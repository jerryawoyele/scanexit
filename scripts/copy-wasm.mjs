// Copies the barcode reader's WebAssembly file into /public so the app serves it itself.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const src = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
mkdirSync("public", { recursive: true });
copyFileSync(src, "public/zxing_reader.wasm");
console.log("copied zxing_reader.wasm to public/");
