# Infrastructure guide — what Test Routify runs on, and what it costs

A plain-English explanation of every external service this app needs, why it needs it,
and how to choose between free and paid tiers.

Written for someone new to hosting. Terms are explained the first time they appear, and
there is a [glossary](#glossary) at the end.

> Companion docs: [`DEPLOY_FREE.md`](DEPLOY_FREE.md) is the click-by-click walkthrough.
> [`THIRD_PARTY_CREDENTIALS.md`](THIRD_PARTY_CREDENTIALS.md) tracks which accounts exist.
> This document explains the *reasoning* those two assume.

---

## 1. The mental model: five moving parts

Everything below exists to run one of these five things. If you understand this diagram,
the rest of the document is detail.

```
                    ┌──────────────┐
   Learner's        │   WEB APP    │  React, just files. Cheap to host.
   browser  ───────►│  (Vercel)    │
   or phone         └──────┬───────┘
                           │ asks for data
                           ▼
                    ┌──────────────┐        ┌────────────────┐
                    │     API      │◄──────►│    DATABASE    │  routes, users,
                    │   (Render)   │        │   (Supabase)   │  bookings, GPS
                    └──────┬───────┘        └────────────────┘
                           │ "process this upload"
                           ▼
                    ┌──────────────┐
                    │  JOB QUEUE   │  a to-do list the API writes
                    │  (Upstash)   │  and the worker reads
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐        ┌────────────────┐
                    │    WORKER    │◄──────►│    STORAGE     │  the actual video
                    │     (???)    │        │ (Cloudflare R2)│  files
                    └──────────────┘        └────────────────┘
                      ffmpeg lives here
```

**Why five pieces instead of one program?** Because turning a 20-minute dashcam video
into streamable footage takes *minutes of solid CPU work*. If the API did that itself, the
web request would time out and every other user would be stuck waiting. So the API does
the fast thing (write a note to the queue, reply "received") and a separate worker does
the slow thing in the background. This is the single most important design decision in the
system, and it is why you are paying for two servers instead of one.

---

## 2. Each service, in detail

### 2.1 Database — Postgres **with PostGIS**

**What it is.** Where every non-video thing lives: users, routes, bookings, test centres,
GPS points, subscriptions.

**Why this app can't use just any database.** The code does *geographic* maths in SQL —
"how far is this GPS point from the reference route", "give me the points along this line
in order". Those come from **PostGIS**, an add-on ("extension") for Postgres:

```sql
-- from apps/api/src/modules/test-centres/test-centres.service.ts
ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
```

A database without PostGIS will fail to start the app, not merely lose a feature. So
"any Postgres" is not enough — it must be Postgres **with the PostGIS extension enabled**.

**How the free tier works.** Supabase gives you 500 MB of storage and pauses the database
after ~7 days with no traffic. Paused means the first request afterwards takes ~30 seconds
to wake it, then it's normal. Your data is not deleted.

**How the paid tier differs.** ~$25/mo removes the pausing, raises storage to 8 GB, and
adds daily backups. **Backups are the real reason to upgrade** — on the free tier, if you
delete something by accident, it is gone.

**Recommended:** Supabase free now → Supabase Pro ($25/mo) before real users, mainly for
backups. Neon is a good alternative with a more generous free tier.

> ⚠️ **Render's own free Postgres is deleted 30 days after you create it.** If that is
> where you ran the migrations, treat it as temporary. Supabase free pauses but never
> expires.

> ⚠️ **Connection pooling.** Supabase gives you two connection strings. The direct one
> (port 5432) allows a small number of simultaneous connections; the **pooler** (port
> 6543) allows many. This API keeps a pool of database connections open, so use the
> pooler URL for `DATABASE_URL` and add `?pgbouncer=true` to the end — without it you can
> hit "too many connections" under quite modest load. See the glossary for what a
> connection pool is.

---

### 2.2 Redis — the job queue

**What it is.** A very fast in-memory store. This app uses it for exactly one thing: a
shared to-do list between the API and the worker.

**Why it's needed.** The API and the worker are separate programs, possibly on separate
machines. When someone uploads a video, the API needs to tell the worker "there's work to
do". It does that by pushing a note onto a Redis list; the worker sits waiting to pull
notes off:

```python
# services/worker/worker/main.py
res = r.brpop([config.MEDIA_JOBS_KEY], timeout=5)
```

`BRPOP` means "**b**locking **r**ight **pop**" — take the next item off the list, and if
the list is empty, wait rather than returning immediately. The waiting happens *on the
Redis server*, so a job pushed mid-wait is delivered the instant it arrives. One wait,
however long, is one billable command.

**How the free tier works.** Upstash charges per *command*. Free tiers are generous for
bursty traffic, but an idle worker is not bursty — it re-asks on a fixed cycle forever.

> ⚠️ **This was a real cost trap.** At the original 5-second timeout: 12 commands/minute =
> **17,280/day ≈ 518,000/month while completely idle** — the same order as a typical free
> monthly allowance, spent before a single upload. `MEDIA_POLL_TIMEOUT_S` now defaults to
> **30**, which is ~86,000/month.
>
> **This costs nothing in responsiveness.** Because BRPOP blocks server-side, a queued job
> still comes back in 0 seconds; the timeout only governs how long an *empty* wait lasts.
> (Measured: a job pushed onto the list was returned immediately, while an empty queue
> blocked for the full window as a single command.) Set `MEDIA_POLL_TIMEOUT_S=2` locally
> if you prefer a tighter loop while developing.

**Recommended:** Upstash free. Redis is the cheapest part of this stack either way.

---

### 2.3 API hosting — the backend server

**What it is.** The NestJS program in `apps/api`. Every login, every route listing, every
signed video URL goes through it.

**How the free tier works.** Render's free web service **sleeps after 15 minutes with no
traffic**. The next visitor's request wakes it, which takes 30–60 seconds — during which
your app looks broken. This is called a **cold start**.

For a demo you show people on request, that's tolerable. For real users it is not: most
people abandon a page that hangs for 30 seconds.

**How the paid tier differs.** $7/mo (Render Starter) means the server simply never
sleeps. That is the whole difference, and it is the single highest-value £7 in this stack.

**Recommended:** Render free while testing → Render Starter ($7/mo) the day you have users
who didn't personally ask you for a demo link.

---

### 2.4 Web app hosting

**What it is.** `apps/web` compiles to plain HTML/CSS/JavaScript files. No server logic —
the browser downloads the files and talks to the API directly.

**Why it's basically free.** Serving static files is the cheapest thing on the internet.
Vercel's Hobby tier covers this comfortably.

One important detail already configured for you: `apps/web/vercel.json` forwards `/api`
requests to your API server. This makes the browser see one single origin
(`your-app.vercel.app`) instead of two, which avoids a whole class of **CORS** problems
(see glossary) *and* is required for the signed video gateway to work correctly.

**Recommended:** Vercel Hobby (free). Upgrade only if you need team seats or commercial
terms. Cloudflare Pages is an equally good free alternative.

---

### 2.5 Media worker hosting — ⚠️ the gap

**What it is.** The Python program in `services/worker`. It downloads the raw dashcam
clips, joins them, transcodes them into multiple qualities, makes thumbnails, syncs the
GPS to the video, and checks the drive against the reference route.

**Why it needs its own server.** It runs **ffmpeg** (see glossary) — the most
CPU-expensive thing this app does by a wide margin.

**What happens without it:** uploads reach R2 and stop there. No playable video, no
thumbnails, no GPS sync. The upload screen will say it succeeded, because it did — the
file arrived. Nothing then processes it.

**Why there's no free tier.** Free hosting is built for things that idle cheaply and
respond in milliseconds. A worker pinning a CPU for 40 minutes is the opposite. No
reputable provider gives that away, and `render.yaml` currently doesn't define this
service at all.

**How much CPU, realistically.** Encoding 20 minutes of 1080p into a 4-quality ladder,
for both front and rear cameras, is roughly **1.5–2 hours of single-core CPU time per
route** (an estimate from typical x264 throughput — measure yours). That means:

| Option | Spec | Cost | Time per route (est.) |
|---|---|---|---|
| Your own laptop | whatever you have | £0 | fastest, but only while it's on |
| Render Starter | 0.5 CPU, 512 MB | $7/mo | ~4 hours — slow but it works |
| Render Standard | 1 CPU, 2 GB | $25/mo | ~2 hours |
| **Hetzner CX22 VPS** | **2 vCPU, 4 GB** | **~€4/mo** | **~1 hour** |

**Hetzner is dramatically better value** — more CPU than Render Standard for a sixth of
the price. The trade-off is that it's a **VPS** (see glossary): a bare server you maintain
yourself — installing Docker, applying security updates, restarting things when they
break. Render does all that for you. You are paying Render for *not having to be a sysadmin*.

**Recommended path:**

1. **Now, pre-launch:** run the worker on your own machine with
   `docker compose up worker`, pointed at the live Redis, database and R2. It picks up
   real jobs from the real queue. Costs nothing, and it is a completely legitimate setup
   while you are the only person uploading.
2. **At launch, low volume:** Render Starter ($7/mo). Slow but hands-off.
3. **When transcoding is a bottleneck:** Hetzner (~€4/mo) if you're willing to learn
   basic server admin, or Render Standard ($25/mo) if you'd rather not.

---

### 2.6 Object storage — Cloudflare R2 ✅

**What it is.** Where the video files themselves live. Databases are bad at large files;
object storage is built for exactly this.

**Why R2 specifically.** Most providers charge **egress** — a fee every time data leaves
their network, i.e. every time someone watches a video. That's the dominant cost for a
video app. **R2 charges nothing for egress.** For your use case that isn't a small saving,
it's the difference between a viable and an unviable business model.

**Your costs:** ~$0.015 per GB per month, and roughly nothing else at your scale. Around
**6 GB per route** (ladder + master + raw clips) ≈ **$0.09/route/month** ≈ $9/mo for 100
routes, with unlimited viewing included.

**Already done.** Remaining setup: API token, env vars on both API *and* worker, and the
bucket **CORS policy** — which is not optional and is not something the API can supply.
Uploads go browser → R2 directly, so without it every upload fails its preflight with
`403 CORS not configured for this bucket` while `curl` against the same presigned URL
returns 200. The policy and the click path are in
[`infra/README-r2-cors.md`](../infra/README-r2-cors.md).

---

### 2.7 Payments

**Stripe** (web) — no monthly fee, ~1.5% + 20p per UK card transaction. You only pay when
you're paid. Needed for `STRIPE_SECRET_KEY` and the per-centre paywall.

**RevenueCat** (mobile) — Apple and Google force in-app purchases to go through their own
systems, which are fiddly; RevenueCat wraps both. Free until ~$2,500/month of revenue.

**Apple Developer Program — $99/year.** Unavoidable for an iOS app. Also required for
*Sign in with Apple*, which Apple's rules **mandate** if you offer Google sign-in — and
this app offers both.

**Google Play Developer — $25 once.** Unavoidable for Android.

---

### 2.8 Free and keyless

| Service | Used for | Note |
|---|---|---|
| **postcodes.io** | Postcode → coordinates, town, region | Free, no key, no signup |
| **OpenStreetMap tiles** | The map images | Free, but their policy forbids heavy commercial use — move to MapTiler or Stadia before real traffic |
| **Google Sign-In** | Login | Free; needs a Google Cloud project but no billing |
| **Sentry** | Error reporting | Optional; free tier is fine |
| **OpenAI** | Progress summaries | Optional — the code has an explicit fallback when no key is set |
| **Valhalla** | Turn-by-turn instructions | Optional — a geometry-based fallback exists |

---

### 2.9 Not bought yet, because nothing uses them yet

- **Email.** There is *no* email provider integrated anywhere in the codebase. No password
  reset, no receipts, no booking confirmations. You will need one (Resend or Postmark,
  free to start) — but this is a feature to build, not just an account to open.
- **Push notifications.** `notifications.service.ts` stores device tokens and writes
  in-app rows; nothing actually sends a push. FCM is free when you get there; APNs comes
  with the Apple account.

---

## 3. How free tiers work — the general pattern

Free tiers are not charity; they are a funnel. Providers make them **usable but
deliberately unsuitable for production**, in one of four ways:

1. **Sleeping / cold starts** — free things are switched off when idle (Render API,
   Supabase database). Costs the provider nothing; costs you a 30-second first load.
2. **Hard quotas** — a fixed number of operations or GB per month (Upstash commands, R2
   storage). Exceed it and you're either blocked or auto-upgraded.
3. **Missing safety features** — no backups, no uptime guarantee, no support. This is the
   one that actually bites, because you don't notice it until something goes wrong.
4. **Expiry** — Render's free Postgres is *deleted* after 30 days.

**The rule of thumb:** free tiers are excellent for building and demoing, and unsuitable
the moment a real person depends on the thing. The first two upgrades worth paying for are
always **(a) no cold starts** and **(b) database backups**.

---

## 4. Recommended stack and costs

### Stage 1 — now, pre-launch: **£0/month**

| Part | Provider | Note |
|---|---|---|
| Database | Supabase free | Use the **pooler** URL |
| Redis | Upstash free | Raise BRPOP timeout to 30s |
| API | Render free | Cold starts are fine for demos |
| Web | Vercel Hobby | |
| Storage | Cloudflare R2 | ✅ done |
| Worker | **your own laptop** | `docker compose up worker` |

### Stage 2 — real users: **~£28/month** (~$35)

| Part | Provider | Cost |
|---|---|---|
| Database | Supabase Pro | $25/mo — buy this for the **backups** |
| Redis | Upstash free | $0 |
| API | Render Starter | $7/mo — no more cold starts |
| Web | Vercel Hobby | $0 |
| Storage | Cloudflare R2 | ~$1–10 depending on library size |
| Worker | Hetzner CX22 | ~€4/mo (or Render Starter $7 to avoid server admin) |
| Domain | any registrar | ~£10/**year** |

Plus one-offs when you ship mobile: **Apple $99/year**, **Google Play $25 once**.

### Stage 3 — scale

Add a second worker (the design already supports running several in parallel — they all
pull from the same queue), a paid map tile provider, and an email service.

---

## 5. The honest summary

You have already bought the only *unusual* thing (R2). Everything else is either free at
your stage or costs less than a takeaway per month.

**The one genuine gap is worker hosting.** Until it's running somewhere, video upload does
not work end to end — and the cheapest correct answer today is to run it on your own
machine, which costs nothing.

---

## Glossary

**API** — the "brain" server. The web and mobile apps have no direct database access; they
ask the API for everything, which is what lets one set of rules (like the paywall) apply
to every client.

**CDN (Content Delivery Network)** — copies of your files kept in data centres worldwide,
so a user in Glasgow downloads from somewhere near Glasgow. This app deliberately does
*not* use a CDN for video, because CDN URLs are public and route footage is paid content.

**Cold start** — the delay when a sleeping server has to boot before answering. 30–60
seconds on free tiers.

**Connection pool** — opening a database connection is slow, so programs keep a handful
open and reuse them. Problem: each copy of your API keeps its own pool, and databases cap
total connections. A *pooler* (like PgBouncer) sits in front and shares a small number of
real connections among many clients.

**CORS (Cross-Origin Resource Sharing)** — a browser security rule: a page from site A
can't read data from site B unless B explicitly allows it. This is why R2 needs a CORS
policy naming your web address, and why the Vercel `/api` forwarding trick is useful.

**Egress** — data leaving a provider's network, i.e. downloads. Traditionally charged per
GB and the main cost of hosting video. R2 charges £0 for it.

**Extension (Postgres)** — an add-on that teaches the database new tricks. PostGIS adds
geography.

**ffmpeg** — the open-source tool that reads, converts and joins video. Free software, but
it needs CPU, and CPU is what you rent.

**HLS (HTTP Live Streaming)** — chopping video into ~6-second chunks plus a playlist
listing them, so a player can switch quality mid-stream when the connection changes.

**Job queue** — a shared to-do list. The API adds tasks, the worker takes them. Lets slow
work happen without making anyone wait.

**Managed service** — the provider handles updates, backups and restarts. You pay more
money and less attention. The opposite of a VPS.

**Object storage** — a giant hard drive on the internet, addressed by filename, built for
large files. R2, S3 and MinIO are all this.

**PostGIS** — the Postgres extension that understands coordinates, distances and shapes.

**Presigned URL** — a temporary link with a cryptographic signature and an expiry baked
in. Lets a browser upload straight to R2 without the API touching the bytes, and lets a
video be watched without making it public.

**Transcoding** — converting video from one format/quality to another. Making the 1080p /
720p / 480p / 360p versions is transcoding, and it's the expensive step.

**vCPU** — a share of a physical processor core. "0.5 vCPU" means roughly half a core, so
CPU-heavy work takes about twice as long.

**VPS (Virtual Private Server)** — a bare rented computer. Cheapest per unit of power,
but you install and maintain everything on it yourself.

**Worker** — a program with no web interface that just processes queued jobs.
