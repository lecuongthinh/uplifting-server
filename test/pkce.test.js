import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { makePkce } from "../src/lib/zalo.js";

// Vector chính thức của RFC 7636 (Appendix B) — cùng công thức mà code dùng.
test("challenge = base64url(sha256(verifier)) khớp vector RFC 7636", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(crypto.createHash("sha256").update(verifier).digest("base64url"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("makePkce: verifier 43-128 ký tự URL-safe, challenge khớp verifier, mỗi lần một cặp mới", () => {
  const a = makePkce();
  const b = makePkce();
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(a.challenge, crypto.createHash("sha256").update(a.verifier).digest("base64url"));
  assert.notEqual(a.verifier, b.verifier);
});
