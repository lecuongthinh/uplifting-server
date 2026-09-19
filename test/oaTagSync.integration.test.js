import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabase } from "./helpers/fakeSupabase.js";

const state = { sb: null, contact: null, oaTags: [], oaCalls: [], crmCalls: [], registry: [] };

const url = (p) => new URL(p, import.meta.url).href;
mock.module(url("../src/lib/supabase.js"), { exports: { getSupabase: () => state.sb } });
mock.module(url("../src/lib/oaTagRegistry.js"), { exports: { OA_TAG_PREFIX: "oa:", listRegistry: async () => state.registry } });
mock.module(url("../src/lib/leadconnector.js"), {
  exports: {
    getContactById: async () => state.contact,
    getFieldIdByKey: async () => "f_uid",
    customFieldsOf: (c) => Object.fromEntries((c.customFields || []).map((f) => [f.id, f.value])),
    addContactNote: async () => {},
    addContactTag: async (id, tag) => { state.crmCalls.push(["add", tag]); state.contact.tags.push(tag); },
    removeContactTag: async (id, tag) => { state.crmCalls.push(["remove", tag]); state.contact.tags = state.contact.tags.filter((t) => t !== tag); },
  },
});
mock.module(url("../src/lib/zalo.js"), {
  exports: {
    getFollowerInfo: async () => ({ data: { tags_and_notes_info: { tag_names: [...state.oaTags] } } }),
    tagFollower: async (_uid, name) => { state.oaCalls.push(["tag", name]); if (!state.oaTags.includes(name)) state.oaTags.push(name); },
    untagFollower: async (_uid, name) => { state.oaCalls.push(["untag", name]); state.oaTags = state.oaTags.filter((n) => n !== name); },
  },
});

const sync = await import("../src/lib/oaTagSync.js");

const REG = [
  { ghl_tag: "oa:vip", oa_name: "VIP" },
  { ghl_tag: "oa:hot", oa_name: "Hot" },
];

beforeEach(() => {
  state.sb = createFakeSupabase({ oa_tag_state: [], oa_tag_sync_log: [] });
  state.registry = REG;
  state.oaTags = [];
  state.oaCalls = [];
  state.crmCalls = [];
  state.contact = { id: "c1", phone: "+84901111111", tags: [], customFields: [{ id: "f_uid", value: "uid-1" }] };
});

const snapshot = () => state.sb._db.oa_tag_state[0]?.synced_tags;
const logs = () => state.sb._db.oa_tag_sync_log;

test("CRM gắn tag → nhãn xuất hiện trên OA, ảnh chụp được lưu", async () => {
  state.contact.tags = ["oa:vip"];
  const r = await sync.syncContactOaTags("c1", { origin: "crm" });
  assert.equal(r.status, "ok");
  assert.deepEqual(state.oaCalls, [["tag", "VIP"]]);
  assert.deepEqual(snapshot(), ["VIP"]);
  assert.equal(logs().length, 1);
});

test("chạy lại khi đã khớp → unchanged, không gọi thêm, không ghi log", async () => {
  state.contact.tags = ["oa:vip"];
  await sync.syncContactOaTags("c1", { origin: "crm" });
  state.oaCalls = [];
  const r = await sync.syncContactOaTags("c1", { origin: "crm" });
  assert.equal(r.status, "unchanged");
  assert.deepEqual(state.oaCalls, []);
  assert.equal(logs().length, 1);
});

test("CHIỀU NGƯỢC: nhãn đăng ký được gắn tay trên OA → tự thêm tag oa:* lên CRM", async () => {
  state.sb._db.oa_tag_state.push({ contact_id: "c1", synced_tags: [] });
  state.oaTags = ["Hot", "Kid"]; // Kid là nhãn gắn tay KHÔNG đăng ký
  const r = await sync.syncContactOaTags("c1", { origin: "oa" });
  assert.equal(r.status, "ok");
  assert.deepEqual(state.crmCalls, [["add", "oa:hot"]]);
  assert.deepEqual(state.oaCalls, [], "không đụng OA");
  assert.ok(state.oaTags.includes("Kid"), "nhãn gắn tay còn nguyên");
  assert.deepEqual(snapshot(), ["Hot"]);
  assert.match(logs()[0].detail, /\+oa:hot/);
});

