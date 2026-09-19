import { Router } from "express";
import crypto from "crypto";
import { requireAdminSecret } from "../middleware/adminAuth.js";
import { getSupabase } from "../lib/supabase.js";
import {
  findContactByPhone,
  findContactsWithCustomField,
  getFieldIdByKey,
  customFieldsOf,
  listCustomFields,
  listLocationTagNames,
} from "../lib/leadconnector.js";
import { exchangeAuthorizationCode, makePkce, checkOaAuth, listOaTags, sendConsultationMessageUID } from "../lib/zalo.js";
import { DYNAMIC_FIELDS, fieldStatus, ensureDynamicFields } from "../lib/dynamicFields.js";
import { getMiniAppActivity } from "../lib/miniappActivity.js";
import { getOaState } from "../lib/oaState.js";
import { getLastInteraction, INTERACTION_WINDOW_DAYS } from "../lib/oaInteractions.js";
import {
  OA_TAG_PREFIX,
  OA_TAG_MAX_LENGTH,
  OA_TAG_RULES,
  OA_TAG_MIN_DESCRIPTION,
  checkName,
  ensureGhlTags,
  ghlTagPresence,
  listRegistry,
  registerTag,
  deactivateTag,
} from "../lib/oaTagRegistry.js";
import { syncContactOaTags, enqueueOaTagSync, queueStats } from "../lib/oaTagSync.js";
import { GIFT_RULES, GIFT_PLACEHOLDERS, GIFT_MAX_MESSAGE, validateGiftInput, renderGiftMessage, requiredTagsOf } from "../lib/giftRules.js";
import {
  listGifts,
  getGift,
  giftStats,
  listGrants,
  grantsForPhone,
  retryGrant,
  previewActivation,
  activateGift,
  deactivateGift,
} from "../lib/gifts.js";
import { TAG_MINIAPP_USER, TAG_OA_FOLLOWED, TAG_EVER_MESSAGED_OA } from "../lib/tags.js";

// Toàn bộ quản trị theo dõi tương tác / quà tặng / nhãn OA. Mật khẩu =
// CONTENT_ADMIN_SECRET (cùng trang quản trị nội dung). Hầu hết route là POST
// mang {secret,...} trong body; chỉ 2 route cấp quyền OA mở bằng trình duyệt
// nên dùng ?secret=.
const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_TAG = "Hồ sơ test — Mini App";

const fail = (res, err, status = 500) => res.status(status).json({ message: err.message || String(err) });

// ── Cấp quyền OA lần đầu (lấy refresh token, lưu vào GHL Custom Value) ──────
// Cần đăng ký đúng URL callback trong Zalo Developers (Official Account → cài
// đặt callback URL). `state` chống giả mạo callback.
const oauthStates = new Map(); // state -> { exp, verifier }
// Sau proxy của Render, req.protocol luôn là "http" — dùng x-forwarded-proto để callback
// ra đúng https (Zalo đòi callback khớp chính xác địa chỉ đã đăng ký).
const backendBase = (req) =>
  process.env.BACKEND_URL || `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}`;
const callbackUrl = (req) => `${backendBase(req)}/admin/oa/zalo-oauth-callback`;

router.get("/zalo-oauth-start", requireAdminSecret, (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  const { verifier, challenge } = makePkce();
  oauthStates.set(state, { exp: Date.now() + 10 * 60 * 1000, verifier });
  const url =
    `https://oauth.zaloapp.com/v4/oa/permission?app_id=${encodeURIComponent(process.env.ZALO_OA_APP_ID || "")}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl(req))}&code_challenge=${challenge}&state=${state}`;
  res.redirect(url);
});

// Trình duyệt được Zalo chuyển về — không mang được mật khẩu, nên xác thực bằng
// `state` do chính server vừa cấp ở bước start (đã qua mật khẩu).
router.get("/zalo-oauth-callback", async (req, res) => {
  const { code, state } = req.query;
  const pending = oauthStates.get(state);
  oauthStates.delete(state);
  if (!code || !pending || pending.exp < Date.now()) return res.status(400).send("Phiên cấp quyền không hợp lệ hoặc đã hết hạn. Mở lại đường dẫn bắt đầu.");
  try {
    await exchangeAuthorizationCode(code, pending.verifier);
    res.send("Đã cấp quyền OA thành công. Refresh token đã lưu vào GHL (Custom Value zalo_oa_refresh_token). Có thể đóng trang này.");
  } catch (err) {
    console.error("[oa-oauth] lỗi:", err.response?.data || err.message);
    res.status(500).send(`Lỗi: ${err.message}`);
  }
});

router.use(requireAdminSecret);

