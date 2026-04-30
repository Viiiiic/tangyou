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
      headline: "先别吃",
      advice: sweetDrink ? "去掉甜饮，主食减量。" : "甜点先别吃，主食减量。",
      voiceText: sweetDrink ? "先别吃，去掉甜饮。" : "先别吃，甜点先别吃。",
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
    const headline = refinedStarch?.name?.includes("面") ? "面少一点" : "米饭少半碗";
    return makeResult({
      scanId,
      state: "yellow",
      headline,
      advice: "先吃菜肉，再吃主食。",
      voiceText: `${headline}，先吃菜肉。`,
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
      headline: "按平时量",
      advice: "不要再加甜饮或点心。",
      voiceText: "按平时量，别加甜饮。",
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
    headline: "照片没拍清",
    advice: "重新拍一张，把整盘饭菜拍进去。",
    voiceText: "照片没拍清，重拍一张。",
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
    voice_text: withFoodSummary(voiceText, recognized, foodGroups),
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

function withFoodSummary(voiceText, items, foodGroups) {
  const names = cleanFoodNames(items).slice(0, 3);
  if (names.length === 0) {
    return voiceText;
  }
  const foodDecision = summarizeFoodDecisionForVoice(foodGroups || classifyFoods(items));
  return `看到${names.join("、")}。${foodDecision ? `${foodDecision}。` : ""}${voiceText}`;
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

function summarizeFoodDecisionForVoice(groups) {
  const parts = [];
  if (groups.can_eat.length > 0) {
    parts.push(`${joinNames(groups.can_eat, 3)}可以吃`);
  }
  if (groups.limit.length > 0) {
    parts.push(`${joinNames(groups.limit, 3)}少量吃`);
  }
  if (groups.avoid.length > 0) {
    parts.push(`${joinNames(groups.avoid, 3)}不能吃`);
  } else if (groups.can_eat.length > 0 || groups.limit.length > 0) {
    parts.push("没有不能吃的");
  }
  return parts.join("。");
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
