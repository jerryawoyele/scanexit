"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Scanner, { preloadReader } from "@/components/Scanner";
import Thumb from "@/components/Thumb";
import { Brand, ScanIcon, BagIcon, Splash, AlertIcon, ClockIcon } from "@/components/Icons";
import { api, naira } from "@/lib/client";

type Item = { productId: string; barcode: string; name: string; imageUrl: string | null; qty: number; unitPriceKobo: number; lineKobo: number };
type Cart = { id: string; status: string; totalKobo: number; itemCount: number; verifyWord: string | null; items: Item[] };
type StoreInfo = { name: string; slug: string };

const MIN_SPLASH_MS = 700; // keep the loading screen up long enough to read, never a flicker
const IDLE_MS = 10 * 60 * 1000; // unpaid shoppers re-enter their number after 10 minutes without activity (server decides)
type CartRes = { cart: Cart | null; expired?: boolean; secondsLeft?: number | null };

export default function Shop() {
  const [store, setStore] = useState<StoreInfo | null | undefined>(undefined);
  const [root, setRoot] = useState(false);
  const [offline, setOffline] = useState(false);
  const [cart, setCart] = useState<Cart | null | undefined>(undefined);
  const [phone, setPhone] = useState("");
  const [manual, setManual] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Products already given the "use + / −" hint (once per product).
  const hinted = useRef<Set<string> | null>(null);
  const [hl, setHl] = useState<string | null>(null);
  // Session timeout: when this shopper's unpaid session runs out (server is the judge).
  const [timedOut, setTimedOut] = useState(false);
  const deadline = useRef(Date.now() + IDLE_MS);
  const bump = () => { deadline.current = Date.now() + IDLE_MS; };
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
    preloadReader(); // ready by the time the camera opens
    const started = Date.now();
    (async () => {
      try {
      const [s, c] = await Promise.all([
        api<{ store: StoreInfo | null; root?: boolean }>("/api/store"),
        api<CartRes>("/api/cart"),
      ]);
      await new Promise((r) => setTimeout(r, Math.max(0, MIN_SPLASH_MS - (Date.now() - started))));
      if (!s.ok || !s.data.store) { setRoot(!!s.data.root); setStore(null); return; }
      const cartNow = c.ok ? c.data.cart : null;
      if (cartNow && (cartNow.status === "PAID" || cartNow.status === "CHECKED")) { window.location.href = "/receipt"; return; }
      setStore(s.data.store);
      setCart(cartNow);
      if (c.ok && c.data.expired) setTimedOut(true);
      if (c.ok && c.data.secondsLeft) deadline.current = Date.now() + c.data.secondsLeft * 1000;
      } catch {
        setOffline(true); // no connection: don't leave the loading screen up forever
      }
    })();
  }, []);

  const flash = (ok: boolean, text: string, ms = 2500) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), ms); };

  // Ask the server whether this session is still live; if it timed out, go back to the phone screen.
  const checkSession = useCallback(async () => {
    const r = await api<CartRes>("/api/cart");
    if (!r.ok) return;
    if (r.data.expired) { setCart(null); setPhone(""); setTimedOut(true); setSheetOpen(false); setMsg(null); return; }
    if (r.data.cart) {
      setCart(r.data.cart);
      if (r.data.secondsLeft) deadline.current = Date.now() + r.data.secondsLeft * 1000;
    }
  }, []);

  const shopping = !!cart && cart.status === "OPEN";
  useEffect(() => {
    if (!shopping) return;
    const tick = setInterval(() => { if (Date.now() > deadline.current) checkSession(); }, 15000);
    const onShow = () => { if (document.visibilityState === "visible") checkSession(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(tick); document.removeEventListener("visibilitychange", onShow); };
  }, [shopping, checkSession]);

  const add = useCallback(async (barcode: string) => {
    const r = await api<{ cart: Cart; error?: string; already?: boolean }>("/api/cart/items", { method: "POST", body: JSON.stringify({ barcode }) });
    if (r.ok) {
      bump();
      setCart(r.data.cart);
      const it = r.data.cart.items.find((i) => i.barcode === barcode.trim());
      if (r.data.already && it) {
        // Rescanning adds nothing: the first time for each product, show how to change the quantity.
        if (!hinted.current) {
          try { hinted.current = new Set(JSON.parse(sessionStorage.getItem("sx_hinted") ?? "[]")); } catch { hinted.current = new Set(); }
        }
        if (!hinted.current.has(it.productId)) {
          hinted.current.add(it.productId);
          try { sessionStorage.setItem("sx_hinted", JSON.stringify([...hinted.current])); } catch { /* storage off */ }
          flash(true, `${it.name} is already in your basket. Open your basket and use + or − to change how many.`, 4000);
          setHl(it.productId);
          setTimeout(() => setHl((h) => (h === it.productId ? null : h)), 4000);
        }
      } else flash(true, `Added: ${it?.name ?? barcode}`);
    } else if (r.data.error === "NOT_FOUND") flash(false, "Item not found. Please take this item to the exit desk.");
    else if (r.data.error === "NO_CART") checkSession();
    else if (r.data.error === "CART_LOCKED") window.location.href = "/receipt";
    else flash(false, "Could not add item. Try again.");
  }, [checkSession]);

  // + / − update the basket on screen instantly; the server is told a moment later (quick taps are
  // combined into one update). Prices and totals still come from the server when it answers.
  const qtyTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const qtyPending = useRef<Record<string, number>>({});
  const inFlight = useRef(0);
  const sendQty = async (productId: string) => {
    const qty = qtyPending.current[productId];
    delete qtyPending.current[productId];
    delete qtyTimers.current[productId];
    inFlight.current++;
    const r = await api<{ cart: Cart; error?: string }>("/api/cart/items", { method: "PATCH", body: JSON.stringify({ productId, qty }) });
    inFlight.current--;
    const idle = inFlight.current === 0 && Object.keys(qtyPending.current).length === 0;
    if (r.ok) bump();
    if (r.ok && idle) setCart(r.data.cart);
    else if (!r.ok) {
      if (r.data.error === "CART_LOCKED") { window.location.href = "/receipt"; return; }
      if (r.data.error === "NO_CART") { checkSession(); return; }
      flash(false, "Couldn't update the quantity. Try again.");
      const fresh = await api<{ cart: Cart | null }>("/api/cart");
      if (fresh.ok && fresh.data.cart) setCart(fresh.data.cart);
    }
  };
  const flushQty = async () => {
    const ids = Object.keys(qtyPending.current);
    ids.forEach((id) => clearTimeout(qtyTimers.current[id]));
    await Promise.all(ids.map((id) => sendQty(id)));
  };
  const setQty = (productId: string, qty: number) => {
    const n = Math.max(0, Math.min(99, Math.floor(qty)));
    setCart((c) => {
      if (!c) return c;
      const items = n === 0
        ? c.items.filter((i) => i.productId !== productId)
        : c.items.map((i) => (i.productId === productId ? { ...i, qty: n, lineKobo: n * i.unitPriceKobo } : i));
      return { ...c, items, itemCount: items.reduce((t, i) => t + i.qty, 0), totalKobo: items.reduce((t, i) => t + i.lineKobo, 0) };
    });
    qtyPending.current[productId] = n;
    clearTimeout(qtyTimers.current[productId]);
    qtyTimers.current[productId] = setTimeout(() => sendQty(productId), 350);
  };

  const start = async () => {
    setStarting(true);
    const r = await api<{ cart: Cart; restored?: boolean }>("/api/cart", { method: "POST", body: JSON.stringify({ phone }) });
    setStarting(false);
    setConfirming(false);
    if (!r.ok) { flash(false, "Couldn't start. Check your connection and try again."); return; }
    bump();
    setTimedOut(false);
    setCart(r.data.cart);
    if (r.data.restored && r.data.cart.itemCount > 0) flash(true, "Welcome back. Your basket is just as you left it.");
  };

  // Phone number check before starting: a quick confirm, because the number (with the word)
  // is how the order is found if the pass won't scan.
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [phoneErr, setPhoneErr] = useState("");
  const phoneInput = useRef<HTMLInputElement>(null);
  const digits = phone.replace(/\D/g, "");
  const prettyPhone = (() => {
    if (/^0\d{10}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    if (/^234\d{10}$/.test(digits)) return `+234 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
    return phone.trim();
  })();
  const askConfirm = () => {
    if (digits.length < 10 || digits.length > 14) { setPhoneErr("Enter your full phone number, e.g. 0801 234 5678."); phoneInput.current?.focus(); return; }
    setPhoneErr("");
    setConfirming(true);
  };
  const editNumber = () => { setConfirming(false); setTimeout(() => phoneInput.current?.focus(), 50); };
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") editNumber(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming]);

  const pay = async () => {
    setPaying(true);
    await flushQty();
    const r = await api<{ url: string; error?: string }>("/api/checkout", { method: "POST" });
    if (r.ok) window.location.href = r.data.url;
    else if (r.data.error === "NO_CART") { setPaying(false); checkSession(); }
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
        {msg && <div role="status" className={`toast floating ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
        {timedOut && (
          <div className="status amber" role="status"><ClockIcon /><div>Your session timed out<small>For your security, enter your phone number again after 10 minutes without activity. Use the same number to pick up your basket where you left off.</small></div></div>
        )}
        <section className="hero">
          <span className="hero-scan"><ScanIcon /></span>
          <h1 className="display">Skip the <em>queue.</em></h1>
          <p>Scan items as you shop, pay on your phone, and walk out.</p>
        </section>
        <div className="card">
          <ol className="steps">
            <li>Scan each item as you shop</li>
            <li>Pay on your phone</li>
            <li>At the exit, scan your pass at the exit check and place your items on it</li>
          </ol>
        </div>
        <form className="card" onSubmit={(e) => { e.preventDefault(); askConfirm(); }} noValidate>
          <label className="field" htmlFor="phone">Your phone number</label>
          <input id="phone" ref={phoneInput} inputMode="tel" autoComplete="tel" placeholder="080 1234 5678" value={phone}
            aria-invalid={!!phoneErr} aria-describedby={phoneErr ? "phone-err" : undefined}
            onChange={(e) => { setPhone(e.target.value); if (phoneErr) setPhoneErr(""); }} />
          {phoneErr && <p id="phone-err" className="field-err">{phoneErr}</p>}
          <p className="muted" style={{ margin: "8px 0 14px" }}>If your pass won&apos;t scan at the exit, your number finds your order. You&apos;ll get a word to go with it, so only you can claim it.</p>
          <button className="block lg">Start shopping</button>
        </form>
        <p className="fineprint">Baskets may be checked at the exit.</p>
        {confirming && (
          <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) editNumber(); }}>
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-h" aria-describedby="confirm-d">
              <div className="modal-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
              </div>
              <h2 id="confirm-h">Is this your number?</h2>
              <div className="modal-phone num">{prettyPhone}</div>
              <p id="confirm-d" className="muted">Make sure it&apos;s right. With your word, it&apos;s how we find your order if your pass won&apos;t scan at the exit.</p>
              <div className="modal-actions">
                <button className="ghost lg" onClick={editNumber}>Edit number</button>
                <button className="lg" onClick={start} disabled={starting} autoFocus>{starting ? "Starting…" : "Continue"}</button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <div className="shop">
      <Scanner fullscreen onCode={add} hint="Point at a barcode" />

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
            <div className={`item ${hl === i.productId ? "hl" : ""}`} key={i.productId}>
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
            <p className="sheet-note">Your word is <b>{cart.verifyWord}</b>. If your pass won&apos;t scan at the exit check, use your phone number and this word.</p>
          )}
        </div>
      </section>
    </div>
  );
}
