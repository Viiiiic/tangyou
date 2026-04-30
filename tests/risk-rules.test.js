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
  assert.deepEqual(result.food_groups, {
    can_eat: [],
    limit: [],
    avoid: [],
    unknown: [],
  });
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
  assert.equal(result.headline, "甜饮别喝");
  assert.equal(result.primary_action, "camera");
  assert.deepEqual(result.food_groups.can_eat, []);
  assert.deepEqual(result.food_groups.limit, ["米饭"]);
  assert.deepEqual(result.food_groups.avoid, ["甜饮"]);
  assert.match(result.voice_text, /甜饮不能吃/);
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
  assert.equal(result.headline, "主食少吃");
  assert.equal(result.food_summary, "我看到：米饭、青菜、鸡肉");
  assert.deepEqual(result.food_groups.can_eat, ["青菜", "鸡肉"]);
  assert.deepEqual(result.food_groups.limit, ["米饭"]);
  assert.deepEqual(result.food_groups.avoid, []);
  assert.equal(
    result.voice_text,
    "这顿饭没有不能吃的。米饭少吃点，先吃菜肉。青菜可以多吃点。鸡肉可以吃。",
  );
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
  assert.equal(result.headline, "菜肉先吃");
  assert.equal(result.primary_action, "listen");
  assert.deepEqual(result.food_groups.can_eat, ["青菜", "豆腐"]);
  assert.deepEqual(result.food_groups.limit, ["杂粮饭"]);
  assert.deepEqual(result.food_groups.avoid, []);
  assert.equal(
    result.voice_text,
    "这顿饭没有不能吃的。杂粮饭少吃点。青菜可以多吃点。豆腐可以吃。",
  );
});
