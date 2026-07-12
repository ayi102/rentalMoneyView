import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "rentalMoneyView",
  description: "The economic outlook for your rental property.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-white">
                $
              </span>
              rentalMoneyView
            </Link>
            <nav className="flex gap-1 text-sm">
              <Link
                href="/"
                className="rounded-md px-3 py-1.5 text-muted hover:bg-background hover:text-foreground"
              >
                Dashboard
              </Link>
              <Link
                href="/summary"
                className="rounded-md px-3 py-1.5 text-muted hover:bg-background hover:text-foreground"
              >
                All Years
              </Link>
              <Link
                href="/ledger"
                className="rounded-md px-3 py-1.5 text-muted hover:bg-background hover:text-foreground"
              >
                Ledger
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
