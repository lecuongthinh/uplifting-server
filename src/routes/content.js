import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireSession } from "../middleware/session.js";

const router = Router();

// Courses, lessons, and articles are all pure data (see the "no redeploy to
// update content" decision in project_uplifting_coaching_miniapp memory) —
// this route layer never changes when a course or article is added/edited
// through the content-admin page (/admin/content, see contentAdmin.js).

router.get("/courses", async (_req, res) => {
  const { data, error } = await supabase
    .from("courses")
    .select("slug, title, description, cover_image_url, is_free")
    .eq("is_published", true)
    .order("sort_order");
  if (error) return res.status(500).json({ message: error.message });
  res.json({ courses: data });
});

router.get("/courses/:slug", async (req, res) => {
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
  // reads like a real course, but video/body are stripped server-side, not
  // just hidden by the client — there's no purchase/entitlement system yet
  // (see project_uplifting_coaching_miniapp memory), so nothing can
  // currently "unlock" a lesson; hiding it here is the only real gate that
  // exists today, not just a UI nicety.
  const safeLessons = lessons.map((l) => (l.is_locked ? { ...l, video_url: null, body: null } : l));

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

export default router;
