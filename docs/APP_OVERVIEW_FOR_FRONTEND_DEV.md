# Test Routify — The Whole App, Explained for a Frontend Developer

> You know how to build UIs. This document explains **everything else** — the
> backend, the database, background jobs, storage, deployment — at an **abstract
> level**. The goal is understanding, not implementation. You won't write any of
> this by hand; you just need a clear mental model of how the pieces fit.

---

## 1. The one-paragraph mental model

Think of the app as a **restaurant**:

- **The dining room** = the parts you already know: the **web app, admin app, and
  mobile app**. This is what users see and touch.
- **The kitchen** = the **backend API**. Customers never enter it. They send orders
  (requests) and get plates back (responses). All the real decisions happen here.
- **The pantry / cold store** = the **database**. Where ingredients (data) are kept
  in an organised, permanent way.
- **The prep cooks working out of sight** = the **background worker**. Slow jobs
  (chopping vegetables = processing videos) happen back here so the dining room
  stays fast.
- **The order-ticket rail** = the **queue** (Redis). Tickets line up for the prep
  cooks to pick up.
- **The walk-in freezer for bulky items** = **object storage**. Big files (videos)
  live here, not in the pantry.

Your world is the dining room. This doc walks you through the rest of the kitchen.

---

## 2. The pieces of *this* app

Here's every part of Test Routify and which folder it lives in:

| Piece | Plain-English job | Folder | Tech |
|---|---|---|---|
| **Web app** | Learner-facing site (you know this world) | `apps/web` | React + Vite |
| **Admin app** | Staff dashboard to approve routes, manage users | `apps/admin` | React + Vite |
| **Mobile app** | Native iOS/Android version | `apps/mobile` | Flutter (Dart) |
| **API (backend)** | The "kitchen" — all business rules, auth, data access | `apps/api` | NestJS (TypeScript) |
| **Worker** | Background video/GPS/AI processing | `services/worker` | Python |
| **Database schema** | The shape of the stored data + upgrades | `db` | SQL (Postgres) |
| **Infrastructure** | Local Docker setup for DB/cache/storage | `infra` | docker-compose |
| **Docs** | What you're reading | `docs` | Markdown |

Three frontends, one backend, one worker, and the plumbing underneath.

---

## 3. Frontend vs. Backend — the core split

You already build the **frontend**: it runs in the user's browser or phone. It's
great at showing things and reacting to clicks, but it can't be *trusted* and can't
*remember* anything on its own.

The **backend** runs on a server you control. It exists because:

- **Trust / security.** Anyone can open your frontend code and tamper with it. So
  the rules that *matter* ("is this user allowed to watch this route?") must be
  enforced on the backend, where users can't reach the code. In Test Routify, the
  frontend *asks* "can I open this route?" but the **backend decides**.
- **Shared truth.** Every user's phone, laptop and the admin dashboard must see the
  same data. That single source of truth lives on the backend.
- **Secrets.** Payment keys, database passwords — these can never ship in frontend
  code. They live only on the backend.

> **Rule of thumb:** the frontend is a *pretty remote control*. The backend is the
> *actual machine*. Never trust the remote to enforce anything important.

---

## 4. How the frontend talks to the backend — the API

They talk over **HTTP**, the same protocol your browser already uses for every page
load. The backend exposes a set of **URLs** (called an **API**), and the frontend
sends **requests** to them and gets **JSON** back.

A request is basically: *a verb + a URL + (optionally) some data*.

| Verb | Means | Example in Test Routify |
|---|---|---|
| `GET` | "give me" | `GET /routes` → the list of routes |
| `POST` | "create / do" | `POST /auth/login` → log in |
| `PATCH` | "update part of" | `PATCH /users/me` → change your name |
| `DELETE` | "remove" | delete something |

The reply carries a **status code**: `200` = ok, `401` = not logged in, `403` =
logged in but not allowed, `404` = not found, `500` = server broke. You've seen
these in your browser's network tab — that's exactly this.

In this repo you can **see and try every endpoint** at
**http://localhost:3000/docs** (an auto-generated, clickable API catalogue called
Swagger). That page *is* the contract between frontend and backend.

---

## 5. The database — where data lives forever

The **database** is a program whose only job is to store data safely and hand it
back fast. Test Routify uses **PostgreSQL** ("Postgres").

Picture a set of **spreadsheets called tables**. Each table holds one kind of thing,
one row per item:

- a `users` table (one row per account)
- a `routes` table (one row per driving route)
- a `subscriptions` table (one row per paid subscription)
- a `test_centres` table (one row per UK test centre)

