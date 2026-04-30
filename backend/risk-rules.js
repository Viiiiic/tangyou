const RULES_VERSION = "diabetes-meal-rules-002";

function hasCategory(items, category) {
  return items.some((item) => item.category === category);
}

function findCategory(items, category) {
  return items.find((item) => item.category === category);
}

function getRefinedStarch(items) {
  return items.find((item) =>
    ["refined_starch", "starchy_veg", "congee_noodle"].includes(item.category),
  );
}

function buildResult({ scanId, vision, modelVersion }) {
  const items = vision.recognized || [];
  const confidence = vision.confidence ?? 0;
  const refinedStarch = getRefinedStarch(items);
  const hasProtein = hasCategory(items, "protein");
  const hasVeg = hasCategory(items, "non_starchy_veg");
  const sweetDrink = findCategory(items, "sweet_drink");
  const dessert = findCategory(items, "dessert");

  if (isProviderSetupIssue(vision.abstainReason)) {
    return makeResult({
      scanId,
      state: "gray",
      headline: "识别未接入",
      advice: "当前还不能判断饭菜。",
      voiceText: "现在不能判断。",
      primaryLabel: "重新拍一张",
      primaryAction: "camera",
      recognized: items,
      confidence,
      modelVersion,
      abstainReason: vision.abstainReason,
    });
  }

  if (isProviderRuntimeIssue(vision.abstainReason)) {
    return makeResult({
      scanId,
      state: "gray",
      headline: "识别没连上",
      advice: "当前不能判断饭菜。",
      voiceText: "识别没连上，不能判断。",
      primaryLabel: "重新拍一张",
      primaryAction: "camera",
      recognized: items,
      confidence,
      modelVersion,
      abstainReason: vision.abstainReason,
    });
  }

  if (vision.quality !== "clear" || confidence < 0.56) {
    return makeResult({
      scanId,
      state: "gray",
      headline: "照片没拍清",
      advice: "重新拍一张，把整盘饭菜拍进去。",
      voiceText: "照片没拍清，重拍一张。",
      primaryLabel: "重新拍一张",
      primaryAction: "camera",
      recognized: items,
      confidence,
      modelVersion,
      abstainReason: vision.abstainReason || "low_image_or_model_confidence",
    });
  }

  if (sweetDrink || dessert) {
    return makeResult({
      scanId,
      state: "red",
      headline: sweetDrink ? "甜饮别喝" : "甜点别吃",
      advice: sweetDrink ? "去掉甜饮，主食减量。" : "甜点先别吃，主食减量。",
      voiceText: sweetDrink ? "甜饮别喝，主食少一点。" : "甜点别吃，主食少一点。",
      primaryLabel: "改好再拍",
      primaryAction: "camera",
      recognized: items,
      confidence,
      modelVersion,
      abstainReason: null,
    });
  }

  if (
    refinedStarch?.portion_band === "large" ||
    refinedStarch?.category === "congee_noodle" ||
    (refinedStarch?.portion_band === "normal" && (!hasProtein || !hasVeg))
  ) {
    return makeResult({
      scanId,
      state: "yellow",
      headline: "主食少吃",
      advice: "先吃菜肉，再吃主食。",
      voiceText: "主食少吃，先吃菜肉。",
      primaryLabel: "听怎么做",
      primaryAction: "listen",
      recognized: items,
      confidence,
      modelVersion,
      abstainReason: null,
    });
  }

  if (refinedStarch && hasProtein && hasVeg) {
    return makeResult({
      scanId,
      state: "green",
      headline: "菜肉先吃",
      advice: "先吃菜肉，主食别加量。",
      voiceText: "菜肉先吃，主食按平时量。",
      primaryLabel: "听结果",
      primaryAction: "listen",
      recognized: items,
      confidence,
      modelVersion,
      abstainReason: null,
    });
  }

  if (refinedStarch) {
    return makeResult({
      scanId,
      state: "yellow",
      headline: "少量吃",
      advice: "糯米或主食升糖快，尝一点就好。",
      voiceText: "少量吃，别当主食加量。",
      primaryLabel: "听怎么做",
      primaryAction: "listen",
      recognized: items,
      confidence,
      modelVersion,
      abstainReason: null,
    });
  }

  if (hasProtein || hasVeg) {
    return makeResult({
      scanId,
      state: "green",
      headline: "菜肉可以吃",
      advice: "菜肉可以吃，主食另算。",
      voiceText: "菜肉可以吃，主食另算。",
      primaryLabel: "听结果",
      primaryAction: "listen",
      recognized: items,
      confidence,
      modelVersion,
      abstainReason: null,
    });
  }

  return makeResult({
    scanId,
    state: "gray",
    headline: "不能判断",
    advice: "我看到食物了，但分类不够确定。",
    voiceText: "看到了食物，但还不能判断。",
    primaryLabel: "重新拍一张",
    primaryAction: "camera",
    recognized: items,
    confidence,
    modelVersion,
    abstainReason: "rule_conflict_or_missing_food_groups",
  });
}

