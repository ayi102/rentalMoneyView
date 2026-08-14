// Proxy (called Middleware before Next.js 16) — runs before every matched
// request, on the Node.js runtime.
//
// Three jobs:
//  1. Issue a per-request CSP nonce. Next.js attaches it to its own scripts
//     automatically, as long as the page is dynamically rendered (all of ours are).
//  2. Keep the Supabase session cookie fresh. Token refreshes must be written to
//     the response here, because Server Components can't set cookies.
//  3. Optimistically redirect signed-out visitors to /login.
//
// Job 3 is a convenience, NOT the security boundary. Per the Next.js auth guide,
// real enforcement lives in src/lib/auth.ts and is called by every page and every
// Server Action.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Paths reachable without a session. */
const PUBLIC_PATHS = ["/login"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  // The browser never talks to Supabase directly in this app (all auth calls are
  // server-side), but allow the project origin so adding a browser client later
  // doesn't fail in a confusing way.
  let supabaseOrigin = "";
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
    }
  } catch {
    // Malformed URL — leave it out rather than emitting a broken directive.
  }

  return (
    [
      `default-src 'self'`,
      // 'strict-dynamic' lets Next's nonced bootstrap script load the rest of the
      // bundle. 'unsafe-eval' is only needed in dev, where React uses eval to
      // rebuild server error stacks.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
      // Recharts sets inline style attributes on the elements it renders, which a
      // nonce cannot cover (style attributes fall under style-src-attr). Inline
      // styles are a far weaker vector than inline scripts, so this is the
      // tradeoff: scripts stay strictly nonce-gated.
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' blob: data:`,
      `font-src 'self'`,
      `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `frame-ancestors 'none'`,
      `upgrade-insecure-requests`,
    ].join("; ") + ";"
  );
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // Rebuilt whenever Supabase rotates cookies: request.cookies.set() updates the
  // request's cookie header, so deriving headers from request.headers afterwards
  // carries the new values through to the render.
  const buildResponse = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    // Next.js reads the nonce out of the CSP on the *request* during SSR.
    headers.set("Content-Security-Policy", csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  const withCsp = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  let response = buildResponse();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Misconfigured deployment. Don't make a redirect decision from a broken
    // client — let it through so the page's own requireUser() surfaces the error.
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = buildResponse();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // A response carrying Set-Cookie for an auth token must never be cached
        // by a CDN, or one visitor's session could be handed to another. Supabase
        // supplies the exact no-store headers to apply.
        for (const [k, v] of Object.entries(headers)) {
          response.headers.set(k, v);
        }
      },
    },
  });

  // Must run before we commit a response, so a refresh landing mid-request can
  // still be persisted by setAll above.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;
  const publicPath = isPublic(pathname);

  if (!signedIn && !publicPath) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    return withCsp(NextResponse.redirect(to));
  }

  if (signedIn && publicPath) {
    const to = request.nextUrl.clone();
    to.pathname = "/";
    to.search = "";
    return withCsp(NextResponse.redirect(to));
  }

  return response;
}

export const config = {
  // Everything except static assets and the files a browser or phone fetches
  // before login (icons, manifest, robots) — those must stay reachable or the
  // install prompt and favicon break on the login screen. No image or manifest
  // route in this app serves private data.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|manifest\\.webmanifest|.*\\.png$|.*\\.svg$).*)",
  ],
};
