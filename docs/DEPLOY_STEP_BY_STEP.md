# Deploying RouteSync — A Learning Guide (free tier)

A slow, explained walkthrough for a frontend developer deploying a full stack for the
first time. Every step has a **Do** (the action) and a **Why** (what it's for). Follow
it top to bottom — the order is deliberate.

You've already signed up for Supabase, Upstash and Vercel and generated your database
and Redis URLs. This guide shows how those pieces actually connect.

---

## 0. The big picture — what you're deploying and in what order

Your app is five moving parts. Locally they all ran on your laptop; deploying means
giving each one a permanent home on the internet:

```
        ┌──────────────┐        ┌──────────────┐
Users → │  Web / Admin │ ──/api→ │     API      │ ─→ Database (Postgres)
        │  (Vercel)    │        │   (Render)   │ ─→ Redis (Upstash)
        └──────────────┘        └──────────────┘ ─→ File storage (later)
```

**The golden rule of order:** deploy the things others *depend on* first.

1. **Database** (Supabase) — the API can't start without it.
2. **Redis** (Upstash) — the API can't start without it.
3. **API** (Render) — needs the two URLs above; the frontends can't work without it.
4. **Frontends** (Vercel) — need the API's address to talk to it.

So: **data stores → API → frontends.** If you do it in another order, earlier pieces
just sit there broken until the thing they need exists. That's normal — don't panic.

> **Why split it up at all?** Different parts have different needs. A *database* must
> run forever and never lose data. An *API* is a running program. A *frontend* is just
> static files (HTML/JS) a CDN can serve cheaply. Each gets a host suited to its job.

---

## 1. One concept you'll use everywhere: environment variables

Before touching a platform, understand this — it's 80% of deployment.

Your code must not contain passwords or URLs, because (a) code is shared/committed and
(b) the same code runs in different places (your laptop vs the server) with different
settings. So those values live **outside** the code as **environment variables** —
simple `NAME=value` pairs you set in each platform's dashboard.

- On your laptop they were in a file called `.env`.
- On Render/Vercel you type them into a settings screen instead.
- The code reads them at runtime (e.g. `process.env.DATABASE_URL`).

> **Why it matters:** "deploying" is mostly *"put the right values in the right
> platform's environment settings."* Most deploy failures are a wrong or missing env
> var, not broken code.

The two secrets you already generated — `DATABASE_URL` and `REDIS_URL` — are exactly
this. They belong to the **API (Render)**, because only the backend talks to the
database and Redis. The frontend never sees them.

---

## 2. Database — Supabase

The database is where all data lives permanently: users, routes, subscriptions, test
centres. RouteSync uses **PostgreSQL**, and specifically needs the **PostGIS**
add-on (for map/location maths), which is why we chose Supabase.

### Step 2.1 — Enable PostGIS
**Do:** Supabase → **SQL Editor** → run:
```sql
create extension if not exists postgis;
```
**Why:** An "extension" adds extra abilities to Postgres. The app's schema uses PostGIS
types (geographic points for test centres). Without enabling it first, loading the
schema fails on the very first geo column.

### Step 2.2 — Create the tables and demo data
**Do:** SQL Editor → **New query** → open [`db/bootstrap.sql`](../db/bootstrap.sql),
copy the **whole file**, paste, **Run**.

**Why:** A fresh database is completely empty — no tables at all. `bootstrap.sql` is a
single script that builds every table (the "schema"), applies the later upgrades
("migrations"), and inserts demo accounts/routes ("seed data") so you have something to
click. After it runs you'll have ~7 users, some routes, and 45 test centres.

> **Concept — schema vs migrations vs seed:**
> - *Schema* = the shape (which tables/columns exist).
> - *Migration* = a later, careful change to that shape on a database that already has
>   data (e.g. "add a column"). We combined schema + all migrations into one file for
>   you here.
> - *Seed* = fake starter data for testing.

### Step 2.3 — Get the connection string (this is `DATABASE_URL`)
**Do:** Supabase → **Connect** → **Connection string** → **Session pooler** → copy the
URI. Replace `[YOUR-PASSWORD]` with your real database password and add `?schema=public`:
```
postgresql://postgres.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres?schema=public
```

**Why each part matters:**
- A **connection string** is just the database's *address + login* packed into one line:
  `postgresql://USER:PASSWORD@HOST:PORT/DATABASENAME`.
- **Use the "Session pooler", not "Direct connection".** The direct one
  (`db.<ref>.supabase.co`) is IPv6-only on the free tier, and hosts like Render can't
  reach it → connection errors. The pooler (`...pooler.supabase.com`) works over IPv4.
- **Password characters:** if your password has symbols like `@ ! # /`, they break the
  URL (because `@` also separates password from host). Easiest fix: use a password with
  only **letters and numbers**. (Otherwise you must percent-encode them, e.g. `@`→`%40`.)
- **`?schema=public`** tells the app which schema (namespace) its tables live in.

> **Security:** treat this string like a password — it *is* one. Never commit it or
> paste it publicly. It only ever goes into Render's env settings.

---

## 3. Redis — Upstash

**Why the app needs Redis:** Redis is a very fast in-memory store. RouteSync uses it as
a **job queue** (via a library called BullMQ) and a cache. The API tries to connect to
it **at startup**, so if `REDIS_URL` is missing or wrong, the API won't boot.

### Step 3.1 — Use the TCP URL, not the REST one
**Do:** In Upstash, open your database and pick the **TCP** connection (not "REST").
Copy the string that starts with `rediss://`:
```
rediss://default:<token>@<name>.upstash.io:6379
```

**Why:** Upstash offers two ways in — a **REST** API (for serverless/edge functions) and
a normal **TCP** connection (for regular server libraries). This app uses a standard
Redis client (`ioredis`), which speaks TCP. The REST URL/token you first saw are the
wrong kind and won't work here. `rediss://` (with two s's) just means TCP **over TLS**
(encrypted) — the client handles that automatically.

