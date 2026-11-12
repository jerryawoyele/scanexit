import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isStaff } from "@/lib/auth";
import { isStation, loadRun } from "@/lib/belt";
import { devMode } from "@/lib/paystack";
import { requireStore } from "@/lib/store";

/** Current state of a run (?id=…), or of this store's active run when no id is given. */
export async function GET(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  if (!isStaff(req, s.store) && !isStation(req, s.store)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  let id = req.nextUrl.searchParams.get("id");
  if (!id) {
    const [r] = await q(`SELECT id FROM exit_runs WHERE store_id=$1 AND status='RUNNING' ORDER BY started_at DESC LIMIT 1`, [s.store.id]);
    if (!r) return NextResponse.json({ run: null, simulate: devMode() });
    id = r.id;
  }
  const run = await loadRun(id!, s.store.id);
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ run, simulate: devMode() });
}
