/**
 * Interactive .env setup.
 *
 * Almost everything is derivable from one Supabase connection string, so this asks
 * for the two things that genuinely can't be computed — the connection string and
 * the anon key — and builds the rest:
 *
 *   DATABASE_URL              transaction pooler (6543) + the pgbouncer flags
 *   DIRECT_URL                session pooler (5432), same credentials
 *   NEXT_PUBLIC_SUPABASE_URL  derived from the project ref inside the string
 *   CRON_SECRET               generated locally
 *
 * It also normalises `prisma.<ref>` usernames to `postgres.<ref>` (Supabase's
 * Prisma snippet assumes a dedicated role you may not have created).
 *
 * Run: npm run setup:env
 *
 * Input is not echoed when running in a terminal, so the password doesn't end up
 * in your scrollback. Nothing is transmitted anywhere — this writes one local file.
 * Any existing .env is backed up first.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { randomBytes } from "node:crypto";

const outFlag = process.argv.indexOf("--out");
const OUT = outFlag !== -1 ? process.argv[outFlag + 1] : ".env";

interface Rl extends readline.Interface {
  // readline writes prompts through this internal hook; overriding it is how you
  // suppress echo for a single question.
  _writeToOutput?: (s: string) => void;
  output?: { write: (s: string) => void };
}

/**
 * Prompts interactively from a TTY, masking what's typed.
 *
 * When stdin is a pipe, readline is the wrong tool: the pipe reaches EOF and fires
 * 'close' before a later question() is registered, so that callback never runs and
 * the process exits successfully having done nothing. So for non-TTY input, slurp
 * every line up front and hand them out in order.
 */
class Prompter {
  private lines: string[] | null = null;
  private rl: Rl | null = null;

  async init(): Promise<void> {
    if (process.stdin.isTTY) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    this.lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  }

  ask(question: string, mask: boolean): Promise<string> {
    if (this.lines) {
      process.stdout.write(question);
      const next = (this.lines.shift() ?? "").trim();
      process.stdout.write(mask ? "\n" : `${next}\n`);
      return Promise.resolve(next);
    }

    const rl = this.rl!;
    return new Promise((resolve) => {
      if (!mask) {
        rl.question(question, (a) => resolve(a.trim()));
        return;
      }
      const original = rl._writeToOutput;
      rl.question(question, (a) => {
        rl._writeToOutput = original;
        rl.output?.write("\n");
        resolve(a.trim());
      });
      // Echo the prompt itself, then swallow the typed characters.
      rl._writeToOutput = function (s: string) {
        if (s.includes(question)) original?.call(rl, s);
      };
    });
  }

  close(): void {
    this.rl?.close();
  }
}

interface Parsed {
  ref: string;
  host: string;
  password: string;
  port: string;
}

/**
 * Pull the pieces out by regex rather than `new URL`, so the password is preserved
 * exactly as pasted — URL parsing would percent-decode it and we'd have to guess
 * how to re-encode.
 */
function parseConnectionString(raw: string): Parsed | { error: string } {
  const m = raw
    .trim()
    .match(/^postgres(?:ql)?:\/\/([^:@\s]+):([^@\s]*)@([^:/\s]+):(\d+)\/([^?\s]+)/);
  if (!m) {
    return {
      error:
        "That doesn't look like a Postgres connection string. Expected something like\n" +
        "  postgresql://postgres.abcdefg:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    };
  }

  const [, user, password, host, port] = m;

  if (!password || password.includes("[YOUR-PASSWORD]")) {
    return {
      error:
        "The string still contains the literal [YOUR-PASSWORD] placeholder.\n" +
        "Replace it with your database password and run this again.",
    };
  }

  if (host.startsWith("db.")) {
    return {
      error:
        `That's the "Direct connection" string (host ${host}).\n` +
        "It doesn't reveal your pooler region, and it's IPv6-only on newer projects.\n" +
        "In the Connect panel choose ORMs → Prisma, or set the connection method to\n" +
        "Transaction pooler, and paste that string instead.",
    };
  }

  if (!host.includes("pooler.supabase.com")) {
    return {
      error: `Unexpected host "${host}" — expected aws-<region>.pooler.supabase.com.`,
    };
  }

  // Username is <role>.<project-ref>; the ref is what we need.
  const dot = user.indexOf(".");
  if (dot === -1) {
    return {
      error: `Couldn't find a project ref in username "${user}" (expected <role>.<project-ref>).`,
    };
  }
  const ref = user.slice(dot + 1);

  return { ref, host, password, port };
}

function checkAnonKey(key: string): string | null {
  if (key.startsWith("sb_secret_") || key.startsWith("service_role")) {
    return "That looks like a SECRET / service_role key. It must not go in a NEXT_PUBLIC_ variable — grab the anon / publishable key instead.";
  }
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64").toString("utf8"),
      );
      if (payload.role && payload.role !== "anon") {
        return `That key encodes role "${payload.role}", not "anon". Use the anon / publishable key.`;
      }
    } catch {
      // Undecodable: let check:env warn about it rather than blocking here.
    }
  }
  return null;
}

