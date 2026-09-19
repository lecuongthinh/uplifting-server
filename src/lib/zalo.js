import axios from "axios";
import { getZaloRefreshTokenFromGHL, saveZaloRefreshTokenToGHL } from "./leadconnector.js";

// Gọi API Zalo Official Account (gắn/gỡ nhãn, đọc thông tin người quan tâm,
// gửi tin tư vấn). Chạy THẲNG từ Render — chỉ việc đổi số điện thoại
// (graph.zalo.me) mới cần relay IP Việt Nam (xem lib/zaloRelay.js).
//
// Cần env: ZALO_OA_APP_ID, ZALO_OA_APP_SECRET (Zalo Developers → App).
// Refresh token của OA lưu ở GHL Custom Value (xem leadconnector.js), lấy
// lần đầu qua /admin/oa/zalo-oauth-start.

// Zalo trả HTTP 200 kèm JSON có `error` khác 0 — giữ MÃ SỐ lại trên Error để
// nơi gọi phân biệt lỗi vĩnh viễn (VD -232 ngoài cửa sổ 7 ngày) với lỗi tạm.
export class ZaloApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ZaloApiError";
    this.zaloErrorCode = code;
  }
}

function throwIfZaloError(data, fallbackMessage) {
  if (data && data.error) throw new ZaloApiError(data.message || fallbackMessage, data.error);
}

let cachedOAToken = null;
let cachedOATokenExpiry = 0;
let cachedRefreshToken = null;
let refreshInFlight = null;

// Refresh token dùng 1 lần: 2 lần gọi song song mà cùng đi đổi thì lần thứ 2
// hỏng vì token đã bị lần 1 dùng mất → chỉ cho 1 lần đổi chạy tại 1 thời điểm,
// các lần gọi khác đợi và dùng chung kết quả.
async function getOAAccessToken() {
  if (cachedOAToken && Date.now() < cachedOATokenExpiry) return cachedOAToken;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshOAAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function refreshOAAccessToken() {
  if (!process.env.ZALO_OA_APP_ID || !process.env.ZALO_OA_APP_SECRET) {
    throw new Error("Thiếu ZALO_OA_APP_ID / ZALO_OA_APP_SECRET trong biến môi trường.");
  }
  if (!cachedRefreshToken) cachedRefreshToken = await getZaloRefreshTokenFromGHL();

  const { data } = await axios.post(
    "https://oauth.zaloapp.com/v4/oa/access_token",
    new URLSearchParams({
      refresh_token: cachedRefreshToken,
      app_id: process.env.ZALO_OA_APP_ID,
      grant_type: "refresh_token",
    }),
    { headers: { secret_key: process.env.ZALO_OA_APP_SECRET } }
  );
  if (!data.access_token) {
    console.error("[zalo] OA token refresh failed:", data);
    // Refresh token sai/đã bị dùng: bỏ bản trong bộ nhớ để lần sau đọc lại từ GHL.
    cachedRefreshToken = null;
    throw new Error(data.error_reason || data.error_name || "OA token refresh failed");
  }
  cachedOAToken = data.access_token;
  cachedOATokenExpiry = Date.now() + (Number(data.expires_in) - 60) * 1000;

  // Token cũ đã bị Zalo huỷ ngay khi đổi — lưu bản mới TRƯỚC khi trả về, thử
  // lại vài lần nếu GHL chớp lỗi (mất token này là không cứu được, phải cấp
  // quyền lại).
  if (data.refresh_token && data.refresh_token !== cachedRefreshToken) {
    cachedRefreshToken = data.refresh_token;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await saveZaloRefreshTokenToGHL(data.refresh_token);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[zalo] lưu refresh token mới lần ${attempt} lỗi:`, err.message);
      }
    }
    if (lastErr) console.error("[zalo] BỎ CUỘC lưu refresh token mới — GHL đang giữ bản cũ đã hết hạn:", lastErr.message);
  }
  return cachedOAToken;
}

// Dùng ở bước cấp quyền lần đầu: đổi `code` lấy token, lưu refresh token vào GHL.
export async function exchangeAuthorizationCode(code) {
  const { data } = await axios.post(
    "https://oauth.zaloapp.com/v4/oa/access_token",
    new URLSearchParams({ code, app_id: process.env.ZALO_OA_APP_ID, grant_type: "authorization_code" }),
    { headers: { secret_key: process.env.ZALO_OA_APP_SECRET } }
  );
  if (!data.access_token || !data.refresh_token) {
    throw new Error(data.error_reason || data.error_name || "Zalo không trả token — code hết hạn hoặc app chưa gắn với OA");
  }
  await saveZaloRefreshTokenToGHL(data.refresh_token);
  cachedRefreshToken = data.refresh_token;
  cachedOAToken = data.access_token;
  cachedOATokenExpiry = Date.now() + (Number(data.expires_in) - 60) * 1000;
}

const authHeaders = async () => ({ access_token: await getOAAccessToken(), "Content-Type": "application/json" });

export async function tagFollower(uid, tagName) {
  const { data } = await axios.post(
    "https://openapi.zalo.me/v2.0/oa/tag/tagfollower",
    { user_id: uid, tag_name: tagName },
    { headers: await authHeaders() }
  );
  throwIfZaloError(data, "Zalo tagFollower error");
  return data;
}

export async function untagFollower(uid, tagName) {
  const { data } = await axios.post(
    "https://openapi.zalo.me/v2.0/oa/tag/rmfollowerfromtag",
    { user_id: uid, tag_name: tagName },
    { headers: await authHeaders() }
  );
  throwIfZaloError(data, "Zalo untagFollower error");
  return data;
}

// Thông tin 1 người quan tâm, gồm nhãn hiện có (data.tags_and_notes_info.tag_names).
export async function getFollowerInfo(uid) {
  const { data } = await axios.get("https://openapi.zalo.me/v3.0/oa/user/detail", {
    params: { data: JSON.stringify({ user_id: uid }) },
    headers: { access_token: await getOAAccessToken() },
  });
  throwIfZaloError(data, "Zalo getFollowerInfo error");
  return data;
}

export async function listOaTags() {
  const { data } = await axios.get("https://openapi.zalo.me/v2.0/oa/tag/gettagsofoa", {
    headers: { access_token: await getOAAccessToken() },
  });
  throwIfZaloError(data, "Zalo listOaTags error");
  return data;
}

// Tin tư vấn (văn bản tự do) gửi theo UID — miễn phí nhưng CHỈ đi được khi
// còn trong cửa sổ tương tác của Zalo (khách nhắn tin/bấm nút trong 7 ngày,
// hoặc 1 tin ngay lúc vừa follow). Ngoài cửa sổ Zalo trả -232.
export async function sendConsultationMessageUID(uid, text) {
  const { data } = await axios.post(
    "https://openapi.zalo.me/v3.0/oa/message/cs",
    { recipient: { user_id: uid }, message: { text } },
    { headers: await authHeaders() }
  );
  throwIfZaloError(data, "Zalo sendConsultationMessageUID error");
  return data;
}

// Chẩn đoán cho trang kiểm tra cài đặt: lấy được access token không?
export async function checkOaAuth() {
  await getOAAccessToken();
  return { ok: true, tokenExpiresInSec: Math.round((cachedOATokenExpiry - Date.now()) / 1000) };
}
