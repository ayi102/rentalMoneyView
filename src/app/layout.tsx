import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { logout } from "@/lib/auth-actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "rentalMoneyView",
  description: "The economic outlook for your rental property.",
  // Private financial data — never index it, wherever it's linked from.
  robots: { index: false, follow: false, nocache: true },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "rentalMoneyView",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Match the light/dark surface colors so the phone's status bar blends in.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141a22" },
  ],
};

const navLinks = [
  { href: "/", label: "All Years" },
  { href: "/worksheet", label: "Worksheet" },
  { href: "/projection", label: "Projection" },
];

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Display-only: decides whether to render the nav. Access control itself is
  // enforced by requireUser() in each page and action, not here — layouts don't
  // re-render on every navigation.
  const user = await getSessionUser();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {user && (
          <header className="border-b border-border bg-surface">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-5">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-white">
                  $
                </span>
                rentalMoneyView
              </Link>
              <nav className="flex gap-1 text-sm">
                {navLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="rounded-md px-3 py-1.5 text-muted hover:bg-background hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
              <form action={logout} className="ml-auto">
                <button
                  type="submit"
                  className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-background hover:text-foreground"
                >
                  Sign out
                </button>
              </form>
            </div>
          </header>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5">
          {children}
        </main>
      </body>
    </html>
  );
}
