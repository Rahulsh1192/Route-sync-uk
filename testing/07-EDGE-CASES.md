# 07 — Edge Cases

**Prefix:** `EDGE-###`

Only edge cases that are meaningful for **this** implementation. Generic checklist items
with no basis in the code are omitted.

---

## 1. Empty and single-record states

Every list in the app must handle "nothing here" without an error banner, an infinite
spinner or a blank panel.

| Test ID | Where | How to produce it | Expected |
|---|---|---|---|
| EDGE-001 | `/test-centres` | Search `zzzzzz` | Empty state |
| EDGE-002 | `/discover` | Search `zzzzzz` | Empty state |
| EDGE-003 | A test centre with no routes | Open e.g. Exeter | Centre details plus an empty routes state |
| EDGE-004 | `/bookings` | A fresh account | Empty state |
| EDGE-005 | `/account/progress` | A fresh account | **Zeros**, not a 404 — `getProgress()` returns a defaulted object |
| EDGE-006 | `/instructors/find` | Search a postcode with no coverage | The `elsewhere` grouping, or an empty state — never a silent nationwide list presented as local |
| EDGE-007 | Admin Review Queue | Approve/reject everything | Empty state; the nav badge disappears |
| EDGE-008 | Admin Instructors | Decide all three applications | Empty state; badge disappears |
| EDGE-009 | Admin Reports | Fresh database | *"No open reports. All clear!"* |
| EDGE-010 | Admin Bookings, Fund, Earnings | Fresh database | Empty tables, no errors |
| EDGE-011 | Instructor dashboard | An instructor with no profile and no slots | The empty-profile branch with a **Find an instructor** button |
| EDGE-012 | Practice mode | A route with zero `route_instructions` | *"Route complete 🎉"* immediately — a **data** gap, not a UI bug |
| EDGE-013 | A single-record list | Delete all but one centre/route/slot | Renders correctly — no plural/singular or grid-layout breakage |

---

## 2. Stale authorisation state

These are the highest-value edge cases in this application, because the role and the
session identity both live inside a JWT that is **not** re-validated against the database
on each request.

| Test ID | Scenario | Steps | Expected / what to record |
|---|---|---|---|
| EDGE-014 | **Role changed while signed in** | User A is signed in. An admin changes A's role. A keeps using the app **without** signing out | The **access token still carries the old role**, so A keeps the old permissions until the token expires (default 900 s) or is refreshed. Record how long, and whether the UI is confusingly inconsistent. Both promotion (`IVER-023`) and demotion matter |
| EDGE-015 | **Account suspended while signed in** | User A is signed in. An admin suspends A. A keeps using the app | **A keeps working** until the access token expires. There is **no session revocation on suspension**. Record the window and raise the severity with the security owner |
| EDGE-016 | **Account erased while signed in** | User A completes `DELETE /api/users/me` in one tab, then acts in another | GDPR erasure **does** revoke every refresh token, so the next refresh fails. Confirm the still-valid access token cannot do anything meaningful in the meantime |
| EDGE-017 | **Subscription expires mid-session** | Set `current_period_end` to the past while a learner is browsing | The next entitlement-gated call returns **403** and the paywall appears |
| EDGE-018 | **Playback token expires mid-video** | Set `SIGNED_URL_TTL=60`, restart, watch past 60 s | Segment requests return **403**. Record how the player surfaces this — a silent stall is a poor experience worth raising |
| EDGE-019 | **Instructor single-session eviction mid-action** | Instructor is part-way through the upload wizard in browser A; sign in as the same instructor in browser B; continue in A | A is evicted at the next token refresh. Record whether wizard state and any in-flight upload are lost cleanly or produce a confusing error |

---

## 3. Concurrency and races

| Test ID | Scenario | Steps | Expected |
|---|---|---|---|
| EDGE-020 | **First-free-route race** | Fresh account, two tabs, two different routes, click **Watch** in both simultaneously | Exactly **one** `demo_route_claims` row. The service has explicit race handling — verify it holds |
| EDGE-021 | **Double booking** | Two learners, same open slot, submit simultaneously | Exactly one booking; the other gets **400 Slot not available** |
| EDGE-022 | **Cancel and rebook race** | Learner A cancels while learner B is on the profile page | B's page must refresh before the slot is offered, and booking a slot that was re-taken must fail cleanly |
| EDGE-023 | **Two moderators, one route** | Both open the same queued route; one approves, the other rejects | The route ends in a defined state and both decisions are in `approvals`. Record which wins — there is **no optimistic-concurrency guard** |
| EDGE-024 | **Two admins, one ADI application** | Both open it; one approves, the other rejects | Record the final `users.role` and `instructor_status`. A rejection after an approval leaves `role = instructor` with `instructor_status = rejected` — an inconsistent pair |
| EDGE-025 | **Slot deleted while being booked** | Instructor deletes an unbooked slot while a learner is submitting a booking for it | **400 Slot not available**, not a 500 |
| EDGE-026 | **Test centre deleted while in use** | Delete an empty centre while an instructor has it selected in the upload wizard | Submitting the upload must fail readably (the `testCentreId` foreign key no longer resolves) |
| EDGE-027 | **Duplicate webhook delivery** | Replay the same Stripe event | One subscription; no double entitlement |

