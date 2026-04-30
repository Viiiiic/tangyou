const test = require("node:test");
const assert = require("node:assert/strict");
const { buildResult } = require("../backend/risk-rules");

test("routes unclear photo to gray", () => {
  const result = buildResult({
    scanId: "scan_test",
    modelVersion: "test-vision",
    vision: {
      quality: "unclear",
      confidence: 0.4,
      abstainReason: "blur",
      recognized: [],
    },
  });

  assert.equal(result.state, "gray");
  assert.equal(result.primary_action, "camera");
  assert.equal(result.safety.abstain_reason, "blur");
});

test("routes sweet drink to red", () => {
  const result = buildResult({
    scanId: "scan_test",
    modelVersion: "test-vision",
    vision: {
      quality: "clear",
      confidence: 0.9,
      recognized: [
        { name: "米饭", category: "refined_starch", portion_band: "normal", confidence: 0.8 },
        { name: "甜饮", category: "sweet_drink", portion_band: "normal", confidence: 0.9 },
      ],
    },
  });

  assert.equal(result.state, "red");
  assert.equal(result.primary_action, "camera");
});

test("routes large rice to yellow", () => {
  const result = buildResult({
    scanId: "scan_test",
    modelVersion: "test-vision",
    vision: {
      quality: "clear",
      confidence: 0.76,
      recognized: [
        { name: "米饭", category: "refined_starch", portion_band: "large", confidence: 0.82 },
        { name: "青菜", category: "non_starchy_veg", portion_band: "normal", confidence: 0.76 },
        { name: "鸡肉", category: "protein", portion_band: "normal", confidence: 0.79 },
      ],
    },
  });

  assert.equal(result.state, "yellow");
  assert.equal(result.headline, "米饭少半碗");
  assert.equal(result.food_summary, "我看到：米饭、青菜、鸡肉");
  assert.equal(result.voice_text, "看到米饭、青菜、鸡肉。米饭少半碗，先吃菜肉。");
});

test("routes balanced plate to green", () => {
  const result = buildResult({
    scanId: "scan_test",
    modelVersion: "test-vision",
    vision: {
      quality: "clear",
      confidence: 0.84,
      recognized: [
        { name: "杂粮饭", category: "refined_starch", portion_band: "normal", confidence: 0.8 },
        { name: "青菜", category: "non_starchy_veg", portion_band: "large", confidence: 0.86 },
        { name: "豆腐", category: "protein", portion_band: "normal", confidence: 0.82 },
      ],
    },
  });

  assert.equal(result.state, "green");
  assert.equal(result.primary_action, "listen");
});
