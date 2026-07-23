# Instructor Revenue-Share — Implementation Plan

> How Test Routify pays uploading instructors a share of per-centre Premium
> revenue (content share) alongside lesson booking commission — designed to be
> scalable, fair, loss-minimising, easy to run, and fully traceable.
> Every fork below is resolved to a single recommended choice.

---

## 0. Principles (the "why" behind each decision)
- **Pay for value actually consumed**, not for uploading → rewards quality, blocks spam.
- **Payers decide the split** → a centre's paid pool is divided by what *its paying subscribers* actually watched. No free-rider dilution, no stakeholder disputes.
- **Never distribute money you might lose** → amortise, hold back a reserve, exclude-before-payout, claw-back-after, platform absorbs fees.
- **One append-only ledger = single source of truth** → every penny traceable and reproducible.
- **Collect data before paying** → log watch-time now; run in "shadow mode" before real payouts.

---

## 1. The model (decided)

| Lever | Decision | Rationale |
|---|---|---|
| Attribution basis | **Watch-seconds on published routes**, from **paying subscribers of that centre** | Fair, self-selects quality, no free-rider dilution, anti-gaming |
| Split | **Platform 55% / instructor pool 45%** of **gross** per-centre subscription revenue | Simple for instructors ("45% of list price"); 55% absorbs Stripe + infra + profit |
| Booking commission | **10%** on top of lesson fee (already built) — separate stream | Second income for instructors; each route is their lead magnet |
| Yearly plans | **Amortise**: recognise `price / 12` into the pool each active month | Fairer, avoids payout spikes, and shrinks refund exposure |
| Payout cadence | **Monthly**, on day **5** for the previous calendar month | Predictable; covers most refunds before payout |
| Minimum payout | **£20** (rolls over if below) | Avoids tiny Stripe transfer fees |
| Holdback reserve | **10% of each payout, released after 90 days** | Covers late chargebacks even after an instructor stops earning |
| Dispute fees | **Platform absorbs** them | Fairness → no instructor revolt |
| View qualifies if | session **≥ 30s and ≥ 25%** of the route; counted seconds **capped at route duration per user/route/day** | Stops farming / self-watching inflation |

### Worked attribution (one centre, one month)
Mill Hill, March: 100 subs × £4.99 = **£499 gross** → pool = 45% = **£224.55** (platform keeps £274.45).
Qualifying watch-seconds **from Mill Hill's paying subscribers**:

| Instructor | Qualifying watch-min | Share | Content accrual |
|---|--:|--:|--:|
| A | 6,000 (50%) | 50% | £112.28 |
| B | 3,600 (30%) | 30% | £67.37 |
| C | 2,400 (20%) | 20% | £44.91 |

If a centre has paid subs but **zero qualifying watch-time**, its pool **stays with the platform** (nobody earned it).

---

## 2. Schema (new tables + config)

**`route_watch_events`** — append-only truth (never edited):
```
id UUID pk
route_id UUID           -- FK routes
user_id UUID            -- FK users (viewer)
test_centre_id UUID     -- denormalised from route at insert (fast period queries)
source TEXT             -- 'playback' | 'practice'
seconds_watched INT     -- reported by client
route_duration_s INT    -- snapshot, for the ≥25% test + per-day cap
watched_at TIMESTAMPTZ
```
Indexes: `(test_centre_id, watched_at)`, `(route_id, watched_at)`, `(user_id, route_id, watched_at)`.
_High-volume → month-partition later; a plain indexed table is fine to start._

**`instructor_earnings`** — the signed ledger (balance = `SUM(amount_minor)`):
```
id, instructor_id UUID, period TEXT ('2026-03'),
entry_type TEXT   -- content_accrual | chargeback_adjustment | payout | holdback | holdback_release | manual_adjustment
amount_minor INT  -- signed (+accrual, −payout/−clawback/−holdback)
currency CHAR(3) default 'GBP'
test_centre_id UUID null   -- traceability
reference TEXT             -- run id / stripe transfer id / dispute id
notes TEXT, created_at TIMESTAMPTZ
```

**`revshare_runs`** — one per period, reproducible:
```
id, period, status (draft|finalized|paid),
gross_minor, pool_minor, platform_minor,
config JSONB   -- snapshot of all config used (split %, thresholds…)
created_at, finalized_at
```

**`revshare_run_lines`** — the math, per (run, instructor, centre):
```
run_id, instructor_id, test_centre_id, watch_seconds, share_pct, amount_minor
```

**`payouts`** — Stripe Connect transfers:
```
id, instructor_id, period, gross_minor, holdback_minor, net_minor,
stripe_transfer_id, status, created_at
```

**Config in existing `platform_config`** (DB-tunable, no redeploy):
| key | default |
|---|--|
| `revshare_instructor_pct` | 45 |
| `revshare_min_view_seconds` | 30 |
| `revshare_min_view_pct` | 25 |
| `revshare_holdback_pct` | 10 |
| `revshare_holdback_days` | 90 |
| `revshare_min_payout_minor` | 2000 |
| `revshare_payout_day` | 5 |

_Note: the existing **Community Fund** stays a separate (charitable) concept; instructor earnings are a **new dedicated ledger**, not the fund._

---

