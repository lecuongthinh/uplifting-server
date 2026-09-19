import { getSupabase } from "./supabase.js";
import { createLocationTag, listLocationTagNames } from "./leadconnector.js";
import { listOaTags } from "./zalo.js";

// NGUỒN SỰ THẬT DUY NHẤT cho luật đặt tên nhãn OA đồng bộ từ CRM — API và
// dashboard đều gọi lại đúng các hàm/hằng số ở đây, để không ai phải nhớ
// luật bằng trí nhớ (mục tiêu đã thống nhất 2026-09-19).
export const OA_TAG_PREFIX = "oa:";
// Zalo giới hạn tên nhãn tối đa 15 ký tự (lỗi thật: "tag_name is too long.
// Limit tag_name length is 15").
export const OA_TAG_MAX_LENGTH = 15;
export const OA_TAG_MIN_DESCRIPTION = 5;

export const OA_TAG_RULES = [
  `Tên nhãn tối đa ${OA_TAG_MAX_LENGTH} ký tự (giới hạn của Zalo).`,
  "Chỉ dùng chữ cái (có dấu được), số, khoảng trắng, dấu gạch ngang, gạch dưới.",
  `Trên CRM, tag sẽ có tiền tố "${OA_TAG_PREFIX}" và tự chuyển chữ thường (VD nhãn "VIP" ↔ tag "${OA_TAG_PREFIX}vip") — GHL luôn lưu tag chữ thường.`,
  "Không trùng tên (không phân biệt hoa/thường) với nhãn đã đăng ký.",
  `Bắt buộc ghi mô tả (tối thiểu ${OA_TAG_MIN_DESCRIPTION} ký tự): nhãn dùng để làm gì, gắn cho ai — để người sau đọc là hiểu.`,
  "Nhãn đã có sẵn trên OA phải xác nhận riêng: từ lúc đăng ký, CRM quản lý nhãn đó — khách nào không có tag CRM tương ứng sẽ bị gỡ nhãn khi đồng bộ.",
];

const NAME_PATTERN = /^[\p{L}\p{N} _-]+$/u;

export function normalizeOaName(name) {
  return String(name || "").normalize("NFC").trim().replace(/\s+/g, " ");
}

export function validateOaName(rawName) {
  const name = normalizeOaName(rawName);
  if (!name) return { ok: false, error: "Chưa nhập tên nhãn." };
  if (name.length > OA_TAG_MAX_LENGTH) {
    return { ok: false, error: `Tên nhãn dài ${name.length} ký tự, tối đa ${OA_TAG_MAX_LENGTH}.` };
  }
  if (name.toLowerCase().startsWith(OA_TAG_PREFIX)) {
    return { ok: false, error: `Không gõ tiền tố "${OA_TAG_PREFIX}" vào tên nhãn — hệ thống tự thêm.` };
  }
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, error: "Tên nhãn chỉ được gồm chữ cái, số, khoảng trắng, gạch ngang, gạch dưới." };
  }
  return { ok: true, name };
}

export function validateDescription(description) {
  const d = String(description || "").trim();
  if (d.length < OA_TAG_MIN_DESCRIPTION) {
    return { ok: false, error: `Mô tả quá ngắn (tối thiểu ${OA_TAG_MIN_DESCRIPTION} ký tự): ghi nhãn dùng để làm gì, gắn cho ai.` };
  }
  return { ok: true, description: d };
}

// Kiểm tra TÊN NHÃN đầy đủ cho form (luật + trùng + đã có trên OA) — dashboard
// gọi thẳng hàm này qua API nên luật chỉ nằm ở 1 nơi.
export async function checkName(rawName) {
  const check = validateOaName(rawName);
  if (!check.ok) return { ok: false, error: check.error };
  const oaName = check.name;
  const ghlTag = ghlTagFor(oaName);
  const [existing, oaTags] = await Promise.all([
    listRegistry({ includeInactive: true }),
    listOaTags().catch(() => ({ data: [] })),
  ]);
  const clash = existing.find((r) => r.ghl_tag === ghlTag || r.oa_name.toLowerCase() === oaName.toLowerCase());
  if (clash) {
    return { ok: false, name: oaName, ghlTag, error: `Đã có nhãn trùng tên: "${clash.oa_name}"${clash.active ? "" : " (đang tắt)"}.` };
  }
  const onOa = (oaTags.data || []).find((t) => String(t).toLowerCase() === oaName.toLowerCase());
  return { ok: true, name: oaName, ghlTag, existsOnOa: onOa || null };
}

