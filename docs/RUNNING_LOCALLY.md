# Test Routify — Run It Locally (for testing)

> A copy‑paste guide to get the whole app running on your machine so you can click
> through it. No prior backend/DevOps experience needed — just follow the steps in
> order. Every command block can be pasted as‑is.

Everything here has been run and verified against this repo. If a step fails, see
[Troubleshooting](#troubleshooting) at the bottom.

---

## 0. What you'll end up with

Four things running at once:

| Piece | What it is | URL |
|---|---|---|
| **Infrastructure** | Database + cache + file storage (in Docker) | — |
| **API** | The backend the apps talk to | http://localhost:3000 (docs at `/docs`) |
| **Web app** | The learner-facing app | http://localhost:5174 |
| **Admin app** | The staff dashboard | http://localhost:5180 |

The mobile (Flutter) app and the Python media worker are **optional** for basic
testing — the web app is the fastest way to see everything.

---

## 1. Install the prerequisites (one time)

| Tool | Why | Check it's installed |
|---|---|---|
| **Docker Desktop** | Runs the database, cache and storage for you | `docker --version` |
| **Node.js 20** | Runs the API and the two web apps | `node --version` |
| _(optional)_ Python 3.11 | Runs the media/AI worker | `python --version` |
| _(optional)_ Flutter 3.22+ | Runs the mobile app | `flutter --version` |

> Open **Docker Desktop** and let it finish starting before the next step.

All commands below are written for **Git Bash** (comes with Git on Windows) or a
Mac/Linux terminal. Run them from the repo root:
`c:\Users\sharma.rahul1\GIT-REPO\routing-app`.

---

## 2. Start the infrastructure (database, cache, storage)

This starts three background services in Docker. You never edit these — they just run.

```bash
docker compose -f infra/docker-compose.yml up -d
```

What just started:
- **PostgreSQL** (the database) on host port **5434**
- **Redis** (a fast cache / job queue) on **6379**
- **MinIO** (local file storage for videos) on **9000**, console on **9001**

Check they're healthy:

```bash
docker compose -f infra/docker-compose.yml ps
```

---

## 3. Create the database tables and demo data

The database starts empty. This loads the table definitions, then the schema
upgrades, then some demo accounts and routes. Paste the whole block:

```bash
# wait until Postgres is ready
until docker exec infra-postgres-1 pg_isready -U routesync >/dev/null 2>&1; do sleep 1; done

# load schema → phase migrations → seed data, in order
for f in schema.sql migrate_phases_13_17.sql \
         migrate_phase_19.sql migrate_phase_19b.sql migrate_phase_19c.sql \
         migrate_phase_20.sql \
         seed.sql seed_more.sql seed_booking_test.sql seed_test_centres_demo.sql; do
  echo "loading db/$f"
  docker exec -i infra-postgres-1 psql -U routesync -d routesync -v ON_ERROR_STOP=1 < "db/$f" \
    || { echo "FAILED on $f"; break; }
done
```

You should see each file print "loading…" with no `FAILED`. When it finishes you
have ~7 users, a handful of published routes, and 45 UK test centres.

> **Only run this once.** Re-running the seed files on an already-seeded database
> will error on duplicates (harmless, but confusing). To start completely fresh,
> see [Reset everything](#reset-everything).

---

## 4. Start the API (backend)

```bash
cd apps/api
cp .env.example .env
npm install
npm run prisma:generate
```

**Edit `apps/api/.env`** — change the database line so it points at Docker's
Postgres on port **5434**:

```
DATABASE_URL=postgresql://routesync:routesync@localhost:5434/routesync?schema=public
```

(Leave the rest as-is. `REDIS_URL` and `S3_ENDPOINT` already point at localhost.)

Now run it:

```bash
npm run start:dev
```

Leave this terminal running. The API is up when you can open
**http://localhost:3000/docs** (interactive API documentation).

---

## 5. Start the web app (learner-facing)

Open a **new terminal** (keep the API running) at the repo root:

```bash
cd apps/web
npm install
npm run dev
```

Open **http://localhost:5174**. It proxies API calls to the API automatically.

---

## 6. Start the admin app (optional)

Another **new terminal**:

```bash
cd apps/admin
npm install
npm run dev
```

Open **http://localhost:5180**.

---

## 7. Log in and test

Use these seeded accounts (all password **`Password123!`**):

| Role | Email | Use it to see… |
|---|---|---|
| Admin | `demo@routesync.uk` | Admin dashboard + the web app |
| Admin | `admin@routesync.uk` | Admin dashboard |
| Instructor | `instructor@routesync.uk` | Contributor / instructor tools |
| Learner | `learner@routesync.uk` | The normal learner journey |

### A good first test run (learner journey)
1. Go to **http://localhost:5174**, sign in as `learner@routesync.uk`.
2. You land on **Test Centres** — browse the list and open a centre to see its routes.
3. Open any route → the **first route you open becomes your one free demo route**
   (account-wide, any centre); you can watch/practise it.
4. Open a **different** route → you're sent to the **paywall** for that route's centre
   (per-centre Premium unlocks every route at that centre).

### Admin
Sign in to **http://localhost:5180** with `demo@routesync.uk`. Review the route
queue, users, instructors, revenue, etc.

---

## 8. (Optional) The media worker

Only needed if you want to test real video/GPS processing of uploads:

```bash
cd services/worker
cp .env.example .env
pip install -r requirements.txt
python -m worker.main
```

## 8b. (Optional) The mobile app

```bash
cd apps/mobile
flutter pub get
flutter run       # needs an emulator or a connected device
```

---

## Stopping and resetting

**Stop the apps:** press `Ctrl+C` in each `npm run` / API terminal.

**Stop the infrastructure (keeps your data):**
```bash
docker compose -f infra/docker-compose.yml down
```

### Reset everything
Wipes the database completely so you can re-run [step 3](#3-create-the-database-tables-and-demo-data) from scratch:
```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker: command not found` | Docker Desktop isn't installed or isn't running. Start it and retry. |
| API can't connect to the database | Make sure `DATABASE_URL` in `apps/api/.env` uses port **5434** (not 5432/5433), and that step 2 is running. |
| Web app shows "Cannot reach the server" | The API (step 4) isn't running, or crashed — check its terminal. |
| Port already in use (3000/5174/5180/5434) | Another app is using it. Stop that app, or change the port. |
| Seed step prints `FAILED … duplicate key` | The database was already seeded. Either skip step 3, or [reset](#reset-everything) first. |
| `psql`/container name not found | The Postgres container is named `infra-postgres-1`. Confirm with `docker ps`. |

---

## What "port" numbers to remember

| Service | URL |
|---|---|
| API + Swagger docs | http://localhost:3000/docs |
| Web app | http://localhost:5174 |
| Admin app | http://localhost:5180 |
| MinIO storage console | http://localhost:9001 (user `routesync` / pass `routesync123`) |

That's it — you now have the full stack running locally for testing.
