# 10 — Error Handling and Recovery

**Prefix:** `ERR-###`

---

## 1. What the API returns on an error

Every error goes through `AllExceptionsFilter`
([all-exceptions.filter.ts](../apps/api/src/common/filters/all-exceptions.filter.ts)) and
comes back as an RFC-7807-style envelope:

```json
{
  "type": "about:blank",
  "status": 403,
  "title": "Insufficient role",
  "detail": "…",
  "instance": "/api/admin/users",
  "timestamp": "2026-08-17T09:41:00.000Z"
}
```

Anything with a status ≥ 500 is logged server-side with a stack trace; a 5xx response body
says only `Internal server error`.

| Test ID | Check | Expected |
|---|---|---|
| ERR-001 | Trigger a 403, a 404 and a 400 and inspect each body | All follow the envelope above, with the correct `status` and `instance` |
| ERR-002 | Trigger a 500 (e.g. stop the database, then call an endpoint that queries it) | The body is generic — **no stack trace, no SQL, no table names, no file paths reach the client** |
| ERR-003 | Check the API console during ERR-002 | The full stack trace **is** logged server-side |

---

## 2. Front-end error surfaces

Each page has its own error state. The pattern across the codebase is an `.error` banner,
a loading state, and an empty state — verify all three exist per page.

| Test ID | Page | How to force an error | Expected |
|---|---|---|---|
| ERR-004 | `/test-centres` | Stop the API | A readable error banner. **Not** a blank page and not a spinner that never resolves |
| ERR-005 | `/discover` | Stop the API | Error banner; the route grid is **not** rendered |
| ERR-006 | `/test-centres/:id` | Stop the API | Error banner |
| ERR-007 | `/bookings` | Stop the API | Error banner |
| ERR-008 | `/account/progress` | Stop the API | Error banner |
| ERR-009 | `/contribute` | Stop the API | Error banner |
| ERR-010 | `/instructors/find` | Stop the API | Error banner |
| ERR-011 | `/paywall` | Unset `STRIPE_SECRET_KEY` | Error banner reporting that payments are not configured |
| ERR-012 | Admin Reports panel | Stop the API | An error alert with `role="alert"` |
| ERR-013 | Every admin panel | Stop the API | Each shows an error, not an empty table pretending there is no data |
| ERR-014 | Login | Stop the API | *"Cannot reach the server"*-style error. **Must not silently fall into demo mode** — registration is required for all access by design |

---

## 3. Network failure and recovery

| Test ID | Scenario | Steps | Expected / record |
|---|---|---|---|
| ERR-015 | Offline mid-browse | DevTools → Network → Offline, then navigate | A readable error; **restoring the network and retrying must work without a full reload** |
| ERR-016 | Offline mid-upload | Go offline at ~50 % of a multipart upload | A clear failure message. Confirm whether resume is offered or a restart is required (`UPL-047`) |
| ERR-017 | Offline mid-playback | Go offline while a video is playing | The player stalls with a message rather than a silent freeze |
| ERR-018 | Offline mid-booking | Go offline between opening the profile and submitting | The booking fails readably; **no phantom booking** is created |
| ERR-019 | Slow network (throttle to 3G) | Browse, then upload | Loading states are visible throughout; no operation appears complete before it is |
| ERR-020 | API restarts mid-session | Restart the API while signed in | The next call fails, then the app recovers on retry. The session survives |

---

## 4. Third-party failures

| Test ID | Service | How to simulate | Expected |
|---|---|---|---|
| ERR-021 | **postcodes.io** unreachable | Block the domain (hosts file, or a firewalled network) | Test-centre creation → **503** with the "could not reach the postcode lookup service" message. Instructor proximity search fails readably rather than degrading into a nationwide list |
| ERR-022 | **Stripe** unreachable | Use an invalid `STRIPE_SECRET_KEY` | Checkout fails with a readable error; **no** subscription is created |
| ERR-023 | **Stripe webhook** never arrives | Do not run the Stripe CLI, then complete a checkout | The user lands on `/billing/success` **but has no entitlement**. Record how confusing this is — the success page is not proof of entitlement |
| ERR-024 | **Resend (email)** unconfigured | Unset `RESEND_API_KEY` | Registration **still succeeds** — sending never throws. The API logs `Email not configured … dropped`. Verification and reset become untestable |
| ERR-025 | **Resend** rejects the message | Use an invalid API key | Same: the user-facing operation succeeds; the API logs `Resend rejected the message` |
| ERR-026 | **Object storage** (MinIO/R2) down | Stop the MinIO container | Presigned URL generation fails; the upload wizard and badge-evidence upload report a readable error; admin evidence links fail readably |
| ERR-027 | **Redis** down | Stop the Redis container | `POST /api/routes/:id/session-complete` and offline-package requests fail. Record whether they surface as a readable error or an unhandled 500 |
| ERR-028 | **Database** down | Stop the Postgres container | `GET /api/health` returns `db: "down"` **with a 200**; other endpoints return 500 with a generic body |
| ERR-029 | **OpenStreetMap tiles** blocked | Block the tile host | The map renders blank/grey but the page does not crash; the marker logic still runs |
| ERR-030 | **mux.dev test stream** blocked | Block the host | Seeded routes will not play. **Environmental, not a product defect** |
| ERR-031 | **Apple JWKS** unreachable | Block `appleid.apple.com` | `POST /api/auth/oauth/apple` → `401 Could not fetch Apple public keys` |
| ERR-032 | **Worker** not running | Do not start the Python worker | Uploads stall at `queued`. Confirm the state is **visible** on the upload status page rather than looking successful |