## 3. Watch-time logging (where it hooks in)
The player must report *actual* seconds, so the client tells the server:
- **New endpoint:** `POST /api/routes/:id/watch` (JWT) → body `{ secondsWatched, source }` → inserts a `route_watch_events` row, denormalising `test_centre_id` + `route_duration_s` from the route.
- **Web:** in [WatchPage.tsx](apps/web/src/pages/WatchPage.tsx) / [PracticePage.tsx](apps/web/src/pages/PracticePage.tsx), send a heartbeat every ~30s of active play and a final `navigator.sendBeacon` on unmount/tab-hide.
- **Mobile:** same beacon from the Flutter player.
- **Integrity:** raw events stored verbatim; the **≥30s/≥25% filter and per-user/route/day cap are applied at aggregation**, so the truth is preserved and rules can be re-tuned retroactively.

---

## 4. Monthly attribution job
A `@nestjs/schedule` cron (the app already uses `ScheduleModule`) on `revshare_payout_day`, for the previous month, **idempotent by period**:
1. Create `revshare_runs` (draft) + snapshot config.
2. Per centre: `gross = Σ monthly-equivalent of active subs` (monthly = price; yearly = price/12); `pool = gross × 45%`.
3. Aggregate qualifying watch-seconds per (centre, instructor) — join events → routes → uploader, filtered to that centre's **paying subscribers**, applying threshold + cap.
4. Write `revshare_run_lines` + `instructor_earnings` `content_accrual` entries; unattributed pool → platform.
5. Mark run **finalized** (numbers frozen & auditable).
6. **Payout step (separate, admin-approved):** for each instructor, `payable = ledger balance − outstanding holdback`; if `≥ min payout` → Stripe transfer, write `payouts` + `payout` + `holdback` ledger entries; release holdbacks older than 90 days (`holdback_release`).

---

## 5. Refund / chargeback handling
Add Stripe webhooks: `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.
- **Before the period is paid** → the reversed/cancelled sub simply isn't counted (it's no longer "active") → **excluded**, no clawback.
- **After payout** → post negative `chargeback_adjustment` entries to the affected instructors for their share of the reversed **monthly-equivalent** amount; netted against the next payout. Because yearly is amortised, only recognised months reverse → **small exposure**.
- **Dispute fee** → recorded as a platform cost, never charged to instructors.
- **Reserve** (holdback) covers reversals that arrive after an instructor stops earning; residual negatives after 90-day windows → platform write-off (rare by design).

---

## 6. Stripe Connect (actually paying people)
Required for both content payouts and lesson-fee payouts (schema already hints via `stripe_onboarded`).
- Instructor onboarding: create **Stripe Connect Express** account → onboarding link → store `connect_account_id`.
- Payouts = Stripe **transfers** to the connected account. Booking lesson fees flow the same way (learner charged → platform keeps commission → transfer remainder to instructor).
- Gate payouts on `stripe_onboarded = true`; otherwise earnings keep accruing until they onboard.

---

## 7. Admin & instructor UI (surfacing + transparency)
**Admin console (`/admin`) → new "Earnings" panel:**
- Per run: gross, pool, platform take, total to instructors, status; button to run/preview and to approve payouts.
- Per instructor: balance, accrued / held back / paid / adjustments; drill into `run_lines` (centre, seconds, share, £).
- Config editor for the `platform_config` rev-share keys.

**Instructor-facing "My Earnings" page (web app):**
- This month's accrual, watch-time on their routes, holdback, next payout date, payout history.
- **Transparency = no disputes** — they see exactly how the number is derived.

---

## 8. Phased rollout (de-risked, data-first)
| Phase | Ships | Why first |
|---|---|---|
| **1. Data** | `route_watch_events` + `/routes/:id/watch` + client beacons | Can't pay fairly without watch data — start collecting immediately |
| **2. Engine (shadow)** | attribution job + ledger + admin **read-only** reporting | Validate the numbers for a month or two with **no real money moving** |
| **3. Payouts** | Stripe Connect onboarding + transfers + holdback + refund/dispute webhooks | Turn on real money once numbers are trusted |
| **4. Transparency** | instructor "My Earnings" page + admin config UI | Scale & self-service once payouts are proven |

Prerequisite for real revenue at all: **activate Stripe** on subscriptions (currently unconfigured) and align the **£29.99 vs £39.99** yearly-price mismatch so pools compute correctly.

---

## 9. Loss-minimisation summary (how each risk is contained)
- **Overpay before reversal** → amortised yearly + 90-day holdback + exclude/claw-back.
- **Farming/self-watching** → paying-subscriber-only attribution + 30s/25% threshold + per-day cap + ADI gate.
- **Cash-flow spikes** → monthly amortised recognition, not lump-sum.
- **Disputes with instructors** → payer-driven, watch-time transparent, published formula.
- **Fee bleed on small charges** → platform's 55% + minimum payout threshold.

---

## 10. Open inputs I need from you before building Phase 3
1. Confirm the **45% instructor / 55% platform** split (or your number).
2. Confirm **watch-time from paying subscribers only** (recommended) vs all viewers.
3. Company/legal readiness for **Stripe Connect** payouts (KYC, instructor tax/VAT handling).
_These don't block Phases 1–2, which are safe to build now._
