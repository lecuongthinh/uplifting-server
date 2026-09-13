-- Lets each resource pick a matching icon (when there's no cover image) and
-- optionally have its own thumbnail, instead of every resource showing the
-- same generic file icon.
alter table uplifting_app.resources add column if not exists icon_type text not null default 'pdf';
alter table uplifting_app.resources add column if not exists cover_image_url text;