This string is your **`REDIS_URL`**.

---

## 4. API — Render

This is the "kitchen": the running program that holds all the rules and is the only
thing that talks to the database and Redis. Render will run it for you from your GitHub
repo.

### Step 4.1 — Create the service from the Blueprint
**Do:** Render → **New → Blueprint** → connect your GitHub repo. Render finds
[`render.yaml`](../render.yaml) and proposes a service called `routesync-api`.

**Why:** A "Blueprint" is a file in the repo that describes the service (how to build
it, how to start it, what health check to use) so you don't configure it all by hand.
It encodes decisions you'd otherwise have to know:
- **Build command:** `npm install --include=dev && npm run prisma:generate && npm run build`
  — installs dependencies, generates the database client, compiles TypeScript to
  JavaScript.
  - *Why `--include=dev`:* build tools (the compiler) are "dev dependencies". Because
    we set `NODE_ENV=production`, npm would normally **skip** them and the build would
    fail. This flag forces them in for the build.
- **Start command:** `node dist/main.js` — runs the compiled server.
- **Health check path:** `/api/health` — the URL Render pings to know the app is alive.

### Step 4.2 — Set the environment variables
**Do:** During setup (or Service → **Environment**) set:
- `DATABASE_URL` = your Supabase **pooler** string (Step 2.3)
- `REDIS_URL` = your Upstash **TCP** string (Step 3.1)

