import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isStaff } from "@/lib/auth";
import { isStation } from "@/lib/belt";
import { requireStore } from "@/lib/store";

/**
 * The belt's camera reports one item it saw. Body { barcode, runId?, source?, confidence? }.
 * Auth: the store's belt station key (x-station-key) from the belt's AI computer, or a staff PIN
 * (the demo's simulated belt). Without runId it goes to the store's active run.
 */
export async function POST(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const store = s.store;
  const station = isStation(req, store);
  if (!station && !isStaff(req, store)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const barcode = String(b.barcode ?? "").replace(/\s/g, "").slice(0, 64);
  if (!barcode) return NextResponse.json({ error: "BARCODE_REQUIRED" }, { status: 400 });
  const [run] = b.runId
    ? await q(`SELECT id, status FROM exit_runs WHERE id=$1 AND store_id=$2`, [String(b.runId), store.id])
    : await q(`SELECT id, status FROM exit_runs WHERE store_id=$1 AND status='RUNNING' ORDER BY started_at DESC LIMIT 1`, [store.id]);
  if (!run) return NextResponse.json({ error: "NO_ACTIVE_RUN" }, { status: 409 });
  if (run.status !== "RUNNING") return NextResponse.json({ error: "RUN_FINISHED" }, { status: 409 });
  const [p] = await q(`SELECT id FROM products WHERE store_id=$1 AND barcode=$2`, [store.id, barcode]);
  const conf = Number(b.confidence);
  await q(`INSERT INTO exit_run_items (run_id, barcode, product_id, source, confidence) VALUES ($1,$2,$3,$4,$5)`, [
    run.id, barcode, p?.id ?? null,
    station ? String(b.source ?? "camera").slice(0, 16) : "simulated",
    Number.isFinite(conf) ? conf : null,
  ]);
  return NextResponse.json({ ok: true, runId: run.id, known: !!p });
}
