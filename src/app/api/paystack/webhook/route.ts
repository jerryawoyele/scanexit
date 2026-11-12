import { NextRequest, NextResponse } from "next/server";
import { markPaid } from "@/lib/cart";
import { validWebhookSignature, verifyTransaction } from "@/lib/paystack";

/** Paystack calls this when a payment succeeds. Set it in Paystack Dashboard > Settings > API Keys & Webhooks. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!validWebhookSignature(raw, req.headers.get("x-paystack-signature")))
    return NextResponse.json({ error: "BAD_SIGNATURE" }, { status: 401 });
  const event = JSON.parse(raw);
  if (event.event === "charge.success") {
    const reference: string = event.data.reference;
    // Double-check with Paystack's API before trusting the event.
    const v = await verifyTransaction(reference);
    if (v.success) await markPaid(reference, v.amountKobo);
  }
  return NextResponse.json({ received: true });
}
