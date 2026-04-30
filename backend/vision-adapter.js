const crypto = require("crypto");
const fsSync = require("fs");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile, spawnSync } = require("child_process");
const { promisify } = require("util");

const MODEL_VERSION = "vision-not-configured-2026-04-29";
const DEMO_MODEL_VERSION = "demo-vision-fixture-2026-04-29";
const OPENAI_PROVIDER_VERSION = "openai-vision-2026-04-30";
const MINIMAX_PROVIDER_VERSION = "minimax-cli-vision-2026-04-30";
const execFileAsync = promisify(execFile);
const SCENARIOS = ["yellow", "gray", "green", "red"];
const ALLOWED_CATEGORIES = new Set([
  "refined_starch",
  "starchy_veg",
  "congee_noodle",
  "non_starchy_veg",
  "protein",
  "sweet_drink",
  "dessert",
  "fried_high_fat",
  "unknown",
]);
const ALLOWED_PORTIONS = new Set(["small", "normal", "large", "unknown"]);

async function analyzeMealImage({ imageDataUrl, scenario }) {
  const imageHash = hashImage(imageDataUrl);
  const selectedScenario = normalizeScenario(scenario);

  if (selectedScenario) {
    return {
      image_hash: imageHash,
      model_version: DEMO_MODEL_VERSION,
      scenario: selectedScenario,
      mode: "demo_fixture",
      ...fixtureForScenario(selectedScenario),
    };
  }

  const provider = selectedVisionProvider();
  if (provider === "minimax") {
    if (!process.env.MINIMAX_API_KEY) {
      return notConfiguredVision(imageHash, "minimax_api_key_missing");
    }
    if (!isMiniMaxCliAvailable()) {
      return notConfiguredVision(imageHash, "minimax_cli_missing");
    }
    return runProviderSafely({
      imageHash,
      provider,
      task: () => analyzeWithMiniMax({ imageDataUrl, imageHash }),
    });
  }

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      return notConfiguredVision(imageHash, "openai_api_key_missing");
    }
    return runProviderSafely({
      imageHash,
      provider,
      task: () => analyzeWithOpenAI({ imageDataUrl, imageHash }),
    });
  }

  return notConfiguredVision(imageHash);
}

function hasRealVisionProvider() {
  const provider = selectedVisionProvider();
  if (provider === "minimax") {
    return Boolean(process.env.MINIMAX_API_KEY) && isMiniMaxCliAvailable();
  }
  if (provider === "openai") {
    return Boolean(process.env.OPENAI_API_KEY);
  }
  return false;
}

function getVisionStatus() {
  const provider = selectedVisionProvider();
  return {
    configured: hasRealVisionProvider(),
    provider,
    model_version: modelVersionForProvider(provider),
    model: provider === "openai" ? openAIModel() : null,
    minimax_cli_bin: provider === "minimax" ? miniMaxCliBin() : null,
    minimax_cli_available: provider === "minimax" ? isMiniMaxCliAvailable() : null,
    supported_providers: ["minimax", "openai"],
    demo_scenarios: SCENARIOS,
    required_env: requiredEnvForProvider(provider),
  };
}

async function runProviderSafely({ imageHash, provider, task }) {
  try {
    return await task();
  } catch (error) {
    return providerErrorVision(imageHash, provider, error);
  }
}

