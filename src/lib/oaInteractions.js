import { getSupabase } from "./supabase.js";
import { phoneCandidates, updateContactCustomFields, addContactTag } from "./leadconnector.js";
import { getDynamicFieldId } from "./dynamicFields.js";
import { TAG_EVER_MESSAGED_OA } from "./tags.js";

// Cửa sổ 7 ngày của tin tư vấn Zalo: chỉ mở bởi TIN NHẮN THẬT của khách (nhắn
// tin, bấm nút/menu/bài broadcast — Zalo gửi về dưới dạng user_send_*) hoặc
// user_submit_info. CỐ Ý KHÔNG tính follow hay mở Mini App: đã kiểm chứng ở
// 123 GYM bằng lỗi -232 thật (follow chỉ cấp đúng 1 tin miễn phí lúc đó).
export const INTERACTION_WINDOW_DAYS = 7;

// Ghi 3 nơi độc lập (cái nào hỏng không ảnh hưởng cái khác): bảng
// oa_interactions (nguồn thật), field DATE "Lần tương tác OA gần nhất" (điều
// kiện Workflow), tag mốc trọn đời "Đã từng nhắn tin OA". Không ném lỗi.
export async function recordInteraction(phone, source, contactId = null) {
  if (!phone) return;
  const nowIso = new Date().toISOString();
  try {
    const { error } = await getSupabase()
      .from("oa_interactions")
      .upsert({ phone, last_interaction_at: nowIso, source, updated_at: nowIso });
    if (error) throw error;
  } catch (err) {
    console.error(`[oaInteractions] bỏ qua ghi Supabase (${phone}, ${source}):`, err.message);
  }

  if (!contactId) return;
  try {
    const fieldId = await getDynamicFieldId("lastOaInteraction");
    if (fieldId) await updateContactCustomFields(contactId, { [fieldId]: nowIso.slice(0, 10) });
  } catch (err) {
    console.error(`[oaInteractions] bỏ qua ghi field GHL (${phone}):`, err.message);
  }
  try {
    await addContactTag(contactId, TAG_EVER_MESSAGED_OA);
  } catch (err) {
    console.error(`[oaInteractions] bỏ qua gắn tag (${phone}):`, err.message);
  }
}

// Lần tương tác gần nhất, hoặc null nếu chưa từng ghi nhận (không backfill).
export async function getLastInteraction(phone) {
  const { data, error } = await getSupabase()
    .from("oa_interactions")
    .select("last_interaction_at, source")
    .in("phone", phoneCandidates(phone))
    .limit(1);
  if (error) throw error;
  const row = (data || [])[0];
  return row ? { at: new Date(row.last_interaction_at), source: row.source } : null;
}
