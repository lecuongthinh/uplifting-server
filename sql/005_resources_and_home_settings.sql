-- Downloadable lead-magnet resources (PDFs, templates, checklists...) shown
-- on the Home page — same "pure data, no redeploy to add one" pattern as
-- articles/courses.
create table if not exists uplifting_app.resources (
  slug text primary key,
  title text not null,
  description text,
  file_url text not null,
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- New editable Home-page copy: the scorecard CTA banner (title/desc/CTA
-- text + which scorecard it links to) and the "Chương trình của Uplifting"
-- info block (title/desc/CTA text + an external URL, opened via
-- openWebview — the standard "deep-link out to GHL" pattern for this
-- stack). home_banner_scorecard_slug empty = auto-pick the first active
-- scorecard, same as before this feature existed.
insert into uplifting_app.app_settings (key, value) values
  ('home_banner_title', 'Bạn đang cân bằng ở đâu?'),
  ('home_banner_desc', 'Làm bài đánh giá miễn phí — chỉ 3 phút.'),
  ('home_banner_cta_label', 'Bắt đầu'),
  ('home_banner_scorecard_slug', ''),
  ('program_title', 'Chương trình của Uplifting'),
  ('program_desc', 'Tìm hiểu các chương trình coaching phù hợp với bạn — Uplifting sẽ đồng hành cùng bạn qua từng giai đoạn.'),
  ('program_cta_label', 'Tìm hiểu thêm'),
  ('program_cta_url', '')
on conflict (key) do nothing;
