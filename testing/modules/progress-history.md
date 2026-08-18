# Module — Progress & Route History

**Prefix:** `PROG-###`

---

## ⚠ Read this first — the module is not wired up

Verified in code:

- `ProgressService.recordWatch()` and `recordPractice()` are the **only** writers of
  `user_route_history`, and **no controller calls either method**. Searched the whole API.
- The **web app never calls** `POST /api/routes/:id/session-complete`, the one exposed
  endpoint that would enqueue an AI summary.
- **No seed file** inserts into `user_route_history` or `user_progress`.

**Consequence:** on a normally-used system the Progress page will always show
**zeros and an empty history**, no matter how many routes a learner watches. That is the
implemented behaviour, not a rendering bug.

**Do not raise "progress does not update" as a functional defect.** Raise it once, as the
gap recorded in [13-TESTING-GAPS.md](../13-TESTING-GAPS.md), and test the module against
data you insert yourself (§ Test data).

---

## Module overview

| | |
|---|---|
| **Purpose** | Show a learner how much they have watched and practised, their streak, and their per-route history. |
| **Web path** | `/account/progress` |
| **Entry point** | The **My progress** button on `/account` (learner branch only) |
| **API** | `GET /api/users/me/progress` · `GET /api/users/me/history` · `POST /api/routes/:id/session-complete` · `GET /api/routes/:id/summary?type=` |
| **Roles** | All authenticated roles; data is always scoped to the caller |
| **Components** | [ProgressPage.tsx](../../apps/web/src/pages/ProgressPage.tsx) |
| **Backend** | [progress.controller.ts](../../apps/api/src/modules/progress/progress.controller.ts) · [progress.service.ts](../../apps/api/src/modules/progress/progress.service.ts) · [ai-summary.processor.ts](../../apps/api/src/modules/progress/ai-summary.processor.ts) |
| **Dependencies** | Redis + a Bull queue (`ai-summaries`) for AI summaries · Routes (history joins `routes`) |

---

## Business rules found in the implementation

1. `GET /api/users/me/progress` returns a **default zeroed object** when the user has no
   `user_progress` row — never a 404.
2. `GET /api/users/me/history` joins `routes`, orders by `last_watched_at DESC NULLS
   LAST`, and returns at most **50** rows.
3. **Streak logic** (`upsertProgress`): last active **yesterday** → streak + 1; last
   active **today** → streak unchanged; otherwise → streak resets to **1**.
   `longest_streak_days` is the running maximum.
4. `POST /api/routes/:id/session-complete` enqueues an AI summary **only** when
   `sessionType = 'watch'`. It returns `{queued: true}` regardless.
5. `GET /api/routes/:id/summary?type=` returns the stored `ai_summaries` row or **null**
   — never a 404.
6. Everything is scoped to `user_id = <caller>`. There is no endpoint that returns another
   user's progress.

---

## Test data

Because nothing populates these tables, insert rows manually before testing the display:

```sql
-- give the learner some history
INSERT INTO user_route_history
  (id, user_id, route_id, watch_count, watch_pct_max, practice_count,
   last_watched_at, last_practised_at)
VALUES
  (gen_random_uuid(),
   (SELECT id FROM users WHERE email='learner@routesync.uk'),
   '22222222-2222-2222-2222-222222222222', 3, 85, 1, now(), now());

INSERT INTO user_progress
  (user_id, total_routes_watched, total_practice_runs, total_watch_time_s,
   current_streak_days, longest_streak_days, last_active_at)
VALUES
  ((SELECT id FROM users WHERE email='learner@routesync.uk'), 3, 1, 1800, 2, 5, now())
ON CONFLICT (user_id) DO UPDATE SET
  total_routes_watched = EXCLUDED.total_routes_watched,
  current_streak_days  = EXCLUDED.current_streak_days;
```

---

## UI components

H1 "My Progress" · stat tiles (routes watched, practice runs, watch time, current streak,
longest streak) · H2 "Route History" · clickable history cards (each navigates to
`/route/:id`) · error banner · loading state · empty state.

