const test = require("node:test");
const assert = require("node:assert/strict");
const { TtsProvider } = require("../backend/tts-provider");

test("MiniMax TTS becomes default when API key is configured", () => {
  const restore = withEnv({
    MINIMAX_API_KEY: "test-key",
    TTS_MODE: undefined,
  });

  try {
    const provider = new TtsProvider({ storageDir: "/tmp/tangyou-tts-test" });
    const status = provider.getStatus();

    assert.equal(status.mode, "minimax");
    assert.equal(status.provider, "minimax");
    assert.equal(status.configured, true);
  } finally {
    restore();
  }
});

test("TTS stays on browser fallback when no MiniMax key is configured", () => {
  const restore = withEnv({
    MINIMAX_API_KEY: undefined,
    TTS_MODE: undefined,
  });

  try {
    const provider = new TtsProvider({ storageDir: "/tmp/tangyou-tts-test" });
    const status = provider.getStatus();

    assert.equal(status.mode, "browser");
    assert.equal(status.provider, "browser");
    assert.equal(status.configured, false);
  } finally {
    restore();
  }
});

test("truncated MiniMax voice id falls back to the configured antie voice", () => {
  const restore = withEnv({
    MINIMAX_API_KEY: "test-key",
    MINIMAX_VOICE_ID: "Chinese",
    TTS_MODE: undefined,
  });

  try {
    const provider = new TtsProvider({ storageDir: "/tmp/tangyou-tts-test" });
    const status = provider.getStatus();

    assert.equal(status.mode, "minimax");
    assert.equal(status.voice_id, "Chinese (Mandarin)_Kind-hearted_Antie");
  } finally {
    restore();
  }
});

function withEnv(values) {
  const original = {};
  for (const key of Object.keys(values)) {
    original[key] = process.env[key];
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }

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
