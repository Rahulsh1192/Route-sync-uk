# RouteSync Admin Dashboard (React + Vite)

Desktop, data-dense admin console (deliverable #12). Kept separate from the
mobile learner app on purpose — different device target, different UX.

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (proxies /api → http://localhost:3000)
```

Sign in with a `moderator`/`admin` account (create one, then promote its `role`
in the DB). The token is stored in localStorage and attached as a bearer token.

## Implemented

- **Review queue** (`src/ReviewQueue.tsx`) — lists routes in `in_review`/`flagged`
  from `GET /api/admin/review-queue`, shows quality + sync-confidence pills,
  flags instructor fast-track, and approves/rejects via
  `POST /api/admin/routes/:id/moderate`. Header shows live `GET /api/admin/analytics`.
- **Login** (`src/Login.tsx`) — `POST /api/auth/login`.
- **API client** (`src/api.ts`) — typed fetch wrapper with auth + problem+json errors.

## Still to build (contracts exist in the API `/admin/*` routes)

- Per-route detail with pipeline-stage findings + blur preview before approving.
- **Route moderation** & **User management** (roles, suspensions, GDPR actions).
- **Instructor verification** — approve ADI evidence.
- **Analytics** — `GET /api/admin/analytics` (DAU, conversion, watch funnels).
- **Revenue** (Stripe/IAP) and **Fund management** (allocations, beneficiaries, reports).

Auth: log in via `/api/auth/login` as a `moderator`/`admin` user; attach the bearer
token to all requests. All admin endpoints are RBAC-guarded server-side.
