-- Cho phép chọn "khối khám phá thêm" hiện Ở GIỮA bài viết dài thay vì chỉ ở
-- cuối trang — xem lib tương ứng trong uplifting-miniapp (article-detail).
-- 'auto' (mặc định): Mini App tự quyết theo độ dài bài viết (đủ dài mới chèn
-- giữa). 'always'/'never': ghi đè tay cho 1 bài cụ thể, chọn trong quản trị
-- nội dung.
alter table uplifting_app.articles
  add column if not exists mid_promo text not null default 'auto';

alter table uplifting_app.articles drop constraint if exists articles_mid_promo_check;
alter table uplifting_app.articles
  add constraint articles_mid_promo_check check (mid_promo in ('auto', 'always', 'never'));
