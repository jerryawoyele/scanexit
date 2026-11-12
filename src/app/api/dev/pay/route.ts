import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { markPaid } from "@/lib/cart";
import { devMode } from "@/lib/paystack";
import { requestOrigin } from "@/lib/store";

/** DEV MODE ONLY: simulates a successful Paystack payment. Only works when SIMULATE_PAYMENTS="true" and no PAYSTACK_SECRET_KEY is set. */
export async function GET(req: NextRequest) {
  if (!devMode()) return NextResponse.json({ error: "DISABLED" }, { status: 404 });
  const reference = req.nextUrl.searchParams.get("reference") ?? "";
  const [c] = await q(`SELECT total_kobo FROM carts WHERE paystack_ref=$1`, [reference]);
  if (c) await markPaid(reference, c.total_kobo);
  return NextResponse.redirect(`${await requestOrigin()}/receipt?reference=${encodeURIComponent(reference)}`);
}