---

## 4. Multiple tabs and browser navigation

| Test ID | Scenario | Expected |
|---|---|---|
| EDGE-028 | Same account in two tabs; sign out in tab 1; act in tab 2 | Tab 2's next API call fails and it redirects to `/login`. It must not keep showing protected data indefinitely |
| EDGE-029 | Sign in as a **different** account in tab 2 (shared `localStorage`) | Both tabs now hold the newer session. Confirm tab 1 does not show a mix of the two identities |
| EDGE-030 | Browser **Back** after signing out | Guarded pages redirect to `/login`; no protected data is restored from bfcache |
| EDGE-031 | Browser **Back** from the player mid-playback | Video and speech stop; the beacon fires; no audio keeps playing |
| EDGE-032 | Browser **Back** from practice mode while speaking | Speech synthesis stops |
| EDGE-033 | **Forward** navigation after Back | The app reaches a consistent state, not a half-rendered page |
| EDGE-034 | **Refresh (F5) mid-upload** | The wizard's in-memory state is lost. Confirm the orphaned upload can be aborted or is swept, and that the quota is not silently consumed |
| EDGE-035 | **Refresh mid-recording** on `/contribute/record` | The in-memory track is lost. Confirm the open journey can be discarded or reused |
| EDGE-036 | Open an email link (`/verify-email`, `/reset-password`) **while already signed in** | The page processes the token — it is deliberately **not** redirected away |
| EDGE-037 | Open the same reset link in two tabs; submit both | The first succeeds; the second gets **401** — the token is single-use |

---

## 5. Boundary values

| Test ID | Field | Boundary | Expected |
|---|---|---|---|
| EDGE-038 | Password | exactly 8 characters | **Accepted**; 7 rejected |
| EDGE-039 | Display name | exactly 2 characters | Accepted; 1 rejected |
| EDGE-040 | Test-centre name | exactly 2 and exactly 160 | Both accepted; 1 and 161 rejected |
| EDGE-041 | Test-centre description | exactly 1 000 | Accepted; 1 001 rejected |
| EDGE-042 | Emergency contact name | exactly 120 | Accepted; 121 rejected |
| EDGE-043 | Evidence key | exactly 300 | Accepted; 301 rejected |
| EDGE-044 | ADI number | exactly 3 characters | Accepted; 2 rejected |
| EDGE-045 | **ADI expiry = today** | — | **Accepted** — the comparison is against midnight today |
| EDGE-046 | ADI expiry = yesterday | — | Rejected with the expiry message |
| EDGE-047 | Evidence file | exactly 15 MB, then 15 MB + 1 byte | Accepted, then rejected |
| EDGE-048 | Upload file | exactly 5 GB, then larger | Accepted, then rejected |
| EDGE-049 | `secondsWatched` | 0 and exactly 86 400 | Both accepted; 86 401 rejected |
| EDGE-050 | `travelRadiusKm` | 1 and 100 | Both accepted; 0 and 101 rejected |
| EDGE-051 | `lessonPriceMinor` | **0** | Accepted — a free lesson still incurs the platform fee (which is 0 % of 0) |
| EDGE-052 | Camera clock offset | exactly ±24 h, then beyond | Accepted, then rejected |
| EDGE-053 | GPS fixes | exactly 2, then 1 | Accepted, then rejected |
| EDGE-054 | GPS fixes | exactly 200 000, then 200 001 | Accepted, then rejected |
| EDGE-055 | Reference route points | exactly 2, then 1 | Accepted, then rejected |
| EDGE-056 | Multipart part number | 1 and 10 000 | Accepted; 0 and 10 001 rejected |
| EDGE-057 | Fund payout | exactly the balance, then balance + 1 | Accepted, then **400 Payout exceeds fund balance** |
| EDGE-058 | Route list `take` | 50 and 999 | Both capped at 50 |
| EDGE-059 | Free upload cap | the 3rd upload, then the 4th | Accepted, then **403** |
| EDGE-060 | Instructor travel radius vs the 40 km cap | radius 100 km, learner 41 km away | **Not** `nearby` — the cap wins |
| EDGE-061 | Journey coverage at exactly `minCoveragePct` (98 %) | — | Record whether 98 % passes (`>=`) or fails (`>`) and confirm it is intended |
| EDGE-062 | Reconciliation at exactly 95 % | — | The wizard flags `ok` at ≥ 95 % |

