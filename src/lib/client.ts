export function naira(kobo: number) {
  return "₦" + (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });
}
export async function api<T = any>(url: string, init?: RequestInit & { pin?: string }): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init?.pin) headers["x-pin"] = init.pin;
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers as any) } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
