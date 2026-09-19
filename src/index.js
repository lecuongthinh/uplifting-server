import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import scorecardRoutes from "./routes/scorecards.js";
import contentRoutes from "./routes/content.js";
import memberRoutes from "./routes/member.js";
import contentAdminRoutes from "./routes/contentAdmin.js";
import zaloConsentRoutes from "./routes/zaloConsent.js";
import termsRoutes from "./routes/terms.js";
import oaEventsRoutes from "./routes/oaEvents.js";
import oaAdminRoutes from "./routes/oaAdmin.js";
import ghlWebhookRoutes from "./routes/ghlWebhooks.js";

const app = express();

// Personalized/session-scoped JSON must never be cached via ETag/304 — see
// reference_stack_playbook_zalo_ghl_render_supabase memory section 5. Learned
// the hard way on 123gym-server; set this from day one here instead.
app.set("etag", false);
app.use(cors());
// rawBody: chữ ký webhook OA tính trên ĐÚNG byte Zalo gửi, nên phải giữ bản thô.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(`[access] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/scorecards", scorecardRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/member", memberRoutes);
app.use("/admin/content", contentAdminRoutes);
app.use("/admin/oa", oaAdminRoutes);
app.use("/webhooks/zalo-consent", zaloConsentRoutes);
app.use("/webhooks/oa-events", oaEventsRoutes);
app.use("/webhooks", ghlWebhookRoutes);
app.use("/dieu-khoan-su-dung", termsRoutes);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Zalo domain-ownership verification (developers.zalo.me -> app -> "Xác thực
// domain"): Zalo issues a code per app and expects
//   https://<domain>/zalo_verifier<CODE>.html
// to contain <meta property="zalo-platform-site-verification" content="<CODE>">.
// Codes come from the env var ZALO_VERIFIER_CODES (comma-separated: one per Zalo
// app that uses this domain, e.g. the Mini App's and the OA app's) so adding one
// needs no code change. Only listed codes are served: echoing ANY code would let
// someone else's Zalo app verify OUR domain.
app.get(/^\/zalo_verifier([A-Za-z0-9_-]+)\.html$/, (req, res) => {
  const allowed = (process.env.ZALO_VERIFIER_CODES || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const code = req.params[0];
  if (!allowed.includes(code)) return res.status(404).send("Not found");
  res
    .type("html")
    .send(
      `<!DOCTYPE html>\n<html><head><meta property="zalo-platform-site-verification" content="${code}" /></head><body>Uplifting Business Coaching</body></html>`
    );
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`uplifting-server listening on :${port}`));
