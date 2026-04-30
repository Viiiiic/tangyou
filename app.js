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

const serviceUnavailableResult = {
  state: "gray",
  verdict: "识别没连上",
  advice: "现在不能判断，稍后再试。",
  voice: "识别服务没有连上，我不能判断。请稍后再试。",
  primaryLabel: "重新拍一张",
  primaryAction: "camera",
  recognized: [],
};

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
    window.setTimeout(() => {
      finishAnalyzingState();
      currentResult = serviceUnavailableResult;
      renderResult(currentResult);
      showScreen("result");
      showToast("识别没连上，不能判断");
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

  const image = await fileToCompressedDataUrl(file);
  const scenario = new URLSearchParams(window.location.search).get("scenario");
  const response = await fetch(apiUrl("/api/meal-scans"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image,
      filename: file.name,
      scenario,
    }),
  });

  if (!response.ok) {
    throw new Error(`create scan failed: ${response.status}`);
  }

  const job = await response.json();
  return pollScan(job.scan_id);
}

async function pollScan(scanId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 70000) {
    await delay(450);
    const response = await fetch(apiUrl(`/api/meal-scans/${encodeURIComponent(scanId)}`));
    if (!response.ok) {
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

  throw new Error("scan timed out");
}

function normalizeBackendResult(result) {
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
    recognized: Array.isArray(result.recognized) ? result.recognized : [],
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
  renderRecognizedFoods(result.recognized || []);
  document.getElementById("resultVerdict").textContent = result.verdict;
  document.getElementById("adviceText").textContent = result.advice;
  document.getElementById("listenBtn").textContent = result.primaryLabel;
  document
    .getElementById("resultBackBtn")
    .classList.toggle("hidden", result.primaryAction === "camera");
}

function renderRecognizedFoods(items) {
  const foodSeen = document.getElementById("foodSeen");
  const foodList = document.getElementById("foodList");
  const names = Array.from(new Set(items.map((item) => cleanFoodName(item.name)).filter(Boolean)));

  if (names.length === 0) {
    foodSeen.classList.add("unclear");
    foodList.textContent = "还没看清食物";
    return;
  }

  foodSeen.classList.remove("unclear");
  foodList.textContent = names.slice(0, 5).join("、");
}

function cleanFoodName(name) {
  return String(name || "")
    .replace(/\s*[（(].*$/g, "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；:：]+$/g, "")
    .slice(0, 10);
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
  return normalizeApiBase(window.TANGYOU_API_BASE || window.localStorage.getItem("tangyou_api_base") || "");
}

function normalizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

document.getElementById("takePhotoBtn").addEventListener("click", openCameraInput);
document.getElementById("cameraFrameBtn").addEventListener("click", openCameraInput);
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

renderResult(currentResult);
