"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import type { ScanReply, ScanRequest } from "./scan.worker";

type Box = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

// The phone's own barcode detector (Chrome on Android, and others): fastest on a live camera feed.
interface DetectedBarcode { rawValue: string; format?: string; cornerPoints?: Pt[]; boundingBox?: DOMRectReadOnly }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
declare global {
  interface Window {
    BarcodeDetector?: { new (opts?: { formats: string[] }): BarcodeDetectorLike; getSupportedFormats?: () => Promise<string[]> };
  }
}
// Camera controls that browsers support but TypeScript's DOM types don't list yet.
type CamCaps = MediaTrackCapabilities & { zoom?: { min: number; max: number }; torch?: boolean; focusMode?: string[] };
type CamSet = MediaTrackConstraintSet & { zoom?: number; torch?: boolean; focusMode?: string; pointsOfInterest?: Pt[] };

// Product barcodes (EAN/UPC/Code 128) plus QR for ScanExit passes.
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
const ZXING_FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE];

// Phones can't focus closer than ~10-15 cm. Zooming in makes people hold the phone further back,
// where the lens is sharp, while the barcode still fills the picture.
const SHOP_ZOOM = 1.8;

/** Phones without a built-in detector (iPhones) need the WebAssembly reader: start downloading it early. */
export function preloadReader() {
  if (typeof window === "undefined" || window.BarcodeDetector) return;
  fetch("/zxing_reader.wasm").catch(() => undefined);
}

