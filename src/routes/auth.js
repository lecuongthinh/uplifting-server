import { Router } from "express";
import { resolvePhoneNumber } from "../lib/zaloRelay.js";
import { findOrCreateContact, updateContactZaloUid } from "../lib/leadconnector.js";
import { signSession } from "../middleware/session.js";

const router = Router();

// Unlike 123gym-server (404s an unmatched phone — it only serves existing
// members), this app is an acquisition tool: an unmatched phone is a brand
// new lead, so we create a GHL contact for them instead of rejecting.
router.post("/zalo", async (req, res) => {
  const { accessToken, phoneToken, idByOA, name } = req.body;
  if (!accessToken || !phoneToken) {
    return res.status(400).json({ message: "Missing accessToken or phoneToken" });
  }
  try {
    const phone = await resolvePhoneNumber(phoneToken, accessToken);
    const { contact, isNew } = await findOrCreateContact(phone, name);
    console.log(`[auth/zalo] ${isNew ? "created new lead" : "matched existing contact"}: ${contact.id}`);

    if (idByOA) {
      updateContactZaloUid(contact.id, idByOA).catch((err) =>
        console.error("[auth/zalo] failed to sync idByOA:", err.message)
      );
    }

    res.json({
      sessionToken: signSession(contact),
      member: { id: contact.id, name: contact.firstName || contact.contactName || null, isNew },
    });
  } catch (err) {
    console.error("[auth/zalo] error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

export default router;
