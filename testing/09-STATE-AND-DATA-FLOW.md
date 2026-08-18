# 09 — State Transitions & Cross-Module Data Flow

**Prefix:** `STATE-###`

Every state machine and every cross-module dependency found in the implementation. Use
this to work out *where* a change should appear after you make it.

---

## 1. Route status

`route_status` enum: `draft` · `processing` · `flagged` · `in_review` · `published` ·
`rejected` · `archived`.

```
   (upload init)
        |
        v
     draft ──(upload complete)──> processing ──(worker)──> in_review ──(approve)──> published
                                       |                        |                       |
                                       └──(worker flags)──> flagged                     |
                                                                |                       |
                                                          (approve/reject)        (re-moderate:
                                                                |                  no guard!)
                                                                v                       |
                                                             rejected <─────────────────┘
```

| Test ID | Transition | Trigger | Visible where |
|---|---|---|---|
| STATE-001 | *(none)* → `draft` | `POST /api/uploads` | Nowhere learner-facing |
| STATE-002 | `draft` → `processing` | `POST /api/uploads/:id/complete` | Upload status page |
| STATE-003 | `processing` → `in_review` | Worker finishes cleanly | **Admin Review Queue** + nav badge |
| STATE-004 | `processing` → `flagged` | Worker raises findings | Review Queue (also listed) |
| STATE-005 | `in_review`/`flagged` → `published` | Admin/moderator **approve** | `/discover`, the centre page, search; `published_at` set; contributor credits awarded |
| STATE-006 | `in_review`/`flagged` → `rejected` | Admin/moderator **reject** | Leaves the queue; invisible to learners; `published_at` cleared |
| STATE-007 | **`published` → `rejected`** | Re-moderating an already-published route | **There is no state guard.** The route silently disappears from learners. Confirm and see `ADM-RQ-021` |
| STATE-008 | `archived` | **No code path sets this.** The enum value exists but nothing writes it — `Needs Clarification` |

**Invariant to verify:** learners only ever see `status = 'published' AND deleted_at IS
NULL`. Test at every surface — `/discover`, `/test-centres/:id`, `/api/search/routes`,
`/instructors/:id`, `/api/routes`, `/api/routes/:id`.

---

## 2. Upload status

`upload_status` enum: `created` · `uploading` · `queued` · `processing` · `flagged` ·
`completed` · `failed`.

```
created ──(complete)──> queued ──(worker)──> processing ──> completed
   |                                              |
   └──(abort)──> failed                           └──> flagged / failed
```

| Test ID | Transition | Trigger | Notes |
|---|---|---|---|
| STATE-009 | *(none)* → `created` | `POST /api/uploads` | |
| STATE-010 | `created` → `queued` | `POST /api/uploads/:id/complete` | Also moves the route to `processing` |
| STATE-011 | `created` → `failed` | `DELETE /api/uploads/:id` | Orphaned objects are reclaimed; `error = 'Aborted by uploader'` |
| STATE-012 | **Abort blocked** | `DELETE` while `queued`/`processing` | **400 That upload is already being processed** |
| STATE-013 | `queued` → `processing`/`completed`/`failed` | The worker calls `POST /api/webhooks/worker/upload-status` | ⚠ **That endpoint has no authentication.** Anyone can drive this transition — see `PERM-057` |

---

## 3. Booking status

`booking_status` enum: `pending` (default) · `confirmed` · `cancelled` · `completed` ·
`no_show`.

```
pending ──> confirmed ──> completed
   |            |    \
   |            |     └──> no_show
   └────────────┴──> cancelled  (releases the slot)
```

