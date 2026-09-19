// Cổng khoá cho các route quản trị /admin/oa/*: cùng mật khẩu CONTENT_ADMIN_SECRET
// với trang quản trị nội dung. Nhận từ body ({secret}) — cách trang quản trị hiện
// tại đang dùng — hoặc header x-admin-secret (gọi curl) hoặc ?secret= (chỉ cho
// các route mở bằng trình duyệt như bước cấp quyền OA).
export function requireAdminSecret(req, res, next) {
  const want = process.env.CONTENT_ADMIN_SECRET;
  const got = req.body?.secret || req.headers["x-admin-secret"] || req.query.secret;
  if (!want || got !== want) return res.status(401).json({ message: "Sai mật khẩu quản trị" });
  next();
}
