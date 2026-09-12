import { Router } from "express";
import { resolvePhoneNumber } from "../lib/zaloRelay.js";
import { findOrCreateContact, updateContactZaloUid, addContactTag } from "../lib/leadconnector.js";
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

    // Tag every login (best-effort, never blocks the response) so a GHL
    // Workflow can trigger nurture off "someone opened the Mini App" as its
    // own event, not only off scorecard completion — a lead who opens the
    // app but abandons before finishing an assessment still gets captured.
    addContactTag(contact.id, "Nguồn: Zalo Mini App").catch((err) =>
      console.error("[auth/zalo] tag failed:", err.message)
    );
    if (isNew) {
      addContactTag(contact.id, "Lead mới: Mini App").catch((err) =>
        console.error("[auth/zalo] new-lead tag failed:", err.message)
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
