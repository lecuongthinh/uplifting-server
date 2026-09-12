-- Key/value store for small pieces of UI copy that should be editable from
-- /admin/content without a Mini App rebuild+redeploy (which needs a fresh
-- Zalo review). Add new keys here as more hardcoded strings need this.
create table if not exists uplifting_app.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into uplifting_app.app_settings (key, value) values
  ('lock_banner_title', 'Còn nội dung nâng cao phía sau 🔒'),
  ('lock_banner_desc', 'Để lại thông tin qua bài đánh giá miễn phí — Uplifting sẽ liên hệ hướng dẫn anh/chị đăng ký để mở khoá toàn bộ nội dung.'),
  ('lock_modal_title', 'Nội dung nâng cao 🔒'),
  ('lock_modal_desc', 'Bài học này nằm trong phần nâng cao, cần đăng ký mới xem được. Làm bài đánh giá miễn phí để Uplifting tư vấn và hướng dẫn anh/chị mở khoá.'),
  ('lock_cta_label', 'Làm bài đánh giá miễn phí')
on conflict (key) do nothing;
