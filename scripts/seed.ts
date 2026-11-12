import { q } from "../src/lib/db";
import { hashPin } from "../src/lib/auth";

// Local testing only: a "demo" store at http://demo.localhost:3000 with test PINs.
// Staff PIN 123456, admin PIN 654321. Real stores are created on the /owner page.
const STORE = { slug: "demo", name: "Demo Store", staffPin: "123456", adminPin: "654321" };

const products = [
  ["6154000000017", "Peak Milk Tin 400g", 280000],
  ["6154000000024", "Indomie Chicken 70g", 35000],
  ["5449000000996", "Coca-Cola 50cl", 50000],
  ["6154000000031", "Golden Penny Spaghetti 500g", 140000],
  ["3245990250203", "Hennessy VS 70cl", 9500000],
] as const;

(async () => {
  let [store] = await q<{ id: string }>(`SELECT id FROM stores WHERE slug = $1`, [STORE.slug]);
  if (!store) {
    [store] = await q<{ id: string }>(
      `INSERT INTO stores (slug, name, staff_pin_hash, admin_pin_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
      [STORE.slug, STORE.name, hashPin(STORE.staffPin), hashPin(STORE.adminPin)]
    );
  }
  for (const [barcode, name, price] of products) {
    await q(
      `INSERT INTO products (store_id, barcode, name, price_kobo) VALUES ($1,$2,$3,$4)
       ON CONFLICT (store_id, barcode) DO UPDATE SET name=EXCLUDED.name, price_kobo=EXCLUDED.price_kobo, updated_at=now()`,
      [store.id, barcode, name, price]
    );
  }
  console.log(`Seeded store "${STORE.slug}" with ${products.length} sample products`);
  process.exit(0);
})();
