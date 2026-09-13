import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireSession, optionalSession } from "../middleware/session.js";

const router = Router();

// Courses, lessons, and articles are all pure data (see the "no redeploy to
// update content" decision in project_uplifting_coaching_miniapp memory) —
// this route layer never changes when a course or article is added/edited
// through the content-admin page (/admin/content, see contentAdmin.js).

// Small pieces of UI copy (lock banner/modal text) editable from the admin
// page without a Mini App rebuild — see sql/004_app_settings.sql. Defaults
// here mean a fresh row-less deploy still renders sensible text.
const SETTINGS_DEFAULTS = {
  lock_banner_title: "Xem toàn bộ nội dung miễn phí 🔓",
  lock_banner_desc:
    "Chia sẻ số điện thoại để mở khoá toàn bộ bài học — hoàn toàn miễn phí, Uplifting sẽ đồng hành cùng bạn qua Zalo.",
  lock_modal_title: "Mở khoá toàn bộ nội dung",
  lock_modal_desc:
    "Bài học này dành cho người đã đăng ký. Chia sẻ số điện thoại để xem miễn phí toàn bộ khoá học này và các khoá học khác.",
  lock_cta_label: "Đăng ký xem miễn phí",
  home_banner_title: "Bạn đang cân bằng ở đâu?",
  home_banner_desc: "Làm bài đánh giá miễn phí — chỉ 3 phút.",
  home_banner_cta_label: "Bắt đầu",
  home_banner_scorecard_slug: "",
  program_title: "Chương trình của Uplifting",
  program_desc:
    "Tìm hiểu các chương trình coaching phù hợp với bạn — Uplifting sẽ đồng hành cùng bạn qua từng giai đoạn.",
  program_cta_label: "Tìm hiểu thêm",
  program_cta_url: "",
};

router.get("/settings", async (_req, res) => {
  const { data, error } = await supabase.from("app_settings").select("key, value");
  if (error) return res.status(500).json({ message: error.message });
  const settings = { ...SETTINGS_DEFAULTS };
  for (const row of data) settings[row.key] = row.value;
  res.json(settings);
});

router.get("/courses", async (_req, res) => {
  const { data, error } = await supabase
    .from("courses")
    .select("slug, title, description, cover_image_url, is_free")
    .eq("is_published", true)
    .order("sort_order");
  if (error) return res.status(500).json({ message: error.message });
  res.json({ courses: data });
});

// optionalSession, not requireSession: this app is a marketing/lead-gen
// tool, not a paid content platform (see project_uplifting_coaching_miniapp
// memory) — a locked lesson isn't gated behind a purchase, it's gated
// behind sharing a phone number. Anyone with a valid session (i.e. has
// logged in via Zalo at least once) gets every lesson unlocked, regardless
// of is_locked; anonymous callers still get the teaser (title only).
router.get("/courses/:slug", optionalSession, async (req, res) => {
  const { data: course, error } = await supabase
    .from("courses")
    .select("slug, title, description, cover_image_url, is_free")
    .eq("slug", req.params.slug)
    .eq("is_published", true)
    .single();
  if (error || !course) return res.status(404).json({ message: "Không tìm thấy khoá học" });

  const { data: lessons, error: lessonsError } = await supabase
    .from("lessons")
    .select("id, title, video_url, body, sort_order, is_locked")
    .eq("course_slug", req.params.slug)
    .order("sort_order");
  if (lessonsError) return res.status(500).json({ message: lessonsError.message });

  // Locked lessons show up in the curriculum (title, order) so the outline
  // reads like a real course, but video/body are stripped server-side for
  // anonymous callers, not just hidden by the client. `is_locked` in the
  // response reflects whether THIS caller actually has it locked, so the
  // client can keep using it as-is for the lock icon/tap behavior.
  const unlockAll = !!req.session;
  const safeLessons = lessons.map((l) =>
    l.is_locked && !unlockAll ? { ...l, is_locked: true, video_url: null, body: null } : { ...l, is_locked: false }
  );

  res.json({ course, lessons: safeLessons });
});

