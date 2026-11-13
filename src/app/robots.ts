import type { MetadataRoute } from "next";

// Demo and store apps are not for search engines; the public site is scanexit.com.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