/**
 * Camera barcode/QR scanner. Calls onCode once per code (ignores repeats within `cooldownMs`).
 * When a code is seen, four green corner brackets lock onto where it sits in the picture.
 * `fullscreen` fills its (positioned) parent edge to edge, for the shopper's cart page.
 *
 * Reading, fastest first: the phone's built-in detector; otherwise ZXing in WebAssembly on a
 * background thread (iPhones); the JavaScript ZXing reader only if neither is available.
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
  const track = useRef<MediaStreamTrack | null>(null);
  const caps = useRef<CamCaps>({});
  const [torch, setTorch] = useState<boolean | null>(null); // null: this camera has no flashlight
  const [focus, setFocus] = useState<{ x: number; y: number; k: number } | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Where the camera image sits inside the element (the video is shown object-fit: cover).
  const fit = () => {
    const v = video.current, el = wrap.current;
    if (!v || !el || !v.videoWidth) return null;
    const cw = el.clientWidth, ch = el.clientHeight;
    const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
    return { s, ox: (cw - v.videoWidth * s) / 2, oy: (ch - v.videoHeight * s) / 2, cw, ch, vw: v.videoWidth, vh: v.videoHeight };
  };

  // Map points in the camera image to the element on screen.
  const toScreen = (pts: Pt[]): Box | null => {
    const f = fit();
    if (!f || !pts.length) return null;
    const xs = pts.map((p) => p.x * f.s + f.ox), ys = pts.map((p) => p.y * f.s + f.oy);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = Math.max(x1 - x0, 60);
    // Some readers report 1D barcodes as points along one scan line: give the box a barcode-like height.
    if (y1 - y0 < w * 0.25) { const cy = (y0 + y1) / 2; y0 = cy - w * 0.3; y1 = cy + w * 0.3; }
    return { x: x0 - 12, y: y0 - 12, w: x1 - x0 + 24, h: y1 - y0 + 24 };
  };

  const found = (code: string, pts: Pt[], qrCentres = false) => {
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < cooldownMs) return;
    last.current = { code, at: now };
    let box = toScreen(pts);
    if (box && qrCentres) { const g = box.w * 0.16; box = { x: box.x - g, y: box.y - g, w: box.w + 2 * g, h: box.h + 2 * g }; }
    setLock(box ?? { x: 0, y: 0, w: 0, h: 0 });
    clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => setLock(null), 1100);
    if (navigator.vibrate) navigator.vibrate(60);
    cb.current(code);
  };

  const apply = async (set: CamSet) => {
    try { await track.current?.applyConstraints({ advanced: [set as MediaTrackConstraintSet] }); return true; } catch { return false; }
  };

  const toggleTorch = async () => {
    if (torch === null) return;
    if (await apply({ torch: !torch })) setTorch(!torch);
  };

  // Tap the picture to focus there (where the camera supports it).
  const tapFocus = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== video.current) return;
    const f = fit(), el = wrap.current;
    if (!f || !el || !caps.current.focusMode?.length) return;
    const r = el.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    setFocus({ x: sx, y: sy, k: Date.now() });
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => setFocus(null), 900);
    const pt = { x: Math.min(1, Math.max(0, (sx - f.ox) / (f.vw * f.s))), y: Math.min(1, Math.max(0, (sy - f.oy) / (f.vh * f.s))) };
    const modes = caps.current.focusMode;
    await apply({ pointsOfInterest: [pt], ...(modes.includes("single-shot") ? { focusMode: "single-shot" } : {}) });
    // Back to following the subject once it has focused.
    if (modes.includes("continuous")) setTimeout(() => { void apply({ focusMode: "continuous" }); }, 1500);
  };

  // Camera sessions share one <video>: a new one waits until the previous one has fully stopped.
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const el = video.current;
    if (!active || !el) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let controls: IScannerControls | undefined;
    let worker: Worker | null = null;
    let raf = 0;
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };

    // Run on every new camera frame (falls back to screen refreshes).
    const nextFrame = (fn: () => void) => {
      const v = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(fn);
      else raf = requestAnimationFrame(fn);
    };

    const open = async (constraints: MediaTrackConstraints) =>
      navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });

    const start = async () => {
      if (cancelled) return;
      try {
        stream = await open({ facingMode: { ideal: "environment" }, ...size });
        // iPhones with several back lenses can hand us the ultra-wide or a lens-switching "virtual"
        // camera: prefer the plain main camera, which focuses and reads barcodes best.
        const label = stream.getVideoTracks()[0]?.label ?? "";
        if (/ultra|dual|triple/i.test(label)) {
          const main = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === "videoinput" && /^back camera$/i.test(d.label));
          if (main) {
            const s2 = await open({ deviceId: { exact: main.deviceId }, ...size }).catch(() => null);
            if (s2) { stream.getTracks().forEach((t) => t.stop()); stream = s2; }
          }
        }
      } catch {
        if (!cancelled) setError("Camera not available. Allow camera access, or type the barcode in your basket.");
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

      const t = stream.getVideoTracks()[0];
      track.current = t;
      const c: CamCaps = (t.getCapabilities?.() as CamCaps | undefined) ?? {};
      caps.current = c;
      const set: CamSet = {};
      if (c.focusMode?.includes("continuous")) set.focusMode = "continuous"; // keep focusing as the phone moves
      if (fullscreen && c.zoom && c.zoom.max >= 1.4) set.zoom = Math.max(c.zoom.min, Math.min(SHOP_ZOOM, c.zoom.max));
      if (Object.keys(set).length) await apply(set);
      setTorch(c.torch ? false : null);

      el.srcObject = stream;
      el.muted = true;
      await el.play().catch(() => undefined);
      setError(null);

      // 1) Built-in detector.
      let detector: BarcodeDetectorLike | null = null;
      if (window.BarcodeDetector) {
        try {
          const supported = (await window.BarcodeDetector.getSupportedFormats?.()) ?? NATIVE_FORMATS;
          const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
          if (formats.length) detector = new window.BarcodeDetector({ formats });
        } catch { detector = null; }
      }
      if (detector) {
        const loop = async () => {
          if (cancelled) return;
          if (el.readyState >= 2) {
            try {
              const codes = await detector!.detect(el);
              const d = codes.find((x) => x.rawValue);
              if (d && !cancelled) {
                const pts = d.cornerPoints?.length ? d.cornerPoints
                  : d.boundingBox ? [{ x: d.boundingBox.x, y: d.boundingBox.y }, { x: d.boundingBox.right, y: d.boundingBox.bottom }] : [];
                found(d.rawValue, pts);
              }
            } catch { /* frame not ready */ }
          }
          nextFrame(loop);
        };
        loop();
        return;
      }

      // 2) ZXing in WebAssembly, on a background thread.
      if (await startWasm()) return;

      // 3) Last resort: ZXing in JavaScript.
      startJs();
    };

    // Each frame: read the middle of what's on screen at full detail (where people aim), and every
    // third frame the whole picture, scaled down, so a barcode near the edge is still caught.
    const startWasm = () => new Promise<boolean>((resolve) => {
      if (cancelled) return resolve(true);
      let w: Worker;
      try { w = new Worker(new URL("./scan.worker.ts", import.meta.url)); } catch { return resolve(false); }
      worker = w;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) { w.terminate(); worker = null; return resolve(false); }
      let n = 0, id = 0, settled = false;
      const settle = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };

      const send = () => {
        if (cancelled) return;
        const f = fit();
        if (!f || el.readyState < 2) { nextFrame(send); return; }
        // The part of the camera image that is visible on screen.
        const visW = Math.min(f.vw, f.cw / f.s), visH = Math.min(f.vh, f.ch / f.s);
        const visX = (f.vw - visW) / 2, visY = (f.vh - visH) / 2;
        let sx: number, sy: number, sw: number, sh: number, max: number;
        if (++n % 3 === 0) { sx = 0; sy = 0; sw = f.vw; sh = f.vh; max = 1280; }
        else { sw = visW * 0.92; sh = visH * 0.46; sx = visX + (visW - sw) / 2; sy = visY + (visH - sh) / 2; max = 1100; }
        const scale = Math.min(1, max / Math.max(sw, sh));
        canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
        ctx.drawImage(el, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        w.postMessage({ id: ++id, image, ox: sx, oy: sy, scale } satisfies ScanRequest, [image.data.buffer]);
      };

      w.onmessage = (e: MessageEvent<ScanReply>) => {
        if (cancelled) return;
        const r = e.data;
        if (r.failed && !settled) { w.terminate(); worker = null; return settle(false); } // reader couldn't load
        settle(true);
        if (r.code) found(r.code, r.pts ?? [], r.qr);
        nextFrame(send);
      };
      w.onerror = () => { w.terminate(); worker = null; settle(false); };
      send();
    });

    const startJs = async () => {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 400 });
      try {
        const c = await reader.decodeFromVideoElement(el, (result) => {
          if (!result || cancelled) return;
          const pts = (result.getResultPoints() ?? []).map((p) => ({ x: p.getX(), y: p.getY() }));
          found(result.getText(), pts, result.getBarcodeFormat() === BarcodeFormat.QR_CODE);
        });
        if (cancelled) c.stop(); else controls = c;
      } catch {
        if (!cancelled) setError("Camera not available. Allow camera access, or type the barcode in your basket.");
      }
    };

    const run = chain.current.then(start);
    chain.current = run.then(() => undefined, () => undefined);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(lockTimer.current);
      worker?.terminate();
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      if (el.srcObject === stream) el.srcObject = null;
      track.current = null;
      setTorch(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cooldownMs]);

  const locked = !!lock && lock.w > 0;
  return (
    <div ref={wrap} className={fullscreen ? "scanner scanner-full" : "scanner"} onPointerDown={tapFocus}>
      <video ref={video} className="video" muted playsInline autoPlay />
      {locked && (
        <div className="scan-lock" style={{ left: lock!.x, top: lock!.y, width: lock!.w, height: lock!.h }} aria-hidden>
          <span /><span /><span /><span />
        </div>
      )}
      {focus && <div key={focus.k} className="scan-focus" style={{ left: focus.x, top: focus.y }} aria-hidden />}
      {fullscreen && hint && !error && !lock && <div className="scanner-hint">{hint}<small>Hold it about a hand-length away</small></div>}
      {torch !== null && !error && (
        <button type="button" className={`scan-torch ${torch ? "on" : ""}`} onClick={toggleTorch} aria-pressed={torch} aria-label={torch ? "Turn flashlight off" : "Turn flashlight on"}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 2h8v4l-2 4v11a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V10L8 6z" /><path d="M8 6h8" /><path d="M12 13v2" /></svg>
        </button>
      )}
      {error && <div className={fullscreen ? "scanner-error" : "toast err"} style={fullscreen ? undefined : { marginTop: 8 }}>{error}</div>}
    </div>
  );
}
