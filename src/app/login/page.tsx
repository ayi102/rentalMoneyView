import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · rentalMoneyView",
  // Belt-and-braces alongside the X-Robots-Tag header in next.config.ts.
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm py-10">
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="mb-5">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">
            This ledger is private. Sign in to continue.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