// ── Kiểm tra cài đặt: đo thật, không đoán ───────────────────────────────────
router.post("/status", async (req, res) => {
  const probe = async (fn) => {
    try {
      return { ok: true, detail: await fn() };
    } catch (err) {
      const status = err.response?.status;
      return { ok: false, error: `${status ? status + " " : ""}${err.response?.data?.message || err.message}` };
    }
  };
  const table = (name) =>
    probe(async () => {
      // KHÔNG dùng head:true — Supabase trả 204 không lỗi cho cả bảng chưa tạo.
      const { error } = await getSupabase().from(name).select("*").limit(1);
      if (error) throw error;
      return "có";
    });
  const [oaAuth, customFields, tags, fields, ...tables] = await Promise.all([
    probe(checkOaAuth),
    probe(async () => (await listCustomFields()).length + " field"),
    probe(async () => (await listLocationTagNames()).length + " tag"),
    probe(fieldStatus),
    table("miniapp_activity"),
    table("oa_state"),
    table("oa_interactions"),
    table("gifts"),
    table("gift_grants"),
    table("oa_tag_registry"),
    table("oa_tag_state"),
  ]);
  const names = ["miniapp_activity", "oa_state", "oa_interactions", "gifts", "gift_grants", "oa_tag_registry", "oa_tag_state"];
  res.json({
    env: {
      ZALO_OA_APP_ID: Boolean(process.env.ZALO_OA_APP_ID),
      ZALO_OA_APP_SECRET: Boolean(process.env.ZALO_OA_APP_SECRET),
      ZALO_OA_WEBHOOK_SECRET: Boolean(process.env.ZALO_OA_WEBHOOK_SECRET),
      GHL_WEBHOOK_SECRET: Boolean(process.env.GHL_WEBHOOK_SECRET),
      GIFTS_DISABLED: process.env.GIFTS_DISABLED === "true",
    },
    oaCallbackUrl: callbackUrl(req),
    oaAuth,
    ghlCustomFieldsScope: customFields,
    ghlTagsScope: tags,
    dynamicFields: fields,
    tables: Object.fromEntries(names.map((n, i) => [n, tables[i]])),
    queue: queueStats(),
  });
});

router.post("/setup-fields", async (req, res) => {
  try {
    if (req.body.confirm !== "yes") return res.json({ dryRun: true, wanted: DYNAMIC_FIELDS, status: await fieldStatus() });
    res.json({ dryRun: false, fields: await ensureDynamicFields() });
  } catch (err) {
    fail(res, err);
  }
});

// ── Theo dõi tương tác ──────────────────────────────────────────────────────
async function count(table, apply = (q) => q) {
  try {
    // limit(0) + count (không dùng head:true: nó nuốt lỗi bảng chưa tạo).
    const { count: n, error } = await apply(getSupabase().from(table).select("*", { count: "exact" })).limit(0);
    if (error) throw error;
    return n;
  } catch (err) {
    return { error: err.message };
  }
}
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString();

router.post("/summary", async (_req, res) => {
  const [total, d1, d7, d30, following, unfollowed, followed30, everMsg, inWindow] = await Promise.all([
    count("miniapp_activity"),
    count("miniapp_activity", (q) => q.gte("last_seen_at", daysAgo(1))),
    count("miniapp_activity", (q) => q.gte("last_seen_at", daysAgo(7))),
    count("miniapp_activity", (q) => q.gte("last_seen_at", daysAgo(30))),
    count("oa_state", (q) => q.eq("is_following", true)),
    count("oa_state", (q) => q.eq("is_following", false).not("unfollowed_at", "is", null)),
    count("oa_state", (q) => q.gte("followed_at", daysAgo(30))),
    count("oa_interactions"),
    count("oa_interactions", (q) => q.gte("last_interaction_at", daysAgo(INTERACTION_WINDOW_DAYS))),
  ]);
  res.json({
    since: "Số liệu tính từ lúc tính năng bắt đầu ghi nhận (không backfill lịch sử cũ).",
    miniapp: { total, active1d: d1, active7d: d7, active30d: d30 },
    oa: { followingObserved: following, unfollowedObserved: unfollowed, followedLast30d: followed30, everMessaged: everMsg, messagedWithinWindow: inWindow, windowDays: INTERACTION_WINDOW_DAYS },
  });
});

