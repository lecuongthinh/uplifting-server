import { getSupabase } from "./supabase.js";
import { getContactById, customFieldsOf, getFieldIdByKey, addContactNote, addContactTag, removeContactTag } from "./leadconnector.js";
import { tagFollower, untagFollower, getFollowerInfo } from "./zalo.js";
import { OA_TAG_PREFIX, listRegistry } from "./oaTagRegistry.js";
import { planTagSync, hasChanges } from "./tagMerge.js";

// Đồng bộ 1 contact 2 CHIỀU: tag CRM `oa:*` (đã đăng ký) <-> nhãn Zalo OA của
// đúng khách đó. Thiết kế "so sánh thiếu/thừa" nên 1 Workflow GHL (trigger
// Contact Tag không lọc) lo cả gắn lẫn gỡ, chạy lại nhiều lần vẫn đúng.
//
// CRM → OA: Workflow GHL gọi webhook mỗi khi tag đổi (origin "crm").
// OA → CRM: Zalo KHÔNG có webhook báo nhãn đổi, nên phải KÉO: khi khách có
// tương tác OA (nhắn tin, follow) hoặc khi chủ app bấm "Đồng bộ ngược" thì đọc
// nhãn hiện tại từ Zalo và chép phần thay đổi sang CRM (origin "oa"). Bên nào
// "vừa đổi" được xác định bằng ảnh chụp lần đồng bộ trước (lib/tagMerge.js).
//
// AN TOÀN: chỉ đụng nhãn đã đăng ký (active). Nhãn gắn tay trên OA không bao
// giờ bị gắn/gỡ.
export async function syncContactOaTags(contactId, { origin = "crm" } = {}) {
  const contact = await getContactById(contactId);
  const uidFieldId = await getFieldIdByKey("zalo_uid");
  const uid = (uidFieldId && customFieldsOf(contact)[uidFieldId]) || null;
  const phone = contact.phone || null;
  const crmTags = (contact.tags || []).map((t) => String(t).toLowerCase());
  const crmOaTags = crmTags.filter((t) => t.startsWith(OA_TAG_PREFIX));

  const registry = await listRegistry();
  const byGhlTag = new Map(registry.map((r) => [r.ghl_tag, r]));
  const byOaName = new Map(registry.map((r) => [r.oa_name, r]));
  const managed = new Set(registry.map((r) => r.oa_name));

  const crmSet = new Set();
  const unregistered = [];
  for (const t of crmOaTags) {
    const row = byGhlTag.get(t);
    if (row) crmSet.add(row.oa_name);
    else unregistered.push(t);
  }

  const base = { contactId, uid, phone };

  if (!uid) {
    if (crmOaTags.length === 0) return { status: "skip", reason: "no_oa_tags_no_uid" };
    return finish(base, { status: "no_uid", detail: `Có tag ${crmOaTags.join(", ")} nhưng chưa có Zalo UID (khách chưa vào Mini App/follow OA).` });
  }

  const info = await getFollowerInfo(uid);
  const current = info?.data?.tags_and_notes_info?.tag_names || [];
  const oaSet = new Set(current.filter((n) => managed.has(n)));

  const snapshot = await loadSnapshot(contactId);
  const plan = planTagSync({ managed, crm: crmSet, oa: oaSet, snapshot, origin });

  const added = [];
  const removed = [];
  for (const name of plan.toAddOa) {
    await tagFollower(uid, name);
    added.push(name);
  }
  for (const name of plan.toRemoveOa) {
    await untagFollower(uid, name);
    removed.push(name);
  }
  const crmAdded = [];
  const crmRemoved = [];
  for (const name of plan.toAddCrm) {
    await addContactTag(contactId, byOaName.get(name).ghl_tag);
    crmAdded.push(byOaName.get(name).ghl_tag);
  }
  for (const name of plan.toRemoveCrm) {
    await removeContactTag(contactId, byOaName.get(name).ghl_tag);
    crmRemoved.push(byOaName.get(name).ghl_tag);
  }

  // Chỉ lưu ảnh chụp SAU KHI mọi thay đổi đã áp dụng — lỡ giữa chừng có lỗi thì
  // ném ra, hàng đợi thử lại, ảnh chụp cũ còn nguyên nên kế hoạch tính lại đúng.
  await saveSnapshot(contactId, plan.nextSnapshot);

  const crmDetail =
    crmAdded.length + crmRemoved.length > 0
      ? `Chép từ OA sang CRM: ${[...crmAdded.map((t) => `+${t}`), ...crmRemoved.map((t) => `−${t}`)].join(", ")}.`
      : null;

  if (unregistered.length > 0) {
    return finish(base, {
      status: "unregistered",
      added,
      removed,
      detail: [`Tag chưa đăng ký nên không đồng bộ: ${unregistered.join(", ")}. Đăng ký trong tab Nhãn OA.`, crmDetail].filter(Boolean).join(" "),
    });
  }

  // Không có gì đổi và không có gì đáng báo → không ghi log (workflow chạy cho
  // MỌI thay đổi tag, phần lớn không liên quan nhãn OA).
  if (!hasChanges(plan)) return { status: "unchanged" };
  return finish(base, { status: "ok", added, removed, detail: crmDetail });
}

