import axios from "axios";

// Exchanges getPhoneNumber()'s single-use token for the real phone number
// via the VN-hosted relay (Zalo only returns personal info to VN-based IPs
// — see reference_zalo_openapi_vietnam_ip_restriction memory). RELAY_URL is
// blank until the relay is deployed — calling this before then fails
// loudly rather than silently, which is what we want.
//
// Endpoint is `resolve-phone.php`, not `/resolve-phone` — the relay for
// this app is plain PHP (via PHP-FPM), not a Node.js app like 123gym's,
// because the AZDIGI account was hitting its NPROC fork limit and couldn't
// keep a persistent Node process alive (confirmed via stderr.log). PHP
// sidesteps that entirely since it runs on the already-provisioned web
// server pool instead of a new long-lived process.
export async function resolvePhoneNumber(phoneToken, accessToken) {
  if (!process.env.RELAY_URL) {
    throw new Error("RELAY_URL chưa được cấu hình — relay VN chưa deploy xong");
  }
  try {
    const { data } = await axios.post(
      `${process.env.RELAY_URL}/resolve-phone.php`,
      { phoneToken, accessToken },
      {
        headers: {
          "x-relay-secret": process.env.RELAY_SHARED_SECRET,
          // Imunify360 (AZDIGI's bot-protection, sitting in front of the
          // relay) blocks requests from Render's shared outbound IP range
          // that look bot-like — axios's default has no User-Agent at all,
          // which reads as automation. A descriptive one plus the IP-range
          // whitelist (see reference_azdigi_cpanel_nodejs_nproc_gotcha /
          // project_uplifting_coaching_miniapp memory) are both needed.
          "User-Agent": "UpliftingServer/1.0 (+https://uplifting-server.onrender.com)",
        },
      }
    );
    return data.number;
  } catch (err) {
    // The relay/Zalo's own message (e.g. "Session key invalid") is far more
    // useful than axios's generic "Request failed with status code 502".
    throw new Error(err.response?.data?.message || err.message);
  }
}