router.post("/lookup", async (req, res) => {
  const phone = String(req.body.phone || "").trim();
  if (!phone) return res.status(400).json({ message: "Thiếu số điện thoại" });
  const safe = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      return { error: err.message };
    }
  };
  const [contact, miniapp, oaState, oaMessage, grants] = await Promise.all([
    safe(() => findContactByPhone(phone)),
    safe(() => getMiniAppActivity(phone)),
    safe(() => getOaState(phone)),
    safe(() => getLastInteraction(phone)),
    safe(() => grantsForPhone(phone)),
  ]);
  const interesting = new Set([TAG_MINIAPP_USER, TAG_OA_FOLLOWED, TAG_EVER_MESSAGED_OA].map((t) => t.toLowerCase()));
  const tags =
    contact && !contact.error
      ? (contact.tags || []).filter((t) => {
          const l = String(t).toLowerCase();
          return interesting.has(l) || l.startsWith(OA_TAG_PREFIX) || l.startsWith("quà:");
        })
      : [];
  const windowOpen = oaMessage && !oaMessage.error ? oaMessage.at.getTime() >= Date.now() - INTERACTION_WINDOW_DAYS * DAY_MS : false;
  res.json({
    contact: contact && !contact.error ? { id: contact.id, name: contact.contactName || contact.firstName, phone: contact.phone, tags } : contact?.error ? contact : null,
    miniapp,
    oaState,
    oaMessage: oaMessage && !oaMessage.error ? { at: oaMessage.at, source: oaMessage.source, windowOpen } : oaMessage,
    grants,
  });
});

// ── Nhãn OA ─────────────────────────────────────────────────────────────────
router.post("/tags/rules", (_req, res) => {
  res.json({ prefix: OA_TAG_PREFIX, maxLength: OA_TAG_MAX_LENGTH, minDescription: OA_TAG_MIN_DESCRIPTION, rules: OA_TAG_RULES });
});

router.post("/tags/registry", async (_req, res) => {
  try {
    res.json({ tags: await listRegistry({ includeInactive: true }) });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/tags/check", async (req, res) => {
  try {
    res.json(await checkName(req.body.name));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/tags/register", async (req, res) => {
  try {
    const r = await registerTag({
      name: req.body.name,
      description: req.body.description,
      createdBy: req.body.createdBy,
      adoptExisting: req.body.adoptExisting === true,
    });
    res.status(r.status).json(r);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/tags/ensure-ghl", async (req, res) => {
  try {
    res.json(await ensureGhlTags(String(req.body.ghlTag || "").toLowerCase()));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/tags/presence", async (req, res) => {
  try {
    res.json(await ghlTagPresence(String(req.body.ghlTag || "").toLowerCase()));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/tags/deactivate", async (req, res) => {
  try {
    res.json({ tag: await deactivateTag(Number(req.body.id)) });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/tags/oa-tags", async (_req, res) => {
  try {
    res.json(await listOaTags());
  } catch (err) {
    fail(res, err);
  }
});

router.post("/tags/log", async (req, res) => {
  try {
    const limit = Math.min(Number(req.body.limit) || 50, 200);
    let q = getSupabase().from("oa_tag_sync_log").select("*").order("created_at", { ascending: false }).limit(limit);
    if (req.body.status) q = q.eq("status", req.body.status);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ log: data || [], queue: queueStats() });
  } catch (err) {
    fail(res, err);
  }
});

// Đồng bộ ngay 1 contact (kiểm chứng bằng hồ sơ test). origin: "crm" | "oa".
router.post("/tags/sync-contact", async (req, res) => {
  try {
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ message: "Thiếu contactId" });
    res.json(await syncContactOaTags(contactId, { origin: req.body.origin === "oa" ? "oa" : "crm" }));
  } catch (err) {
    fail(res, err);
  }
});

// Kéo OA → CRM hàng loạt: mặc định CHỈ ĐẾM (chạy thử); confirm="yes" mới xếp
// hàng đồng bộ thật (mỗi khách 1 lần gọi Zalo, cách nhau 250ms).
router.post("/tags/pull", async (req, res) => {
  try {
    const fieldId = await getFieldIdByKey("zalo_uid");
    if (!fieldId) return res.status(409).json({ message: "Chưa tìm thấy field zalo_uid trên GHL." });
    const contacts = await findContactsWithCustomField(fieldId);
    if (req.body.confirm !== "yes") {
      return res.json({ dryRun: true, contactsWithUid: contacts.length, message: "Gửi thêm confirm=\"yes\" để xếp hàng đồng bộ ngược OA → CRM cho các khách này." });
    }
    let queued = 0;
    for (const c of contacts) if (enqueueOaTagSync(c.id, "oa", { force: true })) queued++;
    res.json({ dryRun: false, contactsWithUid: contacts.length, queued, queue: queueStats() });
  } catch (err) {
    fail(res, err);
  }
});

// ── Quà tặng ────────────────────────────────────────────────────────────────
router.post("/gifts/rules", (_req, res) => {
  res.json({ rules: GIFT_RULES, placeholders: GIFT_PLACEHOLDERS, maxMessage: GIFT_MAX_MESSAGE, disabled: process.env.GIFTS_DISABLED === "true" });
});

router.post("/gifts/list", async (_req, res) => {
  try {
    const [gifts, stats] = await Promise.all([listGifts(), giftStats().catch(() => ({}))]);
    res.json({ gifts: gifts.map((g) => ({ ...g, requiredTags: requiredTagsOf(g), stats: stats[g.id] || {} })) });
  } catch (err) {
    fail(res, err);
  }
});

// Tạo mới (không có id) hoặc sửa nội dung (có id). Quà mới luôn TẮT.
router.post("/gifts/save", async (req, res) => {
  try {
    const { secret: _s, ...body } = req.body || {};
    const existing = body.id ? await getGift(Number(body.id)) : null;
    if (body.id && !existing) return res.status(404).json({ message: "Không có quà này." });

    const check = validateGiftInput(body, existing);
    if (!check.ok) return res.status(400).json({ message: check.errors[0], errors: check.errors });

    const supabase = getSupabase();
    if (existing) {
      const { gift_key: _key, require_miniapp: _m, require_follow: _f, ...editable } = check.value;
      const { data, error } = await supabase.from("gifts").update(editable).eq("id", existing.id).select().single();
      if (error) throw error;
      return res.json({ ok: true, gift: data });
    }
    const { data, error } = await supabase
      .from("gifts")
      .insert({ ...check.value, active: false, created_by: String(body.createdBy || "").slice(0, 80) || null })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ message: `Mã quà "${check.value.gift_key}" đã tồn tại.` });
      throw error;
    }
    res.status(201).json({ ok: true, gift: data });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/gifts/preview", async (req, res) => {
  try {
    const gift = await getGift(Number(req.body.id));
    if (!gift) return res.status(404).json({ message: "Không có quà này." });
    res.json(await previewActivation(gift));
  } catch (err) {
    fail(res, err);
  }
});

