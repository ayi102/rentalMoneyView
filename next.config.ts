import type { NextConfig } from "next";

// Headers that don't need per-request values live here so they also cover static
// assets, which src/proxy.ts deliberately skips. The Content-Security-Policy is
// NOT here — it carries a per-request nonce and is set in src/proxy.ts.
const securityHeaders = [
  // This app holds private financial records; keep it out of search engines
  // entirely, however a URL might leak.
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  // Force HTTPS for two years, including subdomains.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // frame-ancestors in the CSP is the modern control; this covers older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here needs device APIs.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
