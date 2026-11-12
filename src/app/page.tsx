"use client";
import { useEffect, useState, useCallback } from "react";
import Scanner from "@/components/Scanner";
import Thumb from "@/components/Thumb";
import { Brand, ScanIcon, BagIcon, Splash, AlertIcon } from "@/components/Icons";
import { api, naira } from "@/lib/client";

type Item = { productId: string; barcode: string; name: string; imageUrl: string | null; qty: number; unitPriceKobo: number; lineKobo: number };
type Cart = { id: string; status: string; totalKobo: number; itemCount: number; verifyWord: string | null; items: Item[] };
type StoreInfo = { name: string; slug: string };

const MIN_SPLASH_MS = 700; // keep the loading screen up long enough to read, never a flicker

export default function Shop() {
  const [store, setStore] = useState<StoreInfo | null | undefined>(undefined);
  const [root, setRoot] = useState(false);
  const [offline, setOffline] = useState(false);
  const [cart, setCart] = useState<Cart | null | undefined>(undefined);
  const [phone, setPhone] = useState("");
  const [manual, setManual] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(true);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const started = Date.now();
    (async () => {
      try {
      const [s, c] = await Promise.all([
        api<{ store: StoreInfo | null; root?: boolean }>("/api/store"),
        api<{ cart: Cart | null }>("/api/cart"),
      ]);
      await new Promise((r) => setTimeout(r, Math.max(0, MIN_SPLASH_MS - (Date.now() - started))));
      if (!s.ok || !s.data.store) { setRoot(!!s.data.root); setStore(null); return; }
      const cartNow = c.ok ? c.data.cart : null;
      if (cartNow && (cartNow.status === "PAID" || cartNow.status === "CHECKED")) { window.location.href = "/receipt"; return; }
      setStore(s.data.store);
      setCart(cartNow);
      } catch {
        setOffline(true); // no connection: don't leave the loading screen up forever
      }
    })();
  }, []);

  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 2500); };

  const add = useCallback(async (barcode: string) => {
    const r = await api<{ cart: Cart; error?: string }>("/api/cart/items", { method: "POST", body: JSON.stringify({ barcode }) });
    if (r.ok) {
      setCart(r.data.cart);
      const it = r.data.cart.items.find((i) => i.barcode === barcode.trim());
      flash(true, `Added: ${it?.name ?? barcode}`);
    } else if (r.data.error === "NOT_FOUND") flash(false, "Item not found. Please take this item to the exit desk.");
    else if (r.data.error === "CART_LOCKED") window.location.href = "/receipt";
    else flash(false, "Could not add item. Try again.");
  }, []);

  const setQty = async (productId: string, qty: number) => {
    const r = await api<{ cart: Cart }>("/api/cart/items", { method: "PATCH", body: JSON.stringify({ productId, qty }) });
    if (r.ok) setCart(r.data.cart);
  };

  const start = async () => {
    const r = await api<{ cart: Cart }>("/api/cart", { method: "POST", body: JSON.stringify({ phone }) });
    setCart(r.data.cart);
  };

  const pay = async () => {
    setPaying(true);
    const r = await api<{ url: string; error?: string }>("/api/checkout", { method: "POST" });
    if (r.ok) window.location.href = r.data.url;
    else { setPaying(false); flash(false, r.data.error === "EMPTY_CART" ? "Your cart is empty." : r.data.error === "PAYMENTS_NOT_CONFIGURED" ? "Payments are not available right now. Please pay at a payment point." : "Payment could not start. Try again."); }
  };

  if (offline) {
    return (
      <main>
        <div className="topbar"><Brand /></div>
        <div className="status amber"><AlertIcon /><div>Can&apos;t connect<small>Check your internet connection and try again.</small></div></div>
        <button className="block lg" onClick={() => location.reload()}>Try again</button>
      </main>
    );
  }
  if (store === undefined || (store && cart === undefined)) return <Splash store={store?.name} />;

  if (!store) {
    return (
      <main>
        <div className="topbar"><Brand /></div>
        <section className="hero">
          <span className="hero-scan"><ScanIcon /></span>
          <h1 className="display">{root ? <>Scan the QR at your <em>store.</em></> : <>Store not <em>found.</em></>}</h1>
          <p>{root ? "Each ScanExit store has its own QR code at the entrance. Scan it with your phone camera to start." : "This link doesn't match a ScanExit store. Scan the QR code at the store entrance again."}</p>
        </section>
        {root && <p className="fineprint"><a href="/owner">Store owner? Manage stores</a></p>}
      </main>
    );
  }

  if (!cart) {
    return (
      <main>
        <div className="topbar"><Brand sub={store.name} /></div>
        <section className="hero">
          <span className="hero-scan"><ScanIcon /></span>
          <h1 className="display">Skip the <em>queue.</em></h1>
          <p>Scan items as you shop, pay on your phone, and walk out.</p>
        </section>
        <div className="card">
          <ol className="steps">
            <li>Scan each item as you shop</li>
            <li>Pay on your phone</li>
            <li>At the exit, scan your pass at the ScanExit belt and place your items on it</li>
          </ol>
        </div>
        <form className="card" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <label className="field" htmlFor="phone">Your phone number</label>
          <input id="phone" inputMode="tel" autoComplete="tel" placeholder="080 1234 5678" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <p className="muted" style={{ margin: "8px 0 14px" }}>If your pass won&apos;t scan at the exit, your number finds your order. You&apos;ll get a word to go with it, so only you can claim it.</p>
          <button className="block lg">Start shopping</button>
        </form>
        <p className="fineprint">Baskets may be checked at the exit.</p>
      </main>
    );
  }

  return (
    <main>
      <div className="topbar">
        <Brand sub={store.name} />
        <button className={scanning ? "ghost small" : "small"} onClick={() => setScanning((s) => !s)}>
          <span className="btn-label">{scanning ? "Hide camera" : <><ScanIcon />Scan</>}</span>
        </button>
      </div>
      {cart.verifyWord && (
        <div className="word-card">
          <div><div className="eyebrow">Your word</div><div className="word">{cart.verifyWord}</div></div>
          <div className="muted">If your pass won&apos;t scan at the exit belt, use your phone number and this word.</div>
        </div>
      )}
      {msg && <div role="status" className={`toast floating ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
      {scanning && <div className="card"><Scanner onCode={add} /><p className="muted" style={{ margin: "10px 0 0", textAlign: "center" }}>Point the camera at the product barcode.</p></div>}
      <form className="card row" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { add(manual); setManual(""); } }}>
        <input className="grow" inputMode="numeric" aria-label="Barcode number" placeholder="Type a barcode number" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button type="submit" className="secondary">Add</button>
      </form>
      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Your basket</h2>
          <span className="muted num">{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}</span>
        </div>
        {cart.items.length === 0 && <div className="empty"><BagIcon />No items yet. Scan your first product.</div>}
        {cart.items.map((i) => (
          <div className="item" key={i.productId}>
            <Thumb src={i.imageUrl} alt={i.name} />
            <div className="grow">
              <div className="item-name">{i.name}</div>
              <div className="muted num">{naira(i.unitPriceKobo)} each</div>
              <div className="price" style={{ fontWeight: 800, marginTop: 2 }}>{naira(i.lineKobo)}</div>
            </div>
            <div className="qty">
              <button aria-label={`Remove one ${i.name}`} onClick={() => setQty(i.productId, i.qty - 1)}>−</button>
              <span className="n num">{i.qty}</span>
              <button aria-label={`Add one ${i.name}`} onClick={() => setQty(i.productId, i.qty + 1)}>+</button>
            </div>
          </div>
        ))}
      </div>
      <div className="bar"><div className="row between">
        <div><div className="muted num">Total · {cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}</div><div className="total">{naira(cart.totalKobo)}</div></div>
        <button className="accent lg" style={{ minWidth: 150 }} onClick={pay} disabled={paying || cart.itemCount === 0}>{paying ? "Opening…" : "Pay now"}</button>
      </div></div>
    </main>
  );
}