function makeResult({
  scanId,
  state,
  headline,
  advice,
  voiceText,
  primaryLabel,
  primaryAction,
  recognized,
  confidence,
  modelVersion,
  abstainReason,
}) {
  const foodGroups = state === "gray" ? emptyFoodGroups() : classifyFoods(recognized);
  return {
    scan_id: scanId,
    state,
    headline,
    advice,
    food_summary: summarizeFoods(recognized),
    food_groups: foodGroups,
    voice_text: buildVoiceText(voiceText, recognized, foodGroups),
    primary_label: primaryLabel,
    primary_action: primaryAction,
    recognized,
    safety: {
      model_version: modelVersion,
      rules_version: RULES_VERSION,
      confidence,
      abstain_reason: abstainReason,
    },
  };
}

function summarizeFoods(items) {
  const names = cleanFoodNames(items);
  return names.length > 0 ? `我看到：${names.join("、")}` : "还没看清食物";
}

function buildVoiceText(voiceText, items, foodGroups) {
  if (!hasFoodGroupItems(foodGroups)) {
    return voiceText;
  }

  const avoid = foodGroups.avoid || [];
  const limit = foodGroups.limit || [];
  const canEat = foodGroups.can_eat || [];
  const vegetables = namesInGroupByCategory(items, ["non_starchy_veg"], canEat);
  const proteins = namesInGroupByCategory(items, ["protein"], canEat);
  const usedCanNames = new Set([...vegetables, ...proteins]);
  const otherCan = canEat.filter((name) => !usedCanNames.has(name));
  const parts = [];

  parts.push(avoid.length > 0 ? `${joinNames(avoid, 5)}不能吃` : "这顿饭没有不能吃的");

  if (limit.length > 0) {
    const limitAdvice = `${joinNames(limit, 5)}少吃点`;
    parts.push(voiceText.includes("先吃菜肉") ? `${limitAdvice}，先吃菜肉` : limitAdvice);
  }

  if (vegetables.length > 0) {
    parts.push(`${joinNames(vegetables, 5)}可以多吃点`);
  }
  if (proteins.length > 0) {
    parts.push(`${joinNames(proteins, 5)}可以吃`);
  }
  if (vegetables.length === 0 && proteins.length === 0 && otherCan.length > 0) {
    parts.push(`${joinNames(otherCan, 5)}可以吃`);
  }

  return `${parts.join("。")}。`;
}

function emptyFoodGroups() {
  return {
    can_eat: [],
    limit: [],
    avoid: [],
    unknown: [],
  };
}

function classifyFoods(items) {
  const groups = emptyFoodGroups();

  for (const item of items || []) {
    const name = cleanFoodName(item.name);
    if (!name) continue;

    if (["sweet_drink", "dessert"].includes(item.category)) {
      pushUnique(groups.avoid, name);
    } else if (
      ["refined_starch", "starchy_veg", "congee_noodle", "fried_high_fat"].includes(
        item.category,
      )
    ) {
      pushUnique(groups.limit, name);
    } else if (["non_starchy_veg", "protein"].includes(item.category)) {
      pushUnique(groups.can_eat, name);
    } else {
      pushUnique(groups.unknown, name);
    }
  }

  return groups;
}

function hasFoodGroupItems(groups) {
  return Boolean(
    groups &&
      [groups.can_eat, groups.limit, groups.avoid, groups.unknown].some(
        (names) => Array.isArray(names) && names.length > 0,
      ),
  );
}

function namesInGroupByCategory(items, categories, groupNames) {
  const categorySet = new Set(categories);
  const groupSet = new Set(groupNames);
  return cleanFoodNames(
    (items || []).filter((item) => {
      const name = cleanFoodName(item.name);
      return categorySet.has(item.category) && groupSet.has(name);
    }),
  );
}

function cleanFoodNames(items) {
  return Array.from(
    new Set(
      (items || [])
        .map((item) => cleanFoodName(item.name))
        .filter(Boolean),
    ),
  ).slice(0, 5);
}

function cleanFoodName(name) {
  return String(name || "")
    .replace(/\s*[（(].*$/g, "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；:：]+$/g, "")
    .slice(0, 10);
}

function pushUnique(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function joinNames(names, limit) {
  return names.slice(0, limit).join("、");
}

function isProviderSetupIssue(reason) {
  return [
    "vision_provider_not_configured",
    "minimax_api_key_missing",
    "minimax_cli_missing",
    "openai_api_key_missing",
  ].includes(reason);
}

function isProviderRuntimeIssue(reason) {
  return reason === "minimax_vision_error" || reason === "openai_vision_error";
}

module.exports = {
  RULES_VERSION,
  buildResult,
};
