"use client";
import { useEffect, useState } from "react";
import { api, naira } from "@/lib/client";
import { Brand } from "@/components/Icons";

type Summary = { paid: number; checked: number; revenueKobo: number; adjusted: number; products: number };
type Order = { id: string; phone: string | null; status: string; totalKobo: number; itemCount: number; paidAt: string | null; checkResult: string | null };

const SAMPLE = `barcode,name,price,image_url
6154000000017,Peak Milk Tin 400g,2800,
3245990250203,Hennessy VS 70cl,95000,`;

export default function Admin() {
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  useEffect(() => {
    api<{ store: { name: string } | null }>("/api/store").then((r) => setStoreName(r.data.store?.name ?? null));
  }, []);
  const [data, setData] = useState<{ summary: Summary; orders: Order[]; stationKey?: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const load = async (p = pin) => {
    const r = await api<{ summary: Summary; orders: Order[]; stationKey?: string }>("/api/admin/orders", { pin: p });
    if (r.status === 401) { setAuthed(false); alert("Wrong admin PIN"); return; }
    setData(r.data); setAuthed(true);
  };
  useEffect(() => { if (authed) { const t = setInterval(() => load(), 15000); return () => clearInterval(t); } });

  const importCsv = async () => {
    const r = await api<{ imported: number; errors: string[]; error?: string }>("/api/admin/import", { method: "POST", pin, body: JSON.stringify({ csv }) });
    setResult(r.ok ? `Imported ${r.data.imported} products.${r.data.errors.length ? " Problems: " + r.data.errors.join("; ") : ""}` : `Error: ${r.data.error}`);
    load();
  };

  if (!authed) {
    return (
      <main>
        <div className="topbar"><Brand label="Store admin" sub={storeName} /></div>
        <form className="card" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <h1 style={{ marginBottom: 6 }}>Manager sign-in</h1>
          <p className="muted" style={{ marginTop: 0 }}>Products, today&apos;s orders and pilot numbers.</p>
          <label className="field" htmlFor="pin">Admin PIN</label>
          <input id="pin" type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} style={{ marginBottom: 14, letterSpacing: ".3em", fontSize: 20 }} />
          <button className="block lg">Open admin</button>
        </form>
      </main>
    );
  }

  const s = data?.summary;
  const pill = (status: string) => {
    const k = status === "PENDING_PAYMENT" ? "pending" : status.toLowerCase();
    return <span className={`pill ${k}`}>{status.replace("_", " ").toLowerCase()}</span>;
  };
  return (
    <main style={{ maxWidth: 960 }}>
      <div className="topbar"><Brand label="Store admin" sub={storeName} /><span className="eyebrow">Today</span></div>
      {s && (
        <div className="stats">
          <div className="stat hl"><div className="total">{naira(s.revenueKobo)}</div><div className="muted">ScanExit sales</div></div>
          <div className="stat"><div className="total">{s.paid}</div><div className="muted">paid orders</div></div>
          <div className="stat"><div className="total">{s.checked}</div><div className="muted">checked at exit</div></div>
          <div className="stat"><div className="total">{s.adjusted}</div><div className="muted">baskets with changes</div></div>
          <div className="stat"><div className="total">{s.products}</div><div className="muted">products</div></div>
        </div>
      )}
      <div className="card">
        <h2>Today&apos;s orders</h2>
        {data?.orders.length === 0 && <p className="muted" style={{ margin: 0 }}>No orders yet today.</p>}
        {!!data?.orders.length && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Phone</th><th>Items</th><th>Total</th><th>Status</th><th>Exit check</th></tr></thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.paidAt ? new Date(o.paidAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–"}</td>
                    <td>{o.phone ?? "–"}</td><td>{o.itemCount}</td><td style={{ fontWeight: 700 }}>{naira(o.totalKobo)}</td>
                    <td>{pill(o.status)}</td><td>{o.checkResult ? <span className={`pill ${o.checkResult.toLowerCase()}`}>{o.checkResult.toLowerCase()}</span> : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Exit belt</h2>
        <p className="muted" style={{ marginTop: 0 }}>Open <b>/belt</b> on the screen at the belt and unlock it with the staff PIN. The belt&apos;s AI computer reports each item it sees to <b>/api/belt/item</b> on this store&apos;s address, sending <code>{"{ \"barcode\": \"…\" }"}</code> with the header <code>x-station-key</code>.</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <code className="grow" style={{ background: "#f4f6f1", padding: "12px 14px", borderRadius: 12, wordBreak: "break-all" }}>{showKey ? data?.stationKey : "••••••••••••••••••••••••"}</code>
          <button className="secondary small" onClick={() => setShowKey((v) => !v)}>{showKey ? "Hide key" : "Show belt key"}</button>
        </div>
        <p className="muted" style={{ margin: "8px 0 0" }}>Keep this key secret: it lets a device report items on this store&apos;s belt. Backup when the belt is down: staff use <b>/checker</b>.</p>
      </div>
      <div className="card">
        <h2>Import products</h2>
        <p className="muted" style={{ marginTop: 0 }}>CSV columns: barcode, name, price (naira), image_url. Existing barcodes are updated.</p>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} style={{ marginBottom: 10 }} />
        <textarea rows={6} aria-label="CSV text" placeholder={SAMPLE} value={csv} onChange={(e) => setCsv(e.target.value)} style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 14 }} />
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <button disabled={!csv.trim()} onClick={importCsv}>Import</button>
          {result && <span className={result.startsWith("Error") || result.includes("Problems") ? "missing" : "muted"} style={{ fontWeight: 600 }}>{result}</span>}
        </div>
      </div>
    </main>
  );
}