(The JWT secrets are generated automatically by the Blueprint; leave the `S3_*` ones
blank for now — they're only for file uploads.)

**Why:** This is the moment the API gets told *where its database and cache live*.
These are set on **Render, not Vercel**, because the backend is what uses them. Render
also injects a `PORT` for you automatically; the app reads it — so you don't set a port.

### Step 4.3 — Deploy and verify
**Do:** Deploy. When it's live you'll get a URL like `https://routesync-api.onrender.com`.
Open **`https://YOUR-API.onrender.com/api/health`** in a browser.

**Why:** You should see `{"status":"ok","db":"up"}`. This is your proof that (a) the API
started and (b) it successfully reached the database. `"db":"up"` = `DATABASE_URL` is
correct. If the page errors, read the **Logs** tab in Render — it almost always names
the bad env var.

> **Note the `/api` prefix.** Every endpoint lives under `/api` (e.g. `/api/health`,
> `/api/routes`). Remember this — the frontend rewrite in the next step depends on it.

> **Free-tier behaviour:** a free Render service **sleeps after ~15 min idle**. The next
> request wakes it and takes ~30–60s. That's normal for free — not a bug.

---

## 5. Frontends — Vercel

The web and admin apps are **not** running programs — they're just built files
(HTML/JS/CSS) that a CDN serves. That's why they go on Vercel (built for static hosting)
and are cheap/instant, with no "sleep".

### Step 5.1 — Create two projects
**Do:** Vercel → **Add New → Project** → import the repo. Set **Root Directory** to
`apps/web`. Framework preset: **Vite**. Deploy. Repeat with Root Directory `apps/admin`.

**Why:** It's a monorepo (many apps in one repo), so you tell Vercel *which folder* is
the app. "Vite" tells it how to build (`npm run build`) and where the output goes
(`dist`). Two apps = two projects.

### Step 5.2 — The `/api` rewrite (the crucial bit)
**Do:** The repo already includes [`apps/web/vercel.json`](../apps/web/vercel.json) and
[`apps/admin/vercel.json`](../apps/admin/vercel.json). In **each**, change the rewrite
`destination` from `https://routesync-api.onrender.com/...` to **your real Render URL**
from Step 4.3. Commit/push (or edit and redeploy).

**Why this is essential:** the frontend code calls the API using **relative paths** like
`/api/routes` (no server name). In local dev, Vite quietly forwarded `/api` to
`localhost:3000`. In production there's no Vite — so we tell **Vercel** to forward any
`/api/...` request to your Render API. The `vercel.json` rewrite does that.

> **Bonus — why this avoids "CORS":** because the browser calls `/api` on the *same*
> domain (your Vercel site) and Vercel forwards it server-side, the browser never sees a
> cross-domain request. That sidesteps CORS (the browser security rule that blocks a
> site from calling a different domain) entirely. Clean and simple.

The `vercel.json` also has a second rewrite (`… → /index.html`) so that client-side
routes like `/route/123` load your app instead of 404ing — the standard "single-page
app" fallback.

---

## 6. Verify the whole thing end to end

**Do:** Open your web app's `*.vercel.app` URL. Register or sign in as a seeded account
(password `Password123!`), e.g. `learner@routesync.uk`. Try to open a route.

**Why / what you should see:** you'll be asked for your **test centre + test date**
(the gate), then routed to the paywall for a route outside your centre. If that flow
works, then: Vercel served the app → the rewrite reached Render → Render queried
Supabase → the answer came back. Every layer is proven in one click.

---

## 7. Troubleshooting (and what each error is telling you)

| Symptom | What it means | Fix |
|---|---|---|
| Site loads but "cannot reach the server" | The `/api` rewrite isn't pointing at a working API | Check `vercel.json` destination = your real Render URL; confirm `/api/health` works |
| `/api/health` errors or won't load | API didn't start | Read Render **Logs**; usually a bad `DATABASE_URL`/`REDIS_URL` |
| Health shows `"db":"down"` | API started but can't reach the database | You used the **direct** (IPv6) string — switch to **Session pooler**; check password encoding |
| Build fails on Render (`nest: not found`) | Dev dependencies were skipped | Ensure build uses `npm install --include=dev` (it's in `render.yaml`) |
| First request very slow | Free API was asleep | Normal cold start; wait ~30–60s |
| Login works but no routes | Database is empty | Re-run `bootstrap.sql` in Supabase |

---

## 8. What you've actually learned

- **Environment variables** carry config/secrets into each platform — deployment is
  mostly setting these correctly.
- **Connection strings** are `protocol://user:password@host:port/name` — and *which*
  host matters (pooler vs direct).
- **Order of deployment** follows dependencies: data stores → API → frontends.
- **Backends run**; **frontends are static files** — different hosts for different jobs.
- **Rewrites** connect a static frontend to a separate API and dodge CORS.
- A **health check** is your fastest "is the backend alive and connected?" signal.

---

## 9. Not included on the free tier (on purpose)

- The **Python worker** (video/AI processing) — too heavy for free hosts, so
  **uploading/processing new routes is disabled**. Everything else works.
- **File storage** (Cloudflare R2) — only needed once you enable uploads.
- **Real payments** — keep Stripe in test mode.

When you're ready to add those, they're new env vars + one more host — the same pattern
you just learned.
