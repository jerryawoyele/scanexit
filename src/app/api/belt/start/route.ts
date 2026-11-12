import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isStaff } from "@/lib/auth";
import { verifyReceiptToken } from "@/lib/receipt";
import { requireStore } from "@/lib/store";
import { sameWord } from "@/lib/words";

/** Belt screen: the customer scanned their pass. Body { token } or { phone, word }. Opens a new run for this store's belt. */
export async function POST(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const store = s.store;
  if (!isStaff(req, store)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  let c: Record<string, any> | undefined;
  if (body.token) {
    const t = verifyReceiptToken(String(body.token));
    if (!t.ok) return NextResponse.json({ state: t.reason });
    if (t.storeId !== store.id) return NextResponse.json({ state: "OTHER_STORE" });
    const [row] = await q(`SELECT id, status, receipt_nonce FROM carts WHERE id=$1 AND store_id=$2`, [t.cartId, store.id]);
    if (!row || row.receipt_nonce !== t.nonce) return NextResponse.json({ state: "INVALID" });
    c = row;
  } else if (body.phone) {
    // Pass won't scan / phone disconnected: phone number + the customer's word.
    const phone = String(body.phone).replace(/[^\d+]/g, "");
    const [row] = await q(
      `SELECT id, status, verify_word FROM carts WHERE store_id=$1 AND phone=$2 AND status IN ('PAID','PENDING_PAYMENT','OPEN','CHECKED')
        ORDER BY updated_at DESC LIMIT 1`, [store.id, phone]);
    if (!row || !sameWord(row.verify_word, body.word)) return NextResponse.json({ state: "NOT_FOUND" });
    c = row;
  } else return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  if (!c) return NextResponse.json({ state: "NOT_FOUND" });
  if (c.status === "CHECKED") return NextResponse.json({ state: "ALREADY_USED" });
  if (c.status !== "PAID") return NextResponse.json({ state: "NOT_PAID" });
  // One belt per store for now: any unfinished run on it is abandoned.
  await q(`UPDATE exit_runs SET status='ABANDONED', finished_at=now() WHERE store_id=$1 AND status IN ('RUNNING','MISMATCH')`, [store.id]);
  const [run] = await q<{ id: string }>(`INSERT INTO exit_runs (store_id, cart_id) VALUES ($1,$2) RETURNING id`, [store.id, c.id]);
  return NextResponse.json({ state: "RUNNING", runId: run.id });
}
