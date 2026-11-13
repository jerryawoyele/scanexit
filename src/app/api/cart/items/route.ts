import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentCartId, loadCart } from "@/lib/cart";
import { requireStore } from "@/lib/store";
import { devMode } from "@/lib/paystack";

const DEMO_PRICE_KOBO = 150000; // ₦1,500

async function openCart() {
  const s = await requireStore();
  if ("error" in s) return { error: s.error };
  const id = await currentCartId(s.store.id);
  if (!id) return { error: NextResponse.json({ error: "NO_CART" }, { status: 400 }) };
  const [c] = await q(`SELECT status FROM carts WHERE id = $1`, [id]);
  if (!c) return { error: NextResponse.json({ error: "NO_CART" }, { status: 400 }) };
  if (c.status === "PENDING_PAYMENT") {
    // Customer went back to edit after starting payment: reopen and drop the old payment reference.
    await q(`UPDATE carts SET status='OPEN', paystack_ref=NULL, updated_at=now() WHERE id=$1`, [id]);
  } else if (c.status !== "OPEN") {
    return { error: NextResponse.json({ error: "CART_LOCKED" }, { status: 409 }) };
  }
  return { id, storeId: s.store.id };
}

/** Add a scanned product to the basket (once; quantity is changed with PATCH). */
export async function POST(req: NextRequest) {
  const cart = await openCart();
  if ("error" in cart) return cart.error;
  const { barcode } = await req.json();
  const code = String(barcode ?? "").trim().slice(0, 64);
  let [p] = await q(
    `SELECT id, price_kobo FROM products WHERE store_id = $1 AND barcode = $2 AND active`,
    [cart.storeId, code]
  );
  if (!p && devMode() && /^[0-9A-Za-z-]{4,64}$/.test(code)) {
    // Demo only (simulated payments): any real barcode the camera reads becomes a "Demo product",
    // so visitors can try the whole trip with whatever is in their kitchen.
    [p] = await q(
      `INSERT INTO products (store_id, barcode, name, price_kobo) VALUES ($1, $2, 'Demo product', $3)
       ON CONFLICT (store_id, barcode) DO UPDATE SET active = TRUE RETURNING id, price_kobo`,
      [cart.storeId, code, DEMO_PRICE_KOBO]
    );
  }
  if (!p) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // A product is added once by scanning; the shopper changes the quantity with + and −.
  const added = await q(
    `INSERT INTO cart_items (cart_id, product_id, qty, unit_price_kobo) VALUES ($1,$2,1,$3)
     ON CONFLICT (cart_id, product_id) DO NOTHING RETURNING id`,
    [cart.id, p.id, p.price_kobo]
  );
  await q(`UPDATE carts SET updated_at=now() WHERE id=$1`, [cart.id]); // any scan counts as activity
  return NextResponse.json({ cart: await loadCart(cart.id), already: added.length === 0 });
}

/** Set quantity of an item; 0 removes it. */
export async function PATCH(req: NextRequest) {
  const cart = await openCart();
  if ("error" in cart) return cart.error;
  const { productId, qty } = await req.json();
  const n = Math.max(0, Math.min(99, Math.floor(Number(qty) || 0)));
  if (n === 0) await q(`DELETE FROM cart_items WHERE cart_id=$1 AND product_id=$2`, [cart.id, productId]);
  else await q(`UPDATE cart_items SET qty=$3 WHERE cart_id=$1 AND product_id=$2`, [cart.id, productId, n]);
  await q(`UPDATE carts SET updated_at=now() WHERE id=$1`, [cart.id]);
  return NextResponse.json({ cart: await loadCart(cart.id) });
}
