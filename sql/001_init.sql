-- Uplifting Business Coaching — Supabase schema
-- Runs inside the SHARED "growthLEADERs" project (hwjbjactdrndkkwjbcht).
-- Everything lives in its own schema so it never collides with
-- growthLEADERs' own tables (profiles, daily_logs, woops, checkins...) in
-- public. Run this whole file once in the Supabase SQL editor.

create schema if not exists uplifting_app;

-- Assessment definitions — data-driven on purpose (see
-- reference_zalo_miniapp_limits_and_deeplink memory): adding/editing an
-- assessment is a row change here, never an app redeploy, as long as it
-- fits the same "N areas x M statements, same scale" shape the scoring
-- engine (src/lib/scorecardEngine.js) expects.
create table if not exists uplifting_app.scorecard_configs (
  slug text primary key,
  title text not null,
  description text,
  config jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per completed + claimed (logged-in) assessment attempt — the
-- history this enables is the "retake after 90 days, see your score move"
-- retention mechanic from the strategy doc.
create table if not exists uplifting_app.scorecard_results (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null,          -- GHL contact id, not a Supabase auth uid
  slug text not null references uplifting_app.scorecard_configs(slug),
  area_scores jsonb not null,
  total_score int not null,
  tier_name text,
  created_at timestamptz not null default now()
);
create index if not exists scorecard_results_contact_idx on uplifting_app.scorecard_results(contact_id);

create table if not exists uplifting_app.courses (
  slug text primary key,
  title text not null,
  description text,
  cover_image_url text,
  is_free boolean not null default true,
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists uplifting_app.lessons (
  id uuid primary key default gen_random_uuid(),
  course_slug text not null references uplifting_app.courses(slug) on delete cascade,
  title text not null,
  video_url text,
  body text,
  sort_order int not null default 0
);
create index if not exists lessons_course_idx on uplifting_app.lessons(course_slug);

-- Per-contact lesson completion — feeds "đã học bài mấy" progress in the
-- Mini App without needing a full LMS (see the "short courses" architecture
-- decision in project_uplifting_coaching_miniapp memory).
create table if not exists uplifting_app.lesson_progress (
  contact_id text not null,
  lesson_id uuid not null references uplifting_app.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (contact_id, lesson_id)
);

create table if not exists uplifting_app.articles (
  slug text primary key,
  title text not null,
  excerpt text,
  body text,
  cover_image_url text,
  is_published boolean not null default false,
  published_at timestamptz not null default now()
);

-- Seed: the Wheel of Life assessment designed with the user (see the
-- "Bánh xe Cuộc sống" artifact) is the first live scorecard.
insert into uplifting_app.scorecard_configs (slug, title, description, config)
values (
  'wheel-of-life',
  'Bánh xe Cuộc sống',
  '8 mảng cuộc sống, 3 nhận định mỗi mảng — cho biết bạn đang cân bằng ở đâu và lệch ở đâu.',
  $CONFIG${
  "slug": "wheel-of-life",
  "title": "Bánh xe Cuộc sống",
  "description": "8 mảng cuộc sống, 3 nhận định mỗi mảng — cho biết bạn đang cân bằng ở đâu và lệch ở đâu.",
  "scale": {
    "min": 1,
    "max": 5,
    "labels": ["Hoàn toàn không đúng", "Ít đúng", "Đúng một phần", "Khá đúng", "Hoàn toàn đúng"]
  },
  "areas": [
    {
      "key": "health",
      "label": "Sức khỏe & Năng lượng",
      "statements": [
        "Tôi ngủ đủ và thức dậy với năng lượng dồi dào cho ngày mới.",
        "Tôi duy trì vận động thể chất đều đặn mỗi tuần.",
        "Tình trạng sức khỏe hiện tại không cản trở công việc hay cuộc sống của tôi."
      ]
    },
    {
      "key": "career",
      "label": "Sự nghiệp & Kinh doanh",
      "statements": [
        "Tôi thấy rõ định hướng phát triển sự nghiệp/doanh nghiệp trong 3 năm tới.",
        "Công việc hiện tại tận dụng được thế mạnh lớn nhất của tôi.",
        "Tôi kiểm soát được khối lượng công việc thay vì bị nó cuốn đi."
      ]
    },
    {
      "key": "finance",
      "label": "Tài chính",
      "statements": [
        "Thu nhập hiện tại đủ cho cuộc sống tôi mong muốn mà không phải lo lắng thường trực.",
        "Tôi có khoản dự phòng cho tình huống bất ngờ (ít nhất 3–6 tháng chi phí).",
        "Tôi có kế hoạch tài chính dài hạn rõ ràng (đầu tư, tài sản, hưu trí)."
      ]
    },
    {
      "key": "growth",
      "label": "Phát triển bản thân",
      "statements": [
        "Tôi dành thời gian đều đặn để học kỹ năng hoặc kiến thức mới.",
        "Tôi biết rõ 1–2 năng lực cần cải thiện và đang thực sự cải thiện chúng.",
        "Tôi thường xuyên bước ra khỏi vùng an toàn của mình."
      ]
    },
    {
      "key": "relationship",
      "label": "Tình cảm & Bạn đời",
      "statements": [
        "Tôi hài lòng với mức độ gần gũi và thấu hiểu trong mối quan hệ tình cảm của mình.",
        "Tôi và bạn đời/người thương dành đủ thời gian chất lượng cho nhau.",
        "Chúng tôi giải quyết bất đồng một cách xây dựng."
      ]
    },
    {
      "key": "family",
      "label": "Gia đình",
      "statements": [
        "Tôi hài lòng với chất lượng thời gian dành cho gia đình (cha mẹ, con cái).",
        "Tôi cảm thấy được gia đình thấu hiểu và ủng hộ.",
        "Trách nhiệm với gia đình và công việc của tôi đang ở thế cân bằng."
      ]
    },
    {
      "key": "social",
      "label": "Quan hệ xã hội",
      "statements": [
        "Tôi có những người bạn thân thiết có thể tin tưởng chia sẻ.",
        "Tôi duy trì kết nối đều đặn với bạn bè và cộng đồng của mình.",
        "Tôi thấy mình thuộc về một nhóm hoặc cộng đồng có ý nghĩa."
      ]
    },
    {
      "key": "meaning",
      "label": "Ý nghĩa & Giá trị sống",
      "statements": [
        "Tôi thấy công việc và cuộc sống của mình có ý nghĩa rõ ràng.",
        "Hành động hằng ngày của tôi nhất quán với giá trị cốt lõi tôi tin.",
        "Tôi dành thời gian cho những điều lớn hơn bản thân (đóng góp, cống hiến)."
      ]
    }
  ],
  "tiers": [
    { "name": "Đang quá tải", "min": 24, "max": 55, "message": "Nhiều trụ cột đang ở mức báo động. Đây là lúc cần một người đồng hành để lấy lại nền tảng, không phải cố gắng gồng thêm." },
    { "name": "Mất cân bằng", "min": 56, "max": 79, "message": "Một vài mảng đang kéo cả bánh xe lệch — thường là cái giá thầm lặng của việc dồn sức cho công việc. Xử lý đúng 1–2 mảng yếu nhất sẽ tạo hiệu ứng lan toả." },
    { "name": "Đang đi đúng hướng", "min": 80, "max": 103, "message": "Nền tảng ổn. Việc cần làm là tinh chỉnh có chủ đích để nâng những mảng khá lên mức xuất sắc, thay vì để chúng trôi." },
    { "name": "Cân bằng & sẵn sàng bứt phá", "min": 104, "max": 120, "message": "Bánh xe của bạn tròn đều. Đây là vị thế lý tưởng để đặt mục tiêu lớn hơn — và coaching lúc này là để tăng tốc, không phải chữa cháy." }
  ],
  "areaBands": [
    { "max": 7, "message": "Mảng cần ưu tiên. Chọn một thay đổi nhỏ có thể bắt đầu trong tuần này." },
    { "max": 11, "message": "Ổn định nhưng chưa vững. Một chút chủ đích sẽ tạo khác biệt lớn." },
    { "max": 15, "message": "Điểm mạnh của bạn. Hãy giữ vững và tận dụng nó để nâng các mảng khác." }
  ]
}$CONFIG$::jsonb
)
on conflict (slug) do update set config = excluded.config;
