import { createClient } from "@supabase/supabase-js";

// Shared "growthLEADERs" Supabase project (hwjbjactdrndkkwjbcht) — Uplifting's
// tables live in their own `uplifting_app` schema, not `public`, so they
// never collide with growthLEADERs' existing tables (profiles, daily_logs,
// woops, checkins...) or its separate "vibe coding" deploy workflow. See
// project_uplifting_coaching_miniapp memory for why this project was chosen
// over 123gym's (same business/customer base as growthLEADERs, unlike 123 GYM).
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "uplifting_app" },
});
