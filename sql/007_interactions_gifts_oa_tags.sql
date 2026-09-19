-- Theo dõi tương tác 2 chiều (Mini App + OA ⇄ CRM), quà tặng, và đồng bộ tag OA
-- 2 chiều — schema uplifting_app.
--
-- CHẠY Ở ĐÂU: Supabase SQL Editor của dự án "lecuongthinh's Project"
-- (ref hwjbjactdrndkkwjbcht) — dự án DÙNG CHUNG với app growthLEADERs Năng lượng
-- (cùng tệp khách hàng). File này CHỈ tạo bảng trong schema uplifting_app, KHÔNG
-- đụng gì vào schema public của growthLEADERs (profiles, daily_logs, woops...).
-- Không có bảng nào ở đây tham chiếu bảng của growthLEADERs.
-- Chạy 1 lần. Idempotent
-- (chạy lại không hỏng). Quyền cho service_role đã tự áp dụng cho bảng mới nhờ
-- `alter default privileges` trong 002_grants.sql.
--
-- Code có bọc try/catch nên nếu CHƯA chạy file này thì các tính năng mới chỉ bị
-- bỏ qua, không làm hỏng đăng nhập / webhook OA.
--
-- Khoá theo SĐT (1 khách chỉ có 1 hồ sơ tương tác thật).

-- 1) Hoạt động Mini App: mốc đầu, mốc gần nhất, số NGÀY (giờ VN) đã dùng.
create table if not exists uplifting_app.miniapp_activity (
  phone           text primary key,
  first_seen_at   timestamptz not null,
  last_seen_at    timestamptz not null,
  active_days     int not null default 1,
  last_active_day date not null,
  updated_at      timestamptz not null default now()
);
create index if not exists miniapp_activity_last_seen on uplifting_app.miniapp_activity (last_seen_at desc);

-- 2) Trạng thái OA: follow/unfollow + mốc khách xem / thả cảm xúc tin của OA.
--    followed_at chỉ có khi đã thấy sự kiện follow THẬT.
create table if not exists uplifting_app.oa_state (
  phone            text primary key,
  followed_at      timestamptz,
  unfollowed_at    timestamptz,
  is_following     boolean not null default false,
  last_seen_at     timestamptz,
  last_reaction_at timestamptz,
  updated_at       timestamptz not null default now()
);

-- 3) Cửa sổ 7 ngày của tin tư vấn: mốc TIN NHẮN THẬT gần nhất (KHÔNG tính follow
--    hay mở Mini App).
create table if not exists uplifting_app.oa_interactions (
  phone               text primary key,
  last_interaction_at timestamptz not null,
  source              text not null,
  updated_at          timestamptz not null default now()
);

-- 4) Quà tặng. Tạo xong mặc định TẮT (active=false).
create table if not exists uplifting_app.gifts (
  id               bigint generated always as identity primary key,
  gift_key         text not null unique,
  title            text not null,
  description      text,
  kind             text not null default 'external_url', -- external_url | miniapp_link
  url              text not null,
  message_template text not null,
  require_miniapp  boolean not null default true,
  require_follow   boolean not null default true,
  active           boolean not null default false,
  activated_at     timestamptz,
  ends_at          timestamptz,
  created_by       text,
  created_at       timestamptz not null default now()
);

-- Sổ cái chống tặng trùng: mỗi (quà, SĐT) đúng 1 dòng.
create table if not exists uplifting_app.gift_grants (
  id           bigint generated always as identity primary key,
  gift_id      bigint not null references uplifting_app.gifts(id) on delete cascade,
  phone        text not null,
  contact_id   text,
  status       text not null, -- pending_window | no_uid | delivered | failed | excluded
  attempts     int not null default 0,
  last_error   text,
  granted_at   timestamptz not null default now(),
  delivered_at timestamptz,
  unique (gift_id, phone)
);
create index if not exists gift_grants_phone on uplifting_app.gift_grants (phone);
create index if not exists gift_grants_status on uplifting_app.gift_grants (status);

create or replace view uplifting_app.gift_grant_stats as
  select gift_id, status, count(*)::int as n
  from uplifting_app.gift_grants
  group by gift_id, status;

-- 5) Nhãn OA đăng ký đồng bộ với tag CRM `oa:*`. GHL luôn lưu tag chữ thường nên
--    cần bảng này để biết tên nhãn OA đúng hoa/thường ("VIP"), và để CHỈ nhãn đã
--    đăng ký mới bị đồng bộ/gỡ — nhãn gắn tay trên OA không bao giờ bị đụng.
create table if not exists uplifting_app.oa_tag_registry (
  id          bigint generated always as identity primary key,
  ghl_tag     text not null unique,   -- "oa:vip" (chữ thường, có tiền tố)
  oa_name     text not null,          -- tên nhãn trên OA, tối đa 15 ký tự
  description text,
  created_by  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists oa_tag_registry_oa_name_lower on uplifting_app.oa_tag_registry (lower(oa_name));

-- 6) Nhật ký đồng bộ tag (theo dõi + chỉ ghi note lỗi khi kết quả THAY ĐỔI).
create table if not exists uplifting_app.oa_tag_sync_log (
  id         bigint generated always as identity primary key,
  contact_id text,
  phone      text,
  uid        text,
  status     text not null,           -- ok | no_uid | unregistered | error
  added      text[],
  removed    text[],
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists oa_tag_sync_log_created on uplifting_app.oa_tag_sync_log (created_at desc);
create index if not exists oa_tag_sync_log_contact on uplifting_app.oa_tag_sync_log (contact_id, created_at desc);

-- 7) Ảnh chụp đồng bộ 2 chiều: tập nhãn OA (đã đăng ký) mà CRM và OA đã THỐNG NHẤT
--    ở lần đồng bộ gần nhất — để biết bên nào vừa đổi (xem lib/tagMerge.js).
create table if not exists uplifting_app.oa_tag_state (
  contact_id   text primary key,
  synced_tags  text[] not null default '{}',
  updated_at   timestamptz not null default now()
);
