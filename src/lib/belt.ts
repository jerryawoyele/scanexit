import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { q } from "@/lib/db";
import { loadCart } from "@/lib/cart";
import type { Store } from "@/lib/store";

/**
 * The smart exit belt.
 * A run = one customer's exit check: the pass is scanned at the belt screen, the belt's camera
 * reports every item it sees, and the run is tallied against the paid receipt.
 */

/** Secret key the belt's AI computer uses to report items for this store (derived, nothing to store). */
export function stationKey(storeId: string): string {
  const secret = process.env.RECEIPT_SECRET ?? "";
  return "sx_" + createHmac("sha256", secret).update("belt-station:" + storeId).digest("base64url").slice(0, 32);
}
export function isStation(req: NextRequest, store: Store): boolean {
  const given = Buffer.from(req.headers.get("x-station-key") ?? "");
  const want = Buffer.from(stationKey(store.id));
  return given.length === want.length && timingSafeEqual(given, want);
}

export interface TallyLine {
  productId: string;
  barcode: string;
  name: string;
  imageUrl: string | null;
  unitPriceKobo: number;
  paid: number; // on the receipt
  seen: number; // passed the camera
}
export interface RunView {
  id: string;
  cartId: string;
  status: string; // RUNNING | MATCHED | MISMATCH | DONE
  itemCount: number;
  totalKobo: number;
  phone: string | null;
  lines: TallyLine[]; // receipt items, plus extras the receipt doesn't have (paid = 0)
  unknown: { barcode: string; count: number }[]; // barcodes not in the product list
  seenCount: number;
  missing: number; // paid but not seen
  extra: number; // seen but not paid (incl. unknown)
  match: boolean;
}

export async function loadRun(runId: string, storeId: string): Promise<RunView | null> {
  const [run] = await q(`SELECT * FROM exit_runs WHERE id=$1 AND store_id=$2`, [runId, storeId]);
  if (!run) return null;
  const cart = await loadCart(run.cart_id);
  if (!cart) return null;
  const events = await q<{ barcode: string; product_id: string | null; name: string | null; image_url: string | null; price_kobo: number | null }>(
    `SELECT e.barcode, e.product_id, p.name, p.image_url, p.price_kobo
       FROM exit_run_items e LEFT JOIN products p ON p.id = e.product_id
      WHERE e.run_id=$1 ORDER BY e.created_at`, [runId]);

  const lines = new Map<string, TallyLine>();
  for (const i of cart.items) {
    lines.set(i.productId, { productId: i.productId, barcode: i.barcode, name: i.name, imageUrl: i.imageUrl, unitPriceKobo: i.unitPriceKobo, paid: i.qty, seen: 0 });
  }
  const unknown = new Map<string, number>();
  for (const e of events) {
    if (!e.product_id) { unknown.set(e.barcode, (unknown.get(e.barcode) ?? 0) + 1); continue; }
    const l = lines.get(e.product_id);
    if (l) l.seen++;
    else lines.set(e.product_id, { productId: e.product_id, barcode: e.barcode, name: e.name ?? e.barcode, imageUrl: e.image_url, unitPriceKobo: e.price_kobo ?? 0, paid: 0, seen: 1 });
  }
  const all = [...lines.values()];
  const missing = all.reduce((s, l) => s + Math.max(0, l.paid - l.seen), 0);
  const unknownCount = [...unknown.values()].reduce((s, n) => s + n, 0);
  const extra = all.reduce((s, l) => s + Math.max(0, l.seen - l.paid), 0) + unknownCount;
  return {
    id: run.id, cartId: run.cart_id, status: run.status,
    itemCount: cart.itemCount, totalKobo: cart.totalKobo, phone: cart.phone,
    lines: all, unknown: [...unknown].map(([barcode, count]) => ({ barcode, count })),
    seenCount: events.length, missing, extra, match: missing === 0 && extra === 0,
  };
}

export interface Adjustment { type: "ADD" | "REMOVE"; barcode: string; name: string; qty: number; amountKobo: number }

/** Mark the pass used and record the exit check. Returns false if it was already used or not paid. */
export async function finishCheck(storeId: string, cartId: string, adjustments: Adjustment[], notes: string): Promise<boolean> {
  const updated = await q(
    `UPDATE carts SET status='CHECKED', checked_at=now(), updated_at=now() WHERE id=$1 AND store_id=$2 AND status='PAID' RETURNING id`,
    [cartId, storeId]);
  if (!updated.length) return false;
  await q(`INSERT INTO exit_checks (cart_id, result, adjustments, notes) VALUES ($1,$2,$3,$4)`,
    [cartId, adjustments.length ? "ADJUSTED" : "APPROVED", JSON.stringify(adjustments), notes]);
  return true;
}

/** The adjustments implied by a mismatched run: extras to collect, missing items to refund. */
export function adjustmentsFor(run: RunView): Adjustment[] {
  const out: Adjustment[] = [];
  for (const l of run.lines) {
    if (l.seen > l.paid) out.push({ type: "ADD", barcode: l.barcode, name: l.name, qty: l.seen - l.paid, amountKobo: (l.seen - l.paid) * l.unitPriceKobo });
    if (l.paid > l.seen) out.push({ type: "REMOVE", barcode: l.barcode, name: l.name, qty: l.paid - l.seen, amountKobo: (l.paid - l.seen) * l.unitPriceKobo });
  }
  return out;
}
