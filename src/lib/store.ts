import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { q } from "@/lib/db";

/** A store as used on the server. The PIN hashes never leave the server. */
export interface Store {
  id: string;
  slug: string;
  name: string;
  staffPinHash: string;
  adminPinHash: string;
}

/** The main domain the store subdomains hang off, e.g. "scanexit.com" or "localhost:3000". */
export function rootHost(): string {
  return (process.env.ROOT_DOMAIN || "localhost:3000").trim().toLowerCase();
}

function hostOf(h: Headers): string {
  return (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim().toLowerCase();
}

/** "shoprite-lekki.scanexit.com" -> "shoprite-lekki"; the main domain itself -> null. */
export function slugFromHost(host: string): string | null {
  const root = rootHost();
  if (!host.endsWith("." + root)) return null;
  const sub = host.slice(0, -(root.length + 1));
  if (sub === "www") return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/.test(sub) ? sub : null;
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/;
const RESERVED = new Set(["www", "api", "admin", "owner", "app", "mail"]);
export const validSlug = (s: string) => SLUG_RE.test(s) && !RESERVED.has(s);

/**
 * Single-store mode (used for demo.scanexit.com): when DEFAULT_STORE names a store slug,
 * the main address itself is that store, so no wildcard subdomains are needed.
 */
export function defaultStoreSlug(): string | null {
  const s = (process.env.DEFAULT_STORE ?? "").trim().toLowerCase();
  return s && SLUG_RE.test(s) ? s : null;
}

/** Public address of a store, e.g. https://shoprite-lekki.scanexit.com */
export function storeUrl(slug: string): string {
  const root = rootHost();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(root) || root.endsWith(".localhost") || root.includes("localhost:");
  const scheme = local ? "http" : "https";
  return slug === defaultStoreSlug() ? `${scheme}://${root}` : `${scheme}://${slug}.${root}`;
}

/** Origin of the current request, e.g. https://shoprite-lekki.scanexit.com */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = hostOf(h);
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** True when the request is on the main domain (not a store subdomain). */
export async function onRootHost(): Promise<boolean> {
  return hostOf(await headers()) === rootHost();
}

/** The store this request is for: from its subdomain, or DEFAULT_STORE on the main address. */
export async function currentStore(): Promise<Store | null> {
  const host = hostOf(await headers());
  const slug = slugFromHost(host) ?? (host === rootHost() ? defaultStoreSlug() : null);
  if (!slug) return null;
  const [s] = await q<Store>(
    `SELECT id, slug, name, staff_pin_hash AS "staffPinHash", admin_pin_hash AS "adminPinHash" FROM stores WHERE slug = $1`,
    [slug]
  );
  return s ?? null;
}

/** Use in API routes: the current store, or a 404 response to return. */
export async function requireStore(): Promise<{ store: Store } | { error: NextResponse }> {
  const store = await currentStore();
  return store ? { store } : { error: NextResponse.json({ error: "NO_STORE" }, { status: 404 }) };
}
