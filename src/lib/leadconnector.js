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
function phoneCandidates(rawPhone) {
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
