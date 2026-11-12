import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isStaff } from "@/lib/auth";
import { finishCheck, isStation, loadRun } from "@/lib/belt";
import { requireStore } from "@/lib/store";

/** The customer pressed Done (or the belt went quiet). Body { runId }. Green → pass used; red → attendant. */
export async function POST(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const store = s.store;
  if (!isStaff(req, store) && !isStation(req, store)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { runId } = await req.json().catch(() => ({}));
  const run = await loadRun(String(runId ?? ""), store.id);
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (run.status !== "RUNNING") return NextResponse.json({ error: "RUN_FINISHED", run }, { status: 409 });
  if (run.match) {
    if (!(await finishCheck(store.id, run.cartId, [], "belt: all items matched")))
      return NextResponse.json({ error: "ALREADY_USED" }, { status: 409 });
    await q(`UPDATE exit_runs SET status='DONE', finished_at=now() WHERE id=$1`, [run.id]);
    return NextResponse.json({ result: "GREEN", run: { ...run, status: "DONE" } });
  }
  await q(`UPDATE exit_runs SET status='MISMATCH' WHERE id=$1`, [run.id]);
  return NextResponse.json({ result: "RED", run: { ...run, status: "MISMATCH" } });
}
