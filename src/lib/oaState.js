import { getSupabase } from "./supabase.js";
import { updateContactCustomFields, phoneCandidates } from "./leadconnector.js";
import { getDynamicFieldId } from "./dynamicFields.js";
import { nextOaState, vnDay } from "./activityMath.js";

// Trạng thái OA của 1 khách theo SĐT (follow / đang follow / unfollow / đã xem
// tin / thả cảm xúc). KHÁC oaInteractions.js: file đó chỉ lo mốc TIN NHẮN THẬT
// (quyết định còn cửa sổ 7 ngày để gửi tin tư vấn không); file này ghi các
// tín hiệu KHÔNG mở cửa sổ đó. Không bao giờ ném lỗi — bảng có thể chưa tạo.
export async function recordOaEvent(event, { phone, contactId = null }) {
  if (!phone) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("oa_state").select("*").in("phone", phoneCandidates(phone)).limit(1);
    if (error) throw error;
    const existing = (data || [])[0] || null;

    const { row, followStarted } = nextOaState(existing, event);
    const { error: upsertError } = await supabase.from("oa_state").upsert({ phone: existing?.phone || phone, ...row });
    if (upsertError) throw upsertError;

    if (followStarted && contactId) {
      const fieldId = await getDynamicFieldId("oaFollowedAt");
      if (fieldId) {
        await updateContactCustomFields(contactId, { [fieldId]: vnDay() }).catch((err) =>
          console.error(`[oaState] bỏ qua ghi field GHL (${phone}):`, err.message)
        );
      }
    }
    return row;
  } catch (err) {
    console.error(`[oaState] bỏ qua ghi ${event} (${phone}):`, err.message);
    return null;
  }
}

export async function getOaState(phone) {
  const { data, error } = await getSupabase().from("oa_state").select("*").in("phone", phoneCandidates(phone)).limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}
