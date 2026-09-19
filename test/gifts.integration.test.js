import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabase } from "./helpers/fakeSupabase.js";
import { TAG_MINIAPP_USER, TAG_OA_FOLLOWED } from "../src/lib/tags.js";

// ── Đồ giả cho mọi thứ chạm mạng ────────────────────────────────────────
const state = { sb: null, sent: [], sendImpl: null, tagsAdded: [], notes: [], contacts: new Map(), eligibleForActivation: [] };

const url = (p) => new URL(p, import.meta.url).href;
mock.module(url("../src/lib/supabase.js"), { exports: { getSupabase: () => state.sb } });
mock.module(url("../src/lib/zalo.js"), {
  exports: { sendConsultationMessageUID: async (uid, text) => { state.sent.push({ uid, text }); return state.sendImpl(uid, text); } },
});
mock.module(url("../src/lib/leadconnector.js"), {
  exports: {
    getContactById: async (id) => state.contacts.get(id),
    getFieldIdByKey: async () => "f_uid",
    customFieldsOf: (c) => Object.fromEntries((c.customFields || []).map((f) => [f.id, f.value])),
    addContactTag: async (id, tag) => { state.tagsAdded.push({ id, tag }); },
    addContactNote: async (id, body) => { state.notes.push({ id, body }); },
    findContactsWithAllTags: async () => state.eligibleForActivation,
    phoneCandidates: (p) => [p],
  },
});

const gifts = await import("../src/lib/gifts.js");

const GIFT = {
  id: 1, gift_key: "chao-mung", title: "Ebook thực đơn", url: "https://x.vn/ebook.pdf",
  message_template: "Chào {name}, tặng {gift}: {link}", require_miniapp: true, require_follow: true,
  active: true, ends_at: null,
};
const contact = (over = {}) => ({
  id: "c1", phone: "+84901111111", firstName: "Lan", tags: [TAG_MINIAPP_USER, TAG_OA_FOLLOWED],
  customFields: [{ id: "f_uid", value: "uid-1" }], ...over,
});

beforeEach(() => {
  state.sb = createFakeSupabase({ gifts: [{ ...GIFT }], gift_grants: [] });
  state.sent = []; state.tagsAdded = []; state.notes = []; state.contacts = new Map();
  state.eligibleForActivation = [];
  state.sendImpl = async () => ({ error: 0 });
  delete process.env.GIFTS_DISABLED;
});

const grants = () => state.sb._db.gift_grants;

test("đủ điều kiện + gửi thành công → grant delivered, có tag, note", async () => {
  const c = contact();
  const res = await gifts.maybeGrantGifts(c);
  assert.equal(res.length, 1);
  assert.equal(res[0].status, "delivered");
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].uid, "uid-1");
  assert.equal(state.sent[0].text, "Chào Lan, tặng Ebook thực đơn: https://x.vn/ebook.pdf");
  assert.equal(grants()[0].status, "delivered");
  assert.ok(grants()[0].delivered_at);
  assert.deepEqual(state.tagsAdded, [{ id: "c1", tag: "Quà: chao-mung" }]);
  assert.match(state.notes[0].body, /Đã gửi "Ebook thực đơn"/);
});

test("gọi lại cho cùng khách KHÔNG tặng trùng (chỉ 1 tin, 1 dòng sổ)", async () => {
  const c = contact();
  await gifts.maybeGrantGifts(c);
  const again = await gifts.maybeGrantGifts(c);
  assert.equal(again.length, 0);
  assert.equal(state.sent.length, 1);
  assert.equal(grants().length, 1);
});

test("2 luồng chạy đồng thời (đăng nhập + webhook follow) vẫn chỉ tặng 1 lần", async () => {
  const c = contact();
  await Promise.all([gifts.maybeGrantGifts(c), gifts.maybeGrantGifts(c)]);
  assert.equal(state.sent.length, 1);
  assert.equal(grants().length, 1);
});

test("thiếu 1 điều kiện (chưa follow) → không tặng, không ghi sổ", async () => {
  const res = await gifts.maybeGrantGifts(contact({ tags: [TAG_MINIAPP_USER] }));
  assert.equal(res.length, 0);
  assert.equal(grants().length, 0);
  assert.equal(state.sent.length, 0);
});

test("quà đang tắt hoặc hết hạn → bỏ qua", async () => {
  state.sb = createFakeSupabase({ gifts: [{ ...GIFT, active: false }], gift_grants: [] });
  assert.equal((await gifts.maybeGrantGifts(contact())).length, 0);
  state.sb = createFakeSupabase({ gifts: [{ ...GIFT, ends_at: "2020-01-01T00:00:00Z" }], gift_grants: [] });
  assert.equal((await gifts.maybeGrantGifts(contact())).length, 0);
});

test("GIFTS_DISABLED=true tắt hẳn tính năng", async () => {
  process.env.GIFTS_DISABLED = "true";
  assert.equal((await gifts.maybeGrantGifts(contact())).length, 0);
  assert.equal(grants().length, 0);
});