// Requires login — progress is per-contact. Lightweight (just lesson ids),
// so the client can render a checkmark per lesson without a heavier join.
router.get("/courses/:slug/progress", requireSession, async (req, res) => {
  const { data, error } = await supabase
    .from("lesson_progress")
    .select("lesson_id, lessons!inner(course_slug)")
    .eq("contact_id", req.session.contactId)
    .eq("lessons.course_slug", req.params.slug);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ completedLessonIds: data.map((r) => r.lesson_id) });
});

router.post("/lessons/:id/complete", requireSession, async (req, res) => {
  const { error } = await supabase
    .from("lesson_progress")
    .upsert({ contact_id: req.session.contactId, lesson_id: req.params.id }, { onConflict: "contact_id,lesson_id" });
  if (error) return res.status(500).json({ message: error.message });
  res.json({ completed: true });
});

// Powers Home's "Tiếp tục học" card: finds whichever course this contact
// most recently made progress in (by completed_at) and the next lesson
// they haven't finished yet. Returns { course: null } if they've never
// completed a lesson — the client just doesn't render the card then.
router.get("/progress", requireSession, async (req, res) => {
  const { data: latest, error: latestError } = await supabase
    .from("lesson_progress")
    .select("completed_at, lessons!inner(course_slug)")
    .eq("contact_id", req.session.contactId)
    .order("completed_at", { ascending: false })
    .limit(1);
  if (latestError) return res.status(500).json({ message: latestError.message });
  if (!latest.length) return res.json({ course: null });

  const courseSlug = latest[0].lessons.course_slug;
  const [{ data: course }, { data: lessons }, { data: progress }] = await Promise.all([
    supabase.from("courses").select("slug, title").eq("slug", courseSlug).single(),
    supabase.from("lessons").select("id, title, sort_order").eq("course_slug", courseSlug).order("sort_order"),
    supabase.from("lesson_progress").select("lesson_id").eq("contact_id", req.session.contactId),
  ]);
  if (!course) return res.json({ course: null });

  const completedIds = new Set(progress.map((p) => p.lesson_id));
  const nextLesson = lessons.find((l) => !completedIds.has(l.id)) || null;

  res.json({
    course,
    completedCount: lessons.filter((l) => completedIds.has(l.id)).length,
    totalCount: lessons.length,
    nextLesson,
  });
});

router.get("/articles", async (_req, res) => {
  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, excerpt, cover_image_url, published_at")
    .eq("is_published", true)
    .order("published_at", { ascending: false });
  if (error) return res.status(500).json({ message: error.message });
  res.json({ articles: data });
});

router.get("/articles/:slug", async (req, res) => {
  const { data, error } = await supabase
    .from("articles")
    .select("slug, title, body, cover_image_url, published_at")
    .eq("slug", req.params.slug)
    .eq("is_published", true)
    .single();
  if (error || !data) return res.status(404).json({ message: "Không tìm thấy bài viết" });
  res.json(data);
});

// Downloadable lead-magnet resources (PDFs, templates...) — the client
// opens `file_url` directly (via zmp-sdk's openWebview), no detail page
// needed since there's nothing to render beyond the file itself.
// optionalSession, matching /courses/:slug's model: anonymous callers see
// the teaser (title/description/icon) so resources still work as a Home
// draw, but not the actual file — a locked lesson pattern, not a paid one
// (see project_uplifting_coaching_miniapp memory: registered = full access).
router.get("/resources", optionalSession, async (req, res) => {
  const { data, error } = await supabase
    .from("resources")
    .select("slug, title, description, file_url, icon_type, cover_image_url")
    .eq("is_published", true)
    .order("sort_order");
  if (error) return res.status(500).json({ message: error.message });
  const resources = req.session ? data : data.map((r) => ({ ...r, file_url: null }));
  res.json({ resources });
});

export default router;
