/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Stores live on subdomains (demo.localhost:3000 when testing locally).
  allowedDevOrigins: ["*.localhost"],
  // No floating Next.js dev badge (keeps screenshots and demos clean).
  devIndicators: false,
  // The barcode reader (WebAssembly, ~0.4 MB compressed): phones keep it for a week instead of re-checking each visit.
  async headers() {
    return [{ source: "/zxing_reader.wasm", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] }];
  },
};
export default nextConfig;