| Test ID | Transition | Who can trigger it | Side effect |
|---|---|---|---|
| STATE-014 | *(none)* → `pending` | Any learner via `POST /api/bookings` | Slot `is_booked = TRUE`; a `booking_payments` row with status `pending` |
| STATE-015 | → `confirmed` | The learner, the instructor, or an admin/moderator | None beyond the status |
| STATE-016 | → `cancelled` | Same | **Slot `is_booked` returns to FALSE** — the slot becomes bookable again |
| STATE-017 | → `completed` | Same — **including the learner** | No restriction on who may mark a lesson complete. See `BOOK-036` |
| STATE-018 | → `no_show` | Same | |
| STATE-019 | **Any → any** | **No transition rules exist.** `cancelled` → `confirmed` is accepted | Confirm and record; a cancelled booking re-confirmed does **not** re-book the slot |
| STATE-020 | Invalid status string | Validated only as a string; the enum cast happens in the database | Record the status code — see `BOOK-035` |

---

## 4. Instructor verification status

`instructor_status` enum: `none` · `pending` · `verified` · `rejected`.

```
none ──(apply)──> pending ──(approve)──> verified   [+ users.role = 'instructor']
                     |
                     └──(reject)──> rejected        [users.role UNCHANGED]
```

| Test ID | Transition | Side effects |
|---|---|---|
| STATE-021 | `none`/`rejected` → `pending` | `instructor_verifications` row; the admin nav badge increments |
| STATE-022 | `pending` → `verified` | `reviewed_by`/`reviewed_at`/`review_notes` set · `contributors` upserted with `verified_at`, `adi_number`, `adi_expiry` · **`users.role = 'instructor'`** · `onInstructorVerified()` runs |
| STATE-023 | `pending` → `rejected` | Same verification and contributor writes, `verified_at = NULL`, ADI details **preserved by COALESCE** · **`users.role` unchanged** |
| STATE-024 | **`verified` → `rejected`** | No state guard. `users.role` stays `instructor` while `instructor_status` becomes `rejected` — an **inconsistent pair**. The user keeps staff navigation and upload rights but disappears from instructor search. See `ADM-INS-018` |
| STATE-025 | **ADI expiry passes** | `adiExpired: true` is surfaced, but **nothing demotes the user or blocks bookings**. `Needs Clarification` |

---

## 5. Subscription status

`subscription_status` enum: `active` · `trialing` · `past_due` · `canceled` · `expired`.

| Stripe event | Internal status | Entitlement |
|---|---|---|
| `active` | `active` | Granted (unless `current_period_end` has passed) |
| `trialing` | `trialing` | Granted |
| `past_due`, `unpaid` | `past_due` | **`Needs Clarification`** — confirm whether access is retained |
| `canceled`, `incomplete_expired` | `canceled` | Not granted |

| Test ID | Transition | Trigger | Visible where |
|---|---|---|---|
| STATE-026 | free → `active` premium | `checkout.session.completed` webhook | Paywall disappears for that centre; `/account` shows the plan |
| STATE-027 | `active` → `past_due` | `invoice.payment_failed` | Confirm whether the paywall returns |
| STATE-028 | `active` → `canceled` | `customer.subscription.deleted` | Paywall returns |
| STATE-029 | Period end passes | Time | `isPremiumForCentre()` returns false even if the status is still `active` |
| STATE-030 | Refund | `charge.refunded` | Recorded against the invoice; confirm the entitlement effect |

---

## 6. Journey verdict

`verified` or `rejected`, from a **deterministic** engine.

| Test ID | Input | Verdict |
|---|---|---|
| STATE-031 | Coverage ≥ 98 %, no sustained deviation | `verified` |
| STATE-032 | Coverage below the threshold | `rejected` with a reason |
| STATE-033 | Sustained deviation > 30 m for > 50 m of travel | Counted as a real deviation |
| STATE-034 | The same track submitted twice | **Identical** verdict — determinism is the property to test |

---

## 7. Cross-module data propagation

Each row is a hand-off. Verify the change actually appears in the destination.

