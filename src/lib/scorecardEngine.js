// Generic scorer for any config shaped like wheel-of-life.json (see that
// file's comment-equivalent in reference_zalo_miniapp_limits_and_deeplink /
// project_uplifting_coaching_miniapp memory): N areas, each with M
// statements on the same 1..max scale, summed per area and overall. Adding
// a new assessment is just a new config row in Supabase — this function
// never changes for that.
//
// `answers` shape: { [areaKey]: number[] } — one entry per area, values in
// the same order as config.areas[i].statements.
export function computeScorecardResult(config, answers) {
  const { min, max } = config.scale;
  const areaScores = {};
  const areaFeedback = {};

  for (const area of config.areas) {
    const values = answers[area.key];
    if (!Array.isArray(values) || values.length !== area.statements.length) {
      throw new Error(`Thiếu hoặc sai số câu trả lời cho mảng "${area.key}"`);
    }
    for (const v of values) {
      if (typeof v !== "number" || v < min || v > max) {
        throw new Error(`Giá trị không hợp lệ ở mảng "${area.key}": ${v}`);
      }
    }
    const score = values.reduce((sum, v) => sum + v, 0);
    areaScores[area.key] = score;
    areaFeedback[area.key] = (config.areaBands.find((b) => score <= b.max) || config.areaBands.at(-1)).message;
  }

  const totalScore = Object.values(areaScores).reduce((sum, s) => sum + s, 0);
  const tier = config.tiers.find((t) => totalScore >= t.min && totalScore <= t.max) || null;

  const focusAreas = [...config.areas]
    .sort((a, b) => areaScores[a.key] - areaScores[b.key])
    .slice(0, 3)
    .map((a) => a.key);

  return { areaScores, totalScore, tier, areaFeedback, focusAreas };
}
