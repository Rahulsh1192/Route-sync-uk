# Module — Admin: Review Queue (Content Moderation)

**Prefix:** `ADM-RQ-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | The moderation queue. Uploaded driving routes wait here until a moderator or admin approves them (publishing them to learners) or rejects them. |
| **Web path** | `/admin` → **Review Queue** (the default panel) |
| **Entry point** | Post-login landing for `admin` and `moderator` |
| **API** | `GET /api/admin/review-queue` · `GET /api/admin/routes/:id` · `POST /api/admin/routes/:id/moderate` · `GET /api/admin/analytics` · `GET /api/admin/moderation-log` |
| **Roles** | `moderator`, `admin` |
| **Components** | [AdminApp.tsx](../../apps/web/src/admin/AdminApp.tsx) · [panels/ReviewQueue.tsx](../../apps/web/src/admin/panels/ReviewQueue.tsx) · [panels/RouteDetail.tsx](../../apps/web/src/admin/panels/RouteDetail.tsx) |
| **Backend** | [admin.controller.ts](../../apps/api/src/modules/admin/admin.controller.ts) · [admin.service.ts](../../apps/api/src/modules/admin/admin.service.ts) · [community.service.ts](../../apps/api/src/modules/community/community.service.ts) (`onRoutePublished`) |
| **Dependencies** | Uploads pipeline (produces the queue items) · Community (approval awards credits/reputation/badges) · Storage (signed thumbnail) |

---

## Preconditions

- Signed in as `admin@routesync.uk` (or a moderator you created).
- Seed data provides **3** queue items: two `in_review` and one `flagged`.

---

## Business rules found in the implementation

1. **The queue contains routes with `status` in (`in_review`, `flagged`) and
   `deleted_at IS NULL`.** Drafts, published, rejected and archived routes never appear.
2. **Ordering:** `is_instructor DESC, created_at ASC` — instructor-made routes are
   fast-tracked, then oldest first. **Limit 50.**
3. **Approve → `published`** and `published_at = now()`.
   **Reject → `rejected`** and `published_at = NULL`.
4. **Both decisions are transactional and audited**: the route update, an `approvals` row
   (`approved`/`rejected`, with the reason and the reviewer id) and an `audit_log` row
   (`route.moderate`) are written together.
5. **Approval awards community credit** — `onRoutePublished(contributorId)` adds credits,
   recomputes reputation and evaluates badges.
6. **Only `approve` and `reject` are valid decisions** (`@IsIn(['approve','reject'])`).
7. **The moderator's route detail** returns the route, its pipeline `upload_stages` with
   findings, its `route_videos` renditions, its `route_quality_scores`, and a **600-second**
   signed thumbnail URL.
8. **Nav badges poll every 60 seconds** — the Review Queue badge shows `pendingReview`
   and the Instructors badge shows `pendingInstructors`.

---

## UI components

| Area | Elements |
|---|---|
| Console shell | Sidebar with 9 panels, brand block, **Main app** and **Sign out** items · nav count badges on Review Queue and Instructors · topbar heading = the current panel · stat tiles **Users**, **Published**, **Premium** |
| Review Queue panel | Table/list of queued routes (title, status, quality score, sync confidence, instructor flag, created-at) · a button per row to open the detail · loading, error and "all clear" empty states |
| Route detail overlay | Route title · signed **thumbnail** · **Quality Metrics** (GPS quality, video quality, completeness, sync confidence, contributor reputation, overall) · **Pipeline Stages** with per-stage state and findings · **Video Renditions** (view, width/height, fps, duration, sync offset) · **Approve** / **Reject** buttons · a reason input · **Close** |

---

## Functional test cases

### Queue and detail

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-RQ-001 | Console loads on the Review Queue | admin | Seeded | Sign in as admin | Lands on `/admin`; **Review Queue** is the active panel |
| ADM-RQ-002 | Queue lists the right routes | admin | Seeded | Look at the queue | Exactly **3** items: `Mill Hill evening route (pending)`, `Instructor demo route (pending, fast-track)`, `Isleworth night drive (flagged)`. Published routes are absent |
| ADM-RQ-003 | **Ordering** | admin | Seeded | Read the order | `Instructor demo route (pending, fast-track)` (`is_instructor = true`) is **first**, then the remaining two oldest-first |
| ADM-RQ-004 | Nav badge count | admin | Seeded | Look at the sidebar | The Review Queue badge shows **3** and matches the queue length |
| ADM-RQ-005 | Stat tiles | admin | Seeded | Look at the topbar | **Users**, **Published** and **Premium** tiles show non-zero values consistent with the database |
| ADM-RQ-006 | Open the route detail | admin | — | Click a queued route | The overlay opens with quality metrics, pipeline stages and video renditions |
| ADM-RQ-007 | Quality metrics render | admin | The flagged Isleworth route has scores | Open it | GPS quality **45**, video **60**, completeness **70**, sync confidence **38**, overall **41**, and the flags `low_gps_quality`, `low_sync_confidence` |
| ADM-RQ-008 | Signed thumbnail | admin | A route with a `thumbnail_key` | Open the detail | The thumbnail loads from a signed URL. Seeded routes have no preview row, so no image is expected — record that separately |
| ADM-RQ-009 | Pipeline stages | admin | A worker-processed route | Open the detail | Each stage's state, progress and findings render. Seeded routes have no `upload_stages`, so the list is empty — that is data, not a bug |
| ADM-RQ-010 | Close the detail | admin | Detail open | Click **Close** | Returns to the queue with no state change |

### Moderation decisions

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-RQ-011 | **Approve a route** | admin | `Mill Hill evening route (pending)` | Open it → **Approve** | Route status becomes `published` with `published_at` set; it leaves the queue; the badge count drops to 2 |
| ADM-RQ-012 | Approved route reaches learners | user | ADM-RQ-011 done | Sign in as a learner → `/discover`, and the Mill Hill centre page | The newly approved route is now visible and openable |
| ADM-RQ-013 | **Reject a route** | admin | `Isleworth night drive (flagged)` | Open it → **Reject** with a reason | Status becomes `rejected`; it leaves the queue; `published_at` is NULL |
| ADM-RQ-014 | Rejected route is not visible to learners | user | ADM-RQ-013 done | Search for it on `/discover` | Absent |
| ADM-RQ-015 | **Approval is audited** | admin | ADM-RQ-011 done | `SELECT * FROM approvals ORDER BY decided_at DESC LIMIT 1;` and `SELECT * FROM audit_log WHERE action='route.moderate' ORDER BY created_at DESC LIMIT 1;` | Both rows exist, with the correct route id, decision, reason and **the acting reviewer's user id** |
| ADM-RQ-016 | Rejection reason is stored | admin | ADM-RQ-013 done | Check the `approvals` row | The reason text is present |
| ADM-RQ-017 | Moderation log | admin | Decisions made | `GET /api/admin/moderation-log` | The 50 most recent audit entries, newest first |
| ADM-RQ-018 | **Approval awards community credit** | admin | Note the contributor's credits/reputation before | Approve one of their routes, then `GET /api/contributors/<contributorId>` | Credits and/or reputation increased; `routes_published` incremented; any newly earned badge is awarded |
| ADM-RQ-019 | **Invalid decision value** | admin | — | `POST /api/admin/routes/<id>/moderate` with `{"decision":"maybe"}` | **400** validation error |
| ADM-RQ-020 | Moderate a non-existent route | admin | — | `POST /api/admin/routes/00000000-0000-0000-0000-000000000000/moderate` | **404 Route not found** |
| ADM-RQ-021 | **Re-moderate an already-published route** | admin | ADM-RQ-011 done | `POST` the same route with `{"decision":"reject"}` | It succeeds — there is no state-machine guard, so a published route can be pushed back to `rejected` and immediately disappears from learners. Confirm and raise as `Potential Issue` if unintended (see [13](../13-TESTING-GAPS.md)) |
| ADM-RQ-022 | Queue limit | admin | Insert 60 `in_review` routes | Load the queue | At most **50** items are returned. Confirm there is a way to reach the rest, or record the absence of pagination as a gap |
| ADM-RQ-023 | Empty queue | admin | Approve/reject everything | Reload the panel | A friendly empty state; the nav badge disappears |
| ADM-RQ-024 | Badge polling | admin | Console open on another panel | Insert a new `in_review` route directly in the database and wait ~60 s | The Review Queue badge increments without a page reload |

### Authorisation

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-RQ-025 | **Moderator can moderate** | moderator | Moderator account | Approve a route from the console | **200** — moderation is deliberately available to moderators |
| ADM-RQ-026 | Learner cannot reach the console | user | — | Type `/admin` | Redirected to `/test-centres` |
| ADM-RQ-027 | Instructor cannot reach the console | instructor | — | Type `/admin` | Redirected to `/test-centres` |
| ADM-RQ-028 | **API bypass** — learner reads the queue | user | Learner token | `GET /api/admin/review-queue` | **403 Insufficient role** |
| ADM-RQ-029 | **API bypass** — instructor approves their own route | instructor | Their own route is in the queue | `POST /api/admin/routes/<id>/moderate` with `{"decision":"approve"}` | **403**. A 200 here would let contributors self-publish — a **critical defect** |
| ADM-RQ-030 | Unauthenticated | — | No token | `GET /api/admin/review-queue` | **401** |

---

## Traceability

| Test IDs | UI | API | Guard | Logic |
|---|---|---|---|---|
| ADM-RQ-001 … ADM-RQ-005, ADM-RQ-024 | `AdminApp.tsx` | `GET /api/admin/analytics` | `@Roles('moderator','admin')` | `analytics()`, `STATS_POLL_MS` |
| ADM-RQ-002, ADM-RQ-003, ADM-RQ-022, ADM-RQ-023 | `panels/ReviewQueue.tsx` | `GET /api/admin/review-queue` | same | `reviewQueue()` |
| ADM-RQ-006 … ADM-RQ-010 | `panels/RouteDetail.tsx` | `GET /api/admin/routes/:id` | same | `routeDetail()`, `presignDownload(key, 600)` |
| ADM-RQ-011 … ADM-RQ-021 | Approve / Reject | `POST /api/admin/routes/:id/moderate` | same | `moderate()`, `onRoutePublished()` |
| ADM-RQ-025 … ADM-RQ-030 | `AdminProtected` | all of the above | `RolesGuard` | `isAdminRole()` |
</content>