| Test ID | Change made in… | …must appear in | How to verify |
|---|---|---|---|
| STATE-035 | Admin approves a route | `/discover`, the centre page, global search, the instructor's profile | Sign in as a learner and look in all four |
| STATE-036 | Admin approves a route | The contributor's credits, reputation and `routes_published` | `GET /api/contributors/:id` |
| STATE-037 | Admin approves a route | The **Published** stat tile and the Review Queue badge | Reload `/admin` |
| STATE-038 | Admin rejects a route | It vanishes from every learner surface | Search for it |
| STATE-039 | Admin approves an ADI application | `users.role`, the applicant's navigation, instructor search eligibility | Sign in as the applicant |
| STATE-040 | Admin suspends a user | Login blocked; the instructor disappears from search | Both surfaces |
| STATE-041 | Admin changes a role | The user's navigation and permissions — **only after a token refresh** | See `EDGE-014` |
| STATE-042 | Instructor adds a slot | The learner-facing instructor profile | Open it as a learner |
| STATE-043 | Instructor sets a base postcode | The learner's proximity search moves them from `elsewhere` to `nearby` | `BOOK-004` |
| STATE-044 | Instructor turns off accepting bookings | They disappear from instructor search | `BOOK-011` |
| STATE-045 | Instructor changes their lesson price | The public profile, search results and the price of a **new** booking. **Existing bookings keep their original fee** | Compare an old and a new booking |
| STATE-046 | Learner books a slot | The slot vanishes from the public list; appears on `/bookings`, on `/instructors/me`, and in the admin Bookings panel | All four |
| STATE-047 | Learner cancels a booking | The slot returns to the public list | Reload the profile |
| STATE-048 | A completed Stripe checkout | A `subscriptions` row; the paywall lifts for that centre; `/account` updates; the admin Revenue and Fund figures change | All four |
| STATE-049 | `platform_config.booking_fee_pct` changed | The fee on the **next** booking only | Create one before and one after |
| STATE-050 | `platform_config.revshare_instructor_pct` changed | The **next** attribution run's balances | `ADM-FIN-021` |
| STATE-051 | `platform_config.journey_*` changed | The **next** journey submission's verdict | `JRN-018` |
| STATE-052 | A new reference route created | Selectable in the upload wizard and on Record a drive, **for that centre only** | Both pages |
| STATE-053 | A new test centre created | Appears in the centre list and search, and in the upload wizard's centre select | Both |
| STATE-054 | A test centre acquires a route | It can no longer be deleted | `TC-021` |
| STATE-055 | GDPR erasure | The user disappears from the admin Users list and the user count; their email is freed. **Their contributed routes remain** | `ACCT-022`, `ACCT-023` |
| STATE-056 | Password reset completed | Every session revoked; `email_verified` becomes true | `E2E-007` |
| STATE-057 | Worker writes `route_track_points` | The moving map marker on the Watch page | `PLAY-011` |
| STATE-058 | Worker writes `route_clip_timeline` | The playback response's `clipTimeline` | Inspect `/playback` |
| STATE-059 | Watch-time beacon fires | A `route_watch_events` row; later, the rev-share attribution run | `PLAY-020`, `ADM-FIN-018` |
| STATE-060 | Fund contribution or payout | The fund balance, the transactions table, and the **public** `/api/fund/summary` | All three |

---

## 8. Data that does **not** propagate (verified in code)

Do not raise these as defects — they are recorded once in
[13-TESTING-GAPS.md](13-TESTING-GAPS.md).

| Not propagated | Why |
|---|---|
| Watching or practising → progress counters | `recordWatch()` / `recordPractice()` are never called by any controller |
| Booking → notifications | The notify helpers exist; confirm whether the booking flow calls them (`API-012`) |
| Role change or suspension → live session | The role and identity are inside a JWT that is not re-checked |
| ADI expiry → loss of instructor privileges | No enforcement exists |
| GDPR erasure → media deletion | An explicit `TODO` in the code |
| GDPR export → a downloadable file | An explicit `TODO` in the code |
| A learner reporting content → the Reports panel | There is no reporting UI or endpoint |
</content>
