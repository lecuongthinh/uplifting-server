-- Per-lesson lock flag — lets a course show its full curriculum (titles,
-- order) while gating specific lessons behind "cần đăng ký", independent of
-- the course-level is_free flag (a free course can still have 1-2 locked
-- lessons as a teaser for paid content, or vice versa).
alter table uplifting_app.lessons
  add column if not exists is_locked boolean not null default false;
