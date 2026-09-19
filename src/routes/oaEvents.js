import { Router } from "express";
import crypto from "crypto";
import {
  findContactByPhone,
  createLeadContact,
  findContactsByZaloUid,
  updateContactZaloUid,
  addContactTag,
  removeContactTag,
  addContactNote,
} from "../lib/leadconnector.js";
import { TAG_OA_FOLLOWED } from "../lib/tags.js";
import { recordInteraction } from "../lib/oaInteractions.js";
import { recordOaEvent } from "../lib/oaState.js";
import { maybeGrantGifts, flushPendingGiftsForPhone } from "../lib/gifts.js";
import { enqueueOaTagSync } from "../lib/oaTagSync.js";

const router = Router();

// Webhook OA (follow/unfollow, tin nhắn, user_submit_info...). Đường đi thật:
// Zalo → relay VN (/oa-events, trả 200 ngay, chuyển NGUYÊN BYTE body) → đây.
// Ký KHÁC webhook thu hồi quyền của Mini App: mac = sha256(app_id + rawBody +
// timestamp + OA Secret Key), header x-zevent-signature = "mac=<hex>". OA
// Secret Key lấy ở trang Webhook của app (developers.zalo.me), KHÁC App Secret.
function isValidSignature(rawBody, appId, timestamp, signature) {
  if (!signature || !timestamp || !process.env.ZALO_OA_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHash("sha256")
    .update(`${appId}${rawBody}${timestamp}${process.env.ZALO_OA_WEBHOOK_SECRET}`)
    .digest("hex");
  const received = signature.startsWith("mac=") ? signature.slice(4) : signature;
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

const ZALO_INFO_SHARED_TAG = "Đã chia sẻ SĐT qua Zalo OA";
const NEW_LEAD_TAG = "Lead mới từ Zalo OA";

router.post("/", async (req, res) => {
  const payload = req.body || {};
  const rawBody = req.rawBody || "";
  const signature = req.headers["x-zevent-signature"];
  const timestamp = req.headers["x-zevent-timestamp"] || payload.timestamp;

  // Luôn ghi log payload thô trước (chữ ký đúng hay sai): cách duy nhất để phân
  // biệt sự kiện thật bị lệch chữ ký với ping kiểm tra kết nối của Zalo.
  console.log("[oa-events] raw payload:", JSON.stringify(payload));

  // Luôn trả 200 ngay: ping "Kiểm tra" của Zalo không có chữ ký hợp lệ mà vẫn
  // đòi 200 mới nhận URL. Chữ ký chỉ quyết định có XỬ LÝ payload hay không.
  res.json({ success: true });

  if (!isValidSignature(rawBody, payload.app_id, timestamp, signature)) {
    console.log("[oa-events] chữ ký không hợp lệ — không xử lý payload này");
    return;
  }

  try {
    await handleEvent(payload);
  } catch (err) {
    console.error("[oa-events] handler error:", err.message);
  }
});

async function handleEvent(payload) {
  const name = payload.event_name;

  if (name === "follow") {
    const uid = payload.follower?.id;
    if (!uid) return;
    // Có thể khớp >1 hồ sơ (cùng 1 tài khoản Zalo qua nhiều SĐT) — xử lý hết.
    // Khách chưa từng mở Mini App thì chưa có uid trong CRM → không khớp ai
    // (webhook chỉ kèm uid, không có SĐT), sẽ khớp sau khi họ đăng nhập app.
    const hits = await findContactsByZaloUid(uid);
    for (const contact of hits) {
      // Đọc tag TRƯỚC khi gắn để chỉ ghi note đúng 1 lần lúc THỰC SỰ chuyển từ
      // "chưa follow" sang "follow" (Zalo có thể gọi lại webhook).
      const alreadyFollowed = (contact.tags || []).some((t) => t.toLowerCase() === TAG_OA_FOLLOWED.toLowerCase());
      await addContactTag(contact.id, TAG_OA_FOLLOWED);
      console.log(`[oa-events] follow: gắn tag "${TAG_OA_FOLLOWED}" (uid ${uid})`);
      if (!alreadyFollowed) {
        addContactNote(contact.id, "[OA] Khách đã quan tâm (follow) Zalo OA.").catch((err) =>
          console.error("[oa-events] ghi note follow lỗi:", err.message)
        );
      }
      // follow KHÔNG mở cửa sổ 7 ngày → không recordInteraction ở đây.
      await recordOaEvent("follow", { phone: contact.phone, contactId: contact.id });
      // Ngay lúc follow Zalo cho gửi ĐÚNG 1 tin miễn phí: khách đã chia sẻ SĐT
      // trước đó nhận quà ngay tại đây. Ghép tag vừa gắn vì contact.tags là ảnh
      // chụp TRƯỚC lệnh gắn.
      await maybeGrantGifts({ ...contact, tags: [...(contact.tags || []), TAG_OA_FOLLOWED] }, { uid });
      enqueueOaTagSync(contact.id, "oa");
    }
    return;
  }

  if (name === "unfollow") {
    const uid = payload.follower?.id || payload.user_id;
    for (const contact of uid ? await findContactsByZaloUid(uid) : []) {
      await removeContactTag(contact.id, TAG_OA_FOLLOWED);
      console.log(`[oa-events] unfollow: gỡ tag "${TAG_OA_FOLLOWED}" (uid ${uid})`);
      await recordOaEvent("unfollow", { phone: contact.phone, contactId: contact.id });
    }
    return;
  }

  // Khách nhắn tin/bấm nút/menu/bài broadcast: Zalo gửi 1 event_name riêng cho
  // từng loại nội dung (user_send_text, user_send_image...), chung sender.id.
  if (name?.startsWith("user_send_")) {
    const uid = payload.sender?.id;
    if (!uid) return;
    for (const contact of await findContactsByZaloUid(uid)) {
      recordInteraction(contact.phone, "message", contact.id);
      // Cửa sổ tư vấn ĐANG MỞ: gửi ngay các quà đang chờ (không await).
      flushPendingGiftsForPhone(contact.phone, { uid }).catch((err) => console.error("[oa-events] gửi bù quà lỗi:", err.message));
      enqueueOaTagSync(contact.id, "oa");
    }
    return;
  }

  // Tín hiệu NHẸ hơn tin nhắn (không mở cửa sổ 7 ngày): chỉ có khi đã bật 2 sự
  // kiện này trong cài đặt Webhook của OA. sender = khách (khác
  // user_received_message có sender là chính OA — cố ý không xử lý).
  if (name === "user_seen_message" || name === "user_reacted_message") {
    const uid = payload.sender?.id;
    if (!uid) return;
    const kind = name === "user_seen_message" ? "seen" : "reaction";
    for (const contact of await findContactsByZaloUid(uid)) {
      await recordOaEvent(kind, { phone: contact.phone, contactId: contact.id });
    }
    return;
  }

  if (name === "user_submit_info") {
    const uid = payload.sender?.id;
    const phone = payload.info?.phone;
    const displayName = payload.info?.name;
    if (!uid || !phone) {
      console.log("[oa-events] user_submit_info thiếu uid hoặc phone — xem log payload thô ở trên");
      return;
    }
    let contact = await findContactByPhone(phone);
    if (!contact) {
      contact = await createLeadContact({ phone, name: displayName });
      await addContactTag(contact.id, NEW_LEAD_TAG);
      console.log(`[oa-events] tạo lead mới từ user_submit_info: ${contact.id}`);
    }
    await updateContactZaloUid(contact.id, uid);
    await addContactTag(contact.id, ZALO_INFO_SHARED_TAG);
    // Chủ động gửi thông tin = 1 tin nhắn thật → mở cửa sổ 7 ngày.
    recordInteraction(phone, "message", contact.id);
  }
}

export default router;
