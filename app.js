const screens = new Map(
  Array.from(document.querySelectorAll("[data-screen]")).map((screen) => [
    screen.dataset.screen,
    screen,
  ]),
);

if (window.location.protocol === "file:") {
  window.location.replace("http://localhost:4173/");
}

const API_BASE = resolveApiBase();
const AUTH_TOKEN_KEY = "tangyou_auth_token";
let authToken = window.localStorage.getItem(AUTH_TOKEN_KEY) || "";
let authRequired = false;

const serviceUnavailableResult = {
  state: "gray",
  verdict: "识别没连上",
  advice: "现在不能判断，稍后再试。",
  voice: "识别服务没有连上，我不能判断。请稍后再试。",
  primaryLabel: "重新拍一张",
  primaryAction: "camera",
  recognized: [],
  foodGroups: {
    canEat: [],
    limit: [],
    avoid: [],
    unknown: [],
  },
};

const SCAN_TIMEOUT_MS = 90000;
let currentResult = serviceUnavailableResult;
let progressTimer = null;
let currentAudio = null;

function stopAnalysis() {
  window.clearInterval(progressTimer);
  progressTimer = null;
}

function showScreen(name) {
  if (name !== "analyzing") {
    stopAnalysis();
  }
  for (const screen of screens.values()) {
    screen.classList.remove("active");
  }
  screens.get(name)?.classList.add("active");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}

async function startAnalysis(file) {
  showAnalyzingState();

  try {
    const result = await analyzeWithBackend(file);
    finishAnalyzingState();
    currentResult = result;
    renderResult(currentResult);
    showScreen("result");
  } catch (error) {
    console.warn("Backend scan failed:", error);
    if (isAuthError(error)) {
      clearAuth();
      showAuthMessage("请先登录。");
      showScreen("auth");
      return;
    }
    window.setTimeout(() => {
      finishAnalyzingState();
      currentResult = resultForError(error);
      renderResult(currentResult);
      showScreen("result");
      showToast(currentResult.voice);
    }, 700);
  }
}

function showAnalyzingState() {
  showScreen("analyzing");
  const fill = document.getElementById("progressFill");
  const hint = document.getElementById("analysisHint");
  const startedAt = Date.now();
  fill.style.width = "8%";
  hint.textContent = "正在识别饭菜。";
  window.clearInterval(progressTimer);

  progressTimer = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const progress = Math.min(92, 8 + Math.round((elapsed / 12000) * 84));
    fill.style.width = `${progress}%`;
    if (elapsed > 4500) {
      hint.textContent = "正在判断主食和份量。";
    }
    if (elapsed > 8500) {
      hint.textContent = "如果不确定，我会直接说不能判断。";
    }
  }, 260);
}

function finishAnalyzingState() {
  const fill = document.getElementById("progressFill");
  fill.style.width = "100%";
  stopAnalysis();
}

async function analyzeWithBackend(file) {
  if (window.location.protocol === "file:") {
    throw new Error("Backend API requires http://localhost");
  }
  if (!API_BASE && !isLocalHost()) {
    throw new Error("backend_not_configured");
  }

  const image = await fileToCompressedDataUrl(file);
  const response = await apiFetch("/api/meal-scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image,
      filename: file.name,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error("auth_required");
    throw new Error(`create scan failed: ${response.status}`);
  }

  const job = await response.json();
  return pollScan(job.scan_id);
}

async function pollScan(scanId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SCAN_TIMEOUT_MS) {
    await delay(450);
    const response = await apiFetch(`/api/meal-scans/${encodeURIComponent(scanId)}`);
    if (!response.ok) {
      if (response.status === 401) throw new Error("auth_required");
      throw new Error(`poll scan failed: ${response.status}`);
    }

    const job = await response.json();
    if (job.status === "completed") {
      return normalizeBackendResult(job.result);
    }
    if (job.status === "failed") {
      throw new Error(job.error || "scan failed");
    }
  }

  throw new Error("scan_timeout");
}

function resultForError(error) {
  const message = String(error?.message || error || "");
  if (message === "图片读取失败") {
    return makeFailureResult("图片读不了", "换一张照片，或重新拍一张。", "图片读不了，换一张。");
  }
  if (message.includes("scan_timeout")) {
    return makeFailureResult("识别太慢了", "这次等太久，重新拍一张再试。", "识别太慢了，重新拍一张。");
  }
  if (message.includes("create scan failed: 413")) {
    return makeFailureResult("图片太大", "离近一点重拍，不要上传原图。", "图片太大，重新拍。");
  }
  if (message.includes("create scan failed") || message.includes("poll scan failed")) {
    return makeFailureResult("后端出错", "本地服务返回异常，刷新后再试。", "后端出错，刷新后再试。");
  }
  if (message.includes("backend_not_configured")) {
    return makeFailureResult(
      "识图未接入",
      "外网 H5 还没配置识图后端。",
      "外网识图后端还没配置。",
    );
  }
  if (message.includes("auth_required")) {
    return makeFailureResult("先登录", "登录后才能识别饭菜。", "请先登录。");
  }
  return makeFailureResult(
    "识别没连上",
    "本地识别服务没连上，刷新后再试。",
    "识别服务没连上，刷新后再试。",
  );
}

