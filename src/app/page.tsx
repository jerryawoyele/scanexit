"use client";
import { useEffect, useState, useCallback, useRef } from "react";
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
  const plusTip = useRef(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const dragFrom = useRef<{ y: number; base: number } | null>(null);
  // Drag the basket sheet up/down; on release it snaps open or closed.
  const sheetTravel = () => (typeof window === "undefined" ? 0 : Math.round(window.innerHeight * 0.72) - 92);
  const dragStart = (e: React.PointerEvent) => { dragFrom.current = { y: e.clientY, base: sheetOpen ? 0 : sheetTravel() }; };
  const dragMove = (e: React.PointerEvent) => {
    if (!dragFrom.current) return;
    const dy = e.clientY - dragFrom.current.y;
    if (Math.abs(dy) < 6 && drag === null) return;
    setDrag(Math.min(sheetTravel(), Math.max(0, dragFrom.current.base + dy)));
  };
  const dragEnd = () => {
    if (dragFrom.current && drag !== null) setSheetOpen(drag < sheetTravel() / 2);
    dragFrom.current = null; setDrag(null);
  };
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
    const r = await api<{ cart: Cart; error?: string; already?: boolean }>("/api/cart/items", { method: "POST", body: JSON.stringify({ barcode }) });
    if (r.ok) {
      setCart(r.data.cart);
      const it = r.data.cart.items.find((i) => i.barcode === barcode.trim());
      if (r.data.already) {
        // Rescanning an item already in the basket changes nothing. Explain it once, then stay quiet.
        let shown = false;
        try { shown = sessionStorage.getItem("sx_plus_tip") === "1"; sessionStorage.setItem("sx_plus_tip", "1"); } catch { /* storage off */ }
        if (!shown && !plusTip.current) flash(true, `${it?.name ?? "This item"} is already in your basket. Use + to add more.`);
        plusTip.current = true;
      } else flash(true, `Added: ${it?.name ?? barcode}`);
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
    <div className="shop">
      <Scanner fullscreen onCode={add} hint="Point at a product barcode" />

      <div className="shop-top">
        <div className="brand-pill"><Brand sub={store.name} /></div>
        {cart.verifyWord && <div className="word-pill" title="Your word"><small>Word</small>{cart.verifyWord}</div>}
      </div>
      {msg && <div role="status" className={`toast floating ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}

      <section className={`sheet ${sheetOpen ? "open" : ""}`} style={drag !== null ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined} aria-label="Your basket">
        <div className="sheet-head" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
          <button className="sheet-grab" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen} aria-label={sheetOpen ? "Close basket" : "Open basket"}><span /></button>
          <div className="row between sheet-sum">
            <button className="sheet-title" onClick={() => setSheetOpen((o) => !o)} aria-label={sheetOpen ? "Close basket" : "Open basket"}>
              <span className="total num">{naira(cart.totalKobo)}</span>
              <span className="muted num">{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"} in basket <span aria-hidden>{sheetOpen ? "▾" : "▴"}</span></span>
            </button>
            <button className="accent sheet-pay" onClick={pay} disabled={paying || cart.itemCount === 0}>{paying ? "Opening…" : "Pay now"}</button>
          </div>
        </div>
        <div className="sheet-body">
          <form className="row sheet-add" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { add(manual); setManual(""); } }}>
            <input className="grow" inputMode="numeric" aria-label="Barcode number" placeholder="Type a barcode number" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button type="submit" className="secondary small">Add</button>
          </form>
          {cart.items.length === 0 && <div className="empty"><BagIcon />No items yet. Point your camera at a barcode.</div>}
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
          {cart.verifyWord && (
            <p className="sheet-note">Your word is <b>{cart.verifyWord}</b>. If your pass won&apos;t scan at the exit belt, use your phone number and this word.</p>
          )}
        </div>
      </section>
    </div>
  );
}
