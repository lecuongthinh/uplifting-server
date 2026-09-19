import { Router } from "express";
import { requireSession } from "../middleware/session.js";
import { addContactTag, getContactById, updateContactZaloUid } from "../lib/leadconnector.js";
import { TAG_OA_FOLLOWED } from "../lib/tags.js";
import { afterMiniAppIdentity } from "../lib/identitySync.js";

const router = Router();

// Called right after the client's followOA() succeeds — Zalo's SDK doesn't
// tell our backend on its own that a follow happened, so the Mini App must
// report it explicitly for GHL to know (and segment/remarket on it).
router.post("/followed-oa", requireSession, async (req, res) => {
  try {
    await addContactTag(req.session.contactId, TAG_OA_FOLLOWED);
    res.json({ tagged: true });
    // Sau khi đã trả lời: ghi mốc follow + xét quà (ngay lúc follow là lúc Zalo
    // cho gửi 1 tin miễn phí).
    getContactById(req.session.contactId)
      .then((contact) => afterMiniAppIdentity(contact, { justFollowed: true, idByOA: req.body?.idByOA || null }))
      .catch((err) => console.error("[member/followed-oa] hậu xử lý lỗi:", err.message));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Đồng bộ danh tính khi mở app (idempotent): lưu idByOA nếu đọc được và đồng bộ
// trạng thái follow do Zalo báo. Đăng nhập chỉ chạy 1 lần nên khách vào app rồi
// mới follow OA (hoặc mới cấp quyền) sẽ chỉ được ghi nhận nhờ route này.
// Chặn tần suất trong bộ nhớ: mỗi khách tối đa 1 lần / 5 phút (123 GYM không chặn gì,
// gọi mỗi lần mở trang chủ; ở đây chỉ để mở/đóng app liên tục không dội lên GHL).
const SYNC_THROTTLE_MS = 5 * 60 * 1000;
const lastSync = new Map();
router.post("/sync", requireSession, async (req, res) => {
  const { contactId } = req.session;
  res.json({ ok: true });
  if (Date.now() - (lastSync.get(contactId) || 0) < SYNC_THROTTLE_MS) return;
  if (lastSync.size > 20000) lastSync.clear();
  lastSync.set(contactId, Date.now());
  try {
    const { idByOA, followedOA } = req.body || {};
    if (idByOA) await updateContactZaloUid(contactId, String(idByOA));
    const contact = await getContactById(contactId);
    await afterMiniAppIdentity(contact, { idByOA: idByOA || null, followedOA: followedOA === true ? true : null });
  } catch (err) {
    console.error("[member/sync] lỗi:", err.message);
  }
});

export default router;
