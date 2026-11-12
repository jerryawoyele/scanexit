import { createHmac, timingSafeEqual } from "crypto";

const API = "https://api.paystack.co";

/**
 * Simulated payments are OFF unless explicitly switched on with SIMULATE_PAYMENTS="true",
 * and a Paystack key always wins. A missing key alone never makes payments free.
 */
export const devMode = () => process.env.SIMULATE_PAYMENTS === "true" && !process.env.PAYSTACK_SECRET_KEY;

/** True when the app can take payments at all (real Paystack or explicit simulation). */
export const paymentsConfigured = () => !!process.env.PAYSTACK_SECRET_KEY || devMode();

async function call(path: string, init?: RequestInit) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || !json.status) throw new Error(json.message || `Paystack error ${res.status}`);
  return json.data;
}

export async function initializeTransaction(opts: {
  email: string; amountKobo: number; reference: string; callbackUrl: string; metadata: Record<string, unknown>;
}): Promise<string> {
  const data = await call("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountKobo,
      reference: opts.reference,
      callback_url: opts.callbackUrl,
      currency: "NGN",
      metadata: opts.metadata,
    }),
  });
  return data.authorization_url as string;
}

export async function verifyTransaction(reference: string): Promise<{ success: boolean; amountKobo: number }> {
  const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
  return { success: data.status === "success" && data.currency === "NGN", amountKobo: data.amount };
}

export function validWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !process.env.PAYSTACK_SECRET_KEY) return false;
  const expected = createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
