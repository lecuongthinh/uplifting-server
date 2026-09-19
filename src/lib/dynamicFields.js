import { ensureFieldByName, listCustomFields, invalidateFieldCache } from "./leadconnector.js";

// Field ngày trên hồ sơ GHL do server tự ghi để Workflow lọc được ("còn trong
// 7 ngày", "đã follow từ ...", "lần dùng app gần nhất"). Tạo bằng API (không
// hardcode id): POST /admin/oa/setup-fields?confirm=yes — nhận lại field cùng
// tên nếu đã tạo tay.
export const DYNAMIC_FIELDS = {
  lastMiniAppUse: { name: "Lần dùng Mini App gần nhất", dataType: "DATE" },
  oaFollowedAt: { name: "Ngày quan tâm OA", dataType: "DATE" },
  lastOaInteraction: { name: "Lần tương tác OA gần nhất", dataType: "DATE" },
};

const idCache = new Map();

// Id field nếu ĐÃ có trên GHL, không thì null (không tự tạo lúc đang phục vụ
// request — tạo là việc của bước setup có xác nhận). Chỉ cache khi tìm thấy.
export async function getDynamicFieldId(key) {
  if (idCache.has(key)) return idCache.get(key);
  const def = DYNAMIC_FIELDS[key];
  if (!def) return null;
  const found = (await listCustomFields()).find((f) => String(f.name).trim().toLowerCase() === def.name.toLowerCase());
  if (found) idCache.set(key, found.id);
  return found?.id || null;
}

export async function fieldStatus() {
  const all = await listCustomFields();
  return Object.entries(DYNAMIC_FIELDS).map(([key, def]) => {
    const f = all.find((x) => String(x.name).trim().toLowerCase() === def.name.toLowerCase());
    return { key, name: def.name, exists: Boolean(f), id: f?.id || null };
  });
}

export async function ensureDynamicFields() {
  invalidateFieldCache();
  const out = [];
  for (const [key, def] of Object.entries(DYNAMIC_FIELDS)) {
    const r = await ensureFieldByName(def.name, def.dataType);
    idCache.set(key, r.id);
    out.push({ key, name: def.name, id: r.id, created: r.created });
  }
  return out;
}
