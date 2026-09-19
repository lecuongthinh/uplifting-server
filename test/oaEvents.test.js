import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import express from "express";

const calls = [];
const rec = (name) => (...args) => { calls.push([name, ...args]); return Promise.resolve(); };
const state = { hits: [] };

const url = (p) => new URL(p, import.meta.url).href;
mock.module(url("../src/lib/leadconnector.js"), {
  exports: {
    findContactByPhone: async () => null,
    createLeadContact: async () => ({ id: "new1" }),
    findContactsByZaloUid: async () => state.hits,
    updateContactZaloUid: rec("updateUid"),
    addContactTag: rec("addTag"),
    removeContactTag: rec("removeTag"),
    addContactNote: rec("note"),
  },
});
mock.module(url("../src/lib/oaInteractions.js"), { exports: { recordInteraction: rec("interaction") } });
mock.module(url("../src/lib/oaState.js"), { exports: { recordOaEvent: rec("oaEvent") } });
mock.module(url("../src/lib/gifts.js"), { exports: { maybeGrantGifts: rec("grant"), flushPendingGiftsForPhone: rec("flush") } });
mock.module(url("../src/lib/oaTagSync.js"), { exports: { enqueueOaTagSync: (...a) => calls.push(["enqueue", ...a]) } });

process.env.ZALO_OA_WEBHOOK_SECRET = "test-secret";
const router = (await import("../src/routes/oaEvents.js")).default;

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
app.use("/webhooks/oa-events", router);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/webhooks/oa-events`;
after(() => server.close());

const sign = (raw, appId, ts) => "mac=" + crypto.createHash("sha256").update(`${appId}${raw}${ts}test-secret`).digest("hex");

async function send(payload, { signature, tamper } = {}) {
  const raw = JSON.stringify(payload);
  const ts = String(Date.now());
  const res = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", "x-zevent-timestamp": ts, "x-zevent-signature": signature ?? sign(raw, payload.app_id, ts) },
    body: tamper ? raw.replace("uid-1", "uid-9") : raw,
  });
  await new Promise((r) => setTimeout(r, 50)); // xử lý chạy sau khi đã trả 200
  return res;
}

const CONTACT = { id: "c1", phone: "+84901111111", tags: ["nguồn: zalo mini app"] };
const names = () => calls.map((c) => c[0]);

beforeEach(() => { calls.length = 0; state.hits = [CONTACT]; });

test("chữ ký sai → vẫn trả 200 (ping của Zalo) nhưng KHÔNG xử lý gì", async () => {
  const res = await send({ app_id: "A", event_name: "follow", follower: { id: "uid-1" } }, { signature: "mac=deadbeef" });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, []);
});

test("body bị sửa sau khi ký → không xử lý", async () => {
  await send({ app_id: "A", event_name: "follow", follower: { id: "uid-1" } }, { tamper: true });
  assert.deepEqual(calls, []);
});

test("follow hợp lệ → gắn tag, ghi mốc, xét quà với tag follow, xếp hàng kéo nhãn ngược", async () => {
  await send({ app_id: "A", event_name: "follow", follower: { id: "uid-1" } });
  assert.deepEqual(names(), ["addTag", "note", "oaEvent", "grant", "enqueue"]);
  assert.deepEqual(calls[0].slice(1), ["c1", "Đã theo dõi OA"]);
  const grant = calls.find((c) => c[0] === "grant");
  assert.ok(grant[1].tags.includes("Đã theo dõi OA") && grant[1].tags.includes("nguồn: zalo mini app"));
  assert.equal(grant[2].uid, "uid-1");
  assert.deepEqual(calls.at(-1).slice(1), ["c1", "oa"]);
});

test("follow của người chưa từng mở Mini App (không khớp uid) → không làm gì", async () => {
  state.hits = [];
  await send({ app_id: "A", event_name: "follow", follower: { id: "uid-1" } });
  assert.deepEqual(calls, []);
});

test("follow lặp lại cho người đã có tag → không ghi note lần 2", async () => {
  state.hits = [{ ...CONTACT, tags: ["đã theo dõi oa"] }];
  await send({ app_id: "A", event_name: "follow", follower: { id: "uid-1" } });
  assert.ok(!names().includes("note"));
});

test("unfollow → gỡ tag và ghi mốc", async () => {
  await send({ app_id: "A", event_name: "unfollow", follower: { id: "uid-1" } });
  assert.deepEqual(names(), ["removeTag", "oaEvent"]);
  assert.equal(calls[1][1], "unfollow");
  assert.equal(calls[1][2].contactId, "c1");
});

test("user_send_text → mở cửa sổ 7 ngày: ghi tương tác, gửi bù quà chờ, kéo nhãn ngược", async () => {
  await send({ app_id: "A", event_name: "user_send_text", sender: { id: "uid-1" } });
  assert.deepEqual(names().sort(), ["enqueue", "flush", "interaction"]);
});

test("user_received_message (tin của chính OA) bị bỏ qua", async () => {
  await send({ app_id: "A", event_name: "user_received_message", sender: { id: "uid-1" } });
  assert.deepEqual(calls, []);
});

test("user_seen_message → chỉ ghi trạng thái 'seen', KHÔNG tính là cửa sổ tương tác", async () => {
  await send({ app_id: "A", event_name: "user_seen_message", sender: { id: "uid-1" } });
  assert.deepEqual(names(), ["oaEvent"]);
  assert.equal(calls[0][1], "seen");
});

test("user_submit_info với SĐT chưa có → tạo lead, gắn uid + tag, ghi tương tác", async () => {
  await send({ app_id: "A", event_name: "user_submit_info", sender: { id: "uid-1" }, info: { phone: "0909", name: "Lan" } });
  assert.deepEqual(names(), ["addTag", "updateUid", "addTag", "interaction"]);
});
