import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isStaff } from "@/lib/auth";
import { adjustmentsFor, finishCheck, loadRun } from "@/lib/belt";
import { requireStore } from "@/lib/store";

/**
 * Attendant action on a red result. Body { runId, mode }:
 *  - "rerun": clear what the camera saw and pass the items through again
 *  - "finish": accept the belt's tally; extras are collected and missing items refunded
 */
export async function POST(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const store = s.store;
  if (!isStaff(req, store)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { runId, mode } = await req.json().catch(() => ({}));
  const run = await loadRun(String(runId ?? ""), store.id);
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (run.status !== "MISMATCH") return NextResponse.json({ error: "NOT_A_MISMATCH" }, { status: 409 });
  if (mode === "rerun") {
    await q(`DELETE FROM exit_run_items WHERE run_id=$1`, [run.id]);
    await q(`UPDATE exit_runs SET status='RUNNING' WHERE id=$1`, [run.id]);
    return NextResponse.json({ ok: true, status: "RUNNING" });
  }
  if (mode !== "finish") return NextResponse.json({ error: "BAD_MODE" }, { status: 400 });
  const adj = adjustmentsFor(run);
  const unknownCount = run.unknown.reduce((n, u) => n + u.count, 0);
  const note = "belt + attendant" + (unknownCount ? `; ${unknownCount} unknown item(s) sent to a payment point` : "");
  if (!(await finishCheck(store.id, run.cartId, adj, note)))
    return NextResponse.json({ error: "ALREADY_USED" }, { status: 409 });
  await q(`UPDATE exit_runs SET status='DONE', finished_at=now() WHERE id=$1`, [run.id]);
  const collectKobo = adj.filter((a) => a.type === "ADD").reduce((n, a) => n + a.amountKobo, 0);
  const refundKobo = adj.filter((a) => a.type === "REMOVE").reduce((n, a) => n + a.amountKobo, 0);
  return NextResponse.json({ ok: true, collectKobo, refundKobo, unknownCount });
}
