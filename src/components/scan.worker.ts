/// <reference lib="webworker" />
// Barcode reading off the main thread, with ZXing compiled to WebAssembly (zxing-cpp).
// Used on phones without a built-in barcode detector (every iPhone, some Androids).
import { prepareZXingModule, readBarcodes, type ReadInputBarcodeFormat } from "zxing-wasm/reader";

// The .wasm file is served by the app itself (copied to /public by scripts/copy-wasm.mjs), not from a CDN.
prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path) },
  fireImmediately: true,
});

const FORMATS: ReadInputBarcodeFormat[] = ["EAN13", "EAN8", "UPCA", "UPCE", "Code128", "Code39", "ITF", "QRCode"];

export type ScanRequest = { id: number; image: ImageData; ox: number; oy: number; scale: number };
export type ScanReply = { id: number; code?: string; qr?: boolean; pts?: { x: number; y: number }[]; failed?: boolean };

self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const { id, image, ox, oy, scale } = e.data;
  try {
    const [r] = await readBarcodes(image, { formats: FORMATS, tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 1 });
    if (r && r.isValid && r.text) {
      // Map back from the cropped/scaled frame to camera-image coordinates.
      const p = r.position;
      const pts = [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((q) => ({ x: ox + q.x / scale, y: oy + q.y / scale }));
      (self as unknown as Worker).postMessage({ id, code: r.text, qr: r.format === "QRCode", pts } satisfies ScanReply);
      return;
    }
    (self as unknown as Worker).postMessage({ id } satisfies ScanReply);
  } catch {
    (self as unknown as Worker).postMessage({ id, failed: true } satisfies ScanReply);
  }
};
