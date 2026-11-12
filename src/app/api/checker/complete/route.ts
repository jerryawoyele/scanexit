import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isStaff } from "@/lib/auth";
import { requireStore } from "@/lib/store";

interface Adjustment { type: "ADD" | "REMOVE"; barcode: string; name: string; qty: number; amountKobo: number }

/** Finish an exit check. Marks the receipt as used so the QR cannot be reused. */
export async function POST(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  if (!isStaff(req, s.store)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { cartId, adjustments = [], notes = null } = (await req.json()) as {
    cartId: string; adjustments?: Adjustment[]; notes?: string | null;
  };
  const clean = adjustments
    .filter((a) => (a.type === "ADD" || a.type === "REMOVE") && a.qty > 0)
    .map((a) => ({ type: a.type, barcode: String(a.barcode), name: String(a.name), qty: Math.floor(a.qty), amountKobo: Math.floor(a.amountKobo) }));

  const updated = await q(
    `UPDATE carts SET status='CHECKED', checked_at=now(), updated_at=now() WHERE id=$1 AND store_id=$2 AND status='PAID' RETURNING id`,
    [cartId, s.store.id]
  );
  if (!updated.length) return NextResponse.json({ error: "NOT_PAID_OR_ALREADY_USED" }, { status: 409 });
  await q(`INSERT INTO exit_checks (cart_id, result, adjustments, notes) VALUES ($1,$2,$3,$4)`, [
    cartId, clean.length ? "ADJUSTED" : "APPROVED", JSON.stringify(clean), notes,
  ]);
  const add = clean.filter((a) => a.type === "ADD").reduce((s, a) => s + a.amountKobo, 0);
  const refund = clean.filter((a) => a.type === "REMOVE").reduce((s, a) => s + a.amountKobo, 0);
  return NextResponse.json({ ok: true, collectKobo: add, refundKobo: refund });
}
