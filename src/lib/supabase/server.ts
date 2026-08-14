// Supabase client for server-side use (Server Components, Server Actions).
//
// A new client is created per request — never share one across requests, since
// each carries its own auth state.
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const MISSING_CONFIG_MESSAGE =
  "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
  "See DEPLOY.md for where these come from.";

/**
 * Read the Supabase connection settings, or null if they aren't configured.
 *
 * Non-throwing on purpose: callers that merely ask "is anyone signed in?" must be
 * able to answer "no" on an unconfigured deployment rather than crash. Otherwise
 * the login page itself 500s and there's no way to see what's wrong.
 */
export function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/** Same, but throws — for callers that genuinely cannot proceed without it. */
export function supabaseEnv(): { url: string; key: string } {
  const config = supabaseConfig();
  if (!config) throw new Error(MISSING_CONFIG_MESSAGE);
  return config;
}

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Cookies are read-only when rendering a Server Component. This is
          // expected: src/proxy.ts runs on every request and persists refreshed
          // session cookies there instead.
        }
      },
    },
  });
}
