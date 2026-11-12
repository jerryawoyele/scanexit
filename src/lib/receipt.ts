import { createHmac, timingSafeEqual, randomBytes } from "crypto";

const TTL_MS = 15 * 60 * 1000;

function secret() {
  const s = process.env.RECEIPT_SECRET;
  if (!s || s.length < 16) throw new Error("RECEIPT_SECRET must be set (16+ chars)");
  return s;
}
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function newNonce() {
  return randomBytes(12).toString("base64url");
}

/** Token shown as the receipt QR: store, cart, nonce and expiry, signed. */
export function issueReceiptToken(storeId: string, cartId: string, nonce: string): string {
  const payload = b64(JSON.stringify({ s: storeId, c: cartId, n: nonce, e: Date.now() + TTL_MS }));
  return `SP1.${payload}.${sign(payload)}`;
}

export type TokenResult =
  | { ok: true; storeId: string; cartId: string; nonce: string }
  | { ok: false; reason: "INVALID" | "EXPIRED" };

export function verifyReceiptToken(token: string): TokenResult {
  const [v, payload, sig] = token.trim().split(".");
  if (v !== "SP1" || !payload || !sig) return { ok: false, reason: "INVALID" };
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "INVALID" };
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() > data.e) return { ok: false, reason: "EXPIRED" };
    if (typeof data.s !== "string") return { ok: false, reason: "INVALID" };
    return { ok: true, storeId: data.s, cartId: data.c, nonce: data.n };
  } catch {
    return { ok: false, reason: "INVALID" };
  }
}
