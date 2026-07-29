# Test Routify — Project Status & Task Tracker

**Last updated:** 2026-07-25 · **Living document** — update as work lands.
Legend: ✅ done & verified · 🟡 partial / needs work · ⬜ not started · ⏸ deferred (by decision)

> Companion docs: build roadmap [`ROADMAP.md`](ROADMAP.md) · deploy
> [`DEPLOY_STEP_BY_STEP.md`](DEPLOY_STEP_BY_STEP.md) · monetisation
> [`MONETIZATION_STRATEGY.md`](MONETIZATION_STRATEGY.md) / [`REVSHARE_PLAN.md`](REVSHARE_PLAN.md) ·
> video/GPS [`VIDEO_GPS_SYNC_GUIDE.md`](VIDEO_GPS_SYNC_GUIDE.md) ·
> credentials [`THIRD_PARTY_CREDENTIALS.md`](THIRD_PARTY_CREDENTIALS.md).

---

## 1. Status by area

### Backend API (NestJS) — mostly ✅
| Area | Status | Notes |
|---|---|---|
| Auth — email/password | ✅ | register/login/refresh/logout, JWT rotation, single-session (ADI) |
| Auth — Google | ✅ | verifies ID token; needs `GOOGLE_CLIENT_ID` set (multi-client supported) |
| Auth — Apple | ✅ | real RS256/JWKS verification, unit-tested; needs `APPLE_CLIENT_ID` set |
| Auth — account linking by verified email | ✅ | no duplicate accounts; anti-takeover on unverified email |
| Auth — email verification + password reset | ⬜ | not built |
| Test Centres (browse + admin/instructor CRUD + geocode) | ✅ | postcodes.io |
| Routes (belong to a centre, global search, miles, instructor byline) | ✅ | |
| Access model (per-centre paywall + one free demo route) | ✅ | old test-details gate removed |
| Bookings (instructor profiles, slots, 10% commission) | ✅ | payouts not wired |
| Community (credits / reputation / badges / leaderboards) | ✅ | see tech-debt notes |
| Community Fund (charity ledger) | ✅ | 10% of net profit monthly cron |
| Rev-share engine (Phase 21) | ✅ | shadow mode, instructor share = 0%, admin Earnings panel |
| Subscription invoices + amortised attribution (Phase 22) | ✅ | actual-cash basis w/ estimate fallback |
| GPS↔R1 conformance engine (Phase 23) | ✅ | matching/deviation/coverage/splice/timeline + journey API + seeder |
| Progress / Offline / Notifications | ✅ | from earlier phases |

### Web app (learner + merged admin at /admin) — ✅
| Area | Status | Notes |
|---|---|---|
| Test Centres, Discover, Route detail, Account, Paywall, Bookings, Progress, Contribute | ✅ | Phase 20 redesign |
| Watch / Practice pages | ✅ | + watch-time beacons + instructor "Book a lesson" CTA |
| Read-only users + "Become an Instructor" | ✅ | |
| Admin console (queue/users/instructors/bookings/revenue/fund/earnings/reports) | ✅ | lazy, role-gated, single login |
| **Map follows the marker along R1 on WatchPage** | ⬜ | still a static map centre |
| Google/Apple sign-in **buttons** on web | ⏸ | backend ready; mobile is the social target |

### Admin — ✅ (all panels live, incl. Instructor Earnings shadow report)

### Mobile app (Flutter) — 🟡 scaffolded but stale
| Area | Status | Notes |
|---|---|---|
| App structure (features: auth, home, search, route_detail, route_player, practice, account, subscription, contribute, test_details, shell) | 🟡 | exists but predates the Phase 20 redesign |
| Email login | 🟡 | `login_screen.dart` / `auth_controller.dart` exist |
| **Native Google / Apple sign-in** | ⬜ | not wired (backend endpoints are ready) |
| Secure token storage + refresh interceptor | 🟡 | verify against `flutter_secure_storage` + 401→refresh |
| Feature parity with Phase 20 (Test Centres first-class, no test-details gate, miles) | ⬜ | screens still old model (`test_details` etc.) |
| In-app journey recording + live deviation warning | ⬜ | the R1-recording flow |

