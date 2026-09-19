// Logic THUẦN cho theo dõi tương tác (không gọi mạng/DB) — tách riêng để
// test được bằng dữ liệu giả. Phần ghi Supabase/GHL nằm ở
// lib/miniappActivity.js và lib/oaState.js.

// "Ngày" luôn tính theo giờ Việt Nam (server Render chạy UTC — lấy ngày UTC
// thẳng sẽ lệch 1 ngày với khách dùng app buổi sáng sớm). en-CA cho đúng
// dạng YYYY-MM-DD.
export function vnDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Hoạt động Mini App của 1 SĐT: mốc đầu, mốc gần nhất, số NGÀY (giờ VN) đã
// dùng — số ngày mới là thước đo bám dính thật (mở app 20 lần trong 1 ngày
// vẫn chỉ tính 1 ngày). `existing` = dòng cũ (hoặc null nếu lần đầu).
export function nextMiniAppActivity(existing, now = new Date()) {
  const today = vnDay(now);
  const nowIso = now.toISOString();
  if (!existing) {
    return {
      row: { first_seen_at: nowIso, last_seen_at: nowIso, active_days: 1, last_active_day: today, updated_at: nowIso },
      isFirst: true,
      isNewDay: true,
    };
  }
  const isNewDay = existing.last_active_day !== today;
  return {
    row: {
      first_seen_at: existing.first_seen_at,
      last_seen_at: nowIso,
      active_days: (existing.active_days || 0) + (isNewDay ? 1 : 0),
      last_active_day: today,
      updated_at: nowIso,
    },
    isFirst: false,
    isNewDay,
  };
}

// Trạng thái OA của 1 SĐT. event:
//   "follow"          — sự kiện follow THẬT (webhook OA, hoặc khách vừa bấm
//                       nút follow trong Mini App). Chỉ đặt followed_at khi
//                       thật sự chuyển từ chưa-follow sang follow (Zalo có
//                       thể gọi lại webhook cùng 1 lần follow nhiều lần).
//   "following_seen"  — chỉ QUAN SÁT thấy đang follow (getUserInfo lúc mở
//                       app) — biết đang follow nhưng KHÔNG biết follow từ
//                       khi nào nên không đặt followed_at.
//   "unfollow"        — bỏ quan tâm.
//   "seen" / "reaction" — khách đã xem / thả cảm xúc tin của OA.
// Trả về { row, followStarted } — followStarted=true khi vừa có mốc follow
// mới (nơi gọi dùng để ghi field ngày lên CRM).
export function nextOaState(existing, event, now = new Date()) {
  const nowIso = now.toISOString();
  const base = {
    followed_at: existing?.followed_at ?? null,
    unfollowed_at: existing?.unfollowed_at ?? null,
    is_following: existing?.is_following ?? false,
    last_seen_at: existing?.last_seen_at ?? null,
    last_reaction_at: existing?.last_reaction_at ?? null,
    updated_at: nowIso,
  };
  let followStarted = false;
  switch (event) {
    case "follow":
      if (!(base.is_following && base.followed_at)) {
        base.followed_at = nowIso;
        followStarted = true;
      }
      base.is_following = true;
      break;
    case "following_seen":
      base.is_following = true;
      break;
    case "unfollow":
      base.is_following = false;
      base.unfollowed_at = nowIso;
      break;
    case "seen":
      base.last_seen_at = nowIso;
      break;
    case "reaction":
      base.last_reaction_at = nowIso;
      break;
    default:
      throw new Error(`Sự kiện OA không hợp lệ: ${event}`);
  }
  return { row: base, followStarted };
}
