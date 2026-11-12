import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { CART_COOKIE, currentCartId, loadCart } from "@/lib/cart";
import { requireStore } from "@/lib/store";
import { newVerifyWord } from "@/lib/words";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

export async function GET() {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const id = await currentCartId(s.store.id);
  const cart = id ? await loadCart(id) : null;
  return NextResponse.json({ cart });
}

/** Start a new cart. The phone number gets a random verification word, used by staff to look up the order. */
export async function POST(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  const phone = typeof body.phone === "string" ? body.phone.replace(/[^\d+]/g, "").slice(0, 16) || null : null;
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
