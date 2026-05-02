#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");

const UPLOAD_ENDPOINT = process.env.MINIMAX_FILE_UPLOAD_ENDPOINT || "https://api.minimaxi.com/v1/files/upload";
const CLONE_ENDPOINT = process.env.MINIMAX_VOICE_CLONE_ENDPOINT || "https://api.minimaxi.com/v1/voice_clone";
const DEFAULT_MODEL = process.env.MINIMAX_VOICE_CLONE_MODEL || "speech-2.8-hd";
const DEFAULT_DEMO_TEXT = "爸妈，先听我说。这顿饭主食吃三分之一碗，先吃菜肉，甜饮别喝。";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY is required");
  }
  if (!args.consent) {
    throw new Error("Voice cloning uploads biometric voice data. Re-run with --consent after the speaker agrees.");
  }

  const sourceAudio = requirePath(args.audio, "--audio");
  const voiceId = validateVoiceId(args.voiceId || `TangyouVoice_${Date.now()}`);
  const promptText = args.promptText || "这段话用于保持复刻声音的语气和节奏。";
  const demoText = args.demoText || DEFAULT_DEMO_TEXT;

  const cloneFileId = await uploadAudio({
    apiKey,
    filePath: sourceAudio,
    purpose: "voice_clone",
  });

  let clonePrompt = null;
  if (args.promptAudio) {
    const promptAudio = requirePath(args.promptAudio, "--prompt-audio");
    const promptFileId = await uploadAudio({
      apiKey,
      filePath: promptAudio,
      purpose: "prompt_audio",
    });
    clonePrompt = {
      prompt_audio: promptFileId,
      prompt_text: promptText,
    };
  }

  const clonePayload = {
    file_id: cloneFileId,
    voice_id: voiceId,
    text: demoText,
    model: args.model || DEFAULT_MODEL,
    need_noise_reduction: Boolean(args.noiseReduction),
    need_volume_normalization: true,
    aigc_watermark: false,
  };
  if (clonePrompt) {
    clonePayload.clone_prompt = clonePrompt;
  }

  const response = await fetch(CLONE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(clonePayload),
  });
  const body = await response.json();
  if (!response.ok || body.base_resp?.status_code !== 0) {
    throw new Error(body.base_resp?.status_msg || `voice_clone HTTP ${response.status}`);
  }

  console.log(JSON.stringify({
    ok: true,
    voice_id: voiceId,
    demo_audio: body.demo_audio || "",
    next_env: `MINIMAX_VOICE_ID=${voiceId}`,
  }, null, 2));
}

async function uploadAudio({ apiKey, filePath, purpose }) {
  const extension = path.extname(filePath).toLowerCase();
  if (![".mp3", ".m4a", ".wav"].includes(extension)) {
    throw new Error(`${purpose} audio must be mp3, m4a, or wav`);
  }

  const data = await fs.readFile(filePath);
  if (data.length > 20 * 1024 * 1024) {
    throw new Error(`${purpose} audio must be <= 20MB`);
  }

  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", new Blob([data]), path.basename(filePath));

  const response = await fetch(UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const body = await response.json();
  if (!response.ok || body.base_resp?.status_code !== 0) {
    throw new Error(body.base_resp?.status_msg || `${purpose} upload HTTP ${response.status}`);
  }
  return body.file?.file_id;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--consent") args.consent = true;
    else if (arg === "--noise-reduction") args.noiseReduction = true;
    else if (arg === "--audio") args.audio = argv[++index];
    else if (arg === "--prompt-audio") args.promptAudio = argv[++index];
    else if (arg === "--voice-id") args.voiceId = argv[++index];
    else if (arg === "--prompt-text") args.promptText = argv[++index];
    else if (arg === "--demo-text") args.demoText = argv[++index];
    else if (arg === "--model") args.model = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function requirePath(filePath, flag) {
  if (!filePath) {
    throw new Error(`${flag} is required`);
  }
  return path.resolve(filePath);
}

function validateVoiceId(voiceId) {
  const normalized = String(voiceId || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(normalized)) {
    throw new Error("voice_id must be 8-256 chars, start with a letter, and end with a letter or number");
  }
  return normalized;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
