"use client";
import { useEffect, useState } from "react";
import Scanner from "@/components/Scanner";
import Thumb from "@/components/Thumb";
import { Brand, CheckIcon, AlertIcon, StopIcon, LockIcon } from "@/components/Icons";
import { api, naira } from "@/lib/client";

type Item = { productId: string; barcode: string; name: string; imageUrl: string | null; qty: number; unitPriceKobo: number; lineKobo: number };
type Cart = { id: string; phone: string | null; status: string; totalKobo: number; itemCount: number; items: Item[] };
type Lookup =
  | { state: "PAID" | "NOT_PAID"; cart: Cart; focus: string[]; strict: boolean; reasons: string[] }
  | { state: "INVALID" | "EXPIRED" | "NOT_FOUND" }
  | { state: "ALREADY_USED"; checkedAt: string };
type Adj = { type: "ADD" | "REMOVE"; barcode: string; name: string; qty: number; amountKobo: number };

const messages: Record<string, string> = {
  INVALID: "Not a valid ScanExit receipt",
  EXPIRED: "Receipt QR expired. Ask the customer to refresh their receipt page",
  NOT_FOUND: "No order matches that phone number and word",
  OTHER_STORE: "This receipt is from a different store",
  ALREADY_USED: "This receipt has already been checked",
};

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
  const [missing, setMissing] = useState<Record<string, number>>({});
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

  const reset = () => { setRes(null); setAdds([]); setMissing({}); setAddMode(false); setDone(null); setPhone(""); setWord(""); };

  const lookup = async (body: object) => {
    setBusy(true);
    const r = await api<Lookup>("/api/checker/lookup", { method: "POST", body: JSON.stringify(body), pin });
    setBusy(false);
    if (r.status === 401) { sessionStorage.removeItem("sp_pin"); setAuthed(false); setPinErr("Staff PIN no longer valid. Enter it again."); return; }
    setAdds([]); setMissing({}); setDone(null); setRes(r.data);
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
    const removes: Adj[] = res.cart.items
      .filter((i) => (missing[i.productId] ?? 0) > 0)
      .map((i) => ({ type: "REMOVE", barcode: i.barcode, name: i.name, qty: missing[i.productId], amountKobo: missing[i.productId] * i.unitPriceKobo }));
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
        <div className="topbar"><Brand label="Manual check" sub={storeName} /></div>
        <form className="card" onSubmit={unlock}>
          <h1 style={{ marginBottom: 6 }}>Staff sign-in</h1>
          <p className="muted" style={{ marginTop: 0 }}>Enter the staff PIN to open the manual check, the backup for when the exit check system is down.</p>
          {pinErr && <div className="toast err">{pinErr}</div>}
          <label className="field" htmlFor="pin">Staff PIN</label>
          <input id="pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} style={{ marginBottom: 14, letterSpacing: ".3em", fontSize: 20 }} />
          <button className="block lg">Open checker</button>
        </form>
      </main>
    );
  }

  if (done) {
    const changed = done.collectKobo > 0 || done.refundKobo > 0;
    return (
      <main>
        <div className="topbar"><Brand label="Manual check" sub={storeName} />{lockBtn}</div>
        <div className={`status ${changed ? "amber" : "green"}`}>
          {changed ? <AlertIcon /> : <CheckIcon />}
          <div>{changed ? "Check complete with changes" : "Approved"}<small>{changed ? "Settle the amounts below before the customer leaves." : "The customer can go."}</small></div>
        </div>
        {done.collectKobo > 0 && <div className="card amount-card"><div><div className="eyebrow">Collect</div><div className="muted">Added items · POS, transfer or cash</div></div><div className="total">{naira(done.collectKobo)}</div></div>}
        {done.refundKobo > 0 && <div className="card amount-card"><div><div className="eyebrow">Refund</div><div className="muted">Paid but not in the basket</div></div><div className="total">{naira(done.refundKobo)}</div></div>}
        <button className="block lg" onClick={reset}>Next customer</button>
      </main>
    );
  }

  if (!res) {
    return (
      <main>
        <div className="topbar"><Brand label="Manual check" sub={storeName} />{lockBtn}</div>
        <div className="card"><Scanner onCode={(code) => { if (!busy) lookup({ token: code }); }} /><p className="muted" style={{ margin: "10px 0 0", textAlign: "center" }}>Backup for when the exit check system is down: scan the customer&apos;s pass.</p></div>
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (phone.trim() && word.trim()) lookup({ phone, word }); }}>
          <h2>Got disconnected? Find the order</h2>
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
        <div className="topbar"><Brand label="Manual check" sub={storeName} />{lockBtn}</div>
        <div className="status red"><StopIcon /><div>{messages[res.state]}<small>Do not let the basket through without a valid receipt.</small></div></div>
        <button className="block lg" onClick={reset}>Back</button>
      </main>
    );
  }

  const { cart, focus, strict, reasons } = res;
  const paid = res.state === "PAID";
  const changes = adds.length > 0 || Object.values(missing).some((n) => n > 0);

  return (
    <main>
      <div className={`status ${paid ? (strict ? "amber" : "green") : "red"}`}>
        {paid ? (strict ? <AlertIcon /> : <CheckIcon />) : <StopIcon />}
        <div className="grow">
          {paid ? (strict ? "Paid · do a full check" : "Paid · quick check") : "Not paid yet"}
          {paid && strict && <div className="reasons">{reasons.map((r) => <span key={r}>{r}</span>)}</div>}
          {!paid && <small>Ask the customer to finish payment on their phone, or take their shopping to a payment point.</small>}
        </div>
      </div>

      <div className="card row between">
        <div><div className="big">{cart.itemCount}</div><div className="muted">items to count</div></div>
        <div style={{ textAlign: "right" }}><div className="total">{naira(cart.totalKobo)}</div><div className="muted num">{cart.phone ?? "no phone"}</div></div>
      </div>

      <div className="card">
        <h2>Basket</h2>
        {cart.items.map((i) => {
          const miss = missing[i.productId] ?? 0;
          const isFocus = focus.includes(i.productId);
          return (
            <div key={i.productId} className={`item ${isFocus ? "focus" : ""}`}>
              <Thumb src={i.imageUrl} alt={i.name} />
              <div className="grow">
                <div className="item-name"><span className="num">{i.qty} ×</span> {i.name}</div>
                {isFocus && <span className="tag">Check this</span>}
                {miss > 0 && <div className="missing">{miss} missing</div>}
              </div>
              {paid && (
                <div className="row" style={{ gap: 6 }}>
                  {miss > 0 && <button className="secondary icon" aria-label={`Undo missing ${i.name}`} onClick={() => setMissing((m) => ({ ...m, [i.productId]: miss - 1 }))}>↺</button>}
                  <button className="danger icon" aria-label={`Mark one ${i.name} missing`} disabled={miss >= i.qty} onClick={() => setMissing((m) => ({ ...m, [i.productId]: miss + 1 }))}>−</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {paid && (
        <div className="card">
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
          {adds.length === 0 && !addMode && <p className="muted" style={{ margin: "8px 0 0" }}>Anything in the bag that isn&apos;t on the list.</p>}
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
        {paid && <button className={`grow lg ${changes ? "" : "accent"}`} disabled={busy} onClick={finish}>{changes ? "Finish with changes" : "Approve ✓"}</button>}
      </div></div>
    </main>
  );
}