---

## 5. Timeouts

| Test ID | Scenario | Expected |
|---|---|---|
| ERR-033 | Email provider hangs | The mail call has a **10-second** `AbortSignal.timeout`. Registration must not hang beyond that; it still succeeds |
| ERR-034 | A very long GPS analysis (near 200 000 fixes) | Completes without a gateway timeout. Record the duration |
| ERR-035 | A very large multipart upload | Part URLs are re-signed in batches, so no part URL expires mid-upload |
| ERR-036 | A slow presigned download | The 900-second segment URL and the 300-second evidence URL are long enough for their purpose |

---

## 6. Partial and malformed responses

| Test ID | Scenario | Expected |
|---|---|---|
| ERR-037 | A route with **no** `route_videos` rows | The Watch page handles it — no broken `<video>` element |
| ERR-038 | A route with **no** `route_track_points` | The **Map** view button is hidden entirely |
| ERR-039 | A route with **no** rear stream | The **Rear** view button is hidden |
| ERR-040 | A route with **no** `route_instructions` | Practice shows "Route complete" immediately |
| ERR-041 | A route with **no** `route_previews` row | No thumbnail; the layout does not collapse |
| ERR-042 | An upload with **no** `upload_stages` | The admin route detail shows an empty stage list, not an error |
| ERR-043 | An instructor with **no** `instructor_profiles` row | The search falls back to the default price of 3500 and treats `is_accepting_bookings IS NULL` as accepting |
| ERR-044 | A contributor with **no** `contributors` row | `GET /api/contributors/:id` → **404 Contributor not found** |
| ERR-045 | An ADI verification with **no** `adi_expiry` (pre-Phase-26) | Shown as neither valid nor expired |

---

## 7. Recovery expectations

For each failure above, record:

| Question | Why it matters |
|---|---|
| **Is the error message readable by a non-technical user?** | A raw stack trace or `[object Object]` is a defect |
| **Is a retry offered, or must the page be reloaded?** | Forcing a reload after a transient failure is poor |
| **Is entered data preserved?** | Losing a filled-in form (the upload wizard, the test-centre form, the ADI application) after a failed save is a defect |
| **Does the failure leave orphaned state?** | An aborted upload leaving objects in storage, a booking leaving a slot flagged as booked, a journey left open |
| **Is the failure silent?** | The worst outcome — an action that appears to succeed and did not. `ERR-023` (Stripe webhook) and `ERR-024` (email) are the two known cases |

---

## 8. Known "succeeds but does nothing" cases

Verified in code. Confirm the behaviour, then raise them **once** against
[13-TESTING-GAPS.md](13-TESTING-GAPS.md) rather than per test run.

| Test ID | Action | What actually happens |
|---|---|---|
| ERR-046 | `POST /api/users/me/export` | Returns `{status:'accepted'}` and creates a `data_requests` row. **No file is ever assembled** — an explicit `TODO` |
| ERR-047 | `DELETE /api/users/me` | Anonymises and soft-deletes the account, but **media purging is a `TODO`** — the user's uploaded objects remain |
| ERR-048 | Watching a route | The watch-time beacon fires, but **no progress counter updates** — see [modules/progress-history.md](modules/progress-history.md) |
| ERR-049 | Registering with email unconfigured | Succeeds; no verification email is ever sent, and nothing tells the user |
| ERR-050 | Completing a checkout with the webhook not wired | Lands on `/billing/success` with **no entitlement granted** |
</content>
