import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { OA_TAB_IDS, OA_TAB_BUTTONS, OA_PANELS, OA_SCRIPT } from "./oaAdminUi.js";

const router = Router();

function checkSecret(req, res) {
  if (req.body.secret !== process.env.CONTENT_ADMIN_SECRET) {
    res.status(401).json({ message: "Sai mật khẩu quản trị" });
    return false;
  }
  return true;
}

router.post("/data", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const [
    { data: articles, error: e1 },
    { data: courses, error: e2 },
    { data: lessons, error: e3 },
    { data: scorecards, error: e4 },
    settingsResult,
    resourcesResult,
  ] = await Promise.all([
    supabase.from("articles").select("*").order("published_at", { ascending: false }),
    supabase.from("courses").select("*").order("sort_order"),
    supabase.from("lessons").select("*").order("sort_order"),
    supabase.from("scorecard_configs").select("*").order("created_at"),
    supabase.from("app_settings").select("*").order("key"),
    supabase.from("resources").select("*").order("sort_order"),
  ]);
  // Core content tables have existed since day one — a real error there is
  // worth failing loudly on. `app_settings`/`resources` are newer, migration
  // gated tables (sql/004, sql/005) — degrade to an empty list instead of
  // blocking every other tab if the user hasn't run that migration yet.
  const error = e1 || e2 || e3 || e4;
  if (error) return res.status(500).json({ message: error.message });
  res.json({
    articles,
    courses,
    lessons,
    scorecards,
    settings: settingsResult.data || [],
    resources: resourcesResult.data || [],
  });
});

router.post("/settings", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { values } = req.body || {};
  if (!values || typeof values !== "object") return res.status(400).json({ message: "Thiếu dữ liệu" });
  const rows = Object.entries(values).map(([key, value]) => ({ key, value: String(value ?? "") }));
  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return res.status(500).json({ message: error.message });
  res.json({ saved: true });
});

// slug is the natural unique key — the same "save" endpoint both creates
// and edits (upsert), so the client is responsible for locking the slug
// field once editing an existing row (see the page's JS) — otherwise
// changing it here would silently create a new row instead of updating.
router.post("/articles", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { slug, title, excerpt, body, cover_image_url, is_published } = req.body;
  if (!slug || !title) return res.status(400).json({ message: "Thiếu slug hoặc tiêu đề" });
  const { error } = await supabase
    .from("articles")
    .upsert({ slug, title, excerpt, body, cover_image_url: cover_image_url || null, is_published: !!is_published }, { onConflict: "slug" });
  if (error) return res.status(500).json({ message: error.message });
  res.json({ saved: true });
});

router.post("/articles/toggle", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { error } = await supabase.from("articles").update({ is_published: req.body.is_published }).eq("slug", req.body.slug);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ ok: true });
});

router.post("/resources", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { slug, title, description, file_url, icon_type, cover_image_url, is_published, sort_order } = req.body;
  if (!slug || !title || !file_url) return res.status(400).json({ message: "Thiếu slug, tiêu đề hoặc link file" });
  const { error } = await supabase.from("resources").upsert(
    {
      slug,
      title,
      description,
      file_url,
      icon_type: icon_type || "pdf",
      cover_image_url: cover_image_url || null,
      is_published: !!is_published,
      sort_order: Number(sort_order) || 0,
    },
    { onConflict: "slug" }
  );
  if (error) return res.status(500).json({ message: error.message });
  res.json({ saved: true });
});

router.post("/resources/toggle", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { error } = await supabase.from("resources").update({ is_published: req.body.is_published }).eq("slug", req.body.slug);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ ok: true });
});

router.post("/resources/delete", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { error } = await supabase.from("resources").delete().eq("slug", req.body.slug);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ ok: true });
});

router.post("/articles/delete", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { error } = await supabase.from("articles").delete().eq("slug", req.body.slug);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ ok: true });
});

router.post("/courses", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { slug, title, description, cover_image_url, is_free, is_published, sort_order } = req.body;
  if (!slug || !title) return res.status(400).json({ message: "Thiếu slug hoặc tiêu đề" });
  const { error } = await supabase.from("courses").upsert(
    {
      slug,
      title,
      description,
      cover_image_url: cover_image_url || null,
      is_free: !!is_free,
      is_published: !!is_published,
      sort_order: Number(sort_order) || 0,
    },
    { onConflict: "slug" }
  );
  if (error) return res.status(500).json({ message: error.message });
  res.json({ saved: true });
});

router.post("/courses/toggle", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { error } = await supabase.from("courses").update({ is_published: req.body.is_published }).eq("slug", req.body.slug);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ ok: true });
});

router.post("/courses/delete", async (req, res) => {
  if (!checkSecret(req, res)) return;
  // Lessons reference course_slug with ON DELETE CASCADE (see sql/001_init.sql)
  // so deleting a course cleans up its lessons automatically.
  const { error } = await supabase.from("courses").delete().eq("slug", req.body.slug);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ ok: true });
});

router.post("/lessons", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { course_slug, title, video_url, body, sort_order, is_locked } = req.body;
  if (!course_slug || !title) return res.status(400).json({ message: "Thiếu khoá học hoặc tiêu đề bài học" });
  const { error } = await supabase
    .from("lessons")
    .insert({ course_slug, title, video_url: video_url || null, body, sort_order: Number(sort_order) || 0, is_locked: !!is_locked });
  if (error) return res.status(500).json({ message: error.message });
  res.json({ saved: true });
});

