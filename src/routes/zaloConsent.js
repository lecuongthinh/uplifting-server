import { Router } from "express";
import crypto from "crypto";

const router = Router();

// Per Zalo's Mini App webhook spec: signature = sha256(<values of every
// payload field, sorted by key A-Z, concatenated> + <Mini App secret key>).
// https://docs.zaloplatforms.com/docs/MA/openApis/open/webhook/verifysignature
// Ported from 123gym-server's zaloConsent.js — already accepted by Zalo's
// own Mini App verification for that app, same signature scheme applies
// here (uses the same ZALO_MINI_APP_SECRET_KEY env var, just this app's
// own value).
function isValidSignature(payload, signature) {
  if (!signature) return false;
  const content = Object.keys(payload)
    .sort()
    .map((key) => {
      const value = payload[key];
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    })
    .join("");
  const expected = crypto
    .createHash("sha256")
    .update(`${content}${process.env.ZALO_MINI_APP_SECRET_KEY}`)
    .digest("hex");
  return expected === signature;
}

// Zalo calls this when a user revokes the Mini App's consent/permissions,
// so we can stop holding their data. userId here is the Mini App-scoped
// Zalo user id (from getUserID()) — a different id space than idByOA (the
// OA-follower id captured on login and stored on the GHL contact as
// zalo_uid, see auth.js) — so there's nothing to look up and clear yet.
// Same known gap as 123gym-server's version of this file; wire up real
// deletion once login also captures this mini-app-scoped id somewhere.
// Harmless reachability check — in case Zalo's own "Thiết lập" button in
// the verification console probes the URL with a plain GET before allowing
// it to be saved. The real event delivery is always POST+signed; this just
// makes sure a GET can't fail that setup step for the wrong reason.
router.get("/", (_req, res) => res.json({ ok: true }));

router.post("/", (req, res) => {
  const signature = req.headers["x-zevent-signature"];
  if (!isValidSignature(req.body, signature)) {
    return res.status(401).json({ message: "Invalid signature" });
  }

  const { event, userId } = req.body;
  console.log(`[zalo-consent] event=${event} userId=${userId}`);

  res.json({ success: true });
});

export default router;
