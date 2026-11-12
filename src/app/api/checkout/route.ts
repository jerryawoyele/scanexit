import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentCartId, freezeCart } from "@/lib/cart";
import { devMode, initializeTransaction, paymentsConfigured } from "@/lib/paystack";
import { requestOrigin, requireStore } from "@/lib/store";

export async function POST() {
  if (!paymentsConfigured()) {
    console.error("[scanexit] Checkout refused: set PAYSTACK_SECRET_KEY, or SIMULATE_PAYMENTS=\"true\" for local testing.");
    return NextResponse.json({ error: "PAYMENTS_NOT_CONFIGURED" }, { status: 503 });
  }
  const s = await requireStore();
  if ("error" in s) return s.error;
  const id = await currentCartId(s.store.id);
  if (!id) return NextResponse.json({ error: "NO_CART" }, { status: 400 });
  const [c] = await q(`SELECT status, phone FROM carts WHERE id=$1`, [id]);
  if (!c || !["OPEN", "PENDING_PAYMENT"].includes(c.status))
    return NextResponse.json({ error: "CART_LOCKED" }, { status: 409 });

  const total = await freezeCart(id);
  if (total <= 0) return NextResponse.json({ error: "EMPTY_CART" }, { status: 400 });

  // New reference for every payment attempt.
  const reference = `SP-${id.slice(0, 8)}-${Date.now()}`;
  await q(
    `UPDATE carts SET status='PENDING_PAYMENT', total_kobo=$2, paystack_ref=$3, updated_at=now() WHERE id=$1`,
    [id, total, reference]
  );

  // Send the customer back to this store's own address after paying.
  const origin = await requestOrigin();
  if (devMode()) {
    return NextResponse.json({ url: `${origin}/api/dev/pay?reference=${reference}`, dev: true });
  }
  const url = await initializeTransaction({
    // Paystack requires an email; replace with a real customer email field if you collect one.
    email: `customer-${id.slice(0, 8)}@scanexit.example`,
    amountKobo: total,
    reference,
    callbackUrl: `${origin}/receipt`,
    metadata: { cartId: id, storeId: s.store.id, store: s.store.slug, phone: c.phone },
  });
  return NextResponse.json({ url });
}
