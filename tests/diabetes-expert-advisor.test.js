const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeExpertResult } = require("../backend/diabetes-expert-advisor");

function baseResult(state) {
  return {
    state,
    headline: state,
    advice: "local advice",
    voice_text: "local voice",
    safety: {
      model_version: "test",
      rules_version: "test",
      confidence: 0.9,
      abstain_reason: null,
    },
  };
}

test("expert cannot downgrade a red local result", () => {
  const merged = mergeExpertResult(baseResult("red"), {
    state: "green",
    headline: "可以吃",
    advice: "可以吃",
    voice_text: "可以吃",
    reason: "too loose",
  });

  assert.equal(merged.state, "red");
  assert.equal(merged.voice_text, "local voice");
});

test("expert can upgrade a green local result to yellow with concrete portion", () => {
  const merged = mergeExpertResult(baseResult("green"), {
    state: "yellow",
    headline: "主食三分之一碗",
    advice: "主食吃三分之一碗",
    voice_text: "主食吃三分之一碗，先吃菜肉",
    reason: "主食偏多",
  });

  assert.equal(merged.state, "yellow");
  assert.equal(merged.headline, "主食三分之一碗");
  assert.match(merged.voice_text, /三分之一碗/);
  assert.equal(merged.safety.expert_reason, "主食偏多");
});
