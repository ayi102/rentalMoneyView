// Data Access Layer for auth.
//
// This is the authoritative check. src/proxy.ts also redirects unauthenticated
// requests, but that is only an optimistic pre-filter — every page and every
// Server Action must call requireUser() itself. Server Actions are reachable as
// HTTP endpoints regardless of what the UI renders, so a proxy-level check alone
// is not sufficient (and Next.js has shipped proxy-bypass advisories before).
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient, supabaseConfig } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
  /** "aal1" = password only, "aal2" = a second factor was verified. */
  assuranceLevel: string;
}

/**
 * Verify the session by validating the access token's signature — not by
 * trusting the cookie's contents. `getClaims()` checks the JWT locally via
 * WebCrypto when the project uses asymmetric signing keys, so this is cheap.
 *
 * Wrapped in React `cache()` so several components in one render pass share a
 * single verification.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Unconfigured deployment: nobody is signed in. Returning null keeps the login
  // page renderable so the misconfiguration is visible instead of a blank 500.
  if (!supabaseConfig()) return null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

    // Three shapes are possible: an error, no session at all (data === null), or
    // valid claims.
    if (error || !data?.claims?.sub) return null;

    return {
      id: data.claims.sub,
      email: data.claims.email ?? null,
      assuranceLevel: data.claims.aal ?? "aal1",
    };
  } catch {
    // Network failure, malformed cookie, unreachable project — treat as signed
    // out. This fails closed: no session means no access.
    return null;
  }
});

/** Require a signed-in user, or redirect to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
