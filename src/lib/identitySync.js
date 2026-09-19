import { addContactTag } from "./leadconnector.js";
import { TAG_MINIAPP_USER, TAG_OA_FOLLOWED } from "./tags.js";
import { recordOaEvent } from "./oaState.js";
import { recordMiniAppActivity } from "./miniappActivity.js";
import { maybeGrantGifts } from "./gifts.js";

const has = (tags, t) => tags.some((x) => String(x).toLowerCase() === t.toLowerCase());

// Chạy sau mỗi lần biết thêm về khách từ phía Mini App (đăng nhập, đồng bộ khi mở
// trang chủ, báo vừa follow): ghi nhận hoạt động, đồng bộ tag follow nếu Zalo
// báo followedOA=true, rồi xét quà. Không bao giờ ném lỗi (chạy sau khi đã trả
// lời khách).
//
// `contact.tags` là ảnh chụp TRƯỚC các lệnh gắn tag ở đây — ghép tay tag vừa gắn
// để xét quà đúng (đăng nhập = đã chia sẻ SĐT → tag TAG_MINIAPP_USER).
export async function afterMiniAppIdentity(contact, { idByOA = null, followedOA = null, justFollowed = false } = {}) {
  try {
    recordMiniAppActivity({ phone: contact.phone, contactId: contact.id });

    const tags = [...(contact.tags || [])];
    if (!has(tags, TAG_MINIAPP_USER)) tags.push(TAG_MINIAPP_USER);

    if (justFollowed) {
      await recordOaEvent("follow", { phone: contact.phone, contactId: contact.id });
      if (!has(tags, TAG_OA_FOLLOWED)) tags.push(TAG_OA_FOLLOWED);
    } else if (followedOA === true) {
      // Zalo cho biết khách ĐANG follow (kể cả follow từ trước khi vào app).
      if (!has(tags, TAG_OA_FOLLOWED)) {
        await addContactTag(contact.id, TAG_OA_FOLLOWED);
        tags.push(TAG_OA_FOLLOWED);
      }
      await recordOaEvent("following_seen", { phone: contact.phone, contactId: contact.id });
    }

    await maybeGrantGifts({ ...contact, tags }, { uid: idByOA });
  } catch (err) {
    console.error("[identitySync] lỗi:", err.message);
  }
}
