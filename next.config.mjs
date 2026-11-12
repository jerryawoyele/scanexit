/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Stores live on subdomains (demo.localhost:3000 when testing locally).
  allowedDevOrigins: ["*.localhost"],
  // No floating Next.js dev badge (keeps screenshots and demos clean).
  devIndicators: false,
};
export default nextConfig;