test("Zalo -232 (ngoài cửa sổ) → giữ ở pending_window; khách nhắn tin → gửi bù thành công", async () => {
  const err = Object.assign(new Error("User has not interacted with the OA"), { zaloErrorCode: -232 });
  state.sendImpl = async () => { throw err; };
  const c = contact();
  state.contacts.set("c1", c);

  const res = await gifts.maybeGrantGifts(c);
  assert.equal(res[0].status, "pending_window");
  assert.equal(grants()[0].status, "pending_window");
  assert.equal(grants()[0].attempts, 1);
  assert.equal(state.tagsAdded.length, 0, "chưa gửi được thì chưa gắn tag 'đã nhận quà'");

  // khách nhắn tin cho OA → cửa sổ mở
  state.sendImpl = async () => ({ error: 0 });
  const flushed = await gifts.flushPendingGiftsForPhone("+84901111111", { uid: "uid-1" });
  assert.equal(flushed.length, 1);
  assert.equal(grants()[0].status, "delivered");
  assert.equal(grants()[0].attempts, 2);
  assert.equal(state.tagsAdded.length, 1);
});

test("gửi bù không gửi lại lượt đã delivered", async () => {
  const c = contact();
  state.contacts.set("c1", c);
  await gifts.maybeGrantGifts(c);
  state.sent = [];
  const flushed = await gifts.flushPendingGiftsForPhone("+84901111111", { uid: "uid-1" });
  assert.equal(flushed.length, 0);
  assert.equal(state.sent.length, 0);
});

test("lỗi Zalo khác (không phải -232) → failed, không tự thử lại khi khách nhắn tin", async () => {
  state.sendImpl = async () => { throw Object.assign(new Error("tài khoản không tồn tại"), { zaloErrorCode: -118 }); };
  const c = contact();
  state.contacts.set("c1", c);
  const res = await gifts.maybeGrantGifts(c);
  assert.equal(res[0].status, "failed");
  state.sendImpl = async () => ({ error: 0 });
  assert.equal((await gifts.flushPendingGiftsForPhone("+84901111111")).length, 0);
  assert.equal(grants()[0].status, "failed");
});

test("chưa có uid → no_uid; khi có uid (khách nhắn tin) thì gửi bù", async () => {
  const c = contact({ customFields: [] });
  state.contacts.set("c1", c);
  const res = await gifts.maybeGrantGifts(c);
  assert.equal(res[0].status, "no_uid");
  assert.equal(state.sent.length, 0);
  const flushed = await gifts.flushPendingGiftsForPhone("+84901111111", { uid: "uid-9" });
  assert.equal(flushed[0].status, "delivered");
  assert.equal(state.sent[0].uid, "uid-9");
});

test("uid truyền thẳng (lúc đăng nhập lần đầu hồ sơ CRM chưa kịp có uid) vẫn gửi được", async () => {
  const res = await gifts.maybeGrantGifts(contact({ customFields: [] }), { uid: "uid-fresh" });
  assert.equal(res[0].status, "delivered");
  assert.equal(state.sent[0].uid, "uid-fresh");
});

test("bật quà KHÔNG backfill: người đã đủ điều kiện từ trước bị loại trừ và không nhận quà", async () => {
  state.sb = createFakeSupabase({ gifts: [{ ...GIFT, active: false }], gift_grants: [] });
  state.eligibleForActivation = [{ id: "old1", phone: "+84902222222" }, { id: "old2", phone: "+84903333333" }];
  const out = await gifts.activateGift({ ...GIFT, active: false }, { includeExisting: false });
  assert.equal(out.excluded, 2);
  assert.equal(state.sb._db.gifts[0].active, true);
  assert.deepEqual(grants().map((g) => g.status), ["excluded", "excluded"]);

  // người cũ đăng nhập lại sau khi bật → KHÔNG được tặng
  const oldContact = contact({ id: "old1", phone: "+84902222222" });
  assert.equal((await gifts.maybeGrantGifts(oldContact)).length, 0);
  assert.equal(state.sent.length, 0);
  // khách mới thì được
  assert.equal((await gifts.maybeGrantGifts(contact())).length, 1);
});

test("bật quà với includeExisting=true: không loại trừ ai", async () => {
  state.sb = createFakeSupabase({ gifts: [{ ...GIFT, active: false }], gift_grants: [] });
  state.eligibleForActivation = [{ id: "old1", phone: "+84902222222" }];
  const out = await gifts.activateGift({ ...GIFT, active: false }, { includeExisting: true });
  assert.equal(out.excluded, 0);
  assert.equal(grants().length, 0);
  assert.equal((await gifts.maybeGrantGifts(contact({ id: "old1", phone: "+84902222222" }))).length, 1);
});

test("retryGrant: lượt failed gửi lại được; delivered/excluded thì từ chối", async () => {
  state.sendImpl = async () => { throw Object.assign(new Error("x"), { zaloErrorCode: -118 }); };
  const c = contact();
  state.contacts.set("c1", c);
  await gifts.maybeGrantGifts(c);
  state.sendImpl = async () => ({ error: 0 });
  const r = await gifts.retryGrant(grants()[0].id);
  assert.equal(r.ok, true);
  assert.equal(r.outcome.status, "delivered");
  const again = await gifts.retryGrant(grants()[0].id);
  assert.equal(again.ok, false);
  assert.equal(again.status, 409);
});