Rows in different tables link by **IDs** (a `route` row stores the `id` of the
`user` who made it). That's the whole idea — organised, linked spreadsheets that
never forget.

The backend is the **only** thing that talks to the database. Frontends never do.

### Why "migrations" exist (and why you kept hearing that word)

The database's structure — which tables and columns exist — is called the
**schema**. As the product grows, the schema must change: add a column, add a table.

But the database is already **full of real data** you can't lose. You can't just
"replace the file." A **migration** is a small, careful script that says *"add this
column"* or *"create this table"* to an **existing, populated** database without
destroying anything.

> Analogy: renovating a house **while people live in it**. You don't bulldoze and
> rebuild — you carefully add a room without disturbing the furniture. Each
> renovation step is a "migration".

In this repo, migrations are the `db/migrate_*.sql` files. Recent product changes
(per-test-centre subscriptions, the one-route demo limit, and the first-class Test
Centres module — `db/migrate_phase_20.sql`) each shipped as one of these scripts.
Running them upgrades the database in place; running them twice is safe (they check
"does this already exist?" first).

---

## 6. The background worker + the queue — for slow work

Some tasks are **too slow to do while the user waits**. When an instructor uploads a
20-minute dashcam video, Test Routify must stitch clips, sync them to GPS, blur faces
and number plates, and score quality. That takes minutes.

If the backend did that during the upload request, the user's app would freeze for
minutes. So instead:

