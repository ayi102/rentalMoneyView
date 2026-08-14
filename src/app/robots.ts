import type { MetadataRoute } from "next";

// A private financial ledger has no business in a search index. This is advisory
// only — the X-Robots-Tag header in next.config.ts and the per-page `robots`
// metadata are the enforcing pieces.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
