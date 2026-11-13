import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentCartId, loadCart } from "@/lib/cart";
import { finishCheck } from "@/lib/belt";
import { devMode } from "@/lib/paystack";
import { requireStore } from "@/lib/store";

/**
 * DEMO ONLY (SIMULATE_PAYMENTS="true"): the shopper's own paid order goes through a simulated
 * exit belt: every paid item "passes the camera", the check matches, and the pass is used up,
 * exactly as the real belt would record it.
 */
export async function POST() {
  if (!devMode()) return NextResponse.json({ error: "DISABLED" }, { status: 404 });
  const s = await requireStore();
  if ("error" in s) return s.error;
  const id = await currentCartId(s.store.id);
  if (!id) return NextResponse.json({ error: "NO_CART" }, { status: 400 });
  const cart = await loadCart(id);
  if (!cart || cart.status !== "PAID") return NextResponse.json({ error: "NOT_PAID_OR_ALREADY_USED" }, { status: 409 });

  await q(`UPDATE exit_runs SET status='ABANDONED', finished_at=now() WHERE store_id=$1 AND status IN ('RUNNING','MISMATCH')`, [s.store.id]);
  const [run] = await q<{ id: string }>(`INSERT INTO exit_runs (store_id, cart_id) VALUES ($1,$2) RETURNING id`, [s.store.id, id]);
  for (const item of cart.items) {
    for (let n = 0; n < item.qty; n++) {
      await q(`INSERT INTO exit_run_items (run_id, barcode, product_id, source) VALUES ($1,$2,$3,'simulated')`, [run.id, item.barcode, item.productId]);
    }
  }
  if (!(await finishCheck(s.store.id, id, [], "demo: simulated exit belt, all items matched")))
    return NextResponse.json({ error: "NOT_PAID_OR_ALREADY_USED" }, { status: 409 });
  await q(`UPDATE exit_runs SET status='DONE', finished_at=now() WHERE id=$1`, [run.id]);

  const done = await loadCart(id);
  if (!done) return NextResponse.json({ error: "NO_CART" }, { status: 400 });
  const { receiptNonce, ...safe } = done;
  void receiptNonce;
  return NextResponse.json({ result: "GREEN", cart: safe });
}
