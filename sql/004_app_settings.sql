-- Key/value store for small pieces of UI copy that should be editable from
-- /admin/content without a Mini App rebuild+redeploy (which needs a fresh
-- Zalo review). Add new keys here as more hardcoded strings need this.
create table if not exists uplifting_app.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into uplifting_app.app_settings (key, value) values
  ('lock_banner_title', 'Xem toàn bộ nội dung miễn phí 🔓'),
  ('lock_banner_desc', 'Chia sẻ số điện thoại để mở khoá toàn bộ bài học — hoàn toàn miễn phí, Uplifting sẽ đồng hành cùng bạn qua Zalo.'),
  ('lock_modal_title', 'Mở khoá toàn bộ nội dung'),
  ('lock_modal_desc', 'Bài học này dành cho người đã đăng ký. Chia sẻ số điện thoại để xem miễn phí toàn bộ khoá học này và các khoá học khác.'),
  ('lock_cta_label', 'Đăng ký xem miễn phí')
on conflict (key) do nothing;
