import { Router } from "express";
import { requireSession } from "../middleware/session.js";
import { addContactTag } from "../lib/leadconnector.js";

const router = Router();

// Called right after the client's followOA() succeeds — Zalo's SDK doesn't
// tell our backend on its own that a follow happened, so the Mini App must
// report it explicitly for GHL to know (and segment/remarket on it).
router.post("/followed-oa", requireSession, async (req, res) => {
  try {
    await addContactTag(req.session.contactId, "Đã theo dõi OA");
    res.json({ tagged: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