test("CHIỀU NGƯỢC: nhãn bị gỡ tay trên OA → gỡ tag CRM; nhưng KHÔNG gắn ngược lại lên OA", async () => {
  state.sb._db.oa_tag_state.push({ contact_id: "c1", synced_tags: ["VIP"] });
  state.contact.tags = ["oa:vip"];
  state.oaTags = []; // ai đó gỡ VIP trên OA
  const r = await sync.syncContactOaTags("c1", { origin: "crm" }); // kể cả khi webhook CRM kích hoạt
  assert.equal(r.status, "ok");
  assert.deepEqual(state.crmCalls, [["remove", "oa:vip"]]);
  assert.deepEqual(state.oaCalls, []);
  assert.deepEqual(snapshot(), []);
});

test("CRM gỡ tag (đã đồng bộ trước đó) → gỡ nhãn khỏi OA, giữ nhãn gắn tay", async () => {
  state.sb._db.oa_tag_state.push({ contact_id: "c1", synced_tags: ["VIP"] });
  state.contact.tags = [];
  state.oaTags = ["VIP", "Kid"];
  await sync.syncContactOaTags("c1", { origin: "crm" });
  assert.deepEqual(state.oaCalls, [["untag", "VIP"]]);
  assert.deepEqual(state.oaTags, ["Kid"]);
  assert.deepEqual(snapshot(), []);
});

test("chưa có ảnh chụp + origin oa: chỉ bổ sung, không bao giờ gỡ", async () => {
  state.contact.tags = [];       // CRM không có
  state.oaTags = ["VIP"];        // OA có (có thể là sync cũ trước khi có ảnh chụp)
  await sync.syncContactOaTags("c1", { origin: "oa" });
  assert.deepEqual(state.oaCalls, [], "không gỡ nhãn OA");
  assert.deepEqual(state.crmCalls, [["add", "oa:vip"]]);
});

test("hành vi cũ giữ nguyên: chưa có ảnh chụp + origin crm → CRM là nguồn sự thật, nhãn OA thừa bị gỡ", async () => {
  state.contact.tags = [];
  state.oaTags = ["VIP"];
  await sync.syncContactOaTags("c1", { origin: "crm" });
  assert.deepEqual(state.oaCalls, [["untag", "VIP"]]);
  assert.deepEqual(state.crmCalls, []);
});

test("tag oa:* chưa đăng ký → báo unregistered nhưng vẫn đồng bộ phần đã đăng ký", async () => {
  state.contact.tags = ["oa:vip", "oa:la"];
  const r = await sync.syncContactOaTags("c1", { origin: "crm" });
  assert.equal(r.status, "unregistered");
  assert.deepEqual(state.oaCalls, [["tag", "VIP"]]);
});

test("thiếu Zalo UID → no_uid, không gọi Zalo", async () => {
  state.contact.customFields = [];
  state.contact.tags = ["oa:vip"];
  const r = await sync.syncContactOaTags("c1", { origin: "crm" });
  assert.equal(r.status, "no_uid");
  assert.deepEqual(state.oaCalls, []);
});

const drain = async () => {
  for (let i = 0; i < 60 && (sync.queueStats().pending || sync.queueStats().running); i++) await new Promise((r) => setTimeout(r, 50));
};

test("hàng đợi: nguồn 'oa' bị chặn tần suất, 'crm' và force thì không", async () => {
  state.contact.customFields = []; // job chạy nhanh (skip)
  state.contact.tags = [];
  assert.equal(sync.enqueueOaTagSync("throttle-1", "oa"), true);
  assert.equal(sync.enqueueOaTagSync("throttle-1", "oa"), false, "lần 2 trong 6h bị chặn");
  await drain();
  assert.equal(sync.enqueueOaTagSync("throttle-1", "oa"), false, "vẫn bị chặn sau khi job xong");
  assert.equal(sync.enqueueOaTagSync("throttle-1", "oa", { force: true }), true, "force bỏ qua chặn");
  await drain();
  assert.equal(sync.enqueueOaTagSync("throttle-1", "crm"), true, "webhook CRM luôn được xếp hàng");
  assert.equal(sync.enqueueOaTagSync("throttle-1", "crm"), true, "job đầu đã chạy, job thứ 2 vào hàng chờ");
  assert.equal(sync.enqueueOaTagSync("throttle-1", "crm"), false, "gộp với job đang chờ của cùng contact");
  await drain();
});
