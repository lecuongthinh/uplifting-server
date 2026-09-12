import { Router } from "express";
import { supabase } from "../lib/supabase.js";

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
  const [{ data: articles, error: e1 }, { data: courses, error: e2 }, { data: lessons, error: e3 }] =
    await Promise.all([
      supabase.from("articles").select("*").order("published_at", { ascending: false }),
      supabase.from("courses").select("*").order("sort_order"),
      supabase.from("lessons").select("*").order("sort_order"),
    ]);
  const error = e1 || e2 || e3;
  if (error) return res.status(500).json({ message: error.message });
  res.json({ articles, courses, lessons });
});

// slug is the natural unique key — resubmitting the form with the same
// slug updates it (upsert), so "add" and "edit" are the same action and
// there's no separate edit UI to build.
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
  const { course_slug, title, video_url, body, sort_order } = req.body;
  if (!course_slug || !title) return res.status(400).json({ message: "Thiếu khoá học hoặc tiêu đề bài học" });
  const { error } = await supabase
    .from("lessons")
    .insert({ course_slug, title, video_url: video_url || null, body, sort_order: Number(sort_order) || 0 });
  if (error) return res.status(500).json({ message: error.message });
  res.json({ saved: true });
});

router.post("/lessons/delete", async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { error } = await supabase.from("lessons").delete().eq("id", req.body.id);
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
  body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1f2430; }
  h1 { font-size: 22px; }
  h2 { font-size: 17px; margin-top: 40px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
  label { display: block; margin-top: 12px; font-weight: 600; font-size: 13px; }
  input, textarea, select { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; font-family: inherit; font-size: 14px; }
  textarea { min-height: 80px; }
  button { margin-top: 16px; padding: 9px 18px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .row { display: flex; gap: 6px; align-items: center; }
  .muted { color: #888; font-size: 12px; }
  .msg { margin-top: 8px; font-size: 13px; white-space: pre-wrap; }
  .checkbox-row { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
  .checkbox-row input { width: auto; margin: 0; }
  fieldset { border: 1px solid #eee; border-radius: 8px; padding: 14px 16px; margin-top: 16px; }
  legend { font-weight: 700; font-size: 13px; padding: 0 6px; }
</style>
</head>
<body>
  <h1>Quản trị nội dung — Uplifting</h1>
  <label>Mật khẩu quản trị
    <input type="password" id="secret" />
  </label>
  <button id="loadBtn">Tải dữ liệu</button>
  <div id="loadMsg" class="msg"></div>

  <div id="app" style="display:none">
    <h2>Bài viết</h2>
    <table id="articlesTable"><thead><tr><th>Tiêu đề</th><th>Hiện</th><th></th></tr></thead><tbody></tbody></table>
    <fieldset>
      <legend>Thêm / cập nhật bài viết</legend>
      <p class="muted">Nhập lại đúng "Đường dẫn (slug)" của bài đã có để sửa bài đó, thay vì tạo bài mới.</p>
      <label>Đường dẫn (slug, không dấu, không khoảng trắng) <input id="a_slug" placeholder="vi-du-bai-viet" /></label>
      <label>Tiêu đề <input id="a_title" /></label>
      <label>Tóm tắt ngắn <input id="a_excerpt" /></label>
      <label>Nội dung <textarea id="a_body"></textarea></label>
      <label>Link ảnh bìa (tuỳ chọn) <input id="a_cover" /></label>
      <div class="checkbox-row"><input type="checkbox" id="a_published" checked /><label style="margin:0">Hiển thị ngay</label></div>
      <button id="a_save">Lưu bài viết</button>
      <div id="a_msg" class="msg"></div>
    </fieldset>

    <h2>Khoá học</h2>
    <table id="coursesTable"><thead><tr><th>Tiêu đề</th><th>Miễn phí</th><th>Hiện</th><th></th></tr></thead><tbody></tbody></table>
    <fieldset>
      <legend>Thêm / cập nhật khoá học</legend>
      <p class="muted">Nhập lại đúng slug đã có để sửa, thay vì tạo khoá mới.</p>
      <label>Đường dẫn (slug) <input id="c_slug" placeholder="ten-khoa-hoc" /></label>
      <label>Tiêu đề <input id="c_title" /></label>
      <label>Mô tả <textarea id="c_desc"></textarea></label>
      <label>Link ảnh bìa (tuỳ chọn) <input id="c_cover" /></label>
      <label>Thứ tự hiển thị (số nhỏ hiện trước) <input id="c_sort" type="number" value="1" /></label>
      <div class="checkbox-row"><input type="checkbox" id="c_free" checked /><label style="margin:0">Miễn phí</label></div>
      <div class="checkbox-row"><input type="checkbox" id="c_published" checked /><label style="margin:0">Hiển thị ngay</label></div>
      <button id="c_save">Lưu khoá học</button>
      <div id="c_msg" class="msg"></div>
    </fieldset>

    <h2>Bài học</h2>
    <div id="lessonsByCourse"></div>
    <fieldset>
      <legend>Thêm bài học mới</legend>
      <label>Thuộc khoá học <select id="l_course"></select></label>
      <label>Tiêu đề bài học <input id="l_title" /></label>
      <label>Link video (tuỳ chọn) <input id="l_video" placeholder="https://..." /></label>
      <label>Nội dung / ghi chú <textarea id="l_body"></textarea></label>
      <label>Thứ tự trong khoá <input id="l_sort" type="number" value="1" /></label>
      <button id="l_save">Thêm bài học</button>
      <div id="l_msg" class="msg"></div>
    </fieldset>
  </div>

  <script>
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

    let state = { articles: [], courses: [], lessons: [] };

    function renderArticles() {
      const tbody = document.querySelector('#articlesTable tbody');
      tbody.innerHTML = state.articles.map(a => \`
        <tr>
          <td>\${a.title}<div class="muted">\${a.slug}</div></td>
          <td><input type="checkbox" \${a.is_published ? 'checked' : ''} onchange="toggleArticle('\${a.slug}', this.checked)" /></td>
          <td><button onclick="deleteArticle('\${a.slug}')">Xoá</button></td>
        </tr>\`).join('');
    }

    function renderCourses() {
      const tbody = document.querySelector('#coursesTable tbody');
      tbody.innerHTML = state.courses.map(c => \`
        <tr>
          <td>\${c.title}<div class="muted">\${c.slug}</div></td>
          <td>\${c.is_free ? 'Có' : 'Không'}</td>
          <td><input type="checkbox" \${c.is_published ? 'checked' : ''} onchange="toggleCourse('\${c.slug}', this.checked)" /></td>
          <td><button onclick="deleteCourse('\${c.slug}')">Xoá</button></td>
        </tr>\`).join('');

      const select = document.getElementById('l_course');
      select.innerHTML = state.courses.map(c => \`<option value="\${c.slug}">\${c.title}</option>\`).join('');
    }

    function renderLessons() {
      const container = document.getElementById('lessonsByCourse');
      container.innerHTML = state.courses.map(c => {
        const lessons = state.lessons.filter(l => l.course_slug === c.slug);
        return \`<div style="margin-top:10px"><strong>\${c.title}</strong>
          <table><tbody>\${lessons.map(l => \`
            <tr><td>\${l.sort_order}. \${l.title}</td><td><button onclick="deleteLesson('\${l.id}')">Xoá</button></td></tr>
          \`).join('') || '<tr><td class="muted">Chưa có bài học</td></tr>'}</tbody></table>
        </div>\`;
      }).join('');
    }

    async function load() {
      document.getElementById('loadMsg').textContent = 'Đang tải...';
      try {
        localStorage.setItem('content_admin_secret', secret());
        state = await api('/data', {});
        document.getElementById('app').style.display = 'block';
        document.getElementById('loadMsg').textContent = '';
        renderArticles(); renderCourses(); renderLessons();
      } catch (err) {
        document.getElementById('loadMsg').textContent = 'Lỗi: ' + err.message;
      }
    }
    document.getElementById('loadBtn').addEventListener('click', load);

    window.toggleArticle = async (slug, is_published) => {
      await api('/articles/toggle', { slug, is_published }); load();
    };
    window.deleteArticle = async (slug) => {
      if (!confirm('Xoá bài viết này?')) return;
      await api('/articles/delete', { slug }); load();
    };
    window.toggleCourse = async (slug, is_published) => {
      await api('/courses/toggle', { slug, is_published }); load();
    };
    window.deleteCourse = async (slug) => {
      if (!confirm('Xoá khoá học này? Toàn bộ bài học bên trong cũng bị xoá.')) return;
      await api('/courses/delete', { slug }); load();
    };
    window.deleteLesson = async (id) => {
      if (!confirm('Xoá bài học này?')) return;
      await api('/lessons/delete', { id }); load();
    };

    document.getElementById('a_save').addEventListener('click', async () => {
      const msg = document.getElementById('a_msg');
      try {
        await api('/articles', {
          slug: document.getElementById('a_slug').value.trim(),
          title: document.getElementById('a_title').value.trim(),
          excerpt: document.getElementById('a_excerpt').value.trim(),
          body: document.getElementById('a_body').value,
          cover_image_url: document.getElementById('a_cover').value.trim(),
          is_published: document.getElementById('a_published').checked,
        });
        msg.textContent = 'Đã lưu!'; load();
      } catch (err) { msg.textContent = 'Lỗi: ' + err.message; }
    });

    document.getElementById('c_save').addEventListener('click', async () => {
      const msg = document.getElementById('c_msg');
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
        msg.textContent = 'Đã lưu!'; load();
      } catch (err) { msg.textContent = 'Lỗi: ' + err.message; }
    });

    document.getElementById('l_save').addEventListener('click', async () => {
      const msg = document.getElementById('l_msg');
      try {
        await api('/lessons', {
          course_slug: document.getElementById('l_course').value,
          title: document.getElementById('l_title').value.trim(),
          video_url: document.getElementById('l_video').value.trim(),
          body: document.getElementById('l_body').value,
          sort_order: document.getElementById('l_sort').value,
        });
        msg.textContent = 'Đã thêm!'; load();
      } catch (err) { msg.textContent = 'Lỗi: ' + err.message; }
    });

    if (secret()) load();
  </script>
</body>
</html>`);
});

export default router;
