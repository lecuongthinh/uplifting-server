import { getSupabase } from "./supabase.js";
import { updateContactCustomFields, phoneCandidates } from "./leadconnector.js";
import { getDynamicFieldId } from "./dynamicFields.js";
import { nextMiniAppActivity, vnDay } from "./activityMath.js";

// Zalo KHÔNG quan sát được việc khách mở Mini App — chỉ server mình biết, nên
// tự ghi mỗi lần khách gọi API bằng phiên đăng nhập. Ghi ở 2 nơi: bảng
// miniapp_activity (nguồn thật, đếm số ngày dùng) và field DATE trên GHL (điều
// kiện Workflow, chỉ ghi 1 lần/ngày giờ VN).
//
// Gọi ở MỌI request có phiên nên phải rẻ: không await, không bao giờ ném lỗi,
// chặn bằng bộ nhớ đệm — mỗi SĐT tối đa 1 lần ghi / 30 phút.
const THROTTLE_MS = 30 * 60 * 1000;
const MAX_TRACKED = 20000;
const lastTouch = new Map();

export function recordMiniAppActivity({ phone, contactId }) {
  if (!phone) return;
  const now = Date.now();
  if (now - (lastTouch.get(phone) || 0) < THROTTLE_MS) return;
  if (lastTouch.size > MAX_TRACKED) lastTouch.clear();
  lastTouch.set(phone, now);
  touch(phone, contactId).catch((err) => console.error(`[miniappActivity] bỏ qua ghi (${phone}):`, err.message));
}

async function touch(phone, contactId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("miniapp_activity").select("*").in("phone", phoneCandidates(phone)).limit(1);
  if (error) throw error;
  const existing = (data || [])[0] || null;

  const { row, isNewDay } = nextMiniAppActivity(existing);
  const { error: upsertError } = await supabase.from("miniapp_activity").upsert({ phone: existing?.phone || phone, ...row });
  if (upsertError) throw upsertError;

  if (isNewDay && contactId) {
    const fieldId = await getDynamicFieldId("lastMiniAppUse");
    if (fieldId) {
      await updateContactCustomFields(contactId, { [fieldId]: vnDay() }).catch((err) =>
        console.error(`[miniappActivity] bỏ qua ghi field GHL (${phone}):`, err.message)
      );
    }
  }
}

export async function getMiniAppActivity(phone) {
  const { data, error } = await getSupabase().from("miniapp_activity").select("*").in("phone", phoneCandidates(phone)).limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}