async function initializeAuth() {
  try {
    const response = await apiFetch("/api/auth/status");
    if (!response.ok) {
      showScreen("camera");
      return;
    }
    const status = await response.json();
    authRequired = Boolean(status.required);
    updateAuthUi(status.user);
    if (authRequired && !status.authenticated) {
      showScreen("auth");
      return;
    }
    showScreen("camera");
  } catch (error) {
    console.warn("Auth status failed:", error);
    showScreen("camera");
  }
}

async function login() {
  await submitAuth("/api/auth/login", false);
}

async function register() {
  await submitAuth("/api/auth/register", true);
}

async function submitAuth(path, includeInviteCode) {
  showAuthMessage("");
  const name = document.getElementById("authName").value.trim();
  const password = document.getElementById("authPassword").value;
  const inviteCode = document.getElementById("inviteCode").value.trim();
  if (!name || !password || (includeInviteCode && !inviteCode)) {
    showAuthMessage(includeInviteCode ? "称呼、密码和邀请码都要填。" : "称呼和密码都要填。");
    return;
  }

  try {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        password,
        invite_code: inviteCode,
      }),
    });
    if (!response.ok) {
      showAuthMessage(await authErrorMessage(response));
      return;
    }
    const session = await response.json();
    authToken = session.token;
    window.localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    updateAuthUi(session.user);
    showScreen("camera");
  } catch (error) {
    console.warn("Auth submit failed:", error);
    showAuthMessage("登录服务没连上。");
  }
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch (error) {
    console.warn("Logout failed:", error);
  }
  clearAuth();
  if (authRequired) {
    showScreen("auth");
  }
}

function clearAuth() {
  authToken = "";
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  updateAuthUi(null);
}

function updateAuthUi(user) {
  document.getElementById("logoutBtn").classList.toggle("hidden", !authRequired || !user);
}

function showAuthMessage(message) {
  document.getElementById("authMessage").textContent = message;
}

async function authErrorMessage(response) {
  try {
    const payload = await response.json();
    const message = String(payload.error || "");
    if (message.includes("invite code")) return "邀请码不对。";
    if (message.includes("already exists")) return "这个称呼已经注册。";
    if (message.includes("password")) return "密码至少 6 位。";
    if (message.includes("name")) return "称呼需要 2 到 24 个字。";
    if (response.status === 401) return "称呼或密码不对。";
  } catch {
    // Fall through to the generic message.
  }
  return "登录失败，稍后再试。";
}

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  return fetch(apiUrl(path), {
    ...options,
    headers,
  });
}

function isAuthError(error) {
  return String(error?.message || error || "").includes("auth_required");
}

function makeFailureResult(verdict, advice, voice) {
  return {
    ...serviceUnavailableResult,
    verdict,
    advice,
    voice,
  };
}

function normalizeBackendResult(result) {
  const recognized = Array.isArray(result.recognized) ? result.recognized : [];
  return {
    state: result.state,
    verdict: result.headline,
    advice: result.advice,
    voice: result.voice_text,
    primaryLabel: result.primary_label,
    primaryAction: result.primary_action,
    ttsAudioUrl: result.tts_audio_url,
    scanId: result.scan_id,
    safety: result.safety,
    recognized,
    foodGroups:
      result.state === "gray"
        ? { canEat: [], limit: [], avoid: [], unknown: [] }
        : normalizeFoodGroups(result.food_groups, recognized),
  };
}

function fileToCompressedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片读取失败"));
    };
    image.src = objectUrl;
  });
}

function renderResult(result) {
  const card = document.getElementById("resultCard");
  card.className = `result-card ${result.state}`;
  renderFoodGroups(result.foodGroups, result.state);
  document.getElementById("resultVerdict").textContent = result.verdict;
  document.getElementById("listenBtn").textContent = result.primaryLabel;
  document
    .getElementById("resultBackBtn")
    .classList.toggle("hidden", result.primaryAction === "camera");
}

