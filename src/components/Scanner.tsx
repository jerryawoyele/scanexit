"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";

type Box = { x: number; y: number; w: number; h: number };

/**
 * Camera barcode/QR scanner. Calls onCode once per code (ignores repeats within `cooldownMs`).
 * When a code is read, four green corner brackets lock onto where it sits in the picture.
 * `fullscreen` fills its (positioned) parent edge to edge, for the shopper's cart page.
 */
export default function Scanner({ onCode, active = true, cooldownMs = 2000, fullscreen = false, hint }: {
  onCode: (code: string) => void; active?: boolean; cooldownMs?: number; fullscreen?: boolean; hint?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const cb = useRef(onCode);
  cb.current = onCode;
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<Box | null>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Map a point in the camera image to the element on screen (the video is shown object-fit: cover).
  const toScreen = (pts: { x: number; y: number }[]): Box | null => {
    const v = video.current, el = wrap.current;
    if (!v || !el || !v.videoWidth || !pts.length) return null;
    const cw = el.clientWidth, ch = el.clientHeight;
    const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
    const ox = (cw - v.videoWidth * s) / 2, oy = (ch - v.videoHeight * s) / 2;
    const xs = pts.map((p) => p.x * s + ox), ys = pts.map((p) => p.y * s + oy);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = Math.max(x1 - x0, 60);
    // 1D barcodes report points along one scan line: give the box a barcode-like height.
    if (y1 - y0 < w * 0.25) { const cy = (y0 + y1) / 2; y0 = cy - w * 0.3; y1 = cy + w * 0.3; }
    // 2D codes (QR) report the centres of their corner squares, so reach out to the real edge.
    const pad = pts.length >= 3 ? Math.max(14, (x1 - x0) * 0.2) : 14;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  };

  // Camera sessions share one <video>: a new one must wait until the previous one has fully
  // stopped, or the old session's late stop() would cut the new session's picture.
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const el = video.current;
    if (!active || !el) return;
    let controls: IScannerControls | undefined;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    const start = () => cancelled ? Promise.resolve() : reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        el,
        (result) => {
          if (!result) return;
          const code = result.getText();
          const now = Date.now();
          if (code === last.current.code && now - last.current.at < cooldownMs) return;
          last.current = { code, at: now };
          const box = toScreen((result.getResultPoints() ?? []).map((p) => ({ x: p.getX(), y: p.getY() })));
          setLock(box ?? { x: 0, y: 0, w: 0, h: 0 });
          clearTimeout(lockTimer.current);
          lockTimer.current = setTimeout(() => setLock(null), 1100);
          if (navigator.vibrate) navigator.vibrate(60);
          cb.current(code);
        }
      )
      .then((c) => { if (cancelled) c.stop(); else { controls = c; setError(null); } })
      .catch(() => { if (!cancelled) setError("Camera not available. Allow camera access, or type the barcode in your basket."); });
    const run = chain.current.then(start);
    chain.current = run.then(() => undefined, () => undefined);
    return () => { cancelled = true; controls?.stop(); clearTimeout(lockTimer.current); };
  }, [active, cooldownMs]);

  const locked = !!lock && lock.w > 0;
  return (
    <div ref={wrap} className={fullscreen ? "scanner scanner-full" : "scanner"}>
      <video ref={video} className="video" muted playsInline />
      {locked && (
        <div className="scan-lock" style={{ left: lock!.x, top: lock!.y, width: lock!.w, height: lock!.h }} aria-hidden>
          <span /><span /><span /><span />
        </div>
      )}
      {fullscreen && hint && !error && !lock && <div className="scanner-hint">{hint}</div>}
      {error && <div className={fullscreen ? "scanner-error" : "toast err"} style={fullscreen ? undefined : { marginTop: 8 }}>{error}</div>}
    </div>
  );
}
