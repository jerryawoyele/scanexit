import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isStaff } from "@/lib/auth";
import { loadCart, CartView } from "@/lib/cart";
import { verifyReceiptToken } from "@/lib/receipt";
import { requireStore } from "@/lib/store";
import { sameWord } from "@/lib/words";

const BIG_BASKET = 25;

async function present(cart: CartView) {
  // Which items staff should look at closely: the 3 most expensive.
  const focus = [...cart.items]
    .sort((a, b) => b.unitPriceKobo - a.unitPriceKobo)
    .slice(0, 3)
    .map((i) => i.productId);

  const reasons: string[] = [];
  if (cart.itemCount > BIG_BASKET) reasons.push(`Large basket (${cart.itemCount} items)`);
  if (cart.phone) {
    const [{ n }] = await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM carts WHERE store_id=$1 AND phone=$2 AND status='CHECKED' AND id<>$3`,
      [cart.storeId, cart.phone, cart.id]);
    if (n === 0) reasons.push("First ScanExit visit");
  } else reasons.push("No phone number on order");

  // Never send the receipt secret or the customer's verification word to the checker screen.
  const { receiptNonce, verifyWord, ...safe } = cart;
  void receiptNonce; void verifyWord;
  return { cart: safe, focus, strict: reasons.length > 0, reasons };
}

/**
 * Body: { token } from the receipt QR, or { phone, word } to look up a customer's latest order.
 * Only orders from this store are ever found.
 */
export async function POST(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const store = s.store;
  if (!isStaff(req, store)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();

  let cartId: string | null = null;
  if (body.token) {
    const t = verifyReceiptToken(String(body.token));
    if (!t.ok) return NextResponse.json({ state: t.reason }); // INVALID | EXPIRED
    if (t.storeId !== store.id) return NextResponse.json({ state: "OTHER_STORE" });
    const [c] = await q(`SELECT id, receipt_nonce FROM carts WHERE id=$1 AND store_id=$2`, [t.cartId, store.id]);
    if (!c || c.receipt_nonce !== t.nonce) return NextResponse.json({ state: "INVALID" });
    cartId = c.id;
  } else if (body.phone) {
    const phone = String(body.phone).replace(/[^\d+]/g, "");
    const [c] = await q(
      `SELECT id, verify_word FROM carts WHERE store_id=$1 AND phone=$2 AND status IN ('PAID','PENDING_PAYMENT','OPEN','CHECKED')
        ORDER BY updated_at DESC LIMIT 1`, [store.id, phone]);
    // A wrong word looks exactly like "no order", so the number alone reveals nothing.
    if (!c || !sameWord(c.verify_word, body.word)) return NextResponse.json({ state: "NOT_FOUND" });
    cartId = c.id;
  } else return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });

  const cart = await loadCart(cartId!);
  if (!cart) return NextResponse.json({ state: "NOT_FOUND" });
  if (cart.status === "CHECKED") return NextResponse.json({ state: "ALREADY_USED", checkedAt: cart.checkedAt });
  if (cart.status !== "PAID") return NextResponse.json({ state: "NOT_PAID", ...(await present(cart)) });
  return NextResponse.json({ state: "PAID", ...(await present(cart)) });
}