### Worker (Python media pipeline) — 🟡
| Area | Status | Notes |
|---|---|---|
| Legacy upload pipeline (transcode, face/plate blur, GPS validation, gap detection, quality, sync_engine) | ✅ | for the original upload flow |
| **Journey-driven splice/transcode (consumes `journey_segments`)** | ⬜ | the new R1 flow — not wired |
| Video↔GPS + front/rear sync for the new flow (speed/audio correlation) | ⬜ | phone=exact, dashcam=correlation |
| Valhalla map-matching integration (`VALHALLA_URL`) | 🟡 | referenced; confirm/host |

### Deploy / infra — 🟡
| Area | Status | Notes |
|---|---|---|
| Vercel (web) + Render (API/worker) + Supabase (DB) wired | ✅ | |
| Supabase migrations 20→23 applied | ⬜ | **required** — see DEPLOY doc |
| Stripe activated (live keys + price IDs) | ⬜ | payments inactive until then |
| Login latency (Render free-tier cold start + region) | ⬜ | diagnosed; fix pending |
| `render.yaml` region fix (`S3_REGION`→`auto`, add `region: frankfurt`) | ⬜ | pending your go-ahead |
| `DATABASE_URL` via Supabase pooler (6543) | ⬜ | recommended |

---

## 2. Remaining task board (prioritised)

### P1 — unblock production
- [ ] Apply Supabase migrations `20 → 23` (or `bootstrap.sql` if fresh).
- [ ] Fix login latency: Render **Starter** (or keep-warm ping) + `region: frankfurt` + pooler `DATABASE_URL`.
- [ ] Decide `render.yaml`: revert `S3_REGION` to `auto`, add `region: frankfurt`.
- [ ] Set `GOOGLE_CLIENT_ID` + `APPLE_CLIENT_ID` on Render (unblocks social login).
- [ ] Activate Stripe (secret key, webhook secret, real £4.99/£39.99 price IDs) — only when charging.

### P2 — mobile app (next big build)
- [ ] Auth: native Google (`google_sign_in`) + Apple (`sign_in_with_apple`) + email → existing endpoints.
- [ ] Secure token storage (`flutter_secure_storage`) + 401→refresh + `SESSION_INVALIDATED` handling.
- [ ] Rework screens to Phase 20 model (Test Centres first-class, drop test-details gate, miles, instructor byline).
- [ ] In-app journey recording: start journey → capture GPS → live `/journeys/:id/check` deviation warning → submit.

### P3 — video pipeline (the "muscle")
- [ ] Worker: consume `journey_segments` → splice video to on-route spans → transcode HLS.
- [ ] Video↔GPS sync (phone = shared clock; dashcam = speed correlation) + front↔rear audio correlation.
- [ ] Derive `route_markers` / `route_instructions` at `t_ms` from R1 (Valhalla).
- [ ] Web: `WatchPage` map follows the marker along R1 (new `route_timeline` artifact).

### P4 — polish / correctness
- [ ] Email verification + password reset flow.
- [ ] Reputation double-path fix (verify `+20` doesn't double-count with recompute).
- [ ] Decide whether credits are redeemable (currently a vanity counter).

---

## 3. Known issues / tech debt
- **Login latency** — Render free tier sleeps (30–60 s cold start) + likely cross-region DB. Diagnosed; infra fix pending (P1).
- **`render.yaml`** — local edit set `S3_REGION: EU/UK` (invalid; R2 needs `auto`); not committed, awaiting fix.
- **Reputation** — `onInstructorVerified` adds `+20` but `onRoutePublished` recomputes with its own `+20`; paths not perfectly consistent.
- **Credits** — earned but not spendable anywhere yet.
- ~~Yearly price mismatch £29.99 vs £39.99~~ — ✅ fixed.

---

## 4. Deferred (by decision)
- ⏸ **Phone / SMS login** — cost + toll-fraud; email/Google/Apple cover launch (revisit via Firebase).
- ⏸ **Rev-share Phase 3** (real instructor payouts, Stripe Connect) — instructor share is 0% at launch (charity + marketing); flip `revshare_instructor_pct` + legal sign-off first.
- ⏸ **Web social-login buttons** — backend ready; mobile is the priority surface.

---

## 5. Recently completed (this cycle)
Phases 21–23 + auth hardening: rev-share shadow engine, subscription invoices +
amortised attribution, the GPS↔R1 conformance engine (+ demo seeder), production
Apple Sign-In verification + account linking, the video/GPS sync guide, the
third-party credentials tracker, and the git-ignored local credentials store.
