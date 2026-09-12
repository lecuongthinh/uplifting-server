import { Router } from "express";
import crypto from "crypto";
import { supabase } from "../lib/supabase.js";
import { computeScorecardResult } from "../lib/scorecardEngine.js";
import { requireSession } from "../middleware/session.js";
import { addContactTag, updateContactCustomFields } from "../lib/leadconnector.js";

const router = Router();

// Result is free value, shown immediately on submit — no login wall on the
// compute itself (see project_uplifting_coaching_miniapp memory: the phone
// permission is earned by offering to SAVE the result / get follow-up, per
// Zalo review rule 6.1, not by gating the result behind it). The short-TTL
// cache below just bridges "computed the result" to "logged in a moment
// later to save it", the same pattern as zmp's own phone-token flow.
const pendingSubmissions = new Map();
const SUBMISSION_TTL_MS = 30 * 60 * 1000;

function cacheSubmission(slug, result, answers) {
  const submissionId = crypto.randomUUID();
  pendingSubmissions.set(submissionId, { slug, result, answers, expiresAt: Date.now() + SUBMISSION_TTL_MS });
  return submissionId;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pendingSubmissions) if (entry.expiresAt < now) pendingSubmissions.delete(id);
}, 5 * 60 * 1000).unref();

// Data-driven by design (see reference_zalo_miniapp_limits_and_deeplink
// memory): adding a new assessment is a new row here, never a code change.
router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("scorecard_configs")
    .select("slug, title, description")
    .eq("is_active", true);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ scorecards: data });
});

router.get("/:slug", async (req, res) => {
  const { data, error } = await supabase
    .from("scorecard_configs")
    .select("config")
    .eq("slug", req.params.slug)
    .eq("is_active", true)
    .single();
  if (error || !data) return res.status(404).json({ message: "Không tìm thấy bộ đánh giá này" });
  res.json(data.config);
});

router.post("/:slug/submit", async (req, res) => {
  const { answers } = req.body || {};
  if (!answers) return res.status(400).json({ message: "Missing answers" });
  try {
    const { data, error } = await supabase
      .from("scorecard_configs")
      .select("config")
      .eq("slug", req.params.slug)
      .eq("is_active", true)
      .single();
    if (error || !data) return res.status(404).json({ message: "Không tìm thấy bộ đánh giá này" });

    const result = computeScorecardResult(data.config, answers);
    const submissionId = cacheSubmission(req.params.slug, result, answers);
    res.json({ submissionId, result });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Requires a session (i.e. the user just logged in via Zalo phone
// permission) — this is the moment the free result becomes a tracked lead:
// persisted for the 90-day retake comparison, and pushed into GHL so a
// nurture Workflow can pick it up.
router.post("/:slug/claim", requireSession, async (req, res) => {
  const { submissionId } = req.body || {};
  const entry = pendingSubmissions.get(submissionId);
  if (!entry || entry.slug !== req.params.slug) {
    return res.status(410).json({ message: "Kết quả đã hết hạn, vui lòng làm lại bài đánh giá" });
  }
  pendingSubmissions.delete(submissionId);

  const { contactId } = req.session;
  const { result } = entry;

  const { error } = await supabase.from("scorecard_results").insert({
    contact_id: contactId,
    slug: req.params.slug,
    area_scores: result.areaScores,
    total_score: result.totalScore,
    tier_name: result.tier?.name || null,
  });
  if (error) console.error("[scorecards/claim] failed to persist result:", error.message);

  // Best-effort GHL sync — never blocks the response the user is waiting on.
  addContactTag(contactId, `Scorecard: ${result.tier?.name || "Chưa xác định"}`).catch((err) =>
    console.error("[scorecards/claim] tag failed:", err.message)
  );
  const fieldMap = {};
  if (process.env.GHL_FIELD_SCORECARD_TOTAL) fieldMap[process.env.GHL_FIELD_SCORECARD_TOTAL] = result.totalScore;
  if (process.env.GHL_FIELD_SCORECARD_TIER) fieldMap[process.env.GHL_FIELD_SCORECARD_TIER] = result.tier?.name || "";
  if (Object.keys(fieldMap).length > 0) {
    updateContactCustomFields(contactId, fieldMap).catch((err) =>
      console.error("[scorecards/claim] custom fields failed:", err.message)
    );
  }

  res.json({ saved: true });
});

export default router;
