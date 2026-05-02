const DEFAULT_ENDPOINT = "https://api.minimaxi.com/v1/chat/completions";
const DEFAULT_MODEL = "MiniMax-M2.7-highspeed";
const DEFAULT_TIMEOUT_MS = 7000;

const STATES = new Set(["green", "yellow", "red", "gray"]);
const SEVERITY = {
  green: 1,
  yellow: 2,
  red: 3,
  gray: 4,
};

class DiabetesExpertAdvisor {
  constructor() {
    this.apiKey = process.env.MINIMAX_API_KEY || "";
    this.endpoint = process.env.MINIMAX_EXPERT_ENDPOINT || DEFAULT_ENDPOINT;
    this.model = process.env.MINIMAX_EXPERT_MODEL || DEFAULT_MODEL;
    this.mode = process.env.EXPERT_ADVISOR_MODE || (this.apiKey ? "minimax" : "rules");
    this.timeoutMs = Number(process.env.EXPERT_ADVISOR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  }

  getStatus() {
    return {
      configured: this.mode === "minimax" && Boolean(this.apiKey),
      mode: this.mode,
      provider: this.mode === "minimax" ? "minimax" : "rules",
      model: this.mode === "minimax" ? this.model : null,
      endpoint: this.mode === "minimax" ? this.endpoint : null,
      required_env: this.mode === "minimax" && !this.apiKey ? ["MINIMAX_API_KEY"] : [],
    };
  }

  async refine({ vision, ruleResult }) {
    if (ruleResult.state === "gray") {
      return withExpertMeta(ruleResult, {
        provider: "rules",
        reason: "gray_result_not_sent_to_expert",
      });
    }

    if (this.mode !== "minimax" || !this.apiKey) {
      return withExpertMeta(ruleResult, {
        provider: "rules",
        reason: this.mode !== "minimax" ? "EXPERT_ADVISOR_MODE=rules" : "MINIMAX_API_KEY is not set",
      });
    }

    try {
      const expert = await this.callExpert({ vision, ruleResult });
      return withExpertMeta(mergeExpertResult(ruleResult, expert), {
        provider: "minimax",
        model: this.model,
        endpoint: this.endpoint,
      });
    } catch (error) {
      return withExpertMeta(ruleResult, {
        provider: "rules-fallback",
        model: this.model,
        reason: error.message,
      });
    }
  }

  async callExpert({ vision, ruleResult }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          max_tokens: 420,
          messages: [
            {
              role: "system",
              content: expertSystemPrompt(),
            },
            {
              role: "user",
              content: JSON.stringify({
                task: "糖尿病老人餐前饮食风险复核，只能输出 JSON。",
                vision: {
                  quality: vision.quality,
                  confidence: vision.confidence,
                  recognized: vision.recognized,
                  visible_issues: vision.visible_issues,
                },
                local_rule_result: {
                  state: ruleResult.state,
                  headline: ruleResult.headline,
                  advice: ruleResult.advice,
                  food_groups: ruleResult.food_groups,
                  safety: ruleResult.safety,
                },
              }),
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`MiniMax expert HTTP ${response.status}`);
      }

      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      return normalizeExpertPayload(parseJsonObject(content));
    } finally {
      clearTimeout(timer);
    }
  }
}

function expertSystemPrompt() {
  return [
    "你是糖尿病饮食专家复核器，只基于用户上传图片的结构化识别结果做餐前建议。",
    "不要诊断疾病，不要给药物、胰岛素、血糖监测方案，不要替代医生。",
    "你的目标是给老人一句能执行的话，必须保守，宁可提示少吃或别吃，也不要误判为可以吃。",
    "如果照片不清楚、识别置信度低、食物分类不确定，state 必须是 gray。",
    "如果有甜饮、甜点、奶油点心，state 必须是 red。",
    "如果主食过多、粥面类、糯米类、油炸高脂，state 至少是 yellow；明显甜饮甜点必须 red。",
    "输出必须是 JSON 对象，不要 Markdown。",
    "JSON schema: {\"state\":\"green|yellow|red|gray\",\"headline\":\"8个汉字以内，必须具体\",\"advice\":\"24个汉字以内，必须有具体份量或明确动作\",\"voice_text\":\"80个汉字以内，先说不能吃，再说主食份量，再鼓励菜肉\",\"reason\":\"20个汉字以内\"}。",
    "不要使用模糊词：适量、少量吃、控制一下、注意点。",
    "份量表达优先用：主食三分之一碗、主食半碗、主食一拳头、尝两三口、甜饮别喝、甜点别吃。",
  ].join("\n");
}

function parseJsonObject(content) {
  const text = String(content || "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("expert returned no JSON");
  }
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error("expert returned invalid JSON");
  }
}

function normalizeExpertPayload(payload) {
  const state = STATES.has(payload.state) ? payload.state : "";
  if (!state) {
    throw new Error("expert returned invalid state");
  }
  return {
    state,
    headline: cleanText(payload.headline, 12),
    advice: cleanText(payload.advice, 36),
    voice_text: cleanText(payload.voice_text, 110),
    reason: cleanText(payload.reason, 40),
  };
}

function mergeExpertResult(ruleResult, expert) {
  if (ruleResult.state === "gray") {
    return ruleResult;
  }

  const expertIsStricter = SEVERITY[expert.state] > SEVERITY[ruleResult.state];
  const expertKeepsSeverity = SEVERITY[expert.state] === SEVERITY[ruleResult.state];
  if (!expertIsStricter && !expertKeepsSeverity) {
    return ruleResult;
  }

  return {
    ...ruleResult,
    state: expert.state,
    headline: expert.headline || ruleResult.headline,
    advice: expert.advice || ruleResult.advice,
    voice_text: concreteVoiceText(expert.voice_text || ruleResult.voice_text, expert.state),
    safety: {
      ...ruleResult.safety,
      expert_reason: expert.reason || null,
    },
  };
}

function withExpertMeta(result, expert) {
  return {
    ...result,
    safety: {
      ...result.safety,
      expert,
    },
  };
}

function concreteVoiceText(text, state) {
  const normalized = cleanText(text, 110);
  if (state === "yellow" && isVaguePortion(normalized)) {
    return "这顿主食吃三分之一碗。先吃菜肉，吃完别再加主食。";
  }
  if (state === "green" && isVaguePortion(normalized)) {
    return "菜肉可以吃。主食最多一拳头，先吃菜肉。";
  }
  return normalized;
}

function isVaguePortion(text) {
  return !/(三分之一碗|半碗|一拳头|两三口|别喝|别吃|不吃)/.test(text);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；:：]+$/g, "")
    .slice(0, maxLength);
}

module.exports = {
  DiabetesExpertAdvisor,
  mergeExpertResult,
};