/** Keep the user's existing spreadsheet folder rather than losing it. */
function existingXlsxDir(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const m = fs
    .readFileSync(file, "utf8")
    .match(/^RENTAL_XLSX_DIR\s*=\s*"?([^"\n]*)"?/m);
  return m ? m[1] : null;
}

function render(p: Parsed, anonKey: string, xlsxDir: string | null): string {
  const cronSecret = randomBytes(32).toString("base64");
  const base = `postgresql://postgres.${p.ref}:${p.password}@${p.host}`;

  return `# Local environment — written by \`npm run setup:env\`.
# Git-ignored. Real values never leave this machine.

# --- Database (Prisma) ---------------------------------------------------------
# Transaction pooler (6543) at runtime; connection_limit=1 because each serverless
# invocation opens its own connection.
DATABASE_URL="${base}:6543/postgres?pgbouncer=true&connection_limit=1"

# Session pooler (5432) for \`prisma migrate\`, which needs a real session and hangs
# on the transaction pooler.
DIRECT_URL="${base}:5432/postgres"

# --- Supabase Auth -------------------------------------------------------------
NEXT_PUBLIC_SUPABASE_URL="https://${p.ref}.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="${anonKey}"

# --- Keepalive cron (used on Vercel) -------------------------------------------
# Generated locally. Set the same value in Vercel's environment variables.
CRON_SECRET="${cronSecret}"
${
  xlsxDir
    ? `
# --- Local scripts only --------------------------------------------------------
# Folder holding your per-year .xlsx spreadsheets (used by \`npm run import\`).
RENTAL_XLSX_DIR="${xlsxDir}"
`
    : ""
}`;
}

async function main() {
  const outPath = path.resolve(OUT);

  console.log("Setting up .env for Supabase.\n");
  console.log(
    "In the Supabase dashboard: Connect → ORMs → Prisma, and copy the DATABASE_URL\n" +
      "line (or use the Transaction pooler connection string). Substitute your database\n" +
      "password for [YOUR-PASSWORD] before pasting.\n",
  );

  const prompter = new Prompter();
  await prompter.init();

  const raw = await prompter.ask("Connection string: ", true);
  const parsed = parseConnectionString(raw);
  if ("error" in parsed) {
    console.error(`\n${parsed.error}`);
    prompter.close();
    process.exit(1);
  }

  console.log(
    `\n  project ref  ${parsed.ref}\n  pooler host  ${parsed.host}\n  password     ${parsed.password.length} chars\n`,
  );

  console.log("Now the anon key: Project Settings → API → anon / public key.\n");
  const anonKey = await prompter.ask("Anon key: ", true);
  if (!anonKey) {
    console.error("\nNo key entered.");
    prompter.close();
    process.exit(1);
  }
  const keyProblem = checkAnonKey(anonKey);
  if (keyProblem) {
    console.error(`\n${keyProblem}`);
    prompter.close();
    process.exit(1);
  }

  prompter.close();

  // Back up before overwriting, so a mistake here is never destructive.
  if (fs.existsSync(outPath)) {
    const backup = `${outPath}.bak`;
    fs.copyFileSync(outPath, backup);
    console.log(`Backed up existing ${OUT} to ${path.basename(backup)}`);
  }

  fs.writeFileSync(
    outPath,
    render(parsed, anonKey, existingXlsxDir(outPath)),
    { mode: 0o600 },
  );

  console.log(`Wrote ${outPath} (permissions 600)\n`);
  console.log("Derived DIRECT_URL, NEXT_PUBLIC_SUPABASE_URL, and a fresh CRON_SECRET.");
  console.log("\nNext:  npm run check:env");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
