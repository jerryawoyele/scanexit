"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Thumb from "@/components/Thumb";
import { Brand, CheckIcon, ClockIcon, AlertIcon, StopIcon, Splash } from "@/components/Icons";
import { api, naira } from "@/lib/client";

type Item = { productId: string; name: string; imageUrl: string | null; qty: number; lineKobo: number };
type Cart = { status: string; totalKobo: number; itemCount: number; verifyWord: string | null; items: Item[] };

export default function Receipt() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  // Demo: the simulated exit belt, ticking items off one by one.
  const [belt, setBelt] = useState<null | { seen: number; total: number }>(null);

  const runDemoBelt = async () => {
    if (!cart || belt) return;
    const total = cart.items.reduce((n, i) => n + i.qty, 0);
    setBelt({ seen: 0, total });
    for (let n = 1; n <= total; n++) { await new Promise((r) => setTimeout(r, 550)); setBelt({ seen: n, total }); }
    await new Promise((r) => setTimeout(r, 400));
    const r = await api<{ cart: Cart }>("/api/dev/exit", { method: "POST" });
    if (r.ok) setCart(r.data.cart);
    setBelt(null);
  };

  useEffect(() => {
    api<{ store: { name: string } | null }>("/api/store").then((r) => setStoreName(r.data.store?.name ?? null));
  }, []);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const r = await api<{ cart: Cart; qr: string | null; demo?: boolean; error?: string }>("/api/receipt");
      if (stop) return;
      if (!r.ok) { setError("No order found on this phone."); return; }
      setCart(r.data.cart); setQr(r.data.qr); setDemo(!!r.data.demo);
      const s = r.data.cart.status;
      // Poll while waiting for payment; refresh the QR every 10 minutes so it never expires on screen.
      timer = setTimeout(load, s === "PENDING_PAYMENT" ? 3000 : s === "PAID" ? 10 * 60 * 1000 : 30000);
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  if (error) return (
    <main>
      <div className="topbar"><Brand sub={storeName} /></div>
      <div className="status red"><StopIcon /><div>{error}</div></div>
      <a href="/"><button className="block lg">Start shopping</button></a>
    </main>
  );
  if (!cart) return <Splash store={storeName} />;

  return (
    <main>
      <div className="topbar"><Brand sub={storeName} /><span className="eyebrow">Receipt</span></div>
      {cart.status === "PENDING_PAYMENT" && (
        <div className="status amber"><ClockIcon /><div>Confirming your payment…<small>This page updates by itself.</small></div></div>
      )}
      {cart.status === "PAID" && qr && (
        <div className="status green"><CheckIcon /><div>{demo ? "Paid · demo payment" : "Paid"}<small>{demo ? "This payment was simulated for the demo. No real money was charged." : "Scan this at the ScanExit belt, then place your items on it"}</small></div></div>
      )}
      {cart.status === "PAID" && demo && (
        <div className="card demo-next">
          <div className="eyebrow">Demo · next step</div>
          <h2 style={{ margin: "6px 0 6px" }}>Now, the exit belt</h2>
          {!belt ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>In a store, you&apos;d scan this pass at the ScanExit belt and place your items on it. Its AI camera checks each one against what you paid for.</p>
              <button className="block lg accent" onClick={runDemoBelt}>Try the exit belt</button>
            </>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>Your items are passing the camera…</p>
              <div className="demo-belt-bar"><span style={{ width: `${(belt.seen / Math.max(1, belt.total)) * 100}%` }} /></div>
              {(() => { let left = belt.seen; return cart.items.map((i) => { const seen = Math.min(i.qty, left); left -= seen; const ok = seen >= i.qty; return (
                <div className="item" key={i.productId}>
                  <Thumb src={i.imageUrl} alt={i.name} />
                  <div className="grow item-name">{i.name}<div className="muted num" style={{ fontWeight: 500 }}>Paid {i.qty}</div></div>
                  <div className={`belt-tick num ${ok ? "on" : ""}`}>{ok ? <CheckIcon /> : `${seen}/${i.qty}`}</div>
                </div>); }); })()}
            </>
          )}
        </div>
      )}
      {cart.status === "PAID" && qr && (
        <>
          <div className="ticket">
            <div className="ticket-qr"><img src={qr} alt="Receipt QR code" /></div>
            <div className="ticket-cut" />
            <div className="ticket-sum">
              <div><div className="big">{cart.itemCount}</div><div className="muted">item{cart.itemCount === 1 ? "" : "s"} in your basket</div></div>
              <div style={{ textAlign: "right" }}><div className="eyebrow">{demo ? "Demo payment" : "Paid"}</div><div className="total">{naira(cart.totalKobo)}</div></div>
            </div>
          </div>
          <p className="fineprint" style={{ marginBottom: 16 }}>Keep this screen open. The code refreshes by itself and works once.</p>
          {cart.verifyWord && (
            <div className="word-card">
              <div><div className="eyebrow">Your word</div><div className="word">{cart.verifyWord}</div></div>
              <div className="muted">If your pass won&apos;t scan, use your phone number and this word at the belt.</div>
            </div>
          )}
        </>
      )}
      {cart.status === "CHECKED" && (
        <div className="status green"><CheckIcon /><div>{demo ? "All items match" : "All done"}<small>{demo ? "The belt checked every item. You're free to go!" : "Checked at the exit. Thank you for shopping!"}</small></div></div>
      )}
      {cart.status === "CHECKED" && demo && (
        <div className="card demo-next">
          <div className="eyebrow">That&apos;s the whole ScanExit trip</div>
          <ol className="steps" style={{ marginTop: 8 }}>
            <li>You scanned items with your phone</li>
            <li>You paid on your phone</li>
            <li>The exit belt checked every item</li>
          </ol>
          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            <a href="/" onClick={async (e) => { e.preventDefault(); await fetch("/api/cart", { method: "DELETE" }); location.href = "/"; }}><button className="block lg">Start a new demo trip</button></a>
            <a href="https://scanexit.com"><button className="block lg ghost">Back to scanexit.com</button></a>
          </div>
        </div>
      )}
      {cart.status === "OPEN" && (
        <div className="status amber"><AlertIcon /><div>Payment not completed<small>Nothing was charged. Go back to your cart to try again.</small></div></div>
      )}
      {cart.status === "OPEN" && <a href="/"><button className="block lg" style={{ marginBottom: 12 }}>Back to cart</button></a>}
      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}><h2 style={{ margin: 0 }}>Your items</h2><span className="muted num">{naira(cart.totalKobo)}</span></div>
        {cart.items.map((i) => (
          <div className="item" key={i.productId}>
            <Thumb src={i.imageUrl} alt={i.name} />
            <div className="grow item-name">{i.name}<div className="muted num" style={{ fontWeight: 500 }}>Qty {i.qty}</div></div>
            <div className="price" style={{ fontWeight: 800 }}>{naira(i.lineKobo)}</div>
          </div>
        ))}
      </div>
      {cart.status === "PENDING_PAYMENT" && <a href="/"><button className="ghost block">Edit cart</button></a>}
      {cart.status === "CHECKED" && !demo && <a href="/" onClick={async (e) => { e.preventDefault(); await fetch("/api/cart", { method: "DELETE" }); location.href = "/"; }}><button className="block lg">New shopping trip</button></a>}
    </main>
  );
}
