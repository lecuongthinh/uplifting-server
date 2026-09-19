import axios from "axios";

// Single GHL sub-account for Uplifting (unlike 123gym-server, which fans
// out across 3 club sub-accounts) — one client is enough.
const client = axios.create({
  baseURL: process.env.GHL_API_BASE || "https://services.leadconnectorhq.com",
  headers: {
    Authorization: `Bearer ${process.env.GHL_PRIVATE_TOKEN}`,
    Version: process.env.GHL_API_VERSION || "2021-07-28",
    "Content-Type": "application/json",
  },
});

const locationId = () => process.env.GHL_LOCATION_ID;

// Same phone-format fan-out as 123gym-server's phoneCandidates — Zalo's
// getPhoneNumber() and GHL's stored format ("+84...") don't always agree.
export function phoneCandidates(rawPhone) {
  const digits = rawPhone.replace(/[^\d]/g, "");
  const withoutCountryCode = digits.startsWith("84") ? digits.slice(2) : digits.replace(/^0/, "");
  return [...new Set([rawPhone, `+${digits}`, `+84${withoutCountryCode}`, `0${withoutCountryCode}`])];
}

export async function findContactByPhone(rawPhone) {
  for (const phone of phoneCandidates(rawPhone)) {
    const { data } = await client.post("/contacts/search", {
      locationId: locationId(),
      filters: [{ field: "phone", operator: "eq", value: phone }],
      pageLimit: 1,
    });
    if (data.contacts?.[0]) return data.contacts[0];
  }
  return null;
}

export async function createLeadContact({ phone, name }) {
  const { data } = await client.post("/contacts/", {
    locationId: locationId(),
    phone,
    firstName: name || undefined,
    source: "Zalo Mini App",
  });
  return data.contact;
}

// Uplifting's Mini App is an acquisition tool (unlike 123gym's, which only
// looks up existing members) — anyone who logs in without a matching
// contact is a brand-new lead, so create one instead of 404ing.
export async function findOrCreateContact(phone, name) {
  const existing = await findContactByPhone(phone);
  if (existing) return { contact: existing, isNew: false };
  const contact = await createLeadContact({ phone, name });
  return { contact, isNew: true };
}

export async function updateContactZaloUid(contactId, idByOA) {
  await client.put(`/contacts/${contactId}`, {
    customFields: [{ key: "zalo_uid", field_value: idByOA }],
  });
}

// Generic custom-field writer — caller passes GHL custom field IDs (looked
// up once via Custom Fields API after creating them in the GHL UI) mapped
// to values, e.g. { [SCORECARD_TOTAL_FIELD_ID]: 87 }.
export async function updateContactCustomFields(contactId, fieldIdToValue) {
  await client.put(`/contacts/${contactId}`, {
    customFields: Object.entries(fieldIdToValue).map(([id, value]) => ({ id, field_value: value })),
  });
}

export async function addContactTag(contactId, tag) {
  await client.post(`/contacts/${contactId}/tags`, { tags: [tag] });
}

export async function addContactNote(contactId, body) {
  await client.post(`/contacts/${contactId}/notes`, { body });
}

// ── Bổ sung cho theo dõi tương tác / quà tặng / đồng bộ tag 2 chiều ─────────
// (port từ 123gym-server, bản 1 sub-account: không còn tham số `club`)

export async function removeContactTag(contactId, tag) {
  await client.delete(`/contacts/${contactId}/tags`, { data: { tags: [tag] } });
}

export async function getContactById(contactId) {
  const { data } = await client.get(`/contacts/${contactId}`);
  return data.contact;
}

// Contacts API trả custom field theo "id" (định nghĩa field), không phải key.
export function customFieldsOf(contact) {
  return Object.fromEntries((contact.customFields || []).map((f) => [f.id, f.value]));
}

// ── Custom field: tra id theo fieldKey / tên, tạo nếu chưa có ───────────────
export async function listCustomFields() {
  const { data } = await client.get(`/locations/${locationId()}/customFields`, { params: { model: "contact" } });
  return data.customFields || [];
}

export async function createCustomField({ name, dataType = "TEXT" }) {
  const { data } = await client.post(`/locations/${locationId()}/customFields`, { name, dataType, model: "contact" });
  const f = data.customField || data;
  return { id: f.id, name: f.name, dataType: f.dataType, fieldKey: f.fieldKey };
}

