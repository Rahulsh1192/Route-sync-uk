# Test Routify

A UK driving-route learning platform: watch real, GPS-synchronised driving routes
(front + rear dashcam) and practise them later as turn-by-turn voice navigation.

- **New to full-stack? Start here:** [`docs/APP_OVERVIEW_FOR_FRONTEND_DEV.md`](docs/APP_OVERVIEW_FOR_FRONTEND_DEV.md) — every part of the app explained at an abstract level.
- **Run it locally (testing):** [`docs/RUNNING_LOCALLY.md`](docs/RUNNING_LOCALLY.md) — verified copy-paste launch guide.
- **Architecture & all design deliverables:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Build roadmap & progress:** [`docs/ROADMAP.md`](docs/ROADMAP.md)
- **Database schema:** [`db/schema.sql`](db/schema.sql)

## Monorepo layout

```
apps/api        NestJS business API (TypeScript)
apps/web        React + Vite web app (responsive, mobile-friendly) — includes the admin
                console at /admin (lazy-loaded, admin/moderator only) — ships first
apps/mobile     Flutter app (future native build)
services/worker Python media + AI pipeline (FFmpeg/OpenCV/YOLO/Whisper)
infra           docker-compose for local dev (postgres+postgis, redis, minio)
db              SQL schema + migrations
```

## Tech stack (free / local-friendly)

| Layer | Prod | Local dev |
|---|---|---|
| Mobile | Flutter | — |
| Web + Admin | React + Vite | node 20 |
| API | NestJS | node 20 |
| Workers | Python (FFmpeg/OpenCV/YOLO/Whisper) | python 3.11 |
| DB | Postgres 16 + PostGIS | docker (postgis/postgis) |
| Cache/queue | Redis (BullMQ + RQ) | docker |
| Storage | Cloudflare R2 | MinIO (docker) |
| Transcode/CDN | Cloudflare Stream | local FFmpeg HLS |
| Maps/routing | OSM + Valhalla | OSRM demo |
| Payments | Stripe (web) + RevenueCat/IAP (mobile) | test mode |

## Quick start (local)

```bash
# 1. infrastructure (postgres+postgis, redis, minio)
cd infra
docker compose up -d

# 2. load schema
docker compose exec -T postgres psql -U routesync -d routesync < ../db/schema.sql

# 3. API
cd ../apps/api
cp .env.example .env
npm install
npm run start:dev          # http://localhost:3000 , Swagger at /docs

# 4. worker
cd ../../services/worker
cp .env.example .env
pip install -r requirements.txt
python -m worker.main
```

See each package's README for details. This repo is a working scaffold of the
production design in `docs/ARCHITECTURE.md`; modules marked `// TODO` are stubs with
their contracts defined.
