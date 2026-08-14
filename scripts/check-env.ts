/**
 * Validate .env before it's used against a real database.
 *
 * Catches the mistakes that otherwise surface as a hang or as "incorrect
 * password" — most often the two connection strings being swapped, since they
 * differ only by port.
 *
 * Run: npm run check:env
 *
 * Never prints a secret. Passwords and keys are reported only as lengths or
 * masked fragments, so the output is safe to paste into a chat or an issue.
 */

interface Problem {
  level: "error" | "warn";
  message: string;
}

const problems: Problem[] = [];
const notes: string[] = [];

const err = (message: string) => problems.push({ level: "error", message });
const warn = (message: string) => problems.push({ level: "warn", message });

function required(name: string): string | null {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    err(`${name} is missing.`);
    return null;
  }
  if (v.includes("FILL_ME")) {
    err(`${name} still contains a FILL_ME placeholder.`);
    return null;
  }
  return v;
}

/** Parse a postgres URL without throwing, and without retaining the password. */
function parsePg(name: string, raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    err(`${name} is not a valid URL.`);
    return null;
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") {
    err(`${name} should start with postgresql:// (got ${u.protocol}//).`);
    return null;
  }
  if (!u.password) {
    err(`${name} has no password in it.`);
  }
  return {
    host: u.hostname,
    port: u.port || "(none)",
    user: u.username,
    database: u.pathname.replace(/^\//, ""),
    params: u.searchParams,
    passwordLength: u.password.length,
  };
}

// --- DATABASE_URL: pooled, 6543 ----------------------------------------------
const databaseUrl = required("DATABASE_URL");
let pooled: ReturnType<typeof parsePg> = null;
if (databaseUrl) {
  if (databaseUrl.startsWith("file:")) {
    err(
      "DATABASE_URL still points at a local SQLite file, but the schema is Postgres now.",
    );
  } else {
    pooled = parsePg("DATABASE_URL", databaseUrl);
    if (pooled) {
      if (pooled.port === "5432") {
        err(
          "DATABASE_URL uses port 5432 (direct). It should be the pooled port 6543 — " +
            "you may have the two connection strings swapped.",
        );
      } else if (pooled.port !== "6543") {
        warn(
          `DATABASE_URL uses port ${pooled.port}; the Supabase transaction pooler is normally 6543.`,
        );
      }
      if (pooled.params.get("pgbouncer") !== "true") {
        warn(
          "DATABASE_URL is missing ?pgbouncer=true — Prisma will try prepared " +
            "statements, which a transaction pooler cannot support.",
        );
      }
      notes.push(
        `DATABASE_URL  host=${pooled.host} port=${pooled.port} db=${pooled.database} user=${pooled.user} password=${pooled.passwordLength} chars`,
      );
    }
  }
}

// --- DIRECT_URL: direct, 5432 -------------------------------------------------
const directUrl = required("DIRECT_URL");
if (directUrl) {
  const direct = parsePg("DIRECT_URL", directUrl);
  if (direct) {
    if (direct.port === "6543") {
      err(
        "DIRECT_URL uses the pooled port 6543. Migrations need a real session on " +
          "5432 and will hang otherwise — the two strings look swapped.",
      );
    } else if (direct.port !== "5432") {
      warn(
        `DIRECT_URL uses port ${direct.port}; the direct connection is normally 5432.`,
      );
    }
    if (pooled && direct.port === pooled.port) {
      err("DATABASE_URL and DIRECT_URL use the same port; they must differ.");
    }
    if (pooled && direct.passwordLength !== pooled.passwordLength) {
      warn(
        "DATABASE_URL and DIRECT_URL have different password lengths — one may be stale.",
      );
    }
    notes.push(
      `DIRECT_URL    host=${direct.host} port=${direct.port} db=${direct.database} user=${direct.user} password=${direct.passwordLength} chars`,
    );
  }
}

// --- Supabase Auth ------------------------------------------------------------
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
if (supabaseUrl) {
  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== "https:") {
      err(`NEXT_PUBLIC_SUPABASE_URL should be https (got ${u.protocol}//).`);
    }
    if (u.pathname !== "/" && u.pathname !== "") {
      warn(
        `NEXT_PUBLIC_SUPABASE_URL has a path (${u.pathname}); it should be just the origin.`,
      );
    }
    notes.push(`SUPABASE_URL  ${u.origin}`);
  } catch {
    err("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
}

const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (anonKey) {
  // Legacy keys are JWTs whose payload carries the role; new-style keys are
  // prefixed. Either is fine — what matters is that it isn't the secret key.
  const looksJwt = anonKey.split(".").length === 3;
  const looksPublishable = anonKey.startsWith("sb_publishable_");
  const looksSecret =
    anonKey.startsWith("sb_secret_") || anonKey.startsWith("service_role");

  if (looksSecret) {
    err(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY looks like a SECRET/service_role key. " +
        "NEXT_PUBLIC_ variables are shipped to the browser — replace it with the " +
        "anon/publishable key and rotate the exposed one.",
    );
  } else if (looksJwt) {
    try {
      const payload = JSON.parse(
        Buffer.from(anonKey.split(".")[1], "base64").toString("utf8"),
      );
      if (payload.role && payload.role !== "anon") {
        err(
          `NEXT_PUBLIC_SUPABASE_ANON_KEY encodes role "${payload.role}", not "anon". ` +
            "Anything other than anon must not be public — rotate it.",
        );
      } else {
        notes.push(`ANON_KEY      JWT, role=${payload.role ?? "(unset)"}`);
      }
    } catch {
      warn("NEXT_PUBLIC_SUPABASE_ANON_KEY looks like a JWT but didn't decode.");
    }
  } else if (looksPublishable) {
    notes.push("ANON_KEY      publishable key");
  } else {
    warn(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY isn't a recognisable JWT or sb_publishable_ key.",
    );
  }
}

// --- Cron secret --------------------------------------------------------------
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret || cronSecret.includes("FILL_ME")) {
  warn(
    "CRON_SECRET is not set. Only needed on Vercel, where without it the " +
      "keepalive returns 503 and the Supabase project will eventually pause.",
  );
} else if (cronSecret.length < 24) {
  warn(
    `CRON_SECRET is only ${cronSecret.length} characters; use \`openssl rand -base64 32\`.`,
  );
} else {
  notes.push(`CRON_SECRET   ${cronSecret.length} chars`);
}

// --- Report -------------------------------------------------------------------
if (notes.length) {
  console.log("Parsed (no secrets shown):");
  for (const n of notes) console.log(`  ${n}`);
  console.log("");
}

const errors = problems.filter((p) => p.level === "error");
const warnings = problems.filter((p) => p.level === "warn");

for (const p of errors) console.error(`ERROR  ${p.message}`);
for (const p of warnings) console.warn(`WARN   ${p.message}`);

if (errors.length === 0 && warnings.length === 0) {
  console.log("All environment variables look good.");
  console.log("Next: npm run db:deploy && npm run db:load");
} else {
  console.log(
    `\n${errors.length} error(s), ${warnings.length} warning(s).${
      errors.length ? " Fix the errors before running db:deploy." : ""
    }`,
  );
}

process.exit(errors.length > 0 ? 1 : 0);
