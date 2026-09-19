import { test } from "node:test";
import assert from "node:assert/strict";
import { planTagSync, hasChanges } from "../src/lib/tagMerge.js";

const S = (...a) => new Set(a);
const managed = S("VIP", "Kid2", "Hot");

test("đã khớp nhau → không làm gì, snapshot giữ nhãn đang có", () => {
  const p = planTagSync({ managed, crm: S("VIP"), oa: S("VIP"), snapshot: S("VIP"), origin: "crm" });
  assert.equal(hasChanges(p), false);
  assert.deepEqual(p.nextSnapshot, ["VIP"]);
});

test("CRM vừa gắn tag (snapshot chưa có) → thêm lên OA", () => {
  const p = planTagSync({ managed, crm: S("VIP"), oa: S(), snapshot: S(), origin: "crm" });
  assert.deepEqual(p.toAddOa, ["VIP"]);
  assert.deepEqual(p.nextSnapshot, ["VIP"]);
});

test("CRM vừa gỡ tag (snapshot có, OA còn) → gỡ khỏi OA", () => {
  const p = planTagSync({ managed, crm: S(), oa: S("VIP"), snapshot: S("VIP"), origin: "crm" });
  assert.deepEqual(p.toRemoveOa, ["VIP"]);
  assert.deepEqual(p.toRemoveCrm, []);
  assert.deepEqual(p.nextSnapshot, []);
});

test("OA vừa được gắn tay nhãn đã đăng ký (snapshot chưa có, CRM chưa có) → thêm tag CRM", () => {
  const p = planTagSync({ managed, crm: S(), oa: S("Hot"), snapshot: S(), origin: "oa" });
  assert.deepEqual(p.toAddCrm, ["Hot"]);
  assert.deepEqual(p.toRemoveOa, []);
  assert.deepEqual(p.nextSnapshot, ["Hot"]);
});

test("OA vừa gỡ nhãn (snapshot có, CRM còn tag) → gỡ tag CRM — kể cả khi lần chạy này do CRM kích hoạt", () => {
  for (const origin of ["oa", "crm"]) {
    const p = planTagSync({ managed, crm: S("VIP"), oa: S(), snapshot: S("VIP"), origin });
    assert.deepEqual(p.toRemoveCrm, ["VIP"], `origin=${origin}`);
    assert.deepEqual(p.toAddOa, [], `origin=${origin}`);
    assert.deepEqual(p.nextSnapshot, []);
  }
});

test("chưa có snapshot + origin crm: CRM là nguồn sự thật, nhãn OA thừa bị gỡ (hành vi cũ)", () => {
  const p = planTagSync({ managed, crm: S(), oa: S("VIP"), snapshot: null, origin: "crm" });
  assert.deepEqual(p.toRemoveOa, ["VIP"]);
  assert.deepEqual(p.toAddCrm, []);
});

test("chưa có snapshot + origin oa: KHÔNG bao giờ gỡ, chỉ bổ sung cho bên thiếu", () => {
  const p1 = planTagSync({ managed, crm: S(), oa: S("VIP"), snapshot: null, origin: "oa" });
  assert.deepEqual(p1.toAddCrm, ["VIP"]);
  assert.equal(p1.toRemoveOa.length + p1.toRemoveCrm.length, 0);
  const p2 = planTagSync({ managed, crm: S("Hot"), oa: S(), snapshot: null, origin: "oa" });
  assert.deepEqual(p2.toAddOa, ["Hot"]);
  assert.equal(p2.toRemoveOa.length + p2.toRemoveCrm.length, 0);
});

test("chỉ đụng nhãn đã đăng ký (managed) — nhãn ngoài danh sách bị bỏ qua", () => {
  const p = planTagSync({ managed: S("VIP"), crm: S("VIP", "Lạ"), oa: S("Lạ"), snapshot: S(), origin: "crm" });
  assert.deepEqual(p.toAddOa, ["VIP"]);
  assert.deepEqual(p.nextSnapshot, ["VIP"]);
});

test("nhiều nhãn cùng lúc, mỗi nhãn tự xét theo snapshot", () => {
  const p = planTagSync({
    managed,
    crm: S("VIP", "Kid2"),          // VIP: đã đồng bộ; Kid2: CRM mới thêm
    oa: S("VIP", "Hot"),            // Hot: OA mới thêm
    snapshot: S("VIP"),
    origin: "crm",
  });
  assert.deepEqual(p.toAddOa, ["Kid2"]);
  assert.deepEqual(p.toAddCrm, ["Hot"]);
  assert.deepEqual([...p.nextSnapshot].sort(), ["Hot", "Kid2", "VIP"]);
});

test("chạy lại kế hoạch trên trạng thái đã áp dụng thì không còn việc (idempotent)", () => {
  const first = planTagSync({ managed, crm: S("Kid2"), oa: S("Hot"), snapshot: S(), origin: "crm" });
  // áp dụng kế hoạch
  const crm2 = S("Kid2", ...first.toAddCrm);
  const oa2 = S("Hot", ...first.toAddOa);
  const second = planTagSync({ managed, crm: crm2, oa: oa2, snapshot: S(first.nextSnapshot), origin: "crm" });
  assert.equal(hasChanges(second), false);
});