function renderFoodGroups(groups, state) {
  const normalized = groups || { canEat: [], limit: [], avoid: [], unknown: [] };
  if (state === "gray" && !hasFoodGroupItems(normalized)) {
    document.getElementById("canEatList").textContent = "不能判断";
    document.getElementById("limitEatList").textContent = "不能判断";
    document.getElementById("avoidEatList").textContent = "不能判断";
    fitFoodGroupLists();
    return;
  }
  document.getElementById("canEatList").textContent = listOrNone(normalized.canEat);
  document.getElementById("limitEatList").textContent = listOrNone(normalized.limit);
  document.getElementById("avoidEatList").textContent = listOrNone(normalized.avoid);
  fitFoodGroupLists();
}

function hasFoodGroupItems(groups) {
  return [groups.canEat, groups.limit, groups.avoid, groups.unknown].some(
    (names) => Array.isArray(names) && names.length > 0,
  );
}

function listOrNone(names) {
  return names && names.length > 0 ? names.slice(0, 5).join("、") : "没有";
}

function fitFoodGroupLists() {
  window.requestAnimationFrame(() => {
    document.querySelectorAll(".food-group-list").forEach(fitOneLineText);
  });
}

function fitOneLineText(element) {
  element.style.setProperty("--food-list-size", "24px");
}

function normalizeFoodGroups(groups, recognized) {
  if (groups && typeof groups === "object") {
    return {
      canEat: normalizeNameList(groups.can_eat),
      limit: normalizeNameList(groups.limit),
      avoid: normalizeNameList(groups.avoid),
      unknown: normalizeNameList(groups.unknown),
    };
  }
  return classifyRecognizedFoods(recognized || []);
}

function normalizeNameList(names) {
  return Array.isArray(names) ? Array.from(new Set(names.map(cleanFoodName).filter(Boolean))) : [];
}

function classifyRecognizedFoods(items) {
  const groups = {
    canEat: [],
    limit: [],
    avoid: [],
    unknown: [],
  };

  for (const item of items || []) {
    const name = cleanFoodName(item.name);
    if (!name) continue;

    if (["sweet_drink", "dessert"].includes(item.category)) {
      pushUnique(groups.avoid, name);
    } else if (
      ["refined_starch", "starchy_veg", "congee_noodle", "fried_high_fat"].includes(
        item.category,
      )
    ) {
      pushUnique(groups.limit, name);
    } else if (["non_starchy_veg", "protein"].includes(item.category)) {
      pushUnique(groups.canEat, name);
    } else {
      pushUnique(groups.unknown, name);
    }
  }

  return groups;
}

function cleanFoodName(name) {
  return String(name || "")
    .replace(/\s*[（(].*$/g, "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；:：]+$/g, "")
    .slice(0, 10);
}

function pushUnique(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

async function speakCurrentResult() {
  if (currentResult.ttsAudioUrl) {
    try {
      if (currentAudio) {
        currentAudio.pause();
      }
      currentAudio = new Audio(currentResult.ttsAudioUrl);
      await currentAudio.play();
      showToast("正在读给老人听");
      return;
    } catch (error) {
      console.warn("TTS audio playback failed, using browser speech:", error);
    }
  }

  speakWithBrowserFallback();
}

function speakWithBrowserFallback() {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    showToast("手机不支持朗读，请看大字提示");
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(currentResult.voice);
  utterance.lang = "zh-CN";
  utterance.rate = 1.18;
  window.speechSynthesis.speak(utterance);
  showToast("正在读给老人听");
}

function openCameraInput() {
  const cameraInput = document.getElementById("cameraInput");
  cameraInput.value = "";
  cameraInput.click();
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function resolveApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("api");
  if (fromQuery) {
    const normalized = normalizeApiBase(fromQuery);
    window.localStorage.setItem("tangyou_api_base", normalized);
    return normalized;
  }
  if (isLocalHost()) {
    window.localStorage.removeItem("tangyou_api_base");
    return "";
  }
  return normalizeApiBase(window.TANGYOU_API_BASE || window.localStorage.getItem("tangyou_api_base") || "");
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function normalizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

document.getElementById("takePhotoBtn").addEventListener("click", openCameraInput);
document.getElementById("cameraFrameBtn").addEventListener("click", openCameraInput);
document.getElementById("loginBtn").addEventListener("click", login);
document.getElementById("registerBtn").addEventListener("click", register);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("cameraInput").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    startAnalysis(file);
  }
});

document.getElementById("listenBtn").addEventListener("click", () => {
  if (currentResult.primaryAction === "camera") {
    showScreen("camera");
    return;
  }
  speakCurrentResult();
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.go));
});

window.addEventListener("resize", fitFoodGroupLists);
renderResult(currentResult);
initializeAuth();
