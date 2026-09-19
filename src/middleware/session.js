import jwt from "jsonwebtoken";
import { recordMiniAppActivity } from "../lib/miniappActivity.js";

// No expiresIn — same reasoning as 123gym-server: nothing behind this token
// (scorecard results, course progress) is sensitive enough to force
// re-granting the Zalo phone permission periodically.
export function signSession(contact) {
  return jwt.sign({ contactId: contact.id, phone: contact.phone }, process.env.SESSION_JWT_SECRET);
}

export function requireSession(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Missing session token" });
  try {
    req.session = jwt.verify(token, process.env.SESSION_JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Invalid or expired session" });
  }
  trackActivity(req.session);
  next();
}

// Ghi nhận khách đang dùng app (không await, không ném lỗi, có chặn tần suất
// bên trong — xem lib/miniappActivity.js).
function trackActivity(session) {
  recordMiniAppActivity({ phone: session.phone, contactId: session.contactId });
}

// Same as requireSession but never rejects the request — used by routes that
// serve different content to anonymous vs logged-in callers (e.g. courses:
// a lesson locked for anonymous visitors unlocks once they've shared their
// phone number, per project_uplifting_coaching_miniapp memory's "MKT tool,
// registered = full access" model). req.session is set when a valid token
// is present, left undefined otherwise — the route decides what to do.
export function optionalSession(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.session = jwt.verify(token, process.env.SESSION_JWT_SECRET);
      trackActivity(req.session);
    } catch {
      // invalid/expired — treat the same as anonymous rather than rejecting
    }
  }
  next();
}