---

## Functional test cases

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| PROG-001 | Progress page is reachable | user | — | `/account` → **My progress** | `/account/progress` loads without error |
| PROG-002 | Empty progress for a new account | user | Fresh account | Open `/account/progress` | All counters show **0** and the history is empty. **No error, no 404, no infinite spinner** |
| PROG-003 | Progress renders inserted data | user | Rows inserted per Test data | Reload `/account/progress` | Counters match the inserted values; the route appears in the history with its title, town and difficulty |
| PROG-004 | History item navigates to the route | user | History has a row | Click a history card | Navigates to `/route/:id` |
| PROG-005 | **Watching a route does not update progress** | user | Fresh account | Watch a route for 60 s, then open `/account/progress` | Counters stay at 0. **Expected with the current implementation** — see the warning at the top. Log it once against the gap, not per test run |
| PROG-006 | History cap | user | Insert 60 history rows | `GET /api/users/me/history` | At most **50** rows returned |
| PROG-007 | History ordering | user | Insert rows with different `last_watched_at` | `GET /api/users/me/history` | Newest `last_watched_at` first; rows with a NULL value sort last |
| PROG-008 | **Data scope** | user | Insert history for *two* different users | Sign in as user A and call `GET /api/users/me/history` | Only user A's rows are returned. **Any row belonging to user B is a critical data-leak defect** |
| PROG-009 | Streak — consecutive days | user | Set `last_active_at` to yesterday, then trigger `upsertProgress` (currently only reachable by calling the service directly) | — | `current_streak_days` increments. **Not reachable through the UI** — mark as untestable end-to-end and verify at unit/SQL level |
| PROG-010 | Streak — a gap resets it | user | Set `last_active_at` to 3 days ago | — | `current_streak_days` becomes 1; `longest_streak_days` is unchanged |
| PROG-011 | **API** — session complete (watch) | user | Redis running | `POST /api/routes/<id>/session-complete` with `{"sessionType":"watch"}` | **200** `{queued:true}`; a job appears on the `ai-summaries` queue |
| PROG-012 | **API** — session complete (practice) | user | — | Same with `{"sessionType":"practice"}` | **200** `{queued:true}` but **no** job is enqueued — practice summaries are only enqueued by `recordPractice()`, which nothing calls |
| PROG-013 | **API** — session complete with no body | user | — | `POST` with an empty body | Defaults to `watch`; returns 200 |
| PROG-014 | **API** — AI summary when none exists | user | — | `GET /api/routes/<id>/summary?type=watch` | **null** (not a 404) |
| PROG-015 | **API** — AI summary after generation | user | Redis + the summary worker running, plus whatever `OPENAI`-style config the processor needs | Run PROG-011, wait, then `GET …/summary?type=watch` | A summary object is returned. If the processor is not configured, record it as blocked, not failed |
| PROG-016 | Redis unavailable | user | Stop Redis | `POST /api/routes/<id>/session-complete` | Record the behaviour — an unhandled queue error surfacing as a 500 to the user is a defect worth raising |
| PROG-017 | Unauthenticated access | — | No token | `GET /api/users/me/progress` | **401** |
| PROG-018 | Progress link is hidden for staff | instructor / admin | — | Open `/account` | The **My progress** button is in the learner branch only — confirm whether staff can still reach `/account/progress` by URL, and that it renders without error |

---

## Traceability

| Test IDs | UI | API | Logic |
|---|---|---|---|
| PROG-001 … PROG-008, PROG-018 | `ProgressPage.tsx` | `GET /api/users/me/progress`, `/history` | `getProgress()`, `getHistory()` |
| PROG-009, PROG-010 | *(unreachable from the UI)* | — | `upsertProgress()` |
| PROG-011 … PROG-016 | *(API only)* | `POST /api/routes/:id/session-complete`, `GET /api/routes/:id/summary` | `onSessionComplete()`, `getSummary()`, `ai-summary.processor.ts` |
</content>
