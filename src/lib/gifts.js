import { getSupabase } from "./supabase.js";
import {
  getContactById,
  customFieldsOf,
  getFieldIdByKey,
  addContactTag,
  addContactNote,
  findContactsWithAllTags,
  phoneCandidates,
} from "./leadconnector.js";
import { sendConsultationMessageUID } from "./zalo.js";
import { isEligible, isGiftLive, requiredTagsOf, renderGiftMessage, statusAfterFailure, RETRYABLE_STATUSES } from "./giftRules.js";

// Quà tặng: khách hội đủ điều kiện (đã chia sẻ SĐT với Mini App và/hoặc đã
// follow OA) được TẶNG 1 đường dẫn (trang trong Mini App hoặc link ngoài) gửi
// qua OA. Port từ 123gym-server (bản 1 sub-account).
//
// RÀNG BUỘC THẬT CỦA ZALO quyết định cách giao: tin tư vấn chỉ gửi được khi
// khách vừa follow (1 tin miễn phí) hoặc đã nhắn tin/bấm nút trong 7 ngày.
// Khách follow từ trước rồi mới chia sẻ SĐT thường bị Zalo trả -232. Quà
// không bao giờ "mất": ghi sổ ở trạng thái pending_window và tự gửi khi khách
// nhắn tin cho OA (webhook user_send_* → flushPendingGiftsForPhone).
//
// An toàn: GIFTS_DISABLED=true trên Render tắt cả tính năng ngay (không cần
// deploy). Mọi hàm bọc try/catch — bảng gifts là hạ tầng MỚI, có thể chưa tạo,
// và không được làm hỏng đăng nhập/webhook OA.
const disabled = () => process.env.GIFTS_DISABLED === "true";

export function giftTagName(gift) {
  return `Quà: ${gift.gift_key}`;
}

