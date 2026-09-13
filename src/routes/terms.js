import { Router } from "express";

const router = Router();

const CONTACT_EMAIL = "thinh.seafarer@gmail.com";
const LAST_UPDATED = "13/09/2026";

// Required by Zalo's Mini App verification (điều khoản sử dụng): must
// describe what permissions/personal data the Mini App collects and why —
// see project_uplifting_coaching_miniapp memory. Plain server-rendered
// HTML, same pattern as contentAdmin.js, so it has a stable, permanent URL
// (not a throwaway link) at /dieu-khoan-su-dung.
router.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Điều khoản sử dụng — Uplifting Business Coaching</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; color: #1f2430; line-height: 1.6; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .updated { color: #888; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 17px; margin-top: 32px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 6px; }
  a { color: #c07a1e; }
</style>
</head>
<body>
  <h1>Điều khoản sử dụng &amp; Quyền riêng tư</h1>
  <div class="updated">Cập nhật lần cuối: ${LAST_UPDATED}</div>

  <p>Zalo Mini App "Uplifting Business Coaching" (sau đây gọi là "Ứng dụng") do Uplifting Business Coaching vận hành. Trang này mô tả những quyền và dữ liệu cá nhân mà Ứng dụng sử dụng khi bạn truy cập.</p>

  <h2>1. Thông tin Ứng dụng thu thập</h2>
  <ul>
    <li><strong>Số điện thoại</strong> — chỉ được truy cập khi bạn chủ động bấm nút cho phép (ví dụ: "Lưu kết quả đánh giá", "Đăng ký xem miễn phí"). Ứng dụng không tự động xin quyền này khi mở lên.</li>
    <li><strong>Họ tên và mã định danh Zalo (UID)</strong> — do Zalo cung cấp khi bạn đăng nhập hoặc theo dõi Official Account của Uplifting, dùng để nhận diện và liên hệ qua Zalo.</li>
    <li><strong>Kết quả bài đánh giá và tiến độ học tập</strong> — dữ liệu bạn tạo ra khi sử dụng Ứng dụng (làm bài đánh giá, học bài).</li>
  </ul>

  <h2>2. Mục đích sử dụng</h2>
  <ul>
    <li>Xác định bạn là ai để lưu và cá nhân hoá kết quả đánh giá, tiến độ học tập.</li>
    <li>Liên hệ tư vấn, gửi nội dung, khoá học hoặc ưu đãi phù hợp qua Zalo.</li>
    <li>Chăm sóc khách hàng và cải thiện chất lượng dịch vụ của Uplifting Business Coaching.</li>
  </ul>
  <p>Ứng dụng không sử dụng số điện thoại hoặc dữ liệu cá nhân của bạn cho mục đích nào khác ngoài các mục trên.</p>

  <h2>3. Lưu trữ và chia sẻ dữ liệu</h2>
  <p>Dữ liệu được lưu trữ trong hệ thống quản lý khách hàng (CRM) và cơ sở dữ liệu riêng của Uplifting Business Coaching. Uplifting không bán hoặc chia sẻ dữ liệu cá nhân của bạn cho bên thứ ba, ngoại trừ các nhà cung cấp dịch vụ kỹ thuật (hạ tầng máy chủ, CRM) cần thiết để vận hành Ứng dụng.</p>

  <h2>4. Quyền của bạn</h2>
  <ul>
    <li>Bạn có thể rút lại quyền truy cập số điện thoại bất cứ lúc nào trong phần cài đặt quyền riêng tư của Zalo.</li>
    <li>Bạn có thể yêu cầu xoá toàn bộ dữ liệu cá nhân mà Ứng dụng đang lưu bằng cách liên hệ theo thông tin bên dưới.</li>
  </ul>

  <h2>5. Liên hệ</h2>
  <p>Nếu có câu hỏi về điều khoản này hoặc muốn yêu cầu xoá dữ liệu, vui lòng liên hệ: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
</body>
</html>`);
});

export default router;
