"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { Brand } from "@/components/Icons";
import { api } from "@/lib/client";

type StoreRow = { id: string; slug: string; name: string; url: string; qr: string; products: number; paidToday: number };

const toSlug = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42);

export default function Owner() {
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [err, setErr] = useState("");
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [form, setForm] = useState({ name: "", slug: "", staffPin: "", adminPin: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pins, setPins] = useState({ staffPin: "", adminPin: "" });

  const load = async (p = pin) => {
    const r = await api<{ stores: StoreRow[]; error?: string }>("/api/owner/stores", { pin: p });
    if (r.status === 401) { setAuthed(false); setErr("Wrong owner PIN."); return false; }
    if (!r.ok) { setErr(r.data.error === "OWNER_PIN_NOT_SET" ? "Set OWNER_PIN (8+ characters) in the server settings first." : r.data.error === "NOT_HERE" ? "Open this page on the main address, not a store's address." : "Could not load stores."); return false; }
    setErr(""); setStores(r.data.stores); setAuthed(true); return true;
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api<{ error?: string; url?: string }>("/api/owner/stores", { method: "POST", pin, body: JSON.stringify(form) });
    if (!r.ok) { setMsg({ ok: false, text: r.data.error ?? "Could not create the store." }); return; }
    setMsg({ ok: true, text: `Created ${form.name}. Its link is ${r.data.url}` });
    setForm({ name: "", slug: "", staffPin: "", adminPin: "" }); setSlugEdited(false);
    load();
  };

  const savePins = async (id: string) => {
    const r = await api<{ error?: string }>("/api/owner/stores", { method: "PATCH", pin, body: JSON.stringify({ id, ...pins }) });
    if (!r.ok) { setMsg({ ok: false, text: r.data.error ?? "Could not save the PINs." }); return; }
    setMsg({ ok: true, text: "PINs updated. Staff will need the new PIN next time they open the checker." });
    setEditing(null); setPins({ staffPin: "", adminPin: "" });
  };

  const host = typeof window !== "undefined" ? window.location.host : "";

  if (!authed) {
    return (
      <main>
        <div className="topbar"><Brand label="ScanExit owner" /></div>
        <form className="card" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <h1 style={{ marginBottom: 6 }}>Owner sign-in</h1>
          <p className="muted" style={{ marginTop: 0 }}>Create stores and get each store&apos;s entrance QR code.</p>
          {err && <div className="toast err">{err}</div>}
          <label className="field" htmlFor="pin">Owner PIN</label>
          <input id="pin" type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} style={{ marginBottom: 14 }} />
          <button className="block lg">Open</button>
        </form>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 960 }}>
      <div className="topbar"><Brand label="ScanExit owner" sub={`${stores.length} store${stores.length === 1 ? "" : "s"}`} /></div>
      {msg && <div className={`toast ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}

      {stores.length === 0 && <div className="card muted">No stores yet. Create the first one below.</div>}
      <div className="stores">
        {stores.map((s) => (
          <div className="card store-card" key={s.id}>
            <img src={s.qr} alt={`Entrance QR for ${s.name}`} className="store-qr" />
            <div className="grow">
              <h2 style={{ marginBottom: 2 }}>{s.name}</h2>
              <a className="muted" href={s.url} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>{s.url.replace(/^https?:\/\//, "")}</a>
              <div className="row" style={{ gap: 16, margin: "10px 0 12px" }}>
                <div><div className="total" style={{ fontSize: 20 }}>{s.products}</div><div className="muted">products</div></div>
                <div><div className="total" style={{ fontSize: 20 }}>{s.paidToday}</div><div className="muted">paid today</div></div>
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                <a href={s.qr} download={`${s.slug}-entrance-qr.png`}><button className="small">Download QR</button></a>
                <a href={`${s.url}/checker`} target="_blank" rel="noreferrer"><button className="secondary small">Exit check</button></a>
                <a href={`${s.url}/admin`} target="_blank" rel="noreferrer"><button className="secondary small">Admin</button></a>
                <button className="ghost small" onClick={() => { setEditing(editing === s.id ? null : s.id); setPins({ staffPin: "", adminPin: "" }); }}>{editing === s.id ? "Close" : "Change PINs"}</button>
              </div>
              {editing === s.id && (
                <div style={{ marginTop: 12 }}>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input className="grow" inputMode="numeric" placeholder="New staff PIN (6-12 digits)" aria-label="New staff PIN" value={pins.staffPin} onChange={(e) => setPins({ ...pins, staffPin: e.target.value })} />
                    <input className="grow" inputMode="numeric" placeholder="New admin PIN (6-12 digits)" aria-label="New admin PIN" value={pins.adminPin} onChange={(e) => setPins({ ...pins, adminPin: e.target.value })} />
                  </div>
                  <p className="muted" style={{ margin: "6px 0 8px" }}>Leave one empty to keep it.</p>
                  <button className="small" disabled={!pins.staffPin && !pins.adminPin} onClick={() => savePins(s.id)}>Save PINs</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <form className="card" onSubmit={create}>
        <h2>Add a store</h2>
        <label className="field" htmlFor="sname">Store name</label>
        <input id="sname" placeholder="e.g. Shoprite Lekki" value={form.name} style={{ marginBottom: 10 }}
          onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugEdited ? form.slug : toSlug(e.target.value) })} />
        <label className="field" htmlFor="slug">Link name</label>
        <input id="slug" placeholder="shoprite-lekki" value={form.slug} autoCapitalize="none" spellCheck={false}
          onChange={(e) => { setSlugEdited(true); setForm({ ...form, slug: e.target.value.toLowerCase() }); }} />
        <p className="muted" style={{ margin: "6px 0 12px", wordBreak: "break-all" }}>Customers will open <b>{form.slug || "link-name"}.{host}</b></p>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div className="grow" style={{ minWidth: 200 }}>
            <label className="field" htmlFor="spin">Staff PIN (exit checker)</label>
            <input id="spin" inputMode="numeric" placeholder="6-12 digits" value={form.staffPin} onChange={(e) => setForm({ ...form, staffPin: e.target.value })} />
          </div>
          <div className="grow" style={{ minWidth: 200 }}>
            <label className="field" htmlFor="apin">Admin PIN (manager)</label>
            <input id="apin" inputMode="numeric" placeholder="6-12 digits" value={form.adminPin} onChange={(e) => setForm({ ...form, adminPin: e.target.value })} />
          </div>
        </div>
        <button className="block lg" style={{ marginTop: 14 }} disabled={!form.name.trim() || !form.slug || !form.staffPin || !form.adminPin}>Create store</button>
      </form>
    </main>
  );
}
