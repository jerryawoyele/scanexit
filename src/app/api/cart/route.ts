import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { q } from "@/lib/db";
import { CART_COOKIE, cartSession, loadCart } from "@/lib/cart";
import { requireStore } from "@/lib/store";
import { newVerifyWord } from "@/lib/words";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

export async function GET() {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const { id, expired, secondsLeft } = await cartSession(s.store.id);
  const cart = id ? await loadCart(id) : null;
  return NextResponse.json({ cart, expired, secondsLeft });
}

/**
 * Start shopping. The phone number gets a random verification word, used by staff to look up the order.
 * After a timeout, entering the same number again in the same browser picks up the same basket.
 */
export async function POST(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  const phone = typeof body.phone === "string" ? body.phone.replace(/[^\d+]/g, "").slice(0, 16) || null : null;
  const prev = (await cookies()).get(CART_COOKIE)?.value;
  if (prev && phone) {
    const [same] = await q<{ id: string }>(
      `UPDATE carts SET updated_at = now() WHERE id = $1 AND store_id = $2 AND phone = $3 AND status = 'OPEN' RETURNING id`,
      [prev, s.store.id, phone]
    );
    if (same) return NextResponse.json({ cart: await loadCart(same.id), restored: true });
  }
  const word = phone ? newVerifyWord() : null;
  const [c] = await q<{ id: string }>(
    `INSERT INTO carts (store_id, phone, verify_word) VALUES ($1, $2, $3) RETURNING id`,
    [s.store.id, phone, word]
  );
  const res = NextResponse.json({ cart: await loadCart(c.id) });
  res.cookies.set(CART_COOKIE, c.id, { ...cookieOpts, maxAge: 60 * 60 * 12 });
  return res;
}

/** Forget this browser's cart (after a finished trip), so the next visit starts at the phone screen. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CART_COOKIE, "", { ...cookieOpts, maxAge: 0 });
  return res;
}