// Ảnh chụp lần đồng bộ trước (Set tên nhãn OA), hoặc null nếu chưa có / bảng
// oa_tag_state chưa tạo — khi đó rơi về hành vi an toàn (origin "crm": CRM là
// nguồn sự thật; origin "oa": chỉ bổ sung).
async function loadSnapshot(contactId) {
  try {
    const { data, error } = await getSupabase().from("oa_tag_state").select("synced_tags").eq("contact_id", contactId).maybeSingle();
    if (error) throw error;
    return data ? new Set(data.synced_tags || []) : null;
  } catch (err) {
    console.error("[oaTagSync] không đọc được oa_tag_state:", err.message);
    return null;
  }
}

async function saveSnapshot(contactId, syncedTags) {
  try {
    const { error } = await getSupabase()
      .from("oa_tag_state")
      .upsert({ contact_id: contactId, synced_tags: syncedTags, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (err) {
    console.error("[oaTagSync] không lưu được oa_tag_state:", err.message);
  }
}

// Ghi log; với kết quả CẦN NGƯỜI XỬ LÝ (no_uid/unregistered/error) thì ghi note
// lên contact — nhưng chỉ khi khác lần log gần nhất (không ghi lặp mỗi lần
// Workflow chạy lại).
async function finish({ contactId, uid, phone }, result) {
  const supabase = getSupabase();
  try {
    let shouldNote = false;
    if (["no_uid", "unregistered", "error"].includes(result.status)) {
      const { data: last } = await supabase
        .from("oa_tag_sync_log")
        .select("status, detail")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(1);
      const prev = (last || [])[0];
      shouldNote = !prev || prev.status !== result.status || prev.detail !== result.detail;
    }

    await supabase.from("oa_tag_sync_log").insert({
      contact_id: contactId,
      phone,
      uid,
      status: result.status,
      added: result.added || [],
      removed: result.removed || [],
      detail: result.detail || null,
    });

    if (shouldNote) await addContactNote(contactId, `[Đồng bộ nhãn OA] ${result.detail}`).catch(() => {});
  } catch (err) {
    console.error("[oaTagSync] ghi log lỗi:", err.message);
  }
  return result;
}

// ── Hàng đợi ────────────────────────────────────────────────────────────────
// Gắn tag hàng loạt trong GHL = 1 lần gọi webhook cho MỖI contact. Xử lý lần
// lượt cách nhau 250ms để không dồn dập lên Zalo; gộp yêu cầu của CÙNG 1
// contact đang chờ. Hàng đợi nằm trong bộ nhớ: server khởi động lại giữa chừng
// thì việc chờ mất — chạy lại /admin/oa/tags/pull (OA→CRM) hoặc gắn lại tag để bù.
const JOB_GAP_MS = 250;
const RETRY_DELAYS_MS = [2000, 6000];
const OA_PULL_THROTTLE_MS = 60 * 1000; // mỗi contact tối đa 1 lần kéo từ OA / phút (chỉ để gộp tin nhắn dồn dập)
const MAX_THROTTLE_TRACKED = 50000;
const pending = new Map(); // contactId -> { contactId, origin }
const lastOaPull = new Map();
let running = false;
const stats = { processed: 0, failed: 0 };

export function queueStats() {
  return { pending: pending.size, running, ...stats };
}

// origin "crm" (webhook GHL): luôn xếp hàng. origin "oa" (khách vừa có tương tác
// OA): mỗi contact tối đa 1 lần / phút, trừ khi force=true (bấm tay).
export function enqueueOaTagSync(contactId, origin = "crm", { force = false } = {}) {
  const queued = pending.get(contactId);
  if (queued) {
    if (origin === "crm") queued.origin = "crm";
    return false;
  }
  if (origin === "oa" && !force) {
    if (Date.now() - (lastOaPull.get(contactId) || 0) < OA_PULL_THROTTLE_MS) return false;
    if (lastOaPull.size > MAX_THROTTLE_TRACKED) lastOaPull.clear();
    lastOaPull.set(contactId, Date.now());
  }
  pending.set(contactId, { contactId, origin });
  runQueue();
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runQueue() {
  if (running) return;
  running = true;
  try {
    while (pending.size > 0) {
      const [key, job] = pending.entries().next().value;
      pending.delete(key);
      await runJob(job);
      stats.processed++;
      await sleep(JOB_GAP_MS);
    }
  } finally {
    running = false;
  }
}

async function runJob({ contactId, origin }) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await syncContactOaTags(contactId, { origin });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  stats.failed++;
  console.error(`[oaTagSync] bỏ cuộc sau nhiều lần thử (${contactId}):`, lastErr.message);
  await finish({ contactId, uid: null, phone: null }, { status: "error", detail: `Lỗi khi đồng bộ nhãn OA: ${lastErr.message}` });
}