// Bật quà — tác động thật tới khách nên bắt buộc confirm="yes".
// includeExisting=true: cũng tặng cho người đã đủ điều kiện từ trước (mặc định
// KHÔNG — họ bị đánh dấu loại trừ).
router.post("/gifts/activate", async (req, res) => {
  try {
    const gift = await getGift(Number(req.body.id));
    if (!gift) return res.status(404).json({ message: "Không có quà này." });
    if (gift.active) return res.status(409).json({ message: "Quà này đang bật rồi." });
    if (req.body.confirm !== "yes") return res.status(400).json({ message: 'Thiếu confirm="yes" — bật quà sẽ gửi tin thật cho khách.' });
    res.json({ ok: true, ...(await activateGift(gift, { includeExisting: req.body.includeExisting === true })) });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/gifts/deactivate", async (req, res) => {
  try {
    await deactivateGift(Number(req.body.id));
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/gifts/grants", async (req, res) => {
  try {
    res.json({ grants: await listGrants(Number(req.body.id), { status: req.body.status || null }) });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/gifts/retry", async (req, res) => {
  try {
    const r = await retryGrant(Number(req.body.grantId));
    res.status(r.ok ? 200 : r.status).json(r);
  } catch (err) {
    fail(res, err);
  }
});

// Gửi thử tin quà tới CHÍNH hồ sơ test (tag "Hồ sơ test — Mini App") — không
// tạo lượt tặng, không đụng khách thật. Tài khoản test phải còn trong cửa sổ
// tương tác (vừa nhắn tin cho OA) nếu không Zalo trả -232.
router.post("/gifts/test-send", async (req, res) => {
  try {
    const gift = await getGift(Number(req.body.id));
    if (!gift) return res.status(404).json({ message: "Không có quà này." });
    const contact = await findContactByPhone(String(req.body.phone || ""));
    const isTest = contact && (contact.tags || []).some((t) => t.toLowerCase() === TEST_TAG.toLowerCase());
    if (!isTest) return res.status(403).json({ message: `Chỉ gửi thử cho hồ sơ có tag "${TEST_TAG}".` });
    const uidFieldId = await getFieldIdByKey("zalo_uid");
    const uid = uidFieldId ? customFieldsOf(contact)[uidFieldId] : null;
    if (!uid) return res.status(409).json({ message: "Hồ sơ test chưa có Zalo UID (chưa vào Mini App/follow OA)." });
    const text = renderGiftMessage(gift.message_template, { name: contact.firstName || contact.contactName, gift: gift.title, link: gift.url });
    try {
      await sendConsultationMessageUID(uid, text);
      res.json({ ok: true, sent: text });
    } catch (err) {
      res.status(502).json({
        ok: false,
        zaloErrorCode: err.zaloErrorCode ?? null,
        message: err.zaloErrorCode === -232 ? "Zalo từ chối (-232): tài khoản test chưa nhắn tin cho OA trong 7 ngày qua. Nhắn 1 tin cho OA rồi thử lại." : err.message,
      });
    }
  } catch (err) {
    fail(res, err);
  }
});

export default router;
