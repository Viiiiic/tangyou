const crypto = require("crypto");
const fsSync = require("fs");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile, spawnSync } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL = "speech-2.8-hd";
const DEFAULT_VOICE_ID = "Chinese (Mandarin)_Kind-hearted_Antie";
const DEFAULT_ENDPOINT = "https://api.minimaxi.com/v1/t2a_v2";
const DEFAULT_MODE = "browser";

class TtsProvider {
  constructor({ storageDir }) {
    this.storageDir = storageDir;
    this.apiKey = process.env.MINIMAX_API_KEY || "";
    this.endpoint = process.env.MINIMAX_TTS_ENDPOINT || DEFAULT_ENDPOINT;
    this.model = process.env.MINIMAX_TTS_MODEL || DEFAULT_MODEL;
    this.voiceId = process.env.MINIMAX_VOICE_ID || DEFAULT_VOICE_ID;
    this.mode = process.env.TTS_MODE || DEFAULT_MODE;
    this.cliBin = miniMaxCliBin();
  }

  async generate({ text }) {
    if (this.mode !== "minimax") {
      return {
        provider: "browser-fast",
        audio_url: null,
        cached: false,
        voice_id: "browser",
        model: "speechSynthesis",
        reason: "TTS_MODE=browser",
      };
    }

    const cacheKey = this.cacheKey(text);
    const filename = `${cacheKey}.mp3`;
    const outputPath = path.join(this.storageDir, filename);
    const audioUrl = `/tts/${filename}`;

    await fs.mkdir(this.storageDir, { recursive: true });

    if (await exists(outputPath)) {
      return {
        provider: "minimax",
        audio_url: audioUrl,
        cached: true,
        voice_id: this.voiceId,
        model: this.model,
      };
    }

    if (!this.apiKey) {
      return {
        provider: "browser-fallback",
        audio_url: null,
        cached: false,
        voice_id: this.voiceId,
        model: this.model,
        reason: "MINIMAX_API_KEY is not set",
      };
    }

    try {
      if (isMiniMaxCliAvailable(this.cliBin)) {
        await this.generateWithCli({ text, outputPath });
      } else {
        await this.generateWithHttp({ text, outputPath });
      }
      return {
        provider: "minimax",
        audio_url: audioUrl,
        cached: false,
        voice_id: this.voiceId,
        model: this.model,
      };
    } catch (error) {
      return {
        provider: "browser-fallback",
        audio_url: null,
        cached: false,
        voice_id: this.voiceId,
        model: this.model,
        reason: error.message,
      };
    }
  }

  cacheKey(text) {
    return crypto
      .createHash("sha256")
      .update([this.model, this.voiceId, process.env.MINIMAX_TTS_SPEED || "0.9", text].join("|"))
      .digest("hex")
      .slice(0, 32);
  }

  async generateWithCli({ text, outputPath }) {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "tangyou-minimax-tts-"));
    try {
      await execFileAsync(
        this.cliBin,
        [
          "speech",
          "synthesize",
          "--text",
          text,
          "--out",
          outputPath,
          "--model",
          this.model,
          "--voice",
          this.voiceId,
          "--speed",
          String(Number(process.env.MINIMAX_TTS_SPEED || 1.15)),
          "--format",
          "mp3",
          "--sample-rate",
          "32000",
          "--bitrate",
          "128000",
          "--channels",
          "1",
          "--language",
          "Chinese",
          "--quiet",
          "--non-interactive",
        ],
        {
          env: {
            ...process.env,
            HOME: tempHome,
            MINIMAX_API_KEY: this.apiKey,
            MINIMAX_REGION: process.env.MINIMAX_REGION || "cn",
            NO_COLOR: "1",
          },
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
        },
      );
    } finally {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  }

  async generateWithHttp({ text, outputPath }) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        text,
        stream: false,
        language_boost: "Chinese",
        output_format: "hex",
        voice_setting: {
          voice_id: this.voiceId,
          speed: Number(process.env.MINIMAX_TTS_SPEED || 1.15),
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`MiniMax TTS HTTP ${response.status}`);
    }

    const payload = await response.json();
    const statusCode = payload.base_resp?.status_code;
    if (statusCode !== 0) {
      throw new Error(payload.base_resp?.status_msg || "MiniMax TTS failed");
    }

    const hexAudio = payload.data?.audio;
    if (!hexAudio) {
      throw new Error("MiniMax TTS returned no audio");
    }

    await fs.writeFile(outputPath, Buffer.from(hexAudio, "hex"));
  }
}

function miniMaxCliBin() {
  if (process.env.MINIMAX_CLI_BIN) {
    return process.env.MINIMAX_CLI_BIN;
  }
  const localCli = path.join(__dirname, "..", "node_modules", ".bin", "mmx");
  return fsSync.existsSync(localCli) ? localCli : "mmx";
}

function isMiniMaxCliAvailable(cliBin) {
  const result = spawnSync(cliBin, ["--version"], {
    encoding: "utf8",
    timeout: 1500,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  TtsProvider,
};
