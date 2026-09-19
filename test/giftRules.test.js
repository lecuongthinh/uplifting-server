import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateGiftInput, isEligible, isGiftLive, renderGiftMessage, requiredTagsOf, statusAfterFailure,
  MAX_DELIVERY_ATTEMPTS,
} from "../src/lib/giftRules.js";
import { TAG_MINIAPP_USER, TAG_OA_FOLLOWED } from "../src/lib/tags.js";

const good = {
  gift_key: "chao-mung-ebook",
  title: "Ebook thực đơn 7 ngày",
  url: "https://example.com/ebook.pdf",
  message_template: "Chào {name}, 123 GYM tặng bạn {gift}: {link}",
};

test("dữ liệu hợp lệ → mặc định cần cả Mini App + follow, tắt sẵn", () => {
  const r = validateGiftInput(good);
  assert.equal(r.ok, true);
  assert.equal(r.value.require_miniapp, true);
  assert.equal(r.value.require_follow, true);
});

test("từ chối mã quà sai kiểu, link không https, thiếu {link}, chỗ điền lạ", () => {
  assert.equal(validateGiftInput({ ...good, gift_key: "Chào Mừng" }).ok, false);
  assert.equal(validateGiftInput({ ...good, url: "http://x.com/a" }).ok, false);
  assert.equal(validateGiftInput({ ...good, url: "https://x.com/a b" }).ok, false);
  const noLink = validateGiftInput({ ...good, message_template: "Chào bạn, quà của bạn đây nhé" });
  assert.equal(noLink.ok, false);
  assert.match(noLink.errors.join(" "), /\{link\}/);
  const typo = validateGiftInput({ ...good, message_template: "Chào {ten}, nhận quà {link}" });
  assert.equal(typo.ok, false);
  assert.match(typo.errors.join(" "), /\{ten\}/);
});

test("phải chọn ít nhất 1 điều kiện", () => {
  const r = validateGiftInput({ ...good, require_miniapp: false, require_follow: false });
  assert.equal(r.ok, false);
});

test("sửa quà đã tạo: không đổi được mã quà và điều kiện", () => {
  const existing = { gift_key: "chao-mung-ebook", kind: "external_url", require_miniapp: true, require_follow: true };
  assert.equal(validateGiftInput({ ...good, title: "Tên mới rõ ràng" }, existing).ok, true);
  assert.equal(validateGiftInput({ ...good, gift_key: "khac" }, existing).ok, false);
  assert.equal(validateGiftInput({ ...good, require_follow: false }, existing).ok, false);
});

test("đủ điều kiện theo tag (không phân biệt hoa thường)", () => {
  const gift = { require_miniapp: true, require_follow: true };
  assert.deepEqual(requiredTagsOf(gift), [TAG_MINIAPP_USER, TAG_OA_FOLLOWED]);
  assert.equal(isEligible(gift, [TAG_MINIAPP_USER.toLowerCase(), TAG_OA_FOLLOWED]), true);
  assert.equal(isEligible(gift, [TAG_MINIAPP_USER]), false);
  assert.equal(isEligible({ require_miniapp: false, require_follow: true }, [TAG_OA_FOLLOWED]), true);
  assert.equal(isEligible(gift, []), false);
});

test("quà chỉ chạy khi đang bật và chưa hết hạn", () => {
  const now = Date.parse("2026-09-19T00:00:00Z");
  assert.equal(isGiftLive({ active: false }, now), false);
  assert.equal(isGiftLive({ active: true, ends_at: null }, now), true);
  assert.equal(isGiftLive({ active: true, ends_at: "2026-09-18T00:00:00Z" }, now), false);
  assert.equal(isGiftLive({ active: true, ends_at: "2026-09-20T00:00:00Z" }, now), true);
});

test("điền tin nhắn; thiếu tên thì gọi 'bạn'", () => {
  const t = "Chào {name}, tặng {gift}: {link}";
  assert.equal(renderGiftMessage(t, { name: "Lan", gift: "Ebook", link: "https://a.b" }), "Chào Lan, tặng Ebook: https://a.b");
  assert.equal(renderGiftMessage(t, { name: "", gift: "Ebook", link: "https://a.b" }), "Chào bạn, tặng Ebook: https://a.b");
});

test("trạng thái sau lỗi: -232 giữ chờ; lỗi Zalo khác là hỏng; lỗi mạng thử lại có trần", () => {
  assert.equal(statusAfterFailure({ zaloErrorCode: -232 }, 1), "pending_window");
  assert.equal(statusAfterFailure({ zaloErrorCode: -118 }, 1), "failed");
  assert.equal(statusAfterFailure(new Error("timeout"), 1), "pending_window");
  assert.equal(statusAfterFailure(new Error("timeout"), MAX_DELIVERY_ATTEMPTS), "failed");
});