// Separate from /lessons (insert-only) since a lesson has no natural slug
// to upsert on — editing an existing one updates by its uuid instead.
router.post("/lessons/update", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { id, title, video_url, body, sort_order, is_locked } = req.body;
  if (!id || !title) return res.status(400).json({ message: "Thiếu id hoặc tiêu đề bài học" });
  const { error } = await supabase
    .from("lessons")
    .update({ title, video_url: video_url || null, body, sort_order: Number(sort_order) || 0, is_locked: !!is_locked })
    .eq("id", id);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ saved: true });
});

router.post("/lessons/delete", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { error } = await supabase.from("lessons").delete().eq("id", req.body.id);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ ok: true });
});

// Checks the exact shape computeScorecardResult() and the Mini App's
// scorecard-take/scorecard-result pages read from — not just "does the key
// exist". A config that passes the old shallow check (top-level keys present)
// could still crash the app with a blank screen if e.g. scale.labels was
// missing or areas used the wrong field names (this happened once with a
// config drafted in a different shape — see
// project_uplifting_coaching_miniapp memory). Returns an error string
// pinpointing the bad field, or null if the config is safe to save.
function validateScorecardConfig(config) {
  if (!config || typeof config !== "object") return "Cấu hình phải là một object JSON";
  if (typeof config.title !== "string" || !config.title.trim()) return 'Cấu hình thiếu "title" (chuỗi, hiển thị trên đầu trang làm bài)';

  const { scale } = config;
  if (!scale || typeof scale.min !== "number" || typeof scale.max !== "number" || scale.max <= scale.min) {
    return '"scale.min" và "scale.max" phải là số, và scale.max phải lớn hơn scale.min';
  }
  const expectedLabels = scale.max - scale.min + 1;
  if (!Array.isArray(scale.labels) || scale.labels.length !== expectedLabels) {
    return `"scale.labels" phải là mảng đúng ${expectedLabels} nhãn (một nhãn cho mỗi mức điểm từ ${scale.min} đến ${scale.max})`;
  }

  if (!Array.isArray(config.areas) || config.areas.length === 0) return '"areas" phải là mảng có ít nhất 1 mảng câu hỏi';
  for (const area of config.areas) {
    if (typeof area.key !== "string" || !area.key.trim()) return 'Mỗi mảng trong "areas" cần có "key" (chuỗi, không dấu, dùng làm mã nội bộ)';
    if (typeof area.label !== "string" || !area.label.trim()) return `Mảng "${area.key}" thiếu "label" (tên hiển thị)`;
    if (!Array.isArray(area.statements) || area.statements.length === 0 || area.statements.some((s) => typeof s !== "string" || !s.trim())) {
      return `Mảng "${area.key}" cần "statements" là mảng câu phát biểu (chuỗi), không được để trống`;
    }
  }

  if (!Array.isArray(config.tiers) || config.tiers.length === 0) return '"tiers" phải là mảng có ít nhất 1 mức kết quả';
  for (const tier of config.tiers) {
    if (typeof tier.min !== "number" || typeof tier.max !== "number") return 'Mỗi mức trong "tiers" cần "min" và "max" là số';
    if (typeof tier.name !== "string" || !tier.name.trim()) return 'Mỗi mức trong "tiers" cần "name" (tên hiển thị)';
  }

  if (!Array.isArray(config.areaBands) || config.areaBands.length === 0) return '"areaBands" phải là mảng có ít nhất 1 mức nhận xét theo mảng';
  for (const band of config.areaBands) {
    if (typeof band.max !== "number") return 'Mỗi mức trong "areaBands" cần "max" là số (điểm tối đa của mức đó)';
    if (typeof band.message !== "string" || !band.message.trim()) return 'Mỗi mức trong "areaBands" cần "message" (nhận xét hiển thị)';
  }

  return null;
}

// Scorecards have no delete button in the UI on purpose — scorecard_results
// rows reference a config by slug (see sql/001_init.sql), so deleting one
// that someone has already completed would orphan their history. Deactivate
// (is_active=false) instead — reversible, and getScorecards() already
// filters to is_active so it just stops appearing as a new option.
router.post("/scorecards", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { slug, title, description, is_active, config } = req.body;
  if (!slug || !title) return res.status(400).json({ message: "Thiếu slug hoặc tiêu đề" });
  let parsedConfig;
  try {
    parsedConfig = typeof config === "string" ? JSON.parse(config) : config;
  } catch (err) {
    return res.status(400).json({ message: "Cấu hình JSON không hợp lệ: " + err.message });
  }
  const validationError = validateScorecardConfig(parsedConfig);
  if (validationError) return res.status(400).json({ message: validationError });
  const { error } = await supabase
    .from("scorecard_configs")
    .upsert({ slug, title, description, is_active: !!is_active, config: parsedConfig }, { onConflict: "slug" });
  if (error) return res.status(500).json({ message: error.message });
  res.json({ saved: true });
});

router.post("/scorecards/toggle", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { error } = await supabase.from("scorecard_configs").update({ is_active: req.body.is_active }).eq("slug", req.body.slug);
  if (error) return res.status(500).json({ message: error.message });
  res.json({ ok: true });
});

