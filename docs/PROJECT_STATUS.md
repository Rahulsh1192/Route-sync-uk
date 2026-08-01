# Test Routify — Project Status & Task Tracker

**Last updated:** 2026-07-30 · **Living document** — update as work lands.
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
| **Map follows the marker along R1 on WatchPage** | ✅ | Phase 24 — polyline + interpolated rotating marker, new "All" view (front+rear+map in one container), ±10 s skip, follow toggle |
| **Map provider switch (Leaflet now, Google later)** | ✅ | `VITE_MAP_PROVIDER` + `VITE_GOOGLE_MAPS_API_KEY`; Google impl is written and lazy-chunked, keyless falls back to Leaflet |
| **Dashcam upload wizard (4 steps)** | ✅ | Phase 24 — GPS-source choice, multi-file front/rear/GPS, detected clip order + gap report + reconciliation review with reorder, then upload |
| Google/Apple sign-in **buttons** on web | ⏸ | backend ready; mobile is the social target |

### Admin — ✅ (all panels live, incl. Instructor Earnings shadow report)

### Mobile app (Flutter) — 🟡 auth done, screens still stale
| Area | Status | Notes |
|---|---|---|
| App structure (features: auth, home, search, route_detail, route_player, practice, account, subscription, contribute, test_details, shell) | 🟡 | exists but predates the Phase 20 redesign |
| Email login | ✅ | `login_screen.dart` / `auth_controller.dart` |
| **Native Google / Apple sign-in** | ✅ | commit `9458836` — ID/identity token → existing endpoints, cancel handled, Apple first-run name |
| Secure token storage + refresh interceptor | ✅ | `flutter_secure_storage` + single-retry 401→refresh with replay + `SESSION_INVALIDATED` forced logout |
| Feature parity with Phase 20 (Test Centres first-class, no test-details gate, miles) | ⬜ | screens still old model (`test_details` etc.) |
| In-app journey recording + live deviation warning | ⬜ | the R1-recording flow (UC2 depends on this) |
| Bookings / progress / offline / push / community screens | ⬜ | all endpoints live and unconsumed |

### Worker (Python media pipeline) — ✅ dashcam path built (Phase 24)
| Area | Status | Notes |
|---|---|---|
| Legacy upload pipeline (transcode, face/plate blur, GPS validation, gap detection, quality, sync_engine) | ✅ | for the original upload flow |
| **Dashcam filename/format registry** | ✅ | `dashcam_formats.py` — Viofo/BlackVue/Thinkware/Vantrue/70mai/Nextbase + generics, extensible at runtime via `platform_config.dashcam_format_registry` |
| **Multi-file GPS ingest + merge** | ✅ | `gps_ingest.py` — GPX/NMEA/CSV/KML/embedded, timestamp-sorted, overlap-deduped, teleports dropped, per-file reporting |
| **Clip→wall-clock mapping (anti-drift)** | ✅ | `clip_timeline.py` + `route_clip_timeline` — inter-clip gaps preserved, overlaps trimmed |
| **Video↔GPS reconciliation + wrong-clock detection** | ✅ | `reconcile.py` — containment not equality; infers timezone/DST offsets |
| **Front↔rear audio correlation** | ✅ | `audio_sync.py` → `route_videos.sync_offset_ms` |
| **R1 conformance on uploads** | ✅ | worker → `POST /api/internal/journeys/analyse-upload`; `matching.ts` stays the single source of truth |
| **`route_track_points` written** | ✅ | R1-snapped timeline on video time — this is what the moving map reads |
| Journey-driven splice (cut video to on-route spans) | 🟡 | kept segments are returned and stored; the splice-and-re-encode step itself is not wired |
| Video-motion (optical-flow) signal for dashcam↔GPS correlation | ⬜ | UC2 currently aligns on timestamps + GPS speed; flagged for instructor confirmation when weak |
| Valhalla map-matching integration (`VALHALLA_URL`) | 🟡 | referenced; confirm/host |

### Deploy / infra — 🟡
| Area | Status | Notes |
|---|---|---|
| Vercel (web) + Render (API/worker) + Supabase (DB) wired | ✅ | |
| Supabase migrations 20→**24** applied | ⬜ | **required** — Phase 24 adds `route_clip_timeline`, upload provenance, new pipeline-stage enum values |
| `WORKER_SHARED_SECRET` set on **both** API and worker | ⬜ | **required for dashcam uploads** — without it conformance is skipped and routes are flagged |
| `tzdata` in the worker image | ✅ | pinned in `requirements.txt`; without it dashcam filenames read as UTC (1 h of BST drift) |
| `exiftool` in the worker image (optional) | ⬜ | unlocks the "GPS embedded in video" source, which is the frame-exact one |
| Stripe activated (live keys + price IDs) | ⬜ | payments inactive until then |
| Login latency (Render free-tier cold start + region) | ⬜ | diagnosed; fix pending |
| `render.yaml` region fix (`S3_REGION`→`auto`, add `region: frankfurt`) | ⬜ | still pending — the local edit to `EU/UK` is invalid for R2 and remains uncommitted |
| `DATABASE_URL` via Supabase pooler (6543) | ⬜ | recommended |

---

## 2. Remaining task board (prioritised)

### P1 — unblock production
- [ ] Apply Supabase migrations `20 → 24` (or `bootstrap.sql` if fresh).
- [ ] Set `WORKER_SHARED_SECRET` on **both** the API and the worker (dashcam conformance).
- [ ] Fix login latency: Render **Starter** (or keep-warm ping) + `region: frankfurt` + pooler `DATABASE_URL`.
- [ ] Decide `render.yaml`: revert `S3_REGION` to `auto`, add `region: frankfurt`.
- [ ] Set `GOOGLE_CLIENT_ID` + `APPLE_CLIENT_ID` on Render (unblocks social login).
- [ ] Activate Stripe (secret key, webhook secret, real £4.99/£39.99 price IDs) — only when charging.
- [ ] End-to-end test Phase 24 with real dashcam footage (see §6).

