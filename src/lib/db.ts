import { Pool } from "pg";

type Row = Record<string, any>;
interface Db {
  query<T = Row>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// Every statement is safe to run on each start (fresh database or an older one).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  staff_pin_hash TEXT NOT NULL,
  admin_pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  price_kobo INTEGER NOT NULL CHECK (price_kobo >= 0),
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE products DROP COLUMN IF EXISTS high_value;
ALTER TABLE products ADD COLUMN IF NOT EXISTS store_id TEXT REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_idx ON products (store_id, barcode);
CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  total_kobo INTEGER NOT NULL DEFAULT 0,
  paystack_ref TEXT UNIQUE,
  paid_at TIMESTAMPTZ,
  receipt_nonce TEXT,
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE carts ADD COLUMN IF NOT EXISTS store_id TEXT REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE carts ADD COLUMN IF NOT EXISTS verify_word TEXT;
CREATE INDEX IF NOT EXISTS carts_phone_idx ON carts (phone);
CREATE INDEX IF NOT EXISTS carts_store_phone_idx ON carts (store_id, phone);
CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_kobo INTEGER NOT NULL,
  UNIQUE (cart_id, product_id)
);
CREATE TABLE IF NOT EXISTS exit_checks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  result TEXT NOT NULL,
  adjustments JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exit_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS exit_runs_store_idx ON exit_runs (store_id, started_at);
CREATE TABLE IF NOT EXISTS exit_run_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id TEXT NOT NULL REFERENCES exit_runs(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  product_id TEXT REFERENCES products(id),
  source TEXT NOT NULL DEFAULT 'camera',
  confidence REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exit_run_items_run_idx ON exit_run_items (run_id);
`;

const g = globalThis as unknown as { __scanpayDb?: Promise<Db> };

async function create(): Promise<Db> {
  let db: Db;
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = { query: (t, p) => pool.query(t, p as any[]) as any };
  } else {
    // Local testing: embedded Postgres stored on disk in ./.data
    const { PGlite } = await import("@electric-sql/pglite");
    const { mkdirSync } = await import("node:fs");
    mkdirSync("./.data", { recursive: true });
    const lite = new PGlite("./.data/pglite");
    db = { query: (t, p) => lite.query(t, p as any[]) as any };
  }
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
  return db;
}

export function getDb(): Promise<Db> {
  if (!g.__scanpayDb) g.__scanpayDb = create();
  return g.__scanpayDb;
}

export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return (await db.query<T>(text, params)).rows;
}
