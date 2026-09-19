import { Router } from "express";
import { enqueueOaTagSync } from "../lib/oaTagSync.js";

const router = Router();

// Workflow GHL (trigger "Contact Tag", KHÔNG lọc — chạy cho cả gắn lẫn gỡ) →
// Webhook action tới đây. Header x-webhook-secret = GHL_WEBHOOK_SECRET.
// Custom Data: contactId = {{contact.id}}. Trả 200 ngay, xử lý qua hàng đợi
// (gắn tag hàng loạt = 1 webhook cho MỖI contact).
router.post("/ghl-oa-tag-sync", (req, res) => {
  const want = process.env.GHL_WEBHOOK_SECRET;
  if (!want || req.headers["x-webhook-secret"] !== want) return res.status(401).json({ message: "Unauthorized" });
  const contactId = req.body?.customData?.contactId || req.body?.contactId || req.body?.contact_id;
  if (!contactId) return res.status(400).json({ message: "Thiếu contactId" });
  enqueueOaTagSync(contactId, "crm");
  res.json({ ok: true, queued: true });
});

export default router;
