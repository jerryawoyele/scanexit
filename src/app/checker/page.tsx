"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Scanner from "@/components/Scanner";
import { Brand, CheckIcon, AlertIcon, StopIcon, LockIcon } from "@/components/Icons";
import { api, naira } from "@/lib/client";

// The exit check for smaller stores: a tablet on a stand at the exit. The cashier scans the shopper's pass,
// the paid items appear as product photos with quantities, and the cashier taps each one off as they see it
// in the basket. (Large stores can use the AI camera conveyor at /belt instead.)

type Item = { productId: string; barcode: string; name: string; imageUrl: string | null; qty: number; unitPriceKobo: number; lineKobo: number };
type Cart = { id: string; phone: string | null; status: string; totalKobo: number; itemCount: number; items: Item[] };
type Lookup =
  | { state: "PAID" | "NOT_PAID"; cart: Cart; focus: string[]; strict: boolean; reasons: string[] }
  | { state: "INVALID" | "EXPIRED" | "NOT_FOUND" }
  | { state: "ALREADY_USED"; checkedAt: string };
type Adj = { type: "ADD" | "REMOVE"; barcode: string; name: string; qty: number; amountKobo: number };

const messages: Record<string, string> = {
  INVALID: "Not a valid ScanExit pass",
  EXPIRED: "Pass QR expired. Ask the customer to refresh their pass page",
  NOT_FOUND: "No order matches that phone number and word",
  OTHER_STORE: "This pass is from a different store",
  ALREADY_USED: "This pass has already been checked",
};

const initial = (name: string) => (name.match(/[A-Za-z0-9]/)?.[0] ?? "•").toUpperCase();

