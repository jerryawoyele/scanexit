"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Scanner from "@/components/Scanner";
import Thumb from "@/components/Thumb";
import { Brand, CheckIcon, AlertIcon, StopIcon, LockIcon, ScanIcon } from "@/components/Icons";
import { api, naira } from "@/lib/client";

type Line = { productId: string; barcode: string; name: string; imageUrl: string | null; unitPriceKobo: number; paid: number; seen: number };
type Run = {
  id: string; status: string; itemCount: number; totalKobo: number; phone: string | null;
  lines: Line[]; unknown: { barcode: string; count: number }[];
  seenCount: number; missing: number; extra: number; match: boolean;
};

const startMessages: Record<string, string> = {
  INVALID: "That isn't a valid ScanExit pass.",
  EXPIRED: "This pass has expired. Refresh the receipt page on your phone and scan again.",
  OTHER_STORE: "This pass is from a different store.",
  ALREADY_USED: "This pass has already been used.",
  NOT_PAID: "This order isn't paid yet. Finish payment on your phone first.",
  NOT_FOUND: "No order matches that phone number and word.",
};

export default function Belt() {
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [pinErr, setPinErr] = useState("");
  const [storeName, setStoreName] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [simulate, setSimulate] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<null | { kind: "GREEN" } | { kind: "DONE"; collectKobo: number; refundKobo: number; unknownCount: number }>(null);
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState({ open: false, phone: "", word: "" });
  const [extraCode, setExtraCode] = useState("");
  const scanLock = useRef(false);

  useEffect(() => {
    api<{ store: { name: string } | null }>("/api/store").then((r) => setStoreName(r.data.store?.name ?? null));
    const p = sessionStorage.getItem("sp_pin");
    if (p) { setPin(p); setAuthed(true); }
  }, []);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api("/api/belt/run", { pin });
    if (r.status === 401) { setPinErr("Wrong PIN."); setPin(""); return; }
    setPinErr(""); sessionStorage.setItem("sp_pin", pin); setAuthed(true);
  };
  const lock = () => { sessionStorage.removeItem("sp_pin"); setAuthed(false); reset(); };
  const reset = () => { setRunId(null); setRun(null); setResult(null); setMsg(null); setLookup({ open: false, phone: "", word: "" }); setExtraCode(""); scanLock.current = false; };

  // Live tally: poll the run while the belt is moving (the camera posts items to the server).
  const refresh = useCallback(async (id: string) => {
    const r = await api<{ run: Run; simulate: boolean }>(`/api/belt/run?id=${encodeURIComponent(id)}`, { pin });
    if (r.status === 401) { lock(); return; }
    if (r.ok && r.data.run) { setRun(r.data.run); setSimulate(r.data.simulate); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);
  useEffect(() => {
    if (!runId || result) return;
    refresh(runId);
    const t = setInterval(() => refresh(runId), 800);
    return () => clearInterval(t);
  }, [runId, result, refresh]);

  // Green result clears itself for the next customer.
  useEffect(() => {
    if (result?.kind !== "GREEN") return;
    const t = setTimeout(reset, 7000);
    return () => clearTimeout(t);
  }, [result]);

  const start = async (body: object) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    const r = await api<{ state: string; runId?: string }>("/api/belt/start", { method: "POST", pin, body: JSON.stringify(body) });
    setBusy(false);
    if (r.status === 401) { lock(); return; }
    if (r.data.state === "RUNNING" && r.data.runId) { setRunId(r.data.runId); setLookup({ open: false, phone: "", word: "" }); }
    else { setMsg(startMessages[r.data.state] ?? "Could not read that pass. Try again."); scanLock.current = false; }
  };
  const onPass = (code: string) => { if (scanLock.current || runId) return; scanLock.current = true; start({ token: code }); };

  const pass = async (barcode: string) => {
    if (!runId) return;
    await api("/api/belt/item", { method: "POST", pin, body: JSON.stringify({ runId, barcode }) });
    refresh(runId);
  };
  const passAll = async () => {
    if (!run) return;
    for (const l of run.lines) for (let i = l.seen; i < l.paid; i++) await pass(l.barcode);
  };
  const done = async () => {
    if (!runId) return;
    setBusy(true);
    const r = await api<{ result: "GREEN" | "RED"; run: Run }>("/api/belt/done", { method: "POST", pin, body: JSON.stringify({ runId }) });
    setBusy(false);
    if (r.ok) { setRun(r.data.run); if (r.data.result === "GREEN") setResult({ kind: "GREEN" }); }
  };
  const resolve = async (mode: "rerun" | "finish") => {
    if (!runId) return;
    setBusy(true);
    const r = await api<{ collectKobo: number; refundKobo: number; unknownCount: number }>("/api/belt/resolve", { method: "POST", pin, body: JSON.stringify({ runId, mode }) });
    setBusy(false);
    if (!r.ok) return;
    if (mode === "rerun") refresh(runId);
    else setResult({ kind: "DONE", ...r.data });
  };

  const top = (
    <div className="topbar">
      <Brand label="ScanExit check" sub={storeName} />
      <button className="ghost small" onClick={lock}><span className="btn-label"><LockIcon />Lock</span></button>
    </div>
  );

  if (!authed) {
    return (
      <main>
        <div className="topbar"><Brand label="ScanExit check" sub={storeName} /></div>
        <form className="card" onSubmit={unlock}>
          <h1 style={{ marginBottom: 6 }}>Start the exit check screen</h1>
          <p className="muted" style={{ marginTop: 0 }}>Staff: enter the store PIN once. The screen then stays ready for customers.</p>
          {pinErr && <div className="toast err">{pinErr}</div>}
          <label className="field" htmlFor="pin">Staff PIN</label>
          <input id="pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} style={{ marginBottom: 14, letterSpacing: ".3em", fontSize: 20 }} />
          <button className="block lg">Open exit check screen</button>
        </form>
      </main>
    );
  }

  // ---- results ----
  if (result?.kind === "GREEN") {
    return (
      <main className="belt">
        {top}
        <div className="status green belt-big"><CheckIcon /><div>All items match<small>Bag your items and go. Thank you for shopping!</small></div></div>
        <button className="block lg" onClick={reset}>Next customer</button>
      </main>
    );
  }
  if (result?.kind === "DONE") {
    const changed = result.collectKobo > 0 || result.refundKobo > 0 || result.unknownCount > 0;
    return (
      <main className="belt">
        {top}
        <div className={`status ${changed ? "amber" : "green"}`}>{changed ? <AlertIcon /> : <CheckIcon />}<div>Check complete{changed ? " with changes" : ""}<small>{changed ? "Settle the amounts below, then the customer can go." : "The customer can go."}</small></div></div>
        {result.collectKobo > 0 && <div className="card amount-card"><div><div className="eyebrow">Collect</div><div className="muted">Extra items · POS, transfer or cash</div></div><div className="total">{naira(result.collectKobo)}</div></div>}
        {result.refundKobo > 0 && <div className="card amount-card"><div><div className="eyebrow">Refund</div><div className="muted">Paid but not seen at the exit check</div></div><div className="total">{naira(result.refundKobo)}</div></div>}
        {result.unknownCount > 0 && <div className="card"><b>{result.unknownCount} item(s) not in the product list.</b> <span className="muted">Price them at a payment point.</span></div>}
        <button className="block lg" onClick={reset}>Next customer</button>
      </main>
    );
  }

  // ---- waiting for a pass ----
  if (!runId || !run) {
    return (
      <main className="belt">
        {top}
        <div className="belt-hero">
          <span className="belt-hero-icon"><ScanIcon /></span>
          <h1>Scan your ScanExit pass</h1>
          <p className="muted">Hold the QR code on your phone up to the camera.</p>
        </div>
        {msg && <div className="toast err">{msg}</div>}
        <div className="card"><Scanner onCode={onPass} /></div>
        {!lookup.open ? (
          <button className="ghost block" onClick={() => setLookup({ ...lookup, open: true })}>Pass won&apos;t scan? Use phone number and word</button>
        ) : (
          <form className="card" onSubmit={(e) => { e.preventDefault(); if (lookup.phone.trim() && lookup.word.trim()) start({ phone: lookup.phone, word: lookup.word }); }}>
            <label className="field" htmlFor="bphone">Phone number</label>
            <input id="bphone" inputMode="tel" placeholder="080 1234 5678" value={lookup.phone} onChange={(e) => setLookup({ ...lookup, phone: e.target.value })} style={{ marginBottom: 10 }} />
            <label className="field" htmlFor="bword">Your word</label>
            <input id="bword" autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="e.g. mango" value={lookup.word} onChange={(e) => setLookup({ ...lookup, word: e.target.value })} style={{ marginBottom: 12 }} />
            <button className="block" disabled={busy || !lookup.phone.trim() || !lookup.word.trim()}>Start check</button>
          </form>
        )}
      </main>
    );
  }

  // ---- belt running / red result ----
  const red = run.status === "MISMATCH";
  const paidTotal = run.lines.reduce((n, l) => n + l.paid, 0);
  const seenOnReceipt = run.lines.reduce((n, l) => n + Math.min(l.seen, l.paid), 0);
  const problems = run.lines.filter((l) => l.seen !== l.paid);

  return (
    <main className="belt">
      {top}
      {!red ? (
        <div className="status belt-run"><ScanIcon /><div className="grow">Place your items on the conveyor, one at a time<small>The camera checks each item against your receipt.</small></div>
          <div className="belt-count num"><b>{seenOnReceipt}</b>/{paidTotal}</div></div>
      ) : (
        <div className="status red"><StopIcon /><div>Items don&apos;t match the receipt<small>An attendant will sort this out. Please wait a moment.</small></div></div>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}><h2 style={{ margin: 0 }}>{red ? "What doesn't match" : "Your receipt"}</h2><span className="muted num">{run.itemCount} items · {naira(run.totalKobo)}</span></div>
        {(red ? problems : run.lines).map((l) => {
          const ok = l.seen >= l.paid && l.paid > 0;
          const extra = l.seen > l.paid;
          return (
            <div className={`item ${extra ? "belt-extra" : ""}`} key={l.productId}>
              <Thumb src={l.imageUrl} alt={l.name} />
              <div className="grow">
                <div className="item-name">{l.name}</div>
                <div className="muted num">
                  {l.paid === 0 ? "Not on the receipt" : `Paid ${l.paid}`}
                  {red && l.paid > l.seen && <span className="missing"> · {l.paid - l.seen} not seen</span>}
                  {extra && <span className="missing"> · {l.seen - l.paid} extra, {naira((l.seen - l.paid) * l.unitPriceKobo)}</span>}
                </div>
              </div>
              <div className={`belt-tick num ${ok && !extra ? "on" : ""}`}>{ok && !extra ? <CheckIcon /> : `${l.seen}/${l.paid}`}</div>
            </div>
          );
        })}
        {run.unknown.map((u) => (
          <div className="item belt-extra" key={u.barcode}>
            <div className="thumb" aria-hidden>?</div>
            <div className="grow"><div className="item-name">Unknown item</div><div className="muted num">Barcode {u.barcode} · not in the product list · {u.count}×</div></div>
          </div>
        ))}
      </div>

      {simulate && !red && (
        <div className="card belt-sim">
          <div className="eyebrow">Demo: simulated exit check camera</div>
          <p className="muted" style={{ margin: "4px 0 10px" }}>In a store, the camera reports each item by itself. Here, tap an item to pass it under the camera.</p>
          <div className="belt-sim-grid">
            {run.lines.filter((l) => l.paid > 0).map((l) => (
              <button key={l.productId} className="secondary small" onClick={() => pass(l.barcode)}>+ {l.name}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <button className="small" onClick={passAll}>Pass everything on the receipt</button>
            <form className="row grow" onSubmit={(e) => { e.preventDefault(); if (extraCode.trim()) { pass(extraCode.trim()); setExtraCode(""); } }}>
              <input className="grow" inputMode="numeric" placeholder="Extra item barcode" aria-label="Extra item barcode" value={extraCode} onChange={(e) => setExtraCode(e.target.value)} />
              <button className="ghost small">Pass</button>
            </form>
          </div>
        </div>
      )}

      <div className="bar"><div className="row">
        {!red ? (
          <>
            <button className="ghost" onClick={reset}>Cancel</button>
            <button className="grow lg accent" disabled={busy || run.seenCount === 0} onClick={done}>Done, check my items</button>
          </>
        ) : (
          <>
            <button className="ghost" disabled={busy} onClick={() => resolve("rerun")}>Pass items again</button>
            <button className="grow lg" disabled={busy} onClick={() => resolve("finish")}>Attendant: finish with changes</button>
          </>
        )}
      </div></div>
    </main>
  );
}
