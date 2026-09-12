-- Creating a schema does NOT automatically let PostgREST's roles touch it —
-- only `public` gets that by default. Without this, every request hits
-- Postgres error 42501 "permission denied for schema uplifting_app" even
-- with a valid service_role key and the schema properly exposed in
-- Data API settings (confirmed live: that's exactly the error we hit).
--
-- Only granting to service_role (not anon/authenticated) is intentional —
-- the Mini App never talks to Supabase directly, only uplifting-server does
-- (via the service_role key), so anon/authenticated have no reason to touch
-- this schema at all. Also covers tables created AFTER this runs (e.g. by
-- a future content-admin page), so this shouldn't need re-running per table.

grant usage on schema uplifting_app to service_role;
grant all on all tables in schema uplifting_app to service_role;
grant all on all sequences in schema uplifting_app to service_role;

alter default privileges in schema uplifting_app grant all on tables to service_role;
alter default privileges in schema uplifting_app grant all on sequences to service_role;
