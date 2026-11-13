import { cookies } from "next/headers";
import { q } from "./db";
import { newNonce } from "./receipt";

export const CART_COOKIE = "sp_cart";

export interface CartItemView {
  productId: string;
  barcode: string;
  name: string;
  imageUrl: string | null;
  qty: number;
  unitPriceKobo: number;
  lineKobo: number;
}
export interface CartView {
  id: string;
  storeId: string;
  phone: string | null;
  verifyWord: string | null;
  status: string;
  totalKobo: number;
  itemCount: number;
  paystackRef: string | null;
  paidAt: string | null;
  checkedAt: string | null;
  receiptNonce: string | null;
  items: CartItemView[];
}

/**
 * A shopper who hasn't paid must enter their phone number again after this many minutes with no
 * activity (a scan or a basket change). Paid orders never time out.
 */
export const IDLE_MINUTES = Number(process.env.SHOPPER_IDLE_MINUTES) || 10;

/**
 * This browser's cart for the given store. `expired`: an unpaid cart that has been idle too long;
 * it's kept (re-entering the same number picks it up again) but can't be used until then.
 */
export async function cartSession(storeId: string): Promise<{ id: string | null; expired: boolean; secondsLeft: number | null }> {
  const id = (await cookies()).get(CART_COOKIE)?.value;
  if (!id) return { id: null, expired: false, secondsLeft: null };
  const [c] = await q<{ id: string; status: string; left: number }>(
    `SELECT id, status, EXTRACT(EPOCH FROM (updated_at + interval '${IDLE_MINUTES} minutes' - now()))::int AS left
       FROM carts WHERE id = $1 AND store_id = $2`,
    [id, storeId]
  );
  if (!c) return { id: null, expired: false, secondsLeft: null };
  if (c.status !== "OPEN") return { id: c.id, expired: false, secondsLeft: null };
  if (c.left <= 0) return { id: null, expired: true, secondsLeft: 0 };
  return { id: c.id, expired: false, secondsLeft: c.left };
}

/** The cart in this browser's cookie, only if it belongs to the given store and hasn't timed out. */
export async function currentCartId(storeId: string): Promise<string | null> {
  return (await cartSession(storeId)).id;
}

/** Live prices while OPEN; frozen prices once checkout starts. */
export async function loadCart(cartId: string): Promise<CartView | null> {
  const [c] = await q(`SELECT * FROM carts WHERE id = $1`, [cartId]);
  if (!c) return null;
  const rows = await q(
    `SELECT ci.product_id, ci.qty, ci.unit_price_kobo, p.barcode, p.name, p.image_url, p.price_kobo
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1 ORDER BY p.name`,
    [cartId]
  );
  const live = c.status === "OPEN";
  const items: CartItemView[] = rows.map((r) => {
    const unit = live ? r.price_kobo : r.unit_price_kobo;
    return {
      productId: r.product_id,
      barcode: r.barcode,
      name: r.name,
      imageUrl: r.image_url,
      qty: r.qty,
      unitPriceKobo: unit,
      lineKobo: unit * r.qty,
    };
  });
  const total = items.reduce((s, i) => s + i.lineKobo, 0);
  return {
    id: c.id,
    storeId: c.store_id,
    phone: c.phone,
    verifyWord: c.verify_word,
    status: c.status,
    totalKobo: live ? total : c.total_kobo,
    itemCount: items.reduce((s, i) => s + i.qty, 0),
    paystackRef: c.paystack_ref,
    paidAt: c.paid_at ? new Date(c.paid_at).toISOString() : null,
    checkedAt: c.checked_at ? new Date(c.checked_at).toISOString() : null,
    receiptNonce: c.receipt_nonce,
    items,
  };
}

/** Freeze prices from the server's product table and compute the total. */
export async function freezeCart(cartId: string): Promise<number> {
  await q(
    `UPDATE cart_items ci SET unit_price_kobo = p.price_kobo FROM products p
      WHERE p.id = ci.product_id AND ci.cart_id = $1`,
    [cartId]
  );
  const [{ total }] = await q<{ total: number }>(
    `SELECT COALESCE(SUM(qty * unit_price_kobo), 0)::int AS total FROM cart_items WHERE cart_id = $1`,
    [cartId]
  );
  return total;
}

/** Mark paid only if the reference is the cart's current one and the amount matches exactly. */
export async function markPaid(reference: string, amountKobo: number): Promise<boolean> {
  const rows = await q(
    `UPDATE carts SET status = 'PAID', paid_at = now(), receipt_nonce = $3, updated_at = now()
      WHERE paystack_ref = $1 AND status = 'PENDING_PAYMENT' AND total_kobo = $2
      RETURNING id`,
    [reference, amountKobo, newNonce()]
  );
  return rows.length > 0;
}
