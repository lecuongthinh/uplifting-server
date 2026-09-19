import { test } from "node:test";
import assert from "node:assert/strict";
import { vnDay, nextMiniAppActivity, nextOaState } from "../src/lib/activityMath.js";

test("vnDay tính theo giờ Việt Nam, không phải UTC", () => {
  // 18:30 UTC ngày 19/9 = 01:30 ngày 20/9 giờ VN
  assert.equal(vnDay(new Date("2026-09-19T18:30:00Z")), "2026-09-20");
  assert.equal(vnDay(new Date("2026-09-19T16:59:00Z")), "2026-09-19");
});

test("lần đầu dùng Mini App: 1 ngày hoạt động", () => {
  const { row, isFirst, isNewDay } = nextMiniAppActivity(null, new Date("2026-09-19T03:00:00Z"));
  assert.equal(isFirst, true);
  assert.equal(isNewDay, true);
  assert.equal(row.active_days, 1);
  assert.equal(row.last_active_day, "2026-09-19");
});

test("mở lại trong cùng ngày VN không tăng số ngày", () => {
  const first = nextMiniAppActivity(null, new Date("2026-09-19T03:00:00Z")).row;
  const again = nextMiniAppActivity(first, new Date("2026-09-19T12:00:00Z"));
  assert.equal(again.isNewDay, false);
  assert.equal(again.row.active_days, 1);
  assert.equal(again.row.first_seen_at, first.first_seen_at);
});

test("sang ngày VN mới thì tăng số ngày", () => {
  const first = nextMiniAppActivity(null, new Date("2026-09-19T03:00:00Z")).row;
  const next = nextMiniAppActivity(first, new Date("2026-09-19T17:30:00Z")); // 00:30 ngày 20 giờ VN
  assert.equal(next.isNewDay, true);
  assert.equal(next.row.active_days, 2);
  assert.equal(next.row.last_active_day, "2026-09-20");
});

test("follow thật đặt followed_at; webhook gọi lại cùng lần follow không đổi mốc", () => {
  const t1 = new Date("2026-09-19T03:00:00Z");
  const a = nextOaState(null, "follow", t1);
  assert.equal(a.followStarted, true);
  assert.equal(a.row.followed_at, t1.toISOString());
  const b = nextOaState(a.row, "follow", new Date("2026-09-19T03:00:05Z"));
  assert.equal(b.followStarted, false);
  assert.equal(b.row.followed_at, t1.toISOString());
});

test("following_seen chỉ ghi nhận đang follow, không bịa ngày follow", () => {
  const { row, followStarted } = nextOaState(null, "following_seen", new Date());
  assert.equal(row.is_following, true);
  assert.equal(row.followed_at, null);
  assert.equal(followStarted, false);
});

test("unfollow rồi follow lại tạo mốc follow mới", () => {
  const a = nextOaState(null, "follow", new Date("2026-09-01T00:00:00Z")).row;
  const b = nextOaState(a, "unfollow", new Date("2026-09-10T00:00:00Z")).row;
  assert.equal(b.is_following, false);
  assert.ok(b.unfollowed_at);
  const c = nextOaState(b, "follow", new Date("2026-09-15T00:00:00Z"));
  assert.equal(c.followStarted, true);
  assert.equal(c.row.followed_at, "2026-09-15T00:00:00.000Z");
});

test("seen / reaction chỉ cập nhật mốc tương ứng, giữ nguyên trạng thái follow", () => {
  const a = nextOaState(null, "follow", new Date("2026-09-01T00:00:00Z")).row;
  const b = nextOaState(a, "seen", new Date("2026-09-02T00:00:00Z")).row;
  assert.equal(b.is_following, true);
  assert.equal(b.last_seen_at, "2026-09-02T00:00:00.000Z");
  const c = nextOaState(b, "reaction", new Date("2026-09-03T00:00:00Z")).row;
  assert.equal(c.last_reaction_at, "2026-09-03T00:00:00.000Z");
  assert.equal(c.last_seen_at, "2026-09-02T00:00:00.000Z");
});

test("sự kiện lạ bị từ chối", () => {
  assert.throws(() => nextOaState(null, "banana"), /không hợp lệ/);
});
