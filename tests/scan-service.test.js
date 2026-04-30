const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { ScanService } = require("../backend/scan-service");

test("slow tts does not block completed recognition result", async () => {
  const originalTimeout = process.env.TTS_RESULT_TIMEOUT_MS;
  process.env.TTS_RESULT_TIMEOUT_MS = "10";
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "tangyou-scan-test-"));
  const service = new ScanService({
    storageDir,
    ttsProvider: {
      generate: () => new Promise(() => {}),
    },
  });

  try {
    const job = await service.createScan({
      image: "data:image/jpeg;base64,abc",
      scenario: "green",
      filename: "meal.jpg",
    });
    const completed = await waitForCompleted(service, job.scan_id);

    assert.equal(completed.status, "completed");
    assert.equal(completed.result.state, "green");
    assert.equal(completed.result.tts.provider, "browser-fallback");
    assert.match(completed.result.tts.reason, /tts_result_timeout/);
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
    if (originalTimeout === undefined) {
      delete process.env.TTS_RESULT_TIMEOUT_MS;
    } else {
      process.env.TTS_RESULT_TIMEOUT_MS = originalTimeout;
    }
  }
});

async function waitForCompleted(service, scanId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3000) {
    const job = service.getScan(scanId);
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("scan did not complete");
}
