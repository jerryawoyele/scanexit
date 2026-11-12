import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { requireStore } from "@/lib/store";
import { stationKey } from "@/lib/belt";

/** Today's ScanExit orders plus summary numbers for the pilot. */
export async function GET(req: NextRequest) {
  const st = await requireStore();
  if ("error" in st) return st.error;
  const store = st.store;
  if (!isAdmin(req, store)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const orders = await q(
    `SELECT c.id, c.phone, c.status, c.total_kobo AS "totalKobo", c.paid_at AS "paidAt", c.checked_at AS "checkedAt",
            (SELECT COALESCE(SUM(qty),0)::int FROM cart_items WHERE cart_id=c.id) AS "itemCount",
            (SELECT result FROM exit_checks WHERE cart_id=c.id ORDER BY created_at DESC LIMIT 1) AS "checkResult",
            (SELECT adjustments FROM exit_checks WHERE cart_id=c.id ORDER BY created_at DESC LIMIT 1) AS adjustments
       FROM carts c
      WHERE c.store_id = $1 AND c.created_at >= date_trunc('day', now()) AND c.status <> 'OPEN'
      ORDER BY c.updated_at DESC LIMIT 200`,
    [store.id]
  );
  const [s] = await q(
    `SELECT COUNT(*) FILTER (WHERE status IN ('PAID','CHECKED'))::int AS paid,
            COUNT(*) FILTER (WHERE status='CHECKED')::int AS checked,
            COALESCE(SUM(total_kobo) FILTER (WHERE status IN ('PAID','CHECKED')),0)::int AS "revenueKobo",
            (SELECT COUNT(*)::int FROM exit_checks e JOIN carts c2 ON c2.id = e.cart_id
              WHERE c2.store_id = $1 AND e.result='ADJUSTED' AND e.created_at >= date_trunc('day', now())) AS adjusted,
            (SELECT COUNT(*)::int FROM products WHERE store_id = $1 AND active) AS products
       FROM carts WHERE store_id = $1 AND created_at >= date_trunc('day', now())`,
    [store.id]
  );
  // The exit belt's AI computer reports items with this key (admins only).
  return NextResponse.json({ summary: s, orders, stationKey: stationKey(store.id) });
}
