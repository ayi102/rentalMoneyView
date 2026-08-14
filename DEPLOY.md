# Deploying rentalMoneyView

Goal: the app on your phone and any computer, at a URL only you can get into.

Stack: **Vercel** (hosting, free Hobby) + **Supabase** (Postgres + Auth, free tier).
Expected cost: **$0**.

Your data currently lives in `prisma/dev.db` on this machine. It has already been
dumped to `data/local-dump.json` (git-ignored) and will be loaded into Supabase in
step 4.

---

## 1 · Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **Save the database password it generates** — it appears once, and it's part of
   the connection strings below. Use a long random one.
3. Pick the region closest to you.

## 2 · Create your login, and close the door behind it

This app has **no sign-up page** on purpose — one account, created by hand.

1. **Authentication → Users → Add user**. Use your email and a strong, unique
   passphrase. Tick "Auto Confirm User" so there's no email round-trip.
2. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users
   to sign up". Without this, anyone who finds the URL could register an account.
3. Optional but recommended, given what's in here — **enable MFA**:
   Authentication → Multi-Factor Authentication → enable TOTP, then enrol your
   authenticator app. The app already reports the assurance level (`aal1` vs
   `aal2`) via `getSessionUser()`.

## 3 · Fill in your local `.env`

Copy `.env.example` to `.env` and fill it in from the dashboard:

- `DATABASE_URL` / `DIRECT_URL` — click **Connect** at the top of the project
  dashboard. Nothing there is labelled with those names; they're Prisma's. Take the
  **shared pooler (Supavisor)** strings, which are identical except for the port:

  | Variable | Pooler mode | Port |
  |---|---|---|
  | `DATABASE_URL` | Transaction | **6543** |
  | `DIRECT_URL` | Session | **5432** |

  Both use `aws-<region>.pooler.supabase.com` and user `postgres.<project-ref>`.
  Don't use the "Direct connection" option (`db.<project-ref>.supabase.co`) —
  Supabase's Prisma guide points at the session pooler, and direct connections are
  IPv6-only on newer projects without the paid IPv4 add-on.

  Each string contains a literal `[YOUR-PASSWORD]` placeholder — swap in the
  database password from step 1.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project Settings → API.

Never put the `service_role` / secret key in a `NEXT_PUBLIC_` variable — that would
ship it to the browser.

## 4 · Create the schema and load your data

```bash
npm run db:deploy    # creates the tables in Supabase (prisma migrate deploy)
npm run db:load      # loads data/local-dump.json into Supabase
```

The initial migration (`prisma/migrations/0_init/`) is already committed, so
`db:deploy` has something to apply.

`db:load` refuses to run against a non-empty database unless you pass `--force`
(which deletes the existing rows first). It verifies row counts against the dump
and exits non-zero on any mismatch, so a partial load can't pass silently.

Verify before moving on:

```bash
npm run db:studio    # should show 1 property, 112 transactions, 38 mileage, 25 categories
```

## 5 · Run it locally against Supabase

```bash
npm run dev
```

You should be redirected to `/login`, and get in with the account from step 2.
Check that all three pages show your real numbers. **Fix any problem here, not
after deploying** — the loop is much faster locally.

## 6 · Deploy to Vercel

1. Push the branch and open [vercel.com/new](https://vercel.com/new), import the repo.
2. Add all four env vars from step 3 under **Environment Variables** (Production,
   Preview, and Development). Vercel does not read your local `.env`.
3. Deploy. The build runs `prisma generate && next build`, so the Prisma client is
   generated against the hosted schema.
4. Open the `*.vercel.app` URL — you should land on the login page.

## 7 · Add it to your phone

- **iPhone**: open the URL in Safari → Share → *Add to Home Screen*. It launches
  standalone, with its own icon and no browser chrome.
- **Android**: Chrome → menu → *Install app*.

There is deliberately **no offline cache**. The app is online-only, so your
financial history never sits in on-device storage.

## 8 · Keep the free project from pausing — required

Supabase pauses free-tier projects after about a week of inactivity, and resuming
one is a manual click in their dashboard. It pauses the **whole project**, so Auth
stops working too, not just the database. If you open the app monthly, every visit
would otherwise find it paused.

**This is already wired up** — `vercel.json` runs `/api/keepalive` once a day, and
that route makes one trivial query. All you have to do is set the secret:

1. Generate one: `openssl rand -base64 32`
2. Add it to Vercel as `CRON_SECRET` (Production).

Vercel sends it automatically as `Authorization: Bearer $CRON_SECRET`. Without the
variable the route returns **503** rather than sitting there publicly callable, so
if you skip this step the keepalive silently does nothing — check Vercel's cron
logs after the first day and expect `{"ok":true,...}`.

Notes:
- Hobby-plan crons fire once a day at an approximate time, which is ample here.
- Pausing never destroys data. If it does pause, resume it from the Supabase
  dashboard and nothing is lost.
- Whether a plain query resets Supabase's idle timer is their behaviour, not
  something this repo controls — worth confirming once after a couple of weeks of
  not touching the app.

---

## What protects the data

Four independent layers, so no single mistake exposes anything:

1. **`src/proxy.ts`** redirects signed-out requests to `/login`. This is only an
   optimistic pre-filter, not the boundary.
2. **`requireUser()` in `src/lib/auth.ts`** is the real check, called by every page
   *and every Server Action*. Server Actions are reachable as HTTP endpoints no
   matter what the UI renders, so this is what actually matters. It validates the
   JWT signature via `getClaims()` rather than trusting cookie contents.
3. **Transport and headers** — HSTS, `frame-ancestors 'none'`, nosniff, a
   nonce-based CSP, and `noindex` everywhere (`next.config.ts` + `src/app/robots.ts`).
4. **Supabase Auth** owns password hashing, session refresh, sign-in rate limiting,
   and TOTP.

Worth knowing: Prisma connects with the database credentials, so it bypasses
Postgres row-level security. RLS would add nothing for a single-user app whose
every query already runs behind `requireUser()` — but if you ever add a second
user or query from the browser, revisit that.

## If something breaks

| Symptom | Likely cause |
|---|---|
| Redirect loop at `/login` | `NEXT_PUBLIC_SUPABASE_*` missing or wrong on Vercel |
| "Incorrect email or password" with correct details | User not confirmed in Supabase, or email sign-in disabled |
| `prisma migrate` hangs or times out | Using the pooled 6543 URL for `DIRECT_URL`; migrations need 5432 |
| Random sign-outs | A cookie write being lost — check `setAll` in `src/proxy.ts` |
| Charts render unstyled | CSP `style-src`; Recharts needs inline styles (see the comment in `src/proxy.ts`) |
