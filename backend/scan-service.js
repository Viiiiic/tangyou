const fs = require("fs/promises");
const path = require("path");
const { DiabetesExpertAdvisor } = require("./diabetes-expert-advisor");
const { analyzeMealImage } = require("./vision-adapter");
const { buildResult } = require("./risk-rules");

const DEFAULT_TTS_RESULT_TIMEOUT_MS = 8000;

class ScanService {
  constructor({ storageDir, ttsProvider }) {
    this.storageDir = storageDir;
    this.ttsProvider = ttsProvider;
    this.expertAdvisor = new DiabetesExpertAdvisor();
    this.jobs = new Map();
    this.sequence = 0;
  }

  getExpertStatus() {
    return this.expertAdvisor.getStatus();
  }

  async createScan({ image, filename, scenario }) {
    if (!image || typeof image !== "string") {
      throw new HttpError(400, "image is required");
    }
    if (!image.startsWith("data:image/")) {
      throw new HttpError(400, "image must be a data URL");
    }
    if (image.length > 12 * 1024 * 1024) {
      throw new HttpError(413, "image is too large");
    }

    const scanId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      scan_id: scanId,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.jobs.set(scanId, job);

    this.sequence += 1;
    this.processScan({ scanId, image, filename, scenario }).catch((error) => {
      this.jobs.set(scanId, {
        ...job,
        status: "failed",
        error: error.message,
        updated_at: new Date().toISOString(),
      });
    });

    return job;
  }

  getScan(scanId) {
    const job = this.jobs.get(scanId);
    if (!job) {
      throw new HttpError(404, "scan not found");
    }
    return job;
  }

  async processScan({ scanId, image, filename, scenario }) {
    await delay(550);
    const vision = await analyzeMealImage({
      imageDataUrl: image,
      filename,
      scenario,
    });
    const ruleResult = buildResult({
      scanId,
      vision,
      modelVersion: vision.model_version,
    });
    const result = await this.expertAdvisor.refine({
      vision,
      ruleResult,
    });
    const tts = await this.generateTtsForResult(result.voice_text);
    const completed = {
      scan_id: scanId,
      status: "completed",
      created_at: this.jobs.get(scanId)?.created_at,
      updated_at: new Date().toISOString(),
      result: {
        ...result,
        tts_audio_url: tts.audio_url,
        tts,
      },
      debug: {
        scenario: vision.scenario,
        visible_issues: vision.visible_issues,
        image_hash: vision.image_hash,
      },
    };

    this.jobs.set(scanId, completed);
    await this.appendProvenance(completed);
  }

  async generateTtsForResult(text) {
    const timeoutMs = Number(process.env.TTS_RESULT_TIMEOUT_MS || DEFAULT_TTS_RESULT_TIMEOUT_MS);
    const ttsPromise = this.ttsProvider.generate({ text }).catch((error) => ({
      provider: "browser-fallback",
      audio_url: null,
      cached: false,
      voice_id: "browser",
      model: "speechSynthesis",
      reason: error.message,
    }));

    return Promise.race([
      ttsPromise,
      delay(timeoutMs).then(() => ({
        provider: "browser-fallback",
        audio_url: null,
        cached: false,
        voice_id: "browser",
        model: "speechSynthesis",
        reason: `tts_result_timeout_${timeoutMs}ms`,
      })),
    ]);
  }

  async appendProvenance(job) {
    await fs.mkdir(this.storageDir, { recursive: true });
    const line = JSON.stringify({
      scan_id: job.scan_id,
      ts: job.updated_at,
      state: job.result.state,
      headline: job.result.headline,
      safety: job.result.safety,
      debug: job.debug,
      tts: {
        provider: job.result.tts.provider,
        cached: job.result.tts.cached,
        reason: job.result.tts.reason || null,
      },
    });
    await fs.appendFile(path.join(this.storageDir, "scan-provenance.jsonl"), `${line}\n`);
  }
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  ScanService,
  HttpError,
};
