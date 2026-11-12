import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireStore } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ barcode: string }> }) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  const { barcode } = await params;
  const [p] = await q(
    `SELECT id, barcode, name, price_kobo AS "priceKobo", image_url AS "imageUrl"
       FROM products WHERE store_id = $1 AND barcode = $2 AND active`,
    [s.store.id, barcode.trim()]
  );
  if (!p) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(p);
}
