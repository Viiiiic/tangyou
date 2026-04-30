const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeMealImage, getVisionStatus } = require("../backend/vision-adapter");
const { buildResult } = require("../backend/risk-rules");

test("normal upload does not fake a confident food result", async () => {
  const restore = withoutVisionEnv();

  const vision = await analyzeMealImage({
    imageDataUrl: "data:image/jpeg;base64,abc",
  });
  const result = buildResult({
    scanId: "scan_test",
    modelVersion: vision.model_version,
    vision,
  });

  assert.equal(vision.mode, "not_configured");
  assert.equal(result.state, "gray");
  assert.equal(result.headline, "识别未接入");
  assert.equal(result.safety.abstain_reason, "vision_provider_not_configured");

  restore();
});

test("health status points real setup toward MiniMax by default", () => {
  const restore = withoutVisionEnv();

  const status = getVisionStatus();

  assert.equal(status.configured, false);
  assert.equal(status.provider, null);
  assert.deepEqual(status.supported_providers, ["minimax", "openai"]);
  assert.ok(status.required_env.includes("VISION_PROVIDER=minimax"));
  assert.ok(status.required_env.includes("MINIMAX_API_KEY"));

  restore();
});

test("scenario query is explicit demo fixture mode", async () => {
  const vision = await analyzeMealImage({
    imageDataUrl: "data:image/jpeg;base64,abc",
    scenario: "red",
  });
  const result = buildResult({
    scanId: "scan_test",
    modelVersion: vision.model_version,
    vision,
  });

  assert.equal(vision.mode, "demo_fixture");
  assert.equal(result.state, "red");
});

function withoutVisionEnv() {
  const original = {
    VISION_PROVIDER: process.env.VISION_PROVIDER,
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
    MINIMAX_CLI_BIN: process.env.MINIMAX_CLI_BIN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  delete process.env.VISION_PROVIDER;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_CLI_BIN;
  delete process.env.OPENAI_API_KEY;

  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