async function analyzeWithMiniMax({ imageDataUrl, imageHash }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tangyou-vision-"));
  const imageFile = path.join(tempDir, `meal.${extensionForImageDataUrl(imageDataUrl)}`);

  try {
    const buffer = decodeImageDataUrl(imageDataUrl);
    await fs.writeFile(imageFile, buffer);
    const { stdout } = await execFileAsync(
      miniMaxCliBin(),
      [
        "vision",
        "describe",
        "--image",
        imageFile,
        "--prompt",
        VISION_PROMPT,
        "--output",
        "json",
        "--quiet",
        "--non-interactive",
      ],
      {
        env: {
          ...process.env,
          HOME: tempDir,
          MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
          MINIMAX_REGION: process.env.MINIMAX_REGION || "cn",
          NO_COLOR: "1",
        },
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const parsed = unwrapMiniMaxContent(parseJsonOutput(stdout));
    return normalizeVisionPayload(parsed, imageHash, {
      scenario: "real_minimax",
      modelVersion: `${MINIMAX_PROVIDER_VERSION}:${miniMaxCliBin()}`,
      providerReason: "minimax_unclear_image",
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function analyzeWithOpenAI({ imageDataUrl, imageHash }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openAIModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "你是糖尿病餐前拍照识别系统的视觉解析器，只做图像结构化，不给医疗建议。",
                "请判断这张图是否是清晰的一餐饭照片，并识别可见食物类别和大致份量 band。",
                "只输出 JSON，不要 Markdown。",
                "JSON 字段：quality(clear/unclear), confidence(0-1), abstainReason(null/string), visible_issues(string[]), recognized(array)。",
                "recognized item 字段：name, category, portion_band, confidence。",
                "category 只能是 refined_starch, starchy_veg, congee_noodle, non_starchy_veg, protein, sweet_drink, dessert, fried_high_fat, unknown。",
                "portion_band 只能是 small, normal, large, unknown。",
                "如果看不清、不是饭菜、主食份量看不出来，把 quality 设为 unclear，confidence 不超过 0.55。",
                "不要输出 can_eat, risk, advice, insulin, medication, diagnosis。",
              ].join("\n"),
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "low",
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI vision HTTP ${response.status}`);
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);
  const parsed = parseJsonOutput(outputText);
  return normalizeVisionPayload(parsed, imageHash, {
    scenario: "real_openai",
    modelVersion: `${OPENAI_PROVIDER_VERSION}:${openAIModel()}`,
    providerReason: "openai_unclear_image",
  });
}

function openAIModel() {
  return process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
}

const VISION_PROMPT = [
  "你是糖尿病餐前拍照识别系统的视觉解析器，只做图像结构化，不给医疗建议。",
  "请判断这张图是否是清晰的一餐饭照片，并识别可见食物类别和大致份量 band。",
  "只输出 JSON 对象，不要 Markdown，不要解释。",
  "JSON 字段：quality(clear/unclear), confidence(0-1), abstainReason(null/string), visible_issues(string[]), recognized(array)。",
  "recognized item 字段：name, category, portion_band, confidence。",
  "name 必须用简体中文食物名，不要英文，不要括号翻译。",
  "category 只能是 refined_starch, starchy_veg, congee_noodle, non_starchy_veg, protein, sweet_drink, dessert, fried_high_fat, unknown。",
  "portion_band 只能是 small, normal, large, unknown。",
  "如果看不清、不是饭菜、主食份量看不出来，把 quality 设为 unclear，confidence 不超过 0.55。",
  "不要输出 can_eat, risk, advice, insulin, medication, diagnosis。",
].join("\n");

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const chunks = [];
  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") {
        chunks.push(content.text);
      }
      if (typeof content.output_text === "string") {
        chunks.push(content.output_text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function parseJsonOutput(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw error;
  }
}

function unwrapMiniMaxContent(payload) {
  if (payload && typeof payload.content === "string") {
    return parseJsonOutput(payload.content);
  }
  return payload;
}

function normalizeVisionPayload(payload, imageHash, { scenario, modelVersion, providerReason }) {
  const quality = payload.quality === "clear" ? "clear" : "unclear";
  const confidence = clampNumber(payload.confidence, 0, 1);
  const recognized = Array.isArray(payload.recognized)
    ? payload.recognized.slice(0, 8).map(normalizeItem)
    : [];

  return {
    image_hash: imageHash,
    model_version: modelVersion,
    scenario,
    mode: "real_provider",
    quality,
    confidence,
    abstainReason:
      typeof payload.abstainReason === "string" && payload.abstainReason
        ? payload.abstainReason
        : quality === "clear"
          ? null
          : providerReason,
    visible_issues: Array.isArray(payload.visible_issues)
      ? payload.visible_issues.filter((item) => typeof item === "string").slice(0, 8)
      : [],
    recognized,
  };
}

function selectedVisionProvider() {
  const explicit = String(process.env.VISION_PROVIDER || "").trim().toLowerCase();
  if (explicit === "minimax" || explicit === "openai") {
    return explicit;
  }
  if (process.env.MINIMAX_API_KEY) {
    return "minimax";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  return null;
}

function modelVersionForProvider(provider) {
  if (provider === "minimax") return MINIMAX_PROVIDER_VERSION;
  if (provider === "openai") return OPENAI_PROVIDER_VERSION;
  return MODEL_VERSION;
}

function requiredEnvForProvider(provider) {
  if (provider === "minimax") {
    const required = [];
    if (!process.env.MINIMAX_API_KEY) required.push("MINIMAX_API_KEY");
    if (!isMiniMaxCliAvailable()) required.push("mmx CLI");
    return required;
  }
  if (provider === "openai") {
    return process.env.OPENAI_API_KEY ? [] : ["OPENAI_API_KEY"];
  }
  return ["VISION_PROVIDER=minimax", "MINIMAX_API_KEY", "mmx CLI"];
}

function miniMaxCliBin() {
  if (process.env.MINIMAX_CLI_BIN) {
    return process.env.MINIMAX_CLI_BIN;
  }
  const localCli = path.join(__dirname, "..", "node_modules", ".bin", "mmx");
  return fsSync.existsSync(localCli) ? localCli : "mmx";
}

function isMiniMaxCliAvailable() {
  const result = spawnSync(miniMaxCliBin(), ["--version"], {
    encoding: "utf8",
    timeout: 1500,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

function decodeImageDataUrl(imageDataUrl) {
  const match = String(imageDataUrl || "").match(/^data:image\/[a-z0-9+.-]+;base64,(.+)$/i);
  if (!match) {
    throw new Error("image data URL is invalid");
  }
  return Buffer.from(match[1], "base64");
}

function extensionForImageDataUrl(imageDataUrl) {
  const match = String(imageDataUrl || "").match(/^data:image\/([a-z0-9+.-]+);base64,/i);
  const type = match ? match[1].toLowerCase() : "jpeg";
  if (type === "png") return "png";
  if (type === "webp") return "webp";
  if (type === "gif") return "gif";
  return "jpg";
}

function normalizeItem(item) {
  const category = ALLOWED_CATEGORIES.has(item.category) ? item.category : "unknown";
  const portionBand = ALLOWED_PORTIONS.has(item.portion_band) ? item.portion_band : "unknown";
  return {
    name: normalizeFoodName(item.name),
    category,
    portion_band: portionBand,
    confidence: clampNumber(item.confidence, 0, 1),
  };
}

function normalizeFoodName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "未知食物";

  const chinese = raw
    .replace(/\s*[（(].*$/g, "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；:：]+$/g, "")
    .slice(0, 24);
  if (/[\u4e00-\u9fff]/.test(chinese)) {
    return chinese;
  }

  const lower = raw.toLowerCase();
  const translations = [
    [/rice|grain|quinoa|couscous/, "米饭"],
    [/noodle|pasta|spaghetti/, "面条"],
    [/congee|porridge/, "粥"],
    [/bread|toast|bun|mantou/, "面包"],
    [/shrimp|prawn/, "虾"],
    [/chicken|poultry/, "鸡肉"],
    [/beef|steak/, "牛肉"],
    [/pork|ham/, "猪肉"],
    [/fish|salmon|tuna|cod/, "鱼肉"],
    [/tofu|bean curd/, "豆腐"],
    [/egg/, "鸡蛋"],
    [/sausage|chorizo|bacon/, "香肠"],
    [/broccoli/, "西兰花"],
    [/bok choy|cabbage|lettuce|greens|vegetable|mixed veg|pepper|pea|carrot/, "蔬菜"],
    [/mushroom/, "蘑菇"],
    [/lemon/, "柠檬"],
    [/cilantro|parsley|coriander/, "香菜"],
    [/soup/, "汤"],
    [/dessert|cake|cookie|sweet/, "甜点"],
    [/juice|soda|drink|beverage/, "甜饮"],
  ];

  const matched = translations.find(([pattern]) => pattern.test(lower));
  return matched ? matched[1] : "未知食物";
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.max(min, Math.min(max, number));
}

function notConfiguredVision(imageHash, reason = "vision_provider_not_configured") {
  return {
    image_hash: imageHash,
    model_version: MODEL_VERSION,
    scenario: "not_configured",
    mode: "not_configured",
    quality: "unclear",
    confidence: 0,
    abstainReason: reason,
    visible_issues: [reason],
    recognized: [],
  };
}

function providerErrorVision(imageHash, provider, error) {
  const reason = `${provider}_vision_error`;
  return {
    image_hash: imageHash,
    model_version: modelVersionForProvider(provider),
    scenario: "provider_error",
    mode: "provider_error",
    quality: "unclear",
    confidence: 0,
    abstainReason: reason,
    visible_issues: [reason, String(error.message || error).slice(0, 120)],
    recognized: [],
  };
}

function normalizeScenario(scenario) {
  if (!scenario) return null;
  return SCENARIOS.includes(scenario) ? scenario : null;
}

function hashImage(imageDataUrl) {
  return crypto.createHash("sha256").update(imageDataUrl || "").digest("hex").slice(0, 24);
}

function fixtureForScenario(scenario) {
  if (scenario === "gray") {
    return {
      quality: "unclear",
      confidence: 0.42,
      abstainReason: "blurry_or_incomplete_plate",
      visible_issues: ["blur", "plate_not_complete"],
      recognized: [
        {
          name: "疑似米饭",
          category: "refined_starch",
          portion_band: "unknown",
          confidence: 0.38,
        },
      ],
    };
  }

  if (scenario === "green") {
    return {
      quality: "clear",
      confidence: 0.84,
      abstainReason: null,
      visible_issues: [],
      recognized: [
        {
          name: "杂粮饭",
          category: "refined_starch",
          portion_band: "normal",
          confidence: 0.78,
        },
        {
          name: "青菜",
          category: "non_starchy_veg",
          portion_band: "large",
          confidence: 0.86,
        },
        {
          name: "鸡肉",
          category: "protein",
          portion_band: "normal",
          confidence: 0.83,
        },
      ],
    };
  }

  if (scenario === "red") {
    return {
      quality: "clear",
      confidence: 0.88,
      abstainReason: null,
      visible_issues: ["sweet_drink_visible"],
      recognized: [
        {
          name: "米饭",
          category: "refined_starch",
          portion_band: "large",
          confidence: 0.83,
        },
        {
          name: "甜饮",
          category: "sweet_drink",
          portion_band: "normal",
          confidence: 0.9,
        },
        {
          name: "青菜",
          category: "non_starchy_veg",
          portion_band: "small",
          confidence: 0.72,
        },
      ],
    };
  }

  return {
    quality: "clear",
    confidence: 0.76,
    abstainReason: null,
    visible_issues: ["starch_portion_large"],
    recognized: [
      {
        name: "米饭",
        category: "refined_starch",
        portion_band: "large",
        confidence: 0.82,
      },
      {
        name: "青菜",
        category: "non_starchy_veg",
        portion_band: "normal",
        confidence: 0.75,
      },
      {
        name: "鸡蛋豆腐",
        category: "protein",
        portion_band: "normal",
        confidence: 0.71,
      },
    ],
  };
}

module.exports = {
  MODEL_VERSION,
  analyzeMealImage,
  getVisionStatus,
  hasRealVisionProvider,
};
