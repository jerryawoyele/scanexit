"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";

/** Camera barcode/QR scanner. Calls onCode once per code (ignores repeats within `cooldownMs`). */
export default function Scanner({ onCode, active = true, cooldownMs = 2000 }: {
  onCode: (code: string) => void; active?: boolean; cooldownMs?: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const cb = useRef(onCode);
  cb.current = onCode;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !video.current) return;
    let controls: IScannerControls | undefined;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video.current, (result) => {
        if (!result) return;
        const code = result.getText();
        const now = Date.now();
        if (code === last.current.code && now - last.current.at < cooldownMs) return;
        last.current = { code, at: now };
        if (navigator.vibrate) navigator.vibrate(60);
        cb.current(code);
      })
      .then((c) => { if (cancelled) c.stop(); else controls = c; })
      .catch(() => setError("Camera not available. Allow camera access, or type the barcode below."));
    return () => { cancelled = true; controls?.stop(); };
  }, [active, cooldownMs]);

  return (
    <div>
      <video ref={video} className="video" muted playsInline />
      {error && <div className="toast err" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
