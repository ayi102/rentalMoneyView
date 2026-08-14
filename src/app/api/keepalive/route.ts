import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Supabase pauses free-tier projects after roughly a week of inactivity, and
// resuming one is a manual step in their dashboard. This route runs one trivial
// query so a daily Vercel cron keeps the project awake — see vercel.json.
//
// It's the whole project that pauses, not just Postgres, so this also keeps Auth
// reachable.
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means we can't tell a real cron from anyone who found
  // the URL. Refuse rather than expose an open endpoint.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  // Compare in constant time. Lengths must match first — timingSafeEqual throws
  // on differing lengths.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not set; see DEPLOY.md" },
      { status: 503 },
    );
  }

  if (!authorized(request)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    // Cheapest possible round-trip that proves the database answered.
    const categories = await prisma.category.count();
    return Response.json(
      { ok: true, categories },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Surface failures so a broken keepalive shows up in Vercel's cron logs
    // instead of silently letting the project pause.
    console.error("keepalive failed", error);
    return Response.json(
      { ok: false, error: "database unreachable" },
      { status: 500 },
    );
  }
}
