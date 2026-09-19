// Supabase giả trong bộ nhớ — chỉ hỗ trợ đúng các kiểu gọi mà lib/gifts.js,
// lib/oaTagSync.js... đang dùng (select/insert/update/upsert/eq/in/gte/order/
// limit/single/maybeSingle + nhúng "gifts(*)"). Đủ để kiểm chứng LUỒNG ghi
// DB mà không cần Supabase thật.
const UNIQUE = {
  gifts: ["gift_key"],
  gift_grants: ["gift_id", "phone"],
  oa_tag_state: ["contact_id"],
  miniapp_activity: ["phone"],
  oa_state: ["phone"],
};
const HAS_IDENTITY = ["gifts", "gift_grants"];

export function createFakeSupabase(seed = {}) {
  const db = {};
  for (const [k, v] of Object.entries(seed)) db[k] = v.map((r) => ({ ...r }));
  const seq = {};
  const table = (n) => (db[n] ||= []);
  const same = (a, b, cols) => cols.every((c) => a[c] === b[c]);

  class Query {
    constructor(name) {
      this.name = name;
      this.op = "select";
      this.filters = [];
      this.limitN = null;
      this.orderBy = null;
      this.singleMode = null;
      this.returning = false;
      this.cols = "*";
      this.opts = {};
    }
    select(cols = "*") { if (this.op === "select") this.cols = cols; else this.returning = true; return this; }
    insert(p) { this.op = "insert"; this.payload = p; return this; }
    update(p) { this.op = "update"; this.payload = p; return this; }
    upsert(p, opts = {}) { this.op = "upsert"; this.payload = p; this.opts = opts; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
    order(c, { ascending = true } = {}) { this.orderBy = [c, ascending]; return this; }
    limit(n) { this.limitN = n; return this; }
    single() { this.singleMode = "single"; return this; }
    maybeSingle() { this.singleMode = "maybe"; return this; }
    then(res, rej) { return Promise.resolve(this.exec()).then(res, rej); }

    matching() { return table(this.name).filter((r) => this.filters.every((f) => f(r))); }
    embed(row) {
      if (this.cols.includes("gifts(*)")) return { ...row, gifts: table("gifts").find((g) => g.id === row.gift_id) || null };
      return { ...row };
    }
    shape(rows) {
      const shaped = rows.map((r) => this.embed(r));
      if (this.singleMode === "maybe") return { data: shaped[0] || null, error: null };
      if (this.singleMode === "single") return { data: shaped[0] || null, error: shaped[0] ? null : { message: "no rows" } };
      return { data: shaped, error: null };
    }
    exec() {
      const t = table(this.name);
      const uniq = UNIQUE[this.name];
      if (this.op === "insert" || this.op === "upsert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const out = [];
        for (const raw of rows) {
          const row = { ...raw };
          const existing = uniq ? t.find((r) => same(r, row, uniq)) : null;
          if (existing) {
            if (this.op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
            if (this.opts.ignoreDuplicates) continue;
            Object.assign(existing, row);
            out.push(existing);
            continue;
          }
          if (HAS_IDENTITY.includes(this.name) && !("id" in row)) row.id = seq[this.name] = (seq[this.name] || 0) + 1;
          t.push(row);
          out.push(row);
        }
        return this.returning ? this.shape(out) : { data: null, error: null };
      }
      if (this.op === "update") {
        const hit = this.matching();
        hit.forEach((r) => Object.assign(r, this.payload));
        return this.returning ? this.shape(hit) : { data: null, error: null };
      }
      let rows = this.matching();
      if (this.orderBy) {
        const [c, asc] = this.orderBy;
        rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1));
      }
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      return this.shape(rows);
    }
  }

  return { from: (n) => new Query(n), _db: db };
}
