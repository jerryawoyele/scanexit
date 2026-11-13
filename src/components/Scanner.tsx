"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

type Box = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

// The phone's own barcode detector (Chrome on Android, and others): much faster and more
// reliable on a live, moving camera feed than decoding in JavaScript.
interface DetectedBarcode { rawValue: string; cornerPoints?: Pt[]; boundingBox?: DOMRectReadOnly }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
declare global {
  interface Window {
    BarcodeDetector?: { new (opts?: { formats: string[] }): BarcodeDetectorLike; getSupportedFormats?: () => Promise<string[]> };
  }
}

// Product barcodes (EAN/UPC/Code 128) plus QR for ScanExit passes.
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
const ZXING_FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE];

/**
 * Camera barcode/QR scanner. Calls onCode once per code (ignores repeats within `cooldownMs`).
 * When a code is seen, four green corner brackets lock onto where it sits in the picture.
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

  // Map points in the camera image to the element on screen (the video is shown object-fit: cover).
  const toScreen = (pts: Pt[]): Box | null => {
    const v = video.current, el = wrap.current;
    if (!v || !el || !v.videoWidth || !pts.length) return null;
    const cw = el.clientWidth, ch = el.clientHeight;
    const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
    const ox = (cw - v.videoWidth * s) / 2, oy = (ch - v.videoHeight * s) / 2;
    const xs = pts.map((p) => p.x * s + ox), ys = pts.map((p) => p.y * s + oy);
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

  // Camera sessions share one <video>: a new one waits until the previous one has fully stopped.
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const el = video.current;
    if (!active || !el) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let controls: IScannerControls | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const start = async () => {
      if (cancelled) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch {
        if (!cancelled) setError("Camera not available. Allow camera access, or type the barcode in your basket.");
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      const track = stream.getVideoTracks()[0];
      // Keep the lens focusing as the phone moves (ignored where the camera can't).
      try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }); } catch { /* not supported */ }
      el.srcObject = stream;
      el.muted = true;
      await el.play().catch(() => undefined);
      setError(null);

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
              const c = codes.find((x) => x.rawValue);
              if (c && !cancelled) {
                const pts = c.cornerPoints?.length ? c.cornerPoints
                  : c.boundingBox ? [{ x: c.boundingBox.x, y: c.boundingBox.y }, { x: c.boundingBox.right, y: c.boundingBox.bottom }] : [];
                found(c.rawValue, pts);
              }
            } catch { /* frame not ready */ }
          }
          timer = setTimeout(loop, 90);
        };
        loop();
        return;
      }

      // Fallback: decode in JavaScript, limited to product barcodes + QR, trying harder per frame.
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
      clearTimeout(timer);
      clearTimeout(lockTimer.current);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      if (el.srcObject === stream) el.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cooldownMs]);

  const locked = !!lock && lock.w > 0;
  return (
    <div ref={wrap} className={fullscreen ? "scanner scanner-full" : "scanner"}>
      <video ref={video} className="video" muted playsInline autoPlay />
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