router.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quản trị nội dung — Uplifting</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1f2430; }
  h1 { font-size: 22px; }
  h2 { font-size: 17px; margin-top: 44px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
  label { display: block; margin-top: 12px; font-weight: 600; font-size: 13px; }
  input, textarea, select { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; font-family: inherit; font-size: 14px; }
  input:disabled { background: #f3f2ee; color: #888; }
  textarea { min-height: 80px; }
  textarea.code { font-family: ui-monospace, monospace; font-size: 12.5px; min-height: 260px; }
  button { padding: 9px 18px; cursor: pointer; }
  .btn-primary { margin-top: 16px; background: #c07a1e; color: #fff; border: none; border-radius: 6px; }
  .btn-secondary { margin-top: 16px; margin-left: 8px; background: #eee; border: none; border-radius: 6px; }
  .btn-small { padding: 3px 10px; font-size: 12px; border: 1px solid #ddd; background: #fff; border-radius: 5px; }
  .btn-small.danger { border-color: #e0b3a8; color: #a23b2e; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .muted { color: #888; font-size: 12px; }
  .msg { margin-top: 8px; font-size: 13px; white-space: pre-wrap; }
  .msg.error { color: #a23b2e; }
  .msg.ok { color: #2f7d54; }
  .checkbox-row { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
  .checkbox-row input { width: auto; margin: 0; }
  fieldset { border: 1px solid #eee; border-radius: 8px; padding: 14px 16px; margin-top: 16px; }
  legend { font-weight: 700; font-size: 13px; padding: 0 6px; }
  .editing-banner { display: none; background: #fdf3e4; border: 1px solid #f0d9ae; border-radius: 6px; padding: 8px 12px; font-size: 13px; margin-top: 12px; }
  .editing-banner.show { display: block; }
  .actions { display: flex; gap: 6px; }
  .tab-nav { display: flex; gap: 6px; margin-top: 24px; border-bottom: 1px solid #eee; overflow-x: auto; }
  .tab-btn { background: none; border: none; padding: 10px 14px; font-size: 14px; font-weight: 600; color: #888; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; }
  .tab-btn.active { color: #c07a1e; border-bottom-color: #c07a1e; }
  .tab-panel h2:first-child { margin-top: 20px; }
</style>
</head>
<body>
  <h1>Quản trị nội dung — Uplifting</h1>
  <label>Mật khẩu quản trị
    <input type="password" id="secret" />
  </label>
  <button class="btn-primary" id="loadBtn">Tải dữ liệu</button>
  <div id="loadMsg" class="msg"></div>

  <div id="app" style="display:none">

    <div class="tab-nav">
      <button class="tab-btn" data-tab="articles">Bài viết</button>
      <button class="tab-btn" data-tab="resources">Tài nguyên</button>
      <button class="tab-btn" data-tab="courses">Khoá học</button>
      <button class="tab-btn" data-tab="scorecards">Đánh giá</button>
      <button class="tab-btn" data-tab="settings">Cài đặt hiển thị</button>${OA_TAB_BUTTONS}
    </div>

    <div class="tab-panel" id="tab-articles" hidden>
    <h2>Bài viết</h2>
    <table id="articlesTable"><thead><tr><th>Tiêu đề</th><th>Hiện</th><th></th></tr></thead><tbody></tbody></table>
    <fieldset>
      <legend>Thêm bài viết mới</legend>
      <div id="a_editing" class="editing-banner">Đang sửa bài viết có sẵn — sửa xong bấm "Cập nhật", hoặc "Huỷ" để bỏ.</div>
      <label>Đường dẫn (slug, không dấu, không khoảng trắng) <input id="a_slug" placeholder="vi-du-bai-viet" /></label>
      <label>Tiêu đề <input id="a_title" /></label>
      <label>Tóm tắt ngắn <input id="a_excerpt" /></label>
      <label>Nội dung <textarea id="a_body"></textarea></label>
      <label>Link ảnh bìa (tuỳ chọn) <input id="a_cover" /></label>
      <div class="checkbox-row"><input type="checkbox" id="a_published" checked /><label style="margin:0">Hiển thị ngay</label></div>
      <button class="btn-primary" id="a_save">Thêm bài viết</button>
      <button class="btn-secondary" id="a_cancel" style="display:none">Huỷ sửa</button>
      <div id="a_msg" class="msg"></div>
    </fieldset>
    </div>

    <div class="tab-panel" id="tab-resources" hidden>
    <h2>Tài nguyên</h2>
    <p class="muted">File để khách tải về (PDF, checklist, template...) — hiện trên Trang chủ.</p>
    <table id="resourcesTable"><thead><tr><th>Tiêu đề</th><th>Hiện</th><th></th></tr></thead><tbody></tbody></table>
    <fieldset>
      <legend>Thêm tài nguyên mới</legend>
      <div id="r_editing" class="editing-banner">Đang sửa tài nguyên có sẵn — sửa xong bấm "Cập nhật", hoặc "Huỷ" để bỏ.</div>
      <label>Đường dẫn (slug) <input id="r_slug" placeholder="vi-du-tai-nguyen" /></label>
      <label>Tiêu đề <input id="r_title" /></label>
      <label>Mô tả ngắn <textarea id="r_desc"></textarea></label>
      <label>Link file (PDF, Google Drive, v.v. — link phải xem/tải được công khai) <input id="r_file" placeholder="https://..." /></label>
      <label>Loại tài nguyên (chọn icon phù hợp — chỉ hiện khi không có ảnh đại diện)
        <select id="r_icon">
          <option value="pdf">Tài liệu / PDF</option>
          <option value="video">Video</option>
          <option value="ebook">Ebook / Sách</option>
          <option value="checklist">Checklist</option>
          <option value="link">Link ngoài</option>
        </select>
      </label>
      <label>Link ảnh đại diện (tuỳ chọn — có thì ưu tiên hiện ảnh này thay vì icon) <input id="r_cover" placeholder="https://..." /></label>
      <label>Thứ tự hiển thị (số nhỏ hiện trước) <input id="r_sort" type="number" value="1" /></label>
      <div class="checkbox-row"><input type="checkbox" id="r_published" checked /><label style="margin:0">Hiển thị ngay</label></div>
      <button class="btn-primary" id="r_save">Thêm tài nguyên</button>
      <button class="btn-secondary" id="r_cancel" style="display:none">Huỷ sửa</button>
      <div id="r_msg" class="msg"></div>
    </fieldset>
    </div>

    <div class="tab-panel" id="tab-courses" hidden>
    <h2>Khoá học</h2>
    <table id="coursesTable"><thead><tr><th>Tiêu đề</th><th>Miễn phí</th><th>Hiện</th><th></th></tr></thead><tbody></tbody></table>
    <fieldset>
      <legend>Thêm khoá học mới</legend>
      <div id="c_editing" class="editing-banner">Đang sửa khoá học có sẵn — sửa xong bấm "Cập nhật", hoặc "Huỷ" để bỏ.</div>
      <label>Đường dẫn (slug) <input id="c_slug" placeholder="ten-khoa-hoc" /></label>
      <label>Tiêu đề <input id="c_title" /></label>
      <label>Mô tả <textarea id="c_desc"></textarea></label>
      <label>Link ảnh bìa (tuỳ chọn) <input id="c_cover" /></label>
      <label>Thứ tự hiển thị (số nhỏ hiện trước) <input id="c_sort" type="number" value="1" /></label>
      <div class="checkbox-row"><input type="checkbox" id="c_free" checked /><label style="margin:0">Miễn phí</label></div>
      <div class="checkbox-row"><input type="checkbox" id="c_published" checked /><label style="margin:0">Hiển thị ngay</label></div>
      <button class="btn-primary" id="c_save">Thêm khoá học</button>
      <button class="btn-secondary" id="c_cancel" style="display:none">Huỷ sửa</button>
      <div id="c_msg" class="msg"></div>
    </fieldset>

    <h2>Bài học</h2>
    <div id="lessonsByCourse"></div>
    <fieldset>
      <legend>Thêm bài học mới</legend>
      <div id="l_editing" class="editing-banner">Đang sửa bài học có sẵn — sửa xong bấm "Cập nhật", hoặc "Huỷ" để bỏ.</div>
      <label>Thuộc khoá học <select id="l_course"></select></label>
      <label>Tiêu đề bài học <input id="l_title" /></label>
      <label>Link video (tuỳ chọn — dán link YouTube bình thường cũng được) <input id="l_video" placeholder="https://..." /></label>
      <label>Nội dung / ghi chú <textarea id="l_body"></textarea></label>
      <label>Thứ tự trong khoá <input id="l_sort" type="number" value="1" /></label>
      <div class="checkbox-row"><input type="checkbox" id="l_locked" /><label style="margin:0">Khoá bài học này — chỉ hiện tên, cần chia sẻ số điện thoại (đăng ký) mới xem được nội dung</label></div>
      <button class="btn-primary" id="l_save">Thêm bài học</button>
      <button class="btn-secondary" id="l_cancel" style="display:none">Huỷ sửa</button>
      <div id="l_msg" class="msg"></div>
    </fieldset>
    </div>

    <div class="tab-panel" id="tab-scorecards" hidden>
    <h2>Đánh giá (Assessment)</h2>
    <p class="muted">Không có nút xoá cố ý — kết quả khách đã làm gắn với bộ này, xoá sẽ mất lịch sử của họ. Muốn ẩn thì bỏ "Đang dùng".</p>
    <table id="scorecardsTable"><thead><tr><th>Tiêu đề</th><th>Đang dùng</th><th></th></tr></thead><tbody></tbody></table>
    <fieldset>
      <legend>Thêm bộ đánh giá mới</legend>
      <div id="s_editing" class="editing-banner">Đang sửa bộ đánh giá có sẵn — sửa xong bấm "Cập nhật", hoặc "Huỷ" để bỏ.</div>
      <label>Đường dẫn (slug) <input id="s_slug" placeholder="ten-bo-danh-gia" /></label>
      <label>Tiêu đề <input id="s_title" /></label>
      <label>Mô tả ngắn <input id="s_desc" /></label>
      <div class="checkbox-row"><input type="checkbox" id="s_active" checked /><label style="margin:0">Đang dùng (hiện cho khách chọn)</label></div>
      <details style="margin-top:12px">
        <summary style="cursor:pointer; font-weight:600; font-size:13px">Hướng dẫn định dạng JSON (bấm để xem)</summary>
        <div style="font-size:12.5px; line-height:1.6; margin-top:8px; color:#444">
          <p><strong>Chỉ có đúng 1 định dạng được chấp nhận</strong> — nếu dán JSON từ ChatGPT/nguồn khác, khả năng cao tên trường sẽ khác và bị từ chối lưu (đây chính là lỗi từng gây trắng màn hình trước khi có bước kiểm tra này). Bấm "Chèn mẫu" bên dưới rồi sửa nội dung bên trong mẫu đó là cách an toàn nhất.</p>
          <p>Các trường bắt buộc, đúng tên như sau:</p>
          <ul style="margin:4px 0; padding-left:18px">
            <li><code>title</code> — tiêu đề hiển thị trên đầu bài làm</li>
            <li><code>scale.min</code>, <code>scale.max</code> — điểm nhỏ nhất/lớn nhất mỗi câu (VD 1 và 5)</li>
            <li><code>scale.labels</code> — mảng nhãn, đúng số lượng = max - min + 1</li>
            <li><code>areas</code> — mảng các mảng câu hỏi, mỗi mảng có <code>key</code> (mã, không dấu), <code>label</code> (tên hiển thị), <code>statements</code> (mảng câu hỏi)</li>
            <li><code>tiers</code> — mảng mức kết quả tổng, mỗi mức có <code>name</code>, <code>min</code>, <code>max</code>, <code>message</code></li>
            <li><code>areaBands</code> — mảng nhận xét theo từng mảng (không phải tổng), mỗi mức có <code>max</code> (điểm tối đa của mức) và <code>message</code>, xếp từ điểm thấp đến cao</li>
          </ul>
        </div>
      </details>
      <label>Cấu hình chi tiết (JSON — mảng câu hỏi, thang điểm, ngưỡng kết quả)
        <textarea class="code" id="s_config" placeholder='{"scale": {...}, "areas": [...], "tiers": [...], "areaBands": [...]}'></textarea>
      </label>
      <button type="button" class="btn-secondary" id="s_template" style="margin-top:0">Chèn mẫu</button>
      <p class="muted">Sai định dạng sẽ báo lỗi rõ và không lưu, không làm hỏng dữ liệu hiện có.</p>
      <button class="btn-primary" id="s_save">Thêm bộ đánh giá</button>
      <button class="btn-secondary" id="s_cancel" style="display:none">Huỷ sửa</button>
      <div id="s_msg" class="msg"></div>
    </fieldset>
    </div>

    <div class="tab-panel" id="tab-settings" hidden>
    <h2>Cài đặt hiển thị</h2>
    <p class="muted">Đổi chữ ở đây sẽ hiện ngay trên app, không cần đăng bản cập nhật mới.</p>
    <fieldset>
      <legend>Banner đánh giá trên Trang chủ</legend>
      <label>Tiêu đề banner <input id="set_home_banner_title" /></label>
      <label>Mô tả banner <textarea id="set_home_banner_desc"></textarea></label>
      <label>Chữ trên nút <input id="set_home_banner_cta_label" /></label>
      <label>Dẫn đến bài đánh giá nào <select id="set_home_banner_scorecard_slug"></select></label>
      <p class="muted">Để trống = tự động chọn bài đánh giá đầu tiên đang bật.</p>
    </fieldset>
    <fieldset>
      <legend>Khối "Chương trình của Uplifting" trên Trang chủ</legend>
      <label>Tiêu đề <input id="set_program_title" /></label>
      <label>Mô tả <textarea id="set_program_desc"></textarea></label>
      <label>Chữ trên nút <input id="set_program_cta_label" /></label>
      <label>Link khi bấm nút (để trống = ẩn khối này) <input id="set_program_cta_url" placeholder="https://..." /></label>
    </fieldset>
    <fieldset>
      <legend>Banner khoá nội dung (hiện dưới cuối trang khoá học có bài bị khoá)</legend>
      <label>Tiêu đề banner <input id="set_lock_banner_title" /></label>
      <label>Mô tả banner <textarea id="set_lock_banner_desc"></textarea></label>
    </fieldset>
    <fieldset>
      <legend>Hộp thoại khi bấm vào bài học bị khoá</legend>
      <label>Tiêu đề hộp thoại <input id="set_lock_modal_title" /></label>
      <label>Mô tả hộp thoại <textarea id="set_lock_modal_desc"></textarea></label>
    </fieldset>
    <label>Chữ trên nút "mở khoá" (dùng chung cho banner khoá + hộp thoại) <input id="set_lock_cta_label" /></label>
    <button class="btn-primary" id="set_save">Lưu cài đặt hiển thị</button>
    <div id="set_msg" class="msg"></div>
    </div>
${OA_PANELS}
  </div>

  <script>
    const TABS = ['articles', 'resources', 'courses', 'scorecards', 'settings'].concat(${JSON.stringify(OA_TAB_IDS)});
    const MINIAPP_ID = ${JSON.stringify(process.env.ZALO_MINI_APP_ID || "")};
    function selectTab(tab) {
      for (const t of TABS) {
        document.getElementById('tab-' + t).hidden = t !== tab;
        document.querySelector('.tab-btn[data-tab="' + t + '"]').classList.toggle('active', t === tab);
      }
      localStorage.setItem('content_admin_tab', tab);
    }
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));
    selectTab(TABS.includes(localStorage.getItem('content_admin_tab')) ? localStorage.getItem('content_admin_tab') : 'articles');

    const secretInput = document.getElementById('secret');
    secretInput.value = localStorage.getItem('content_admin_secret') || '';
    function secret() { return secretInput.value; }

    async function api(path, body) {
      const res = await fetch('/admin/content' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret(), ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Lỗi không rõ');
      return data;
    }

    function showMsg(id, text, ok) {
      const el = document.getElementById(id);
      el.textContent = text;
      el.className = 'msg ' + (ok ? 'ok' : 'error');
    }

    let state = { articles: [], courses: [], lessons: [], scorecards: [], resources: [] };

    // ---- generic edit-mode helper: lock the key field, show cancel/banner,
    // switch the save button's label so it's always clear which mode you're in.
    function enterEditMode(prefix, saveLabel) {
      document.getElementById(prefix + '_editing').classList.add('show');
      document.getElementById(prefix + '_cancel').style.display = 'inline-block';
      document.getElementById(prefix + '_save').textContent = saveLabel;
    }
    function exitEditMode(prefix, addLabel) {
      document.getElementById(prefix + '_editing').classList.remove('show');
      document.getElementById(prefix + '_cancel').style.display = 'none';
      document.getElementById(prefix + '_save').textContent = addLabel;
    }

    // ================= Bài viết =================
    function renderArticles() {
      const tbody = document.querySelector('#articlesTable tbody');
      tbody.innerHTML = state.articles.map(a => \`
        <tr>
          <td>\${a.title}<div class="muted">\${a.slug}</div></td>
          <td><input type="checkbox" \${a.is_published ? 'checked' : ''} onchange="toggleArticle('\${a.slug}', this.checked)" /></td>
          <td class="actions"><button class="btn-small" onclick="editArticle('\${a.slug}')">Sửa</button><button class="btn-small danger" onclick="deleteArticle('\${a.slug}')">Xoá</button></td>
        </tr>\`).join('') || '<tr><td class="muted" colspan="3">Chưa có bài viết nào</td></tr>';
    }
    window.toggleArticle = async (slug, is_published) => { await api('/articles/toggle', { slug, is_published }); load(); };
    window.deleteArticle = async (slug) => {
      if (!confirm('Xoá vĩnh viễn bài viết này? Không hoàn tác được.')) return;
      await api('/articles/delete', { slug }); load();
    };
    window.editArticle = (slug) => {
      const a = state.articles.find(x => x.slug === slug);
      document.getElementById('a_slug').value = a.slug;
      document.getElementById('a_slug').disabled = true;
      document.getElementById('a_title').value = a.title || '';
      document.getElementById('a_excerpt').value = a.excerpt || '';
      document.getElementById('a_body').value = a.body || '';
      document.getElementById('a_cover').value = a.cover_image_url || '';
      document.getElementById('a_published').checked = a.is_published;
      enterEditMode('a', 'Cập nhật bài viết');
      document.getElementById('a_slug').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    document.getElementById('a_cancel').addEventListener('click', () => {
      document.getElementById('a_slug').disabled = false;
      ['a_slug','a_title','a_excerpt','a_body','a_cover'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('a_published').checked = true;
      exitEditMode('a', 'Thêm bài viết');
    });
    document.getElementById('a_save').addEventListener('click', async () => {
      try {
        await api('/articles', {
          slug: document.getElementById('a_slug').value.trim(),
          title: document.getElementById('a_title').value.trim(),
          excerpt: document.getElementById('a_excerpt').value.trim(),
          body: document.getElementById('a_body').value,
          cover_image_url: document.getElementById('a_cover').value.trim(),
          is_published: document.getElementById('a_published').checked,
        });
        showMsg('a_msg', 'Đã lưu!', true);
        document.getElementById('a_cancel').click();
        load();
      } catch (err) { showMsg('a_msg', 'Lỗi: ' + err.message, false); }
    });

    // ================= Tài nguyên =================
    function renderResources() {
      const tbody = document.querySelector('#resourcesTable tbody');
      tbody.innerHTML = state.resources.map(r => \`
        <tr>
          <td>\${r.title}<div class="muted">\${r.slug}</div></td>
          <td><input type="checkbox" \${r.is_published ? 'checked' : ''} onchange="toggleResource('\${r.slug}', this.checked)" /></td>
          <td class="actions"><button class="btn-small" onclick="editResource('\${r.slug}')">Sửa</button><button class="btn-small danger" onclick="deleteResource('\${r.slug}')">Xoá</button></td>
        </tr>\`).join('') || '<tr><td class="muted" colspan="3">Chưa có tài nguyên nào</td></tr>';
    }
    window.toggleResource = async (slug, is_published) => { await api('/resources/toggle', { slug, is_published }); load(); };
    window.deleteResource = async (slug) => {
      if (!confirm('Xoá vĩnh viễn tài nguyên này? Không hoàn tác được.')) return;
      await api('/resources/delete', { slug }); load();
    };
    window.editResource = (slug) => {
      const r = state.resources.find(x => x.slug === slug);
      document.getElementById('r_slug').value = r.slug;
      document.getElementById('r_slug').disabled = true;
      document.getElementById('r_title').value = r.title || '';
      document.getElementById('r_desc').value = r.description || '';
      document.getElementById('r_file').value = r.file_url || '';
      document.getElementById('r_icon').value = r.icon_type || 'pdf';
      document.getElementById('r_cover').value = r.cover_image_url || '';
      document.getElementById('r_sort').value = r.sort_order ?? 1;
      document.getElementById('r_published').checked = r.is_published;
      enterEditMode('r', 'Cập nhật tài nguyên');
      document.getElementById('r_slug').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    document.getElementById('r_cancel').addEventListener('click', () => {
      document.getElementById('r_slug').disabled = false;
      ['r_slug','r_title','r_desc','r_file','r_cover'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('r_icon').value = 'pdf';
      document.getElementById('r_sort').value = 1;
      document.getElementById('r_published').checked = true;
      exitEditMode('r', 'Thêm tài nguyên');
    });
    document.getElementById('r_save').addEventListener('click', async () => {
      try {
        await api('/resources', {
          slug: document.getElementById('r_slug').value.trim(),
          title: document.getElementById('r_title').value.trim(),
          description: document.getElementById('r_desc').value.trim(),
          file_url: document.getElementById('r_file').value.trim(),
          icon_type: document.getElementById('r_icon').value,
          cover_image_url: document.getElementById('r_cover').value.trim(),
          sort_order: document.getElementById('r_sort').value,
          is_published: document.getElementById('r_published').checked,
        });
        showMsg('r_msg', 'Đã lưu!', true);
        document.getElementById('r_cancel').click();
        load();
      } catch (err) { showMsg('r_msg', 'Lỗi: ' + err.message, false); }
    });

    // ================= Khoá học =================
    function renderCourses() {
      const tbody = document.querySelector('#coursesTable tbody');
      tbody.innerHTML = state.courses.map(c => \`
        <tr>
          <td>\${c.title}<div class="muted">\${c.slug}</div></td>
          <td>\${c.is_free ? 'Có' : 'Không'}</td>
          <td><input type="checkbox" \${c.is_published ? 'checked' : ''} onchange="toggleCourse('\${c.slug}', this.checked)" /></td>
          <td class="actions"><button class="btn-small" onclick="editCourse('\${c.slug}')">Sửa</button><button class="btn-small danger" onclick="deleteCourse('\${c.slug}')">Xoá</button></td>
        </tr>\`).join('') || '<tr><td class="muted" colspan="4">Chưa có khoá học nào</td></tr>';

      const select = document.getElementById('l_course');
      const prevValue = select.value;
      select.innerHTML = state.courses.map(c => \`<option value="\${c.slug}">\${c.title}</option>\`).join('');
      if (prevValue) select.value = prevValue;
    }
    window.toggleCourse = async (slug, is_published) => { await api('/courses/toggle', { slug, is_published }); load(); };
    window.deleteCourse = async (slug) => {
      if (!confirm('Xoá vĩnh viễn khoá học này? Toàn bộ bài học bên trong cũng bị xoá theo, không hoàn tác được.')) return;
      await api('/courses/delete', { slug }); load();
    };
    window.editCourse = (slug) => {
      const c = state.courses.find(x => x.slug === slug);
      document.getElementById('c_slug').value = c.slug;
      document.getElementById('c_slug').disabled = true;
      document.getElementById('c_title').value = c.title || '';
      document.getElementById('c_desc').value = c.description || '';
      document.getElementById('c_cover').value = c.cover_image_url || '';
      document.getElementById('c_sort').value = c.sort_order ?? 1;
      document.getElementById('c_free').checked = c.is_free;
      document.getElementById('c_published').checked = c.is_published;
      enterEditMode('c', 'Cập nhật khoá học');
      document.getElementById('c_slug').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    document.getElementById('c_cancel').addEventListener('click', () => {
      document.getElementById('c_slug').disabled = false;
      ['c_slug','c_title','c_desc','c_cover'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('c_sort').value = 1;
      document.getElementById('c_free').checked = true;
      document.getElementById('c_published').checked = true;
      exitEditMode('c', 'Thêm khoá học');
    });
    document.getElementById('c_save').addEventListener('click', async () => {
      try {
        await api('/courses', {
          slug: document.getElementById('c_slug').value.trim(),
          title: document.getElementById('c_title').value.trim(),
          description: document.getElementById('c_desc').value,
          cover_image_url: document.getElementById('c_cover').value.trim(),
          sort_order: document.getElementById('c_sort').value,
          is_free: document.getElementById('c_free').checked,
          is_published: document.getElementById('c_published').checked,
        });
        showMsg('c_msg', 'Đã lưu!', true);
        document.getElementById('c_cancel').click();
        load();
      } catch (err) { showMsg('c_msg', 'Lỗi: ' + err.message, false); }
    });

    // ================= Bài học =================
    function renderLessons() {
      const container = document.getElementById('lessonsByCourse');
      container.innerHTML = state.courses.map(c => {
        const lessons = state.lessons.filter(l => l.course_slug === c.slug);
        return \`<div style="margin-top:10px"><strong>\${c.title}</strong>
          <table><tbody>\${lessons.map(l => \`
            <tr>
              <td>\${l.sort_order}. \${l.title}\${l.video_url ? ' 🎬' : ''}\${l.is_locked ? ' 🔒' : ''}</td>
              <td class="actions"><button class="btn-small" onclick="editLesson('\${l.id}')">Sửa</button><button class="btn-small danger" onclick="deleteLesson('\${l.id}')">Xoá</button></td>
            </tr>
          \`).join('') || '<tr><td class="muted">Chưa có bài học</td></tr>'}</tbody></table>
        </div>\`;
      }).join('');
    }
    window.deleteLesson = async (id) => {
      if (!confirm('Xoá vĩnh viễn bài học này? Không hoàn tác được.')) return;
      await api('/lessons/delete', { id }); load();
    };
    window.editLesson = (id) => {
      const l = state.lessons.find(x => x.id === id);
      document.getElementById('l_course').value = l.course_slug;
      document.getElementById('l_course').disabled = true;
      document.getElementById('l_title').value = l.title || '';
      document.getElementById('l_video').value = l.video_url || '';
      document.getElementById('l_body').value = l.body || '';
      document.getElementById('l_sort').value = l.sort_order ?? 1;
      document.getElementById('l_locked').checked = !!l.is_locked;
      enterEditMode('l', 'Cập nhật bài học');
      document.getElementById('l_save').dataset.editingId = id;
      document.getElementById('l_title').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    document.getElementById('l_cancel').addEventListener('click', () => {
      document.getElementById('l_course').disabled = false;
      ['l_title','l_video','l_body'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('l_sort').value = 1;
      document.getElementById('l_locked').checked = false;
      delete document.getElementById('l_save').dataset.editingId;
      exitEditMode('l', 'Thêm bài học');
    });
    document.getElementById('l_save').addEventListener('click', async () => {
      const editingId = document.getElementById('l_save').dataset.editingId;
      const payload = {
        title: document.getElementById('l_title').value.trim(),
        video_url: document.getElementById('l_video').value.trim(),
        body: document.getElementById('l_body').value,
        sort_order: document.getElementById('l_sort').value,
        is_locked: document.getElementById('l_locked').checked,
      };
      try {
        if (editingId) {
          await api('/lessons/update', { id: editingId, ...payload });
        } else {
          await api('/lessons', { course_slug: document.getElementById('l_course').value, ...payload });
        }
        showMsg('l_msg', 'Đã lưu!', true);
        document.getElementById('l_cancel').click();
        load();
      } catch (err) { showMsg('l_msg', 'Lỗi: ' + err.message, false); }
    });

    // ================= Đánh giá (Assessment) =================
    function renderScorecards() {
      const tbody = document.querySelector('#scorecardsTable tbody');
      tbody.innerHTML = state.scorecards.map(s => \`
        <tr>
          <td>\${s.title}<div class="muted">\${s.slug}</div></td>
          <td><input type="checkbox" \${s.is_active ? 'checked' : ''} onchange="toggleScorecard('\${s.slug}', this.checked)" /></td>
          <td class="actions"><button class="btn-small" onclick="editScorecard('\${s.slug}')">Sửa</button></td>
        </tr>\`).join('') || '<tr><td class="muted" colspan="3">Chưa có bộ đánh giá nào</td></tr>';
    }
    window.toggleScorecard = async (slug, is_active) => { await api('/scorecards/toggle', { slug, is_active }); load(); };
    window.editScorecard = (slug) => {
      const s = state.scorecards.find(x => x.slug === slug);
      document.getElementById('s_slug').value = s.slug;
      document.getElementById('s_slug').disabled = true;
      document.getElementById('s_title').value = s.title || '';
      document.getElementById('s_desc').value = s.description || '';
      document.getElementById('s_active').checked = s.is_active;
      document.getElementById('s_config').value = JSON.stringify(s.config, null, 2);
      enterEditMode('s', 'Cập nhật bộ đánh giá');
      document.getElementById('s_slug').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const SCORECARD_TEMPLATE = {
      title: 'Tên bài đánh giá',
      scale: { min: 1, max: 5, labels: ['Hoàn toàn không đúng', 'Ít đúng', 'Đúng một phần', 'Khá đúng', 'Hoàn toàn đúng'] },
      areas: [
        { key: 'mang-1', label: 'Tên mảng 1', statements: ['Câu phát biểu 1', 'Câu phát biểu 2', 'Câu phát biểu 3'] },
        { key: 'mang-2', label: 'Tên mảng 2', statements: ['Câu phát biểu 1', 'Câu phát biểu 2', 'Câu phát biểu 3'] },
      ],
      tiers: [
        { name: 'Mức thấp', min: 6, max: 15, message: 'Nhận xét cho mức điểm tổng thấp.' },
        { name: 'Mức cao', min: 16, max: 30, message: 'Nhận xét cho mức điểm tổng cao.' },
      ],
      areaBands: [
        { max: 9, message: 'Nhận xét khi điểm mảng này thấp.' },
        { max: 15, message: 'Nhận xét khi điểm mảng này cao.' },
      ],
    };
    document.getElementById('s_template').addEventListener('click', () => {
      const el = document.getElementById('s_config');
      if (el.value.trim() && !confirm('Thay thế nội dung đang nhập bằng mẫu?')) return;
      el.value = JSON.stringify(SCORECARD_TEMPLATE, null, 2);
    });
    document.getElementById('s_cancel').addEventListener('click', () => {
      document.getElementById('s_slug').disabled = false;
      ['s_slug','s_title','s_desc','s_config'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('s_active').checked = true;
      exitEditMode('s', 'Thêm bộ đánh giá');
    });
    document.getElementById('s_save').addEventListener('click', async () => {
      try {
        await api('/scorecards', {
          slug: document.getElementById('s_slug').value.trim(),
          title: document.getElementById('s_title').value.trim(),
          description: document.getElementById('s_desc').value.trim(),
          is_active: document.getElementById('s_active').checked,
          config: document.getElementById('s_config').value,
        });
        showMsg('s_msg', 'Đã lưu!', true);
        document.getElementById('s_cancel').click();
        load();
      } catch (err) { showMsg('s_msg', 'Lỗi: ' + err.message, false); }
    });

    // ================= Cài đặt hiển thị =================
    const SETTINGS_KEYS = [
      'home_banner_title', 'home_banner_desc', 'home_banner_cta_label', 'home_banner_scorecard_slug',
      'program_title', 'program_desc', 'program_cta_label', 'program_cta_url',
      'lock_banner_title', 'lock_banner_desc', 'lock_modal_title', 'lock_modal_desc', 'lock_cta_label',
    ];
    function renderSettings() {
      const bySettingKey = Object.fromEntries((state.settings || []).map(s => [s.key, s.value]));
      const slugSelect = document.getElementById('set_home_banner_scorecard_slug');
      const prevValue = bySettingKey.home_banner_scorecard_slug ?? slugSelect.value;
      slugSelect.innerHTML = '<option value="">(Tự động chọn)</option>' +
        state.scorecards.map(s => \`<option value="\${s.slug}">\${s.title}</option>\`).join('');
      slugSelect.value = prevValue;
      for (const key of SETTINGS_KEYS) {
        if (key === 'home_banner_scorecard_slug') continue;
        const el = document.getElementById('set_' + key);
        if (el && bySettingKey[key] !== undefined) el.value = bySettingKey[key];
      }
    }
    document.getElementById('set_save').addEventListener('click', async () => {
      try {
        const values = Object.fromEntries(SETTINGS_KEYS.map(key => [key, document.getElementById('set_' + key).value]));
        await api('/settings', { values });
        showMsg('set_msg', 'Đã lưu!', true);
        load();
      } catch (err) { showMsg('set_msg', 'Lỗi: ' + err.message, false); }
    });

${OA_SCRIPT}
    async function load() {
      document.getElementById('loadMsg').textContent = 'Đang tải...';
      try {
        localStorage.setItem('content_admin_secret', secret());
        state = await api('/data', {});
        document.getElementById('app').style.display = 'block';
        document.getElementById('loadMsg').textContent = '';
        renderArticles(); renderCourses(); renderLessons(); renderScorecards(); renderSettings(); renderResources();
        if (window.loadOaTabs) window.loadOaTabs();
      } catch (err) {
        document.getElementById('loadMsg').textContent = 'Lỗi: ' + err.message;
      }
    }
    document.getElementById('loadBtn').addEventListener('click', load);
    if (secret()) load();
  </script>
</body>
</html>`);
});

export default router;
