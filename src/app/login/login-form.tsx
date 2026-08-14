"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/lib/auth-actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState | undefined, FormData>(
    login,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-xs font-medium uppercase tracking-wide text-muted"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-xs font-medium uppercase tracking-wide text-muted"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      {state?.error && (
        <p
          role="alert"
          className="rounded-lg border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