### P2 — mobile app (next big build)
- [x] Auth: native Google (`google_sign_in`) + Apple (`sign_in_with_apple`) + email → existing endpoints.
- [x] Secure token storage (`flutter_secure_storage`) + 401→refresh + `SESSION_INVALIDATED` handling.
- [ ] Rework screens to Phase 20 model (Test Centres first-class, drop test-details gate, miles, instructor byline).
- [ ] In-app journey recording: start journey → capture GPS → live `/journeys/:id/check` deviation warning → submit.
      **This is what unblocks usecase 2** (dashcam without GPS) — the upload side already accepts it.
- [ ] Mobile Map view: consume the new track from `/routes/:id/playback` (or `/routes/:id/track`).
- [ ] Bookings, progress, offline packages, push notifications, community screens.

### P3 — video pipeline (the "muscle")
- [x] Multi-clip concatenation on a verified timeline + clip→wall-clock mapping (anti-drift).
- [x] Multi-file GPS merge, duration reconciliation, front↔rear audio sync, R1 conformance, track points.
- [ ] Worker: consume `journey_segments` → splice video to on-route spans → transcode HLS.
- [ ] Video-motion (optical-flow) signal so UC2's dashcam↔GPS alignment is measured, not estimated.
- [ ] Instructor "scrub-to-match" confirmation UI for low-confidence alignments.
- [ ] Derive `route_markers` / `route_instructions` at `t_ms` from R1 (Valhalla).

### P4 — polish / correctness
- [ ] Email verification + password reset flow (needs an email transport — none exists yet).
- [ ] Reputation double-path fix (verify `+20` doesn't double-count with recompute).
- [ ] Decide whether credits are redeemable (currently a vanity counter).

---

## 3. Known issues / tech debt
- **Login latency** — Render free tier sleeps (30–60 s cold start) + likely cross-region DB. Diagnosed; infra fix pending (P1).
- **`render.yaml`** — local edit set `S3_REGION: EU/UK` (invalid; R2 needs `auto`); not committed, awaiting fix.
- **Reputation** — `onInstructorVerified` adds `+20` but `onRoutePublished` recomputes with its own `+20`; paths not perfectly consistent.
- **Credits** — earned but not spendable anywhere yet.
- **No email transport** — `notifications.service.ts` persists in-app rows only; push (FCM/APNs) and email are both unwired, which is what blocks email verification / password reset.
- **Phase 24 clip trimming** — the timeline emits `trim_start_ms` for overlapping clips and the media layer honours it by re-encoding that clip. Accurate, but a clip-boundary overlap costs one extra encode.
- ~~Yearly price mismatch £29.99 vs £39.99~~ — ✅ fixed.

---

## 4. Deferred (by decision)
- ⏸ **Phone / SMS login** — cost + toll-fraud; email/Google/Apple cover launch (revisit via Firebase).
- ⏸ **Rev-share Phase 3** (real instructor payouts, Stripe Connect) — instructor share is 0% at launch (charity + marketing); flip `revshare_instructor_pct` + legal sign-off first.
- ⏸ **Web social-login buttons** — backend ready; mobile is the priority surface.
- ⏸ **Google Maps** — the provider switch is built and tested; flip `VITE_MAP_PROVIDER=google` + add a key when you want it. Leaflet/OSM until then (no billing account needed).

---

## 5. Recently completed (this cycle)
Phases 21–23 + auth hardening: rev-share shadow engine, subscription invoices +
amortised attribution, the GPS↔R1 conformance engine (+ demo seeder), production
Apple Sign-In verification + account linking, the video/GPS sync guide, the
third-party credentials tracker, and the git-ignored local credentials store.

**Phase 24 — dashcam upload, video↔GPS sync and synced map playback** (usecase 1
end-to-end: web + worker). Migration `24`, the `route_clip_timeline` anti-drift
mapping, multi-file GPS ingest across five formats, an extensible dashcam filename
registry, duration reconciliation with wrong-clock detection, front↔rear audio
correlation, R1 conformance on uploads via one internal API, `route_track_points`
finally populated, the 4-step upload wizard, and the map that follows the marker —
behind a Leaflet/Google provider switch. 66 worker assertions cover the sync path.

---

## 6. Phase 24 — how to test it end to end
1. Apply `db/migrate_phase_24.sql` (or `bootstrap.sql` on a fresh DB).
2. Set `WORKER_SHARED_SECRET` to the same value on the API and the worker.
3. Create an R1 for a test centre: `POST /api/reference-routes` with the examiner GPX
   points (there is no web UI for this yet — **still the biggest gap**, see below).
4. In the web app: Contribute → Upload, choose *"My dashcam recorded GPS to separate log
   files"*, pick the R1, then upload several front clips + the GPS log(s).
5. On the review step, confirm the detected clip order, the gap report and the
   video-vs-GPS numbers.
6. Watch the pipeline stages on the upload status page: `clip_sort → gap_detect →
   gps_merge → reconcile → merge → audio_sync → sync_engine → conformance → track_points`.
7. Approve the route in `/admin`, then open it: the **All** view shows front + rear + map
   together, and the marker tracks the video as you scrub.

**Known gap before this is usable by a real instructor:** there is still no UI for
creating a reference route (R1). Uploads are conformance-checked against R1 by design,
so without an R1-authoring page (draw on map / import examiner GPX) every dashcam upload
has nothing to be checked against. That is the next thing to build on the web side.