export default function Checker() {
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [res, setRes] = useState<Lookup | null>(null);
  const [phone, setPhone] = useState("");
  const [word, setWord] = useState("");
  const [storeName, setStoreName] = useState<string | null>(null);

  useEffect(() => {
    api<{ store: { name: string } | null }>("/api/store").then((r) => setStoreName(r.data.store?.name ?? null));
  }, []);
  const [adds, setAdds] = useState<Adj[]>([]);
  const [seen, setSeen] = useState<Record<string, number>>({}); // productId -> how many the cashier has tapped off
  const [addMode, setAddMode] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [done, setDone] = useState<{ collectKobo: number; refundKobo: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { const p = sessionStorage.getItem("sp_pin"); if (p) { setPin(p); setAuthed(true); } }, []);

  const [pinErr, setPinErr] = useState("");

  // Check the PIN with the server before opening the screen (an empty lookup returns 400 when the PIN is right, 401 when wrong).
  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api("/api/checker/lookup", { method: "POST", body: "{}", pin });
    if (r.status === 401) { setPinErr("Wrong PIN."); setPin(""); return; }
    setPinErr("");
    sessionStorage.setItem("sp_pin", pin);
    setAuthed(true);
  };

  const reset = () => { setRes(null); setAdds([]); setSeen({}); setAddMode(false); setDone(null); setPhone(""); setWord(""); };

  const lookup = async (body: object) => {
    setBusy(true);
    const r = await api<Lookup>("/api/checker/lookup", { method: "POST", body: JSON.stringify(body), pin });
    setBusy(false);
    if (r.status === 401) { sessionStorage.removeItem("sp_pin"); setAuthed(false); setPinErr("Staff PIN no longer valid. Enter it again."); return; }
    setAdds([]); setSeen({}); setDone(null); setRes(r.data);
  };

  const addItem = async (barcode: string) => {
    const r = await api<{ barcode: string; name: string; priceKobo: number }>(`/api/products/${encodeURIComponent(barcode.trim())}`);
    if (!r.ok) { alert("Barcode not in product list. Price it at a payment point."); return; }
    setAdds((a) => {
      const i = a.findIndex((x) => x.barcode === r.data.barcode);
      if (i >= 0) { const c = [...a]; c[i] = { ...c[i], qty: c[i].qty + 1, amountKobo: c[i].amountKobo + r.data.priceKobo }; return c; }
      return [...a, { type: "ADD", barcode: r.data.barcode, name: r.data.name, qty: 1, amountKobo: r.data.priceKobo }];
    });
  };

  const finish = async () => {
    if (!res || !("cart" in res)) return;
    // Anything paid for but not tapped off wasn't in the basket: it is refunded.
    const removes: Adj[] = res.cart.items
      .map((i) => ({ i, n: i.qty - (seen[i.productId] ?? 0) }))
      .filter(({ n }) => n > 0)
      .map(({ i, n }) => ({ type: "REMOVE", barcode: i.barcode, name: i.name, qty: n, amountKobo: n * i.unitPriceKobo }));
    setBusy(true);
    const r = await api<{ collectKobo: number; refundKobo: number; error?: string }>("/api/checker/complete", {
      method: "POST", pin, body: JSON.stringify({ cartId: res.cart.id, adjustments: [...adds, ...removes] }),
    });
    setBusy(false);
    if (r.ok) setDone(r.data); else alert("Could not complete: " + (r.data.error ?? r.status));
  };

  const lockBtn = (
    <button className="ghost small" onClick={() => { sessionStorage.removeItem("sp_pin"); setAuthed(false); }}>
      <span className="btn-label"><LockIcon />Lock</span>
    </button>
  );

  if (!authed) {
    return (
      <main>
        <div className="topbar"><Brand label="Exit check" sub={storeName} /></div>
        <form className="card" onSubmit={unlock}>
          <h1 style={{ marginBottom: 6 }}>Staff sign-in</h1>
          <p className="muted" style={{ marginTop: 0 }}>Enter the staff PIN to open the exit check on this tablet.</p>
          {pinErr && <div className="toast err">{pinErr}</div>}
          <label className="field" htmlFor="pin">Staff PIN</label>
          <input id="pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} style={{ marginBottom: 14, letterSpacing: ".3em", fontSize: 20 }} />
          <button className="block lg">Open exit check</button>
        </form>
      </main>
    );
  }

  if (done) {
    const changed = done.collectKobo > 0 || done.refundKobo > 0;
    return (
      <main className="tablet">
        <div className="topbar"><Brand label="Exit check" sub={storeName} />{lockBtn}</div>
        <div className={`status ${changed ? "amber" : "green"}`}>
          {changed ? <AlertIcon /> : <CheckIcon />}
          <div>{changed ? "Check complete with changes" : "All items seen"}<small>{changed ? "Settle the amounts below before the customer leaves." : "The customer can go."}</small></div>
        </div>
        {done.collectKobo > 0 && <div className="card amount-card"><div><div className="eyebrow">Collect</div><div className="muted">Extra items · POS, transfer or cash</div></div><div className="total">{naira(done.collectKobo)}</div></div>}
        {done.refundKobo > 0 && <div className="card amount-card"><div><div className="eyebrow">Refund</div><div className="muted">Paid for but not in the basket</div></div><div className="total">{naira(done.refundKobo)}</div></div>}
        <button className="block lg" onClick={reset}>Next customer</button>
      </main>
    );
  }

  if (!res) {
    return (
      <main>
        <div className="topbar"><Brand label="Exit check" sub={storeName} />{lockBtn}</div>
        <div className="card"><Scanner onCode={(code) => { if (!busy) lookup({ token: code }); }} /><p className="muted" style={{ margin: "10px 0 0", textAlign: "center" }}>Scan the customer&apos;s pass to see what they paid for.</p></div>
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (phone.trim() && word.trim()) lookup({ phone, word }); }}>
          <h2>Can&apos;t scan the pass? Find the order</h2>
          <p className="muted" style={{ marginTop: 0 }}>Ask the customer for their phone number and the word shown on their phone.</p>
          <label className="field" htmlFor="phone">Phone number</label>
          <input id="phone" inputMode="tel" placeholder="080 1234 5678" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ marginBottom: 10 }} />
          <label className="field" htmlFor="word">Their word</label>
          <input id="word" autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="e.g. mango" value={word} onChange={(e) => setWord(e.target.value)} style={{ marginBottom: 12 }} />
          <button className="block" disabled={busy || !phone.trim() || !word.trim()}>Find order</button>
        </form>
      </main>
    );
  }

  if (!("cart" in res)) {
    return (
      <main>
        <div className="topbar"><Brand label="Exit check" sub={storeName} />{lockBtn}</div>
        <div className="status red"><StopIcon /><div>{messages[res.state]}<small>Do not let the basket through without a valid pass.</small></div></div>
        <button className="block lg" onClick={reset}>Back</button>
      </main>
    );
  }

  const { cart, focus, strict, reasons } = res;
  const paid = res.state === "PAID";
  const seenCount = cart.items.reduce((s, i) => s + Math.min(seen[i.productId] ?? 0, i.qty), 0);
  const notSeen = cart.itemCount - seenCount;
  const tap = (i: Item) => setSeen((m) => ({ ...m, [i.productId]: Math.min(i.qty, (m[i.productId] ?? 0) + 1) }));
  const untap = (i: Item) => setSeen((m) => ({ ...m, [i.productId]: Math.max(0, (m[i.productId] ?? 0) - 1) }));

  return (
    <main className="tablet">
      <div className={`status ${paid ? (strict ? "amber" : "green") : "red"}`}>
        {paid ? (strict ? <AlertIcon /> : <CheckIcon />) : <StopIcon />}
        <div className="grow">
          {paid ? "Paid · tap each item as you see it" : "Not paid yet"}
          {paid && strict && <div className="reasons">{reasons.map((r) => <span key={r}>{r}</span>)}</div>}
          {!paid && <small>Ask the customer to finish payment on their phone, or take their shopping to a payment point.</small>}
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <div><div className="big">{seenCount} / {cart.itemCount}</div><div className="muted">items seen in the basket</div></div>
          <div style={{ textAlign: "right" }}><div className="total">{naira(cart.totalKobo)}</div><div className="muted num">{cart.phone ?? "no phone"}</div></div>
        </div>
        <div className="progress" aria-hidden><span style={{ width: `${cart.itemCount ? (seenCount / cart.itemCount) * 100 : 0}%` }} /></div>
      </div>

      <div className="tiles" role="list" aria-label="Items paid for">
        {cart.items.map((i) => {
          const n = Math.min(seen[i.productId] ?? 0, i.qty);
          const state = n >= i.qty ? "done" : n > 0 ? "part" : "";
          const isFocus = focus.includes(i.productId) && strict;
          return (
            <div key={i.productId} role="listitem" className={`tile ${state} ${isFocus ? "check" : ""}`}>
              <button className="tile-hit" disabled={!paid} aria-label={`Seen one ${i.name}: ${n} of ${i.qty}`} onClick={() => tap(i)}>
                {i.imageUrl ? <img className="tile-img" src={i.imageUrl} alt="" /> : <div className="tile-img" aria-hidden>{initial(i.name)}</div>}
                <div className="tile-name">{i.name}</div>
                <div className="tile-count">{n >= i.qty ? "All seen" : `${n} of ${i.qty} seen`}</div>
                {isFocus && <span className="tile-flag">Look closely</span>}
              </button>
              <span className="tile-qty">×{i.qty}</span>
              <span className="tile-tick" aria-hidden><CheckIcon /></span>
              {n > 0 && <button className="tile-undo" aria-label={`Undo one ${i.name}`} onClick={() => untap(i)}>↺</button>}
            </div>
          );
        })}
      </div>

      {paid && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row between"><h2 style={{ margin: 0 }}>Extra items (not paid)</h2><button className="secondary small" onClick={() => setAddMode((a) => !a)}>{addMode ? "Close" : "+ Add item"}</button></div>
          {addMode && (
            <div style={{ marginTop: 12 }}>
              <Scanner onCode={addItem} />
              <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); if (addCode.trim()) { addItem(addCode); setAddCode(""); } }}>
                <input className="grow" inputMode="numeric" placeholder="Barcode" aria-label="Barcode of extra item" value={addCode} onChange={(e) => setAddCode(e.target.value)} />
                <button>Add</button>
              </form>
            </div>
          )}
          {adds.length === 0 && !addMode && <p className="muted" style={{ margin: "8px 0 0" }}>Anything in the basket that isn&apos;t on the list.</p>}
          {adds.map((a) => (
            <div className="item" key={a.barcode}>
              <div className="grow item-name"><span className="num">{a.qty} ×</span> {a.name}</div>
              <div className="price" style={{ fontWeight: 800 }}>{naira(a.amountKobo)}</div>
              <button className="danger icon" aria-label={`Remove ${a.name}`} onClick={() => setAdds((x) => x.filter((y) => y.barcode !== a.barcode))}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="bar"><div className="row">
        <button className="ghost" onClick={reset}>Cancel</button>
        {paid && (
          <button className={`grow lg ${notSeen === 0 && adds.length === 0 ? "accent" : ""}`} disabled={busy} onClick={finish}>
            {notSeen === 0 && adds.length === 0 ? "All seen · let them go ✓" : notSeen > 0 ? `Finish · ${notSeen} not in basket` : "Finish with extra items"}
          </button>
        )}
      </div></div>
    </main>
  );
}