let fieldCache = null;
async function fieldsCached() {
  if (!fieldCache) fieldCache = await listCustomFields();
  return fieldCache;
}
export function invalidateFieldCache() {
  fieldCache = null;
}

// Id của field đã có, tìm theo fieldKey ("contact.zalo_uid" hoặc "zalo_uid").
export async function getFieldIdByKey(fieldKey) {
  const want = fieldKey.startsWith("contact.") ? fieldKey : `contact.${fieldKey}`;
  return (await fieldsCached()).find((f) => f.fieldKey === want)?.id || null;
}

// Nhận lại field cùng tên nếu đã tạo tay, không thì tạo mới (không tạo trùng).
export async function ensureFieldByName(name, dataType) {
  const found = (await fieldsCached()).find((f) => String(f.name).trim().toLowerCase() === name.toLowerCase());
  if (found) return { id: found.id, created: false };
  const created = await createCustomField({ name, dataType });
  invalidateFieldCache();
  return { id: created.id, created: true };
}

// ── Tag cấp location (để hiện sẵn trong dropdown Workflow) ──────────────────
export async function listLocationTagNames() {
  const { data } = await client.get(`/locations/${locationId()}/tags`);
  return (data.tags || []).map((t) => String(t.name).toLowerCase());
}

export async function createLocationTag(tagName) {
  await client.post(`/locations/${locationId()}/tags`, { name: tagName });
}

// ── Tìm contact ─────────────────────────────────────────────────────────────
async function searchAll(filters) {
  const contacts = [];
  let searchAfter;
  for (let i = 0; i < 100; i++) {
    const { data } = await client.post("/contacts/search", {
      locationId: locationId(),
      filters,
      pageLimit: 100,
      ...(searchAfter ? { searchAfter } : {}),
    });
    const page = data.contacts || [];
    contacts.push(...page);
    if (page.length < 100) break;
    searchAfter = page[page.length - 1].searchAfter;
  }
  return contacts;
}

// Sự kiện follow/unfollow của OA chỉ kèm uid (không có SĐT) → tìm contact
// theo field zalo_uid. Trả MỌI hồ sơ khớp (1 tài khoản Zalo có thể trùng
// trên nhiều hồ sơ).
export async function findContactsByZaloUid(uid) {
  if (!uid) return [];
  const fieldId = await getFieldIdByKey("zalo_uid");
  if (!fieldId) return [];
  const { data } = await client.post("/contacts/search", {
    locationId: locationId(),
    filters: [{ field: `customFields.${fieldId}`, operator: "eq", value: String(uid) }],
    pageLimit: 100,
  });
  return data.contacts || [];
}

export function findContactsWithAllTags(tagNames) {
  return searchAll(tagNames.map((t) => ({ field: "tags", operator: "contains", value: t.toLowerCase() })));
}

export function findContactsWithCustomField(fieldId) {
  return searchAll([{ field: `customFields.${fieldId}`, operator: "exists" }]);
}

// ── Custom Value (lưu refresh token xoay vòng của Zalo OA) ──────────────────
// Refresh token của Zalo dùng 1 lần rồi đổi — phải lưu bền vững ngoài bộ
// nhớ/env (env đổi thì Render khởi động lại và đua với chính lần xoay token).
const ZALO_REFRESH_TOKEN_CV_NAME = "zalo_oa_refresh_token";

async function findCustomValue(name) {
  const { data } = await client.get(`/locations/${locationId()}/customValues`);
  return (data.customValues || []).find((v) => v.name === name) || null;
}

export async function getZaloRefreshTokenFromGHL() {
  const cv = await findCustomValue(ZALO_REFRESH_TOKEN_CV_NAME);
  if (!cv?.value) throw new Error("Chưa có refresh token của Zalo OA — chạy bước cấp quyền OA (/admin/oa/zalo-oauth-start) trước.");
  return cv.value;
}

export async function saveZaloRefreshTokenToGHL(newToken) {
  const cv = await findCustomValue(ZALO_REFRESH_TOKEN_CV_NAME);
  if (cv) {
    await client.put(`/locations/${locationId()}/customValues/${cv.id}`, { name: ZALO_REFRESH_TOKEN_CV_NAME, value: newToken });
  } else {
    await client.post(`/locations/${locationId()}/customValues`, { name: ZALO_REFRESH_TOKEN_CV_NAME, value: newToken });
  }
}
