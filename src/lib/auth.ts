import { NextRequest } from "next/server";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { Store } from "@/lib/store";

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const pinOf = (req: NextRequest) => req.headers.get("x-pin") ?? "";

/** Store PINs are kept as salted scrypt hashes: "scrypt$<salt>$<hash>". */
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("base64url");
  return `scrypt$${salt}$${scryptSync(pin, salt, 32).toString("base64url")}`;
}
export function checkPin(pin: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash || !pin) return false;
  return same(scryptSync(pin, salt, 32).toString("base64url"), hash);
}

/** PIN rules for store PINs: 6 to 12 digits. */
export const validPin = (pin: unknown) => typeof pin === "string" && /^\d{6,12}$/.test(pin);

export function isAdmin(req: NextRequest, store: Store) {
  return checkPin(pinOf(req), store.adminPinHash);
}
/** Staff PIN opens the checker; the store's admin PIN does too. */
export function isStaff(req: NextRequest, store: Store) {
  const pin = pinOf(req);
  return checkPin(pin, store.staffPinHash) || checkPin(pin, store.adminPinHash);
}
/** The platform owner (you), who creates stores. Set OWNER_PIN in the environment. */
export function isOwner(req: NextRequest) {
  const owner = process.env.OWNER_PIN ?? "";
  return owner.length >= 8 && same(pinOf(req), owner);
}