export function ghlTagFor(oaName) {
  return `${OA_TAG_PREFIX}${normalizeOaName(oaName).toLowerCase()}`;
}

export async function listRegistry({ includeInactive = false } = {}) {
  const supabase = getSupabase();
  let q = supabase.from("oa_tag_registry").select("*").order("created_at", { ascending: false });
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Map ghl_tag (chữ thường) -> dòng đăng ký, CHỈ nhãn đang active.
export async function getRegistryMap() {
  const rows = await listRegistry();
  return new Map(rows.map((r) => [r.ghl_tag, r]));
}

// Đăng ký nhãn mới: kiểm luật, chặn trùng, cảnh báo nếu tên đã có sẵn trên
// OA (cần adoptExisting=true), rồi tạo tag `oa:xxx` trên GHL
// Nhãn trên OA KHÔNG cần
// tạo trước — Zalo tự tạo ở lần gắn đầu tiên (đã kiểm chứng 2026-09-19).
export async function registerTag({ name, description = "", createdBy = "", adoptExisting = false }) {
  const check = validateOaName(name);
  if (!check.ok) return { ok: false, status: 400, error: check.error };
  const desc = validateDescription(description);
  if (!desc.ok) return { ok: false, status: 400, error: desc.error };
  description = desc.description;

  const oaName = check.name;
  const ghlTag = ghlTagFor(oaName);
  const supabase = getSupabase();

  const existing = await listRegistry({ includeInactive: true });
  const clash = existing.find((r) => r.ghl_tag === ghlTag || r.oa_name.toLowerCase() === oaName.toLowerCase());
  if (clash) {
    return { ok: false, status: 409, error: `Đã có nhãn trùng tên: "${clash.oa_name}"${clash.active ? "" : " (đang tắt)"}.` };
  }

  const oaTags = await listOaTags().catch(() => ({ data: [] }));
  const alreadyOnOa = (oaTags.data || []).find((t) => String(t).toLowerCase() === oaName.toLowerCase());
  if (alreadyOnOa && !adoptExisting) {
    return {
      ok: false,
      status: 409,
      needsConfirm: true,
      error: `Nhãn "${alreadyOnOa}" đã có sẵn trên OA. Đăng ký nghĩa là CRM sẽ quản lý nhãn này (khách không có tag CRM tương ứng sẽ bị gỡ). Xác nhận lại nếu đúng ý.`,
    };
  }

  const { data, error } = await supabase
    .from("oa_tag_registry")
    .insert({ ghl_tag: ghlTag, oa_name: alreadyOnOa || oaName, description, created_by: createdBy })
    .select()
    .single();
  if (error) throw error;

  const ghlCreated = await ensureGhlTags(ghlTag);

  return { ok: true, status: 201, tag: data, ghlCreated };
}

// Đảm bảo tag `oa:xxx` có mặt trong danh sách tag của GHL (chọn được ngay trong
// Workflow/bộ lọc). Trả kết quả kèm lý do lỗi thật của GHL (VD 401 = token
// thiếu quyền ghi tag).
export async function ensureGhlTags(ghlTag) {
  try {
    const names = await listLocationTagNames();
    if (names.includes(ghlTag)) return { ok: true, existed: true };
    await createLocationTag(ghlTag);
    return { ok: true, created: true };
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    return { ok: false, error: `${status ? status + " " : ""}${msg}` };
  }
}

export async function ghlTagPresence(ghlTag) {
  try {
    return { present: (await listLocationTagNames()).includes(ghlTag) };
  } catch (err) {
    return { present: null, error: err.message };
  }
}

export async function deactivateTag(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("oa_tag_registry").update({ active: false }).eq("id", id).select().single();
  if (error) throw error;
  return data;
}
