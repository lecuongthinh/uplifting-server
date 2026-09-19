// Quy tắc THUẦN cho tính năng Quà tặng (không gọi mạng/DB) — nguồn sự thật
// duy nhất cho luật nhập liệu, để API và dashboard chỉ hiển thị chứ không
// tự lặp lại luật (mục tiêu đã thống nhất với chủ shop: ai dùng cũng đúng,
// không phụ thuộc trí nhớ về các quy định). Phần ghi DB/gửi tin nằm ở
// lib/gifts.js.
import { TAG_MINIAPP_USER, TAG_OA_FOLLOWED } from "./tags.js";

export const GIFT_KINDS = ["external_url", "miniapp_link"];
export const GIFT_PLACEHOLDERS = ["name", "gift", "link"];
export const GIFT_MAX_MESSAGE = 1000; // tin tư vấn của Zalo cho phép tối đa 2000 ký tự, chừa dư cho chỗ điền
export const GIFT_MIN_MESSAGE = 10;

export const GIFT_RULES = [
  "Mã quà (gift_key): 3–40 ký tự, chỉ chữ thường không dấu, số và dấu gạch ngang — không đổi được sau khi tạo.",
  "Tin nhắn BẮT BUỘC có {link} (nơi điền đường dẫn quà). Chỉ được dùng {name} (tên khách), {gift} (tên quà), {link}.",
  "Đường dẫn phải bắt đầu bằng https://. Quà trong Mini App dùng link dạng https://zalo.me/s/<appId>/?path=/khoa-hoc/<slug> (trang trong Mini App)",
  "Quà tạo xong ở trạng thái TẮT — bật thủ công sau khi xem trước số người đủ điều kiện.",
  "Bật quà: chọn có tặng cho người ĐÃ đủ điều kiện từ trước hay chỉ người mới đủ điều kiện từ lúc bật (mặc định: chỉ người mới).",
  "Tin quà gửi qua OA chỉ đi được khi còn trong cửa sổ tương tác của Zalo (vừa follow, hoặc khách nhắn tin/bấm nút trong 7 ngày). Chưa gửi được thì quà được GIỮ LẠI và tự gửi ngay khi khách nhắn tin cho OA.",
];

const KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Kiểm tra dữ liệu form. `existing` (nếu có) = dòng đang sửa — mã quà và
// điều kiện không được đổi sau khi tạo, chỉ nội dung.
export function validateGiftInput(input, existing = null) {
  const errors = [];
  const out = {};

  const key = String(input.gift_key ?? existing?.gift_key ?? "").trim();
  if (existing) {
    if (input.gift_key && input.gift_key !== existing.gift_key) errors.push("Không đổi được mã quà sau khi tạo.");
    out.gift_key = existing.gift_key;
  } else {
    if (key.length < 3 || key.length > 40 || !KEY_PATTERN.test(key)) {
      errors.push("Mã quà phải 3–40 ký tự, chỉ chữ thường không dấu, số và dấu gạch ngang (VD: chao-mung-ebook).");
    }
    out.gift_key = key;
  }

  const title = String(input.title ?? "").trim();
  if (title.length < 3 || title.length > 80) errors.push("Tên quà phải từ 3 đến 80 ký tự.");
  out.title = title;

  out.description = String(input.description ?? "").trim() || null;

  const kind = input.kind ?? existing?.kind ?? "external_url";
  if (!GIFT_KINDS.includes(kind)) errors.push(`Loại quà không hợp lệ (${GIFT_KINDS.join(" | ")}).`);
  out.kind = kind;

  const url = String(input.url ?? "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) errors.push("Đường dẫn quà phải bắt đầu bằng https:// và không chứa khoảng trắng.");
  out.url = url;

  const template = String(input.message_template ?? "").trim();
  if (template.length < GIFT_MIN_MESSAGE || template.length > GIFT_MAX_MESSAGE) {
    errors.push(`Tin nhắn phải từ ${GIFT_MIN_MESSAGE} đến ${GIFT_MAX_MESSAGE} ký tự.`);
  }
  if (!template.includes("{link}")) errors.push("Tin nhắn phải có {link} — chỗ điền đường dẫn quà.");
  const unknown = [...template.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((p) => !GIFT_PLACEHOLDERS.includes(p));
  if (unknown.length > 0) {
    errors.push(`Chỗ điền không hợp lệ: ${[...new Set(unknown)].map((p) => `{${p}}`).join(", ")}. Chỉ dùng ${GIFT_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.`);
  }
  out.message_template = template;

  // Điều kiện: không đổi sau khi tạo (đổi điều kiện của quà đang chạy sẽ
  // làm sai lịch sử "ai đã đủ điều kiện").
  if (existing) {
    out.require_miniapp = existing.require_miniapp;
    out.require_follow = existing.require_follow;
    if (
      (input.require_miniapp !== undefined && Boolean(input.require_miniapp) !== existing.require_miniapp) ||
      (input.require_follow !== undefined && Boolean(input.require_follow) !== existing.require_follow)
    ) {
      errors.push("Không đổi được điều kiện nhận quà sau khi tạo — tạo quà mới nếu cần điều kiện khác.");
    }
  } else {
    out.require_miniapp = input.require_miniapp === undefined ? true : Boolean(input.require_miniapp);
    out.require_follow = input.require_follow === undefined ? true : Boolean(input.require_follow);
    if (!out.require_miniapp && !out.require_follow) errors.push("Phải chọn ít nhất 1 điều kiện (đã dùng Mini App và/hoặc đã follow OA).");
  }

  if (input.ends_at) {
    const d = new Date(input.ends_at);
    if (Number.isNaN(d.getTime())) errors.push("Ngày kết thúc không hợp lệ.");
    else out.ends_at = d.toISOString();
  } else {
    out.ends_at = null;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: out };
}

// Danh sách tag CRM mà 1 quà đòi hỏi (để dò "đã đủ điều kiện từ trước").
export function requiredTagsOf(gift) {
  const tags = [];
  if (gift.require_miniapp) tags.push(TAG_MINIAPP_USER);
  if (gift.require_follow) tags.push(TAG_OA_FOLLOWED);
  return tags;
}

// `tags` = mảng tag hiện có của contact (bất kỳ hoa/thường).
export function isEligible(gift, tags) {
  const have = new Set((tags || []).map((t) => String(t).toLowerCase()));
  return requiredTagsOf(gift).every((t) => have.has(t.toLowerCase()));
}

export function isGiftLive(gift, now = Date.now()) {
  if (!gift.active) return false;
  if (gift.ends_at && new Date(gift.ends_at).getTime() < now) return false;
  return true;
}

export function renderGiftMessage(template, { name, gift, link }) {
  return template
    .replaceAll("{name}", name || "bạn")
    .replaceAll("{gift}", gift)
    .replaceAll("{link}", link);
}

// Trạng thái 1 lượt tặng (gift_grants.status):
//   pending_window — chưa gửi được vì ngoài cửa sổ tương tác (Zalo -232) hoặc
//                    lỗi mạng tạm thời; tự gửi lại khi khách nhắn tin cho OA
//   no_uid         — chưa có Zalo UID để gửi; gửi lại khi có UID
//   delivered      — đã gửi thành công
//   failed         — Zalo từ chối vì lý do khác (xem last_error), hoặc quá số lần thử
//   excluded       — đã đủ điều kiện TỪ TRƯỚC lúc bật quà và chủ shop chọn không tặng
export const GRANT_STATUSES = ["pending_window", "no_uid", "delivered", "failed", "excluded"];
export const RETRYABLE_STATUSES = ["pending_window", "no_uid"];
export const MAX_DELIVERY_ATTEMPTS = 5;

// Zalo -232 = "chưa từng tương tác hoặc đã hết hạn tương tác" (đã xác nhận
// bằng test thật, xem memory reference_zalo_oa_tin_tu_van_window).
export const ZALO_WINDOW_CLOSED_CODE = -232;

// Quyết định trạng thái sau 1 lần gửi thất bại. `attempts` = số lần đã thử
// TÍNH CẢ lần vừa rồi.
export function statusAfterFailure(err, attempts) {
  const code = err?.zaloErrorCode;
  if (code === ZALO_WINDOW_CLOSED_CODE) return "pending_window";
  // Lỗi không có mã Zalo (mạng/timeout) là tạm thời — cho thử lại, nhưng có trần.
  if (code == null) return attempts >= MAX_DELIVERY_ATTEMPTS ? "failed" : "pending_window";
  return "failed";
}
