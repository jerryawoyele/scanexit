import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { requireStore } from "@/lib/store";

/** Parse one CSV line, supporting quoted fields. */
function parseLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * CSV columns (header row required): barcode,name,price,image_url
 * price is in naira (e.g. 2800 or 2800.50). Extra columns are ignored.
 */
export async function POST(req: NextRequest) {
  const s = await requireStore();
  if ("error" in s) return s.error;
  if (!isAdmin(req, s.store)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { csv } = await req.json();
  const lines = String(csv ?? "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return NextResponse.json({ error: "EMPTY_CSV" }, { status: 400 });

  const header = parseLine(lines[0]).map((h) => h.toLowerCase());
  const col = (n: string) => header.indexOf(n);
  if (col("barcode") < 0 || col("name") < 0 || col("price") < 0)
    return NextResponse.json({ error: "CSV needs barcode, name and price columns" }, { status: 400 });

  let imported = 0; const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseLine(lines[i]);
    const barcode = f[col("barcode")]?.replace(/\s/g, "");
    const name = f[col("name")];
    const price = Number((f[col("price")] ?? "").replace(/[₦,\s]/g, ""));
    const image = col("image_url") >= 0 ? f[col("image_url")] || null : null;
    if (!barcode || !name || !Number.isFinite(price) || price < 0) { errors.push(`Line ${i + 1}: invalid row`); continue; }
    await q(
      `INSERT INTO products (store_id, barcode, name, price_kobo, image_url, active) VALUES ($5,$1,$2,$3,$4,TRUE)
       ON CONFLICT (store_id, barcode) DO UPDATE SET name=EXCLUDED.name, price_kobo=EXCLUDED.price_kobo,
         image_url=COALESCE(EXCLUDED.image_url, products.image_url), active=TRUE, updated_at=now()`,
      [barcode, name, Math.round(price * 100), image, s.store.id]
    );
    imported++;
  }
  return NextResponse.json({ imported, errors: errors.slice(0, 50) });
}
