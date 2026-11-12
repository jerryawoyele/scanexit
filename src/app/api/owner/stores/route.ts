import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { q } from "@/lib/db";
import { hashPin, isOwner, validPin } from "@/lib/auth";
import { onRootHost, storeUrl, validSlug } from "@/lib/store";

/** Owner-only routes live on the main domain, never on a store's subdomain. */
async function guard(req: NextRequest) {
  if (!(await onRootHost())) return NextResponse.json({ error: "NOT_HERE" }, { status: 404 });
  if (!process.env.OWNER_PIN || process.env.OWNER_PIN.length < 8)
    return NextResponse.json({ error: "OWNER_PIN_NOT_SET" }, { status: 503 });
  if (!isOwner(req)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return null;
}

/** All stores with their customer link and entrance QR. */
export async function GET(req: NextRequest) {
  const bad = await guard(req);
  if (bad) return bad;
  const rows = await q(
    `SELECT s.id, s.slug, s.name, s.created_at AS "createdAt",
            (SELECT COUNT(*)::int FROM products p WHERE p.store_id = s.id AND p.active) AS products,
            (SELECT COUNT(*)::int FROM carts c WHERE c.store_id = s.id AND c.status IN ('PAID','CHECKED')
               AND c.created_at >= date_trunc('day', now())) AS "paidToday"
       FROM stores s ORDER BY s.created_at`
  );
  const stores = await Promise.all(rows.map(async (s) => {
    const url = storeUrl(s.slug);
    return { ...s, url, qr: await QRCode.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: "M" }) };
  }));
  return NextResponse.json({ stores });
}

/** Create a store: { name, slug, staffPin, adminPin }. */
export async function POST(req: NextRequest) {
  const bad = await guard(req);
  if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().slice(0, 80);
  const slug = String(b.slug ?? "").trim().toLowerCase();
  if (!name) return NextResponse.json({ error: "Store name is required." }, { status: 400 });
  if (!validSlug(slug))
    return NextResponse.json({ error: "Link name: lowercase letters, numbers and dashes only (e.g. shoprite-lekki)." }, { status: 400 });
  if (!validPin(b.staffPin) || !validPin(b.adminPin))
    return NextResponse.json({ error: "PINs must be 6 to 12 digits." }, { status: 400 });
  if (b.staffPin === b.adminPin) return NextResponse.json({ error: "Staff PIN and admin PIN must be different." }, { status: 400 });
  const [exists] = await q(`SELECT 1 FROM stores WHERE slug = $1`, [slug]);
  if (exists) return NextResponse.json({ error: "That link name is already taken." }, { status: 409 });
  const [s] = await q(
    `INSERT INTO stores (slug, name, staff_pin_hash, admin_pin_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
    [slug, name, hashPin(b.staffPin), hashPin(b.adminPin)]
  );
  return NextResponse.json({ id: s.id, url: storeUrl(slug) });
}

/** Rename a store or set new PINs: { id, name?, staffPin?, adminPin? }. */
export async function PATCH(req: NextRequest) {
  const bad = await guard(req);
  if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  const [s] = await q(`SELECT id FROM stores WHERE id = $1`, [String(b.id ?? "")]);
  if (!s) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (b.name !== undefined) {
    const name = String(b.name).trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: "Store name is required." }, { status: 400 });
    await q(`UPDATE stores SET name = $2 WHERE id = $1`, [s.id, name]);
  }
  for (const [field, col] of [["staffPin", "staff_pin_hash"], ["adminPin", "admin_pin_hash"]] as const) {
    if (b[field] === undefined || b[field] === "") continue;
    if (!validPin(b[field])) return NextResponse.json({ error: "PINs must be 6 to 12 digits." }, { status: 400 });
    await q(`UPDATE stores SET ${col} = $2 WHERE id = $1`, [s.id, hashPin(b[field])]);
  }
  return NextResponse.json({ ok: true });
}