---

## 6. Character sets and hostile strings

Apply to: display name, test-centre name/town/description, route title, lesson notes,
instructor bio, fund beneficiary name, search boxes.

| Test ID | Input | Expected |
|---|---|---|
| EDGE-063 | Unicode — `Café`, `Ωmega`, `日本語`, `Bailiúchán` | Stored and rendered correctly; no mojibake |
| EDGE-064 | Emoji — `🚗 Route 1` | Stored and rendered correctly |
| EDGE-065 | Right-to-left text | Rendered without breaking the layout |
| EDGE-066 | Leading/trailing whitespace | Trimmed where the code trims (display name, contact fields, search terms) |
| EDGE-067 | **Whitespace-only** search term | Treated as no query — the full list is returned |
| EDGE-068 | **HTML** — `<b>bold</b>`, `<img src=x onerror=alert(1)>` | Rendered as **literal text**. React escapes by default; a rendered tag or an executed script is a **critical XSS defect** |
| EDGE-069 | **SQL metacharacters** — `' OR 1=1 --`, `"; DROP TABLE users; --` | Treated as literal text. Every query uses parameterised `$queryRaw` — a database error or an unexpected result set is a **critical injection defect** |
| EDGE-070 | **`LIKE` wildcards** — `%` and `_` in a search box | No error. Note that these **are** wildcards in the `ILIKE` searches, so `%` may match everything. Record the behaviour and confirm it is acceptable (`Needs Clarification`) |
| EDGE-071 | Very long string — 5 000 characters into a search box | Handled without error |
| EDGE-072 | Null bytes / control characters | Rejected or stripped; never a 500 |
| EDGE-073 | Upload filename with spaces, unicode and path characters (`../../evil name.mp4`) | Sanitised — the stored key keeps only `[a-zA-Z0-9._-]`, truncated to 120 characters |

---

## 7. Dates, times and timezones

| Test ID | Scenario | Expected / record |
|---|---|---|
| EDGE-074 | Availability slot **today** | Confirm whether it appears in the public list (the query is `slot_date >= today`, so a slot earlier today is still offered) |
| EDGE-075 | Availability slot **in the past** | No validation exists — record whether it is accepted and whether it stays invisible to learners |
| EDGE-076 | Slot **end time before start time** | No validation exists — record the result |
| EDGE-077 | Slot spanning midnight (23:30–00:30) | Record the behaviour |
| EDGE-078 | Booking on **29 February** | Handled correctly |
| EDGE-079 | Slot on a **DST transition** day (last Sunday in March / October, UK) | Times display correctly with no hour shift |
| EDGE-080 | Camera clock offset combined with DST | The reconciliation screen still produces a sensible timeline |
| EDGE-081 | Fund period boundary — run the contribution on the 1st | The period is the **previous** month |
| EDGE-082 | Rev-share period boundary | Same — the attribution run targets the previous month |
| EDGE-083 | Streak calculation across midnight | `current_streak_days` behaves per the rules in [modules/progress-history.md](modules/progress-history.md). Note this is **not reachable through the UI** |
| EDGE-084 | Verification link at exactly 24 h, reset link at exactly 1 h | Expired — `tokenState` uses `<=`, so the token is spent **at** the expiry instant |

---

## 8. Large datasets

| Test ID | Scenario | Expected |
|---|---|---|
| EDGE-085 | 60 routes in the review queue | 50 returned. **There is no pagination** — record how the remaining 10 are reached |
| EDGE-086 | 60+ users in the admin Users list | 50 returned, no pagination — record it |
| EDGE-087 | 60 bookings in the admin Bookings panel | 50 per page; confirm whether the **UI** exposes paging |
| EDGE-088 | 60 history rows on `/account/progress` | 50 returned |
| EDGE-089 | 100+ published routes on `/discover` | Search returns at most 50; the unfiltered list is cursor-paged at 20 |
| EDGE-090 | A reference route with thousands of points | The panel decimates before submitting; playback and the map stay responsive |
| EDGE-091 | A GPS track near 200 000 fixes | Accepted; the analysis completes without a timeout. Record how long it takes |
| EDGE-092 | A multi-GB multipart upload (~80 parts at 64 MB) | Parts are signed in batches; no part URL expires before it is used |
| EDGE-093 | A long video with many `route_track_points` | The map marker interpolates smoothly; no visible frame drops |
</content>
