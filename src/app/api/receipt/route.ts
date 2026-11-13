import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { currentCartId, loadCart, markPaid } from "@/lib/cart";
import { devMode, verifyTransaction } from "@/lib/paystack";
import { issueReceiptToken } from "@/lib/receipt";
import { requireStore } from "@/lib/store";

/** Returns payment status and, once paid, a fresh signed receipt QR (expires in 15 min). */
export async function GET() {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const id = await currentCartId(s.store.id);
  if (!id) return NextResponse.json({ error: "NO_CART" }, { status: 400 });
  let cart = await loadCart(id);
  if (!cart) return NextResponse.json({ error: "NO_CART" }, { status: 400 });

  // Fallback in case the webhook is slow: verify directly with Paystack.
  if (cart.status === "PENDING_PAYMENT" && cart.paystackRef && !devMode()) {
    try {
      const v = await verifyTransaction(cart.paystackRef);
      if (v.success && (await markPaid(cart.paystackRef, v.amountKobo))) cart = await loadCart(id);
    } catch { /* still pending */ }
  }
  if (!cart) return NextResponse.json({ error: "NO_CART" }, { status: 400 });

  let qr: string | null = null;
  if (cart.status === "PAID" && cart.receiptNonce) {
    const token = issueReceiptToken(cart.storeId, cart.id, cart.receiptNonce);
    qr = await QRCode.toDataURL(token, { margin: 1, width: 320, errorCorrectionLevel: "M" });
  }
  const { receiptNonce, ...safe } = cart;
  void receiptNonce;
  return NextResponse.json({ cart: safe, qr, demo: devMode() });
}
