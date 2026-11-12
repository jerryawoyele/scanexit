import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "ScanExit", description: "Shop. Scan. Exit. Scan as you shop, pay on your phone, skip the queue." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#0b5a3a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before React loads; ignore those. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