1. The API quickly says "got it, we're processing" and drops a **ticket** onto a
   **queue** (that's **Redis** — a very fast in-memory list).
2. A separate program, the **worker**, picks tickets off the queue and does the slow
   work in the background.
3. When it's done, the route becomes available.

> Analogy: you drop your coat at the cloakroom and get a ticket immediately (fast
> response). Someone hangs it up later (background work). You don't stand and wait.

Redis is also used as a **cache** — a scratchpad for answers the backend wants to
reuse quickly instead of asking the database every time.

---

## 7. Object storage — where the big files go

Databases are great for small, structured data (names, dates, IDs) but **terrible
for big files** like videos. Those go into **object storage** instead — think of it
as a giant, cheap, infinite hard drive in the cloud (Amazon S3, Cloudflare R2).
Locally, Test Routify fakes this with a tool called **MinIO**.

The pattern: the video file lives in object storage; the **database only stores a
short pointer** ("the video is at this location"). When a learner watches a route,
the backend hands the app a temporary, expiring link to stream the file directly
from storage.

---

## 8. Authentication — how "logged in" works

When you log in, the backend checks your password and gives your app a **token** — a
tamper-proof digital wristband (the tech is called **JWT**). Your app then attaches
that wristband to **every** request, so the backend knows who you are without you
re-entering your password each time.

- Tokens **expire** quickly for safety; a longer-lived "refresh token" quietly gets
  you a new one (you've probably noticed apps keeping you logged in — that's this).
- The wristband also carries your **role** (learner / instructor / admin), which
  controls what you're allowed to do.

You already store the token in the frontend and send it along; the **enforcement**
of what it unlocks happens on the backend.

---

## 9. Environment variables & secrets

The same code has to run on your laptop and on the real server, but with **different
settings** (which database, which payment keys). Those settings live outside the
code in **environment variables** — a plain list of `NAME=value` pairs, usually in a
file called `.env`.

- `.env.example` files are the *template* (safe to commit).
- Your real `.env` holds actual values and passwords and is **never committed** to
  git.

This is why the run guide has you copy `.env.example` to `.env` and tweak a value.

---

## 10. Docker & docker-compose — running the plumbing painlessly

Installing Postgres, Redis and MinIO by hand on every machine is fiddly and
version-fragile. **Docker** solves this: it packages a program *plus everything it
needs* into a **container** — a sealed box that runs identically on any computer.

> Analogy: a shipping container. The contents behave the same whether the ship,
> truck, or train carries it. "Works on my machine" stops being a problem.

**docker-compose** is a single file that says "run these several containers
together" (Postgres + Redis + MinIO). That's what `infra/docker-compose.yml` does,
and why local setup is just `docker compose up`. There are also **Dockerfiles**
(recipes for packaging *our* apps into containers for deployment).

---

## 11. CI/CD — the robot that checks and ships your code

**CI/CD** = Continuous Integration / Continuous Deployment. It's an automation robot
(here, **GitHub Actions**) that runs every time code is pushed:

- **CI (integration):** automatically builds the apps and runs the tests/checks, so
  a broken change is caught **before** it reaches anyone.
- **CD (deployment):** if everything passes, it packages the apps (into Docker
  containers) and can ship them to the server automatically.

The config lives in `.github/workflows/`. You mostly benefit from it silently: push
code, the robot tells you if you broke something.

---

## 12. Deployment — what "going live" actually means

"Deploying" just means **running your app on a computer other people can reach**,
instead of only on your laptop.

The pieces that run on your machine (API, database, worker, the built web files)
need a permanent home:

- The **web/admin apps** are built into plain static files (HTML/JS/CSS) and served
  from a fast host or CDN.
- The **API and worker** run as containers on a server (or a platform like Fly.io,
  Render, AWS).
- The **database, Redis and storage** become *managed* cloud versions (someone else
  keeps them alive and backed up) instead of your local Docker ones.
- A **domain name** (routesync.co.uk) points at it, with **HTTPS** for security.

Nothing about the *logic* changes — deployment is about **location and reliability**:
always-on, backed up, secured, and able to handle many users.

---

## 13. One click, end to end — following a single action

To tie it together, here's what happens when a learner taps **"Watch route"**:

1. **Web app (frontend)** sends `GET /routes/123/access` with the user's token.
2. **API (backend)** checks: are you logged in? do you have Premium for this route's
   test centre, or is this your one free demo route (or the first route you've opened)?
   It answers `allowed` / `paywall`.
3. If allowed, the app requests the video; the **API** looks up the file's location
   in the **database**, then returns a temporary streaming link into **object
   storage**.
4. The **web app** plays the video from that link.
5. (Separately, earlier) that video only existed because an instructor uploaded it,
   the API queued a job in **Redis**, and the **worker** processed it in the
   background.

Every concept above shows up in that one interaction.

---

## 14. The Test Routify business rules worth knowing

A few product rules are enforced in the backend and shape the whole UX:

- **Registration is required for everything** — there's no anonymous access.
- **Learners browse freely** — there's no mandatory test-centre/test-date gate. Test
  centres are a first-class, browsable section (the default landing page).
- **Demo (free) users get exactly one route total** — the first route they open becomes
  their free demo route (account-wide, any centre); any further route hits the paywall.
- **Premium is bought per test centre and isn't switchable** — it unlocks all routes at
  that centre; covering two centres means two subscriptions.
- **Booking an instructor never requires Premium.**

The backend's job is to make these true no matter what the frontend does.

---

## 15. Who typically owns what

| Area | You (frontend) | Backend/infra folks |
|---|---|---|
| UI, screens, interactions | ✅ | |
| Calling the API, showing responses | ✅ | |
| Deciding *rules* (who can do what) | | ✅ |
| Database & migrations | | ✅ |
| Background jobs / worker | | ✅ |
| Deployment, CI/CD, secrets | | ✅ |

You don't need to *build* the right-hand column — but now you can **talk about it,
read it, and know where things live** when something breaks or a feature spans both
sides.

---

## 16. Mini glossary

| Term | In one line |
|---|---|
| **API** | The set of backend URLs the frontend calls. |
| **Endpoint** | One specific URL of the API (e.g. `POST /auth/login`). |
| **Backend / server** | Code that runs on a computer you control, not the user's. |
| **Database** | Organised, permanent storage of data (Postgres here). |
| **Schema** | The structure of the database (its tables and columns). |
| **Migration** | A script that safely changes the schema of a live database. |
| **Seed** | Fake starter data (demo accounts/routes) for development. |
| **Redis** | A very fast in-memory store used as a cache and a job queue. |
| **Worker** | A background program that does slow jobs off the queue. |
| **Object storage** | Cloud "infinite hard drive" for big files like videos (S3/R2/MinIO). |
| **JWT / token** | A tamper-proof "logged-in wristband" the app sends on each request. |
| **Environment variable** | A setting kept outside the code (in `.env`). |
| **Docker / container** | A sealed box that runs a program identically anywhere. |
| **docker-compose** | A file that runs several containers together. |
| **CI/CD** | Robots that test and ship your code on every push. |
| **Deployment** | Running the app on servers real users can reach. |
| **Swagger** | The clickable, auto-generated API documentation at `/docs`. |

---

*Want to actually see it running? Follow [`RUNNING_LOCALLY.md`](RUNNING_LOCALLY.md).*
*Want the deep technical design? See [`ARCHITECTURE.md`](ARCHITECTURE.md).*