export async function listGifts() {
  const { data, error } = await getSupabase().from("gifts").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getGift(id) {
  const { data, error } = await getSupabase().from("gifts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function liveGifts() {
  const { data, error } = await getSupabase().from("gifts").select("*").eq("active", true);
  if (error) throw error;
  return (data || []).filter((g) => isGiftLive(g));
}

// Trả dòng grant mới tạo, hoặc null nếu (quà, SĐT) đã có dòng — unique
// (gift_id, phone) là chốt chặn thật, an toàn cả khi 2 luồng chạy cùng lúc.
async function claimGrant(gift, contact) {
  const { data, error } = await getSupabase()
    .from("gift_grants")
    .insert({ gift_id: gift.id, phone: contact.phone, contact_id: contact.id, status: "pending_window", attempts: 0 })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return null;
    throw error;
  }
  return data;
}

async function updateGrant(id, patch) {
  const { error } = await getSupabase().from("gift_grants").update(patch).eq("id", id);
  if (error) console.error(`[gifts] cập nhật grant ${id} lỗi:`, error.message);
}

async function uidOf(contact) {
  const fieldId = await getFieldIdByKey("zalo_uid");
  return fieldId ? customFieldsOf(contact)[fieldId] || null : null;
}

// `uid` truyền vào (nếu có) ưu tiên hơn uid đọc từ hồ sơ — lúc đăng nhập lần
// đầu hồ sơ CRM chưa kịp có uid vừa ghi.
export async function deliverGrant(gift, grant, contact, { uid = null } = {}) {
  const useUid = uid || (await uidOf(contact));
  if (!useUid) {
    await updateGrant(grant.id, { status: "no_uid" });
    return { status: "no_uid" };
  }

  const text = renderGiftMessage(gift.message_template, {
    name: contact.firstName || contact.contactName,
    gift: gift.title,
    link: gift.url,
  });
  const attempts = (grant.attempts || 0) + 1;

  try {
    await sendConsultationMessageUID(useUid, text);
  } catch (err) {
    const status = statusAfterFailure(err, attempts);
    await updateGrant(grant.id, { status, attempts, last_error: `${err.zaloErrorCode ?? ""} ${err.message}`.trim() });
    return { status, error: err.message, zaloErrorCode: err.zaloErrorCode ?? null };
  }

  await updateGrant(grant.id, { status: "delivered", attempts, delivered_at: new Date().toISOString(), last_error: null });
  addContactTag(contact.id, giftTagName(gift)).catch((err) => console.error("[gifts] gắn tag quà lỗi:", err.message));
  addContactNote(contact.id, `[Quà tặng] Đã gửi "${gift.title}" qua Zalo OA: ${gift.url}`).catch((err) =>
    console.error("[gifts] ghi note quà lỗi:", err.message)
  );
  return { status: "delivered" };
}

// Gọi ở MỌI nơi vừa có thể làm khách hội đủ điều kiện (đăng nhập, báo đã
// follow từ Mini App, webhook follow). `contact.tags` phải phản ánh ĐÚNG trạng
// thái tag NGAY SAU thao tác vừa gắn.
export async function maybeGrantGifts(contact, { uid = null } = {}) {
  if (disabled() || !contact?.phone) return [];
  try {
    const gifts = (await liveGifts()).filter((g) => isEligible(g, contact.tags));
    const results = [];
    for (const gift of gifts) {
      const grant = await claimGrant(gift, contact);
      if (!grant) continue;
      const outcome = await deliverGrant(gift, grant, contact, { uid });
      console.log(`[gifts] ${gift.gift_key} → ${contact.phone}: ${outcome.status}`);
      results.push({ gift: gift.gift_key, ...outcome });
    }
    return results;
  } catch (err) {
    console.error(`[gifts] lỗi khi xét quà (${contact?.phone}):`, err.message);
    return [];
  }
}

// Khách vừa nhắn tin / bấm nút → cửa sổ ĐANG MỞ, gửi ngay các quà đang chờ.
export async function flushPendingGiftsForPhone(phone, { uid = null } = {}) {
  if (disabled() || !phone) return [];
  try {
    const { data, error } = await getSupabase()
      .from("gift_grants")
      .select("*, gifts(*)")
      .in("phone", phoneCandidates(phone))
      .in("status", RETRYABLE_STATUSES);
    if (error) throw error;
    const results = [];
    for (const grant of data || []) {
      const gift = grant.gifts;
      if (!gift || !isGiftLive(gift) || !grant.contact_id) continue;
      const contact = await getContactById(grant.contact_id);
      const outcome = await deliverGrant(gift, grant, contact, { uid });
      console.log(`[gifts] gửi bù ${gift.gift_key} → ${grant.phone}: ${outcome.status}`);
      results.push({ gift: gift.gift_key, ...outcome });
    }
    return results;
  } catch (err) {
    console.error(`[gifts] lỗi khi gửi bù quà (${phone}):`, err.message);
    return [];
  }
}

// Nút "Gửi lại" trên trang quản trị — dùng cả cho lượt failed; đặt lại số lần thử.
export async function retryGrant(grantId) {
  const { data: grant, error } = await getSupabase().from("gift_grants").select("*, gifts(*)").eq("id", grantId).maybeSingle();
  if (error) throw error;
  if (!grant) return { ok: false, status: 404, error: "Không có lượt tặng này." };
  if (grant.status === "delivered") return { ok: false, status: 409, error: "Lượt này đã gửi rồi." };
  if (grant.status === "excluded") return { ok: false, status: 409, error: "Lượt này là người đã đủ điều kiện từ trước, được loại trừ có chủ đích." };
  const gift = grant.gifts;
  if (!gift || !grant.contact_id) return { ok: false, status: 409, error: "Thiếu thông tin quà/hồ sơ để gửi lại." };
  const contact = await getContactById(grant.contact_id);
  const outcome = await deliverGrant(gift, { ...grant, attempts: 0 }, contact);
  return { ok: true, outcome };
}

// Bao nhiêu người ĐÃ đủ điều kiện ngay lúc này — để biết bật quà ảnh hưởng ai.
export async function previewActivation(gift) {
  const tags = requiredTagsOf(gift);
  const contacts = await findContactsWithAllTags(tags);
  return { requiredTags: tags, uniquePhones: new Set(contacts.filter((c) => c.phone).map((c) => c.phone)).size };
}

// Bật quà. includeExisting=false (mặc định): người ĐÃ đủ điều kiện từ trước
// được đánh dấu "excluded" TRƯỚC khi bật — làm trước để không có khe hở giữa
// lúc bật và lúc loại trừ. includeExisting=true: không loại ai; họ nhận quà ở
// lần kế tiếp có sự kiện đăng nhập/follow (KHÔNG gửi hàng loạt ngay lúc bật).
export async function activateGift(gift, { includeExisting = false } = {}) {
  const supabase = getSupabase();
  let excluded = 0;

  if (!includeExisting) {
    const rows = new Map();
    for (const c of await findContactsWithAllTags(requiredTagsOf(gift))) {
      if (c.phone && !rows.has(c.phone)) rows.set(c.phone, { gift_id: gift.id, phone: c.phone, contact_id: c.id, status: "excluded" });
    }
    const list = [...rows.values()];
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await supabase.from("gift_grants").upsert(list.slice(i, i + 500), { onConflict: "gift_id,phone", ignoreDuplicates: true });
      if (error) throw error;
    }
    excluded = list.length;
  }

  const { error } = await supabase.from("gifts").update({ active: true, activated_at: new Date().toISOString() }).eq("id", gift.id);
  if (error) throw error;
  return { active: true, excluded };
}

export async function deactivateGift(id) {
  const { error } = await getSupabase().from("gifts").update({ active: false }).eq("id", id);
  if (error) throw error;
}

// { [gift_id]: { delivered: n, pending_window: n, ... } } từ view gift_grant_stats.
export async function giftStats() {
  const { data, error } = await getSupabase().from("gift_grant_stats").select("gift_id, status, n");
  if (error) throw error;
  const out = {};
  for (const r of data || []) (out[r.gift_id] ||= {})[r.status] = r.n;
  return out;
}

export async function listGrants(giftId, { status = null, limit = 200 } = {}) {
  let q = getSupabase().from("gift_grants").select("*").eq("gift_id", giftId).order("granted_at", { ascending: false }).limit(limit);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function grantsForPhone(phone) {
  const { data, error } = await getSupabase()
    .from("gift_grants")
    .select("*, gifts(gift_key, title)")
    .in("phone", phoneCandidates(phone))
    .order("granted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
