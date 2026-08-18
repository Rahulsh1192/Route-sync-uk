# Module — Discovery & Global Search

**Prefix:** `DISC-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | One global search box across every published driving route — matched on route title, instructor name, test-centre name, town and postcode. |
| **Web path** | `/discover` (legacy `/search` redirects here) |
| **Entry point** | "Discover Routes" in the desktop nav; "Discover" in the mobile tab bar |
| **API** | `GET /api/routes?cursor=&take=` (paged list, no query) · `GET /api/search/routes?q=` (search) · `GET /api/search/test-centres?q=` or `?near=lat,lng` |
| **Roles** | All authenticated roles behave identically. The API endpoints are unauthenticated |
| **Components** | [DiscoverPage.tsx](../../apps/web/src/pages/DiscoverPage.tsx) · [RouteCard.tsx](../../apps/web/src/components/RouteCard.tsx) · [InstructorByline.tsx](../../apps/web/src/components/InstructorByline.tsx) |
| **Backend** | [search.service.ts](../../apps/api/src/modules/search/search.service.ts) · [routes.service.ts](../../apps/api/src/modules/routes/routes.service.ts) (`list()`) |
| **Dependencies** | Routes and Test Centres data; the contributor's `users` row supplies the instructor byline |

---

## Preconditions

- Signed in.
- Seeded database — 4 published routes exist.

## Business rules found in the implementation

1. **Only `status = 'published'` and `deleted_at IS NULL` routes appear.** In-review,
   flagged, draft, rejected and archived routes are never returned.
2. **A search term is matched with `ILIKE '%term%'`** — case-insensitive substring, no
   fuzzy matching, no stemming. Searching `mil hil` returns nothing.
3. **Ordering is `is_instructor DESC, quality_score DESC NULLS LAST`** — instructor-made
   routes are boosted above everything else.
4. **`instructorVerified` is true when the contributor's role is `instructor` *or*
   `admin`.** Because all seeded routes belong to an `admin`, they all show a verified
   badge — expected, not a defect.
5. **Search returns at most 50 rows** (`take` capped at 100); the unfiltered list
   endpoint returns 20 by default, capped at 50, and is **cursor-paged**.
6. `GET /api/search/test-centres?near=lat,lng` returns the 10 nearest centres by PostGIS
   distance; a malformed `near` gives **400** `near must be "lat,lng"`.
7. Test-centre text search matches name/town by substring but postcode by **prefix**
   (`ILIKE 'term%'`).

---

## UI components

H1 "Discover routes" · one search input, `placeholder="Search routes, instructors, test
centres, towns or postcodes…"`, `aria-label="Search routes"` · route card grid · error
banner · loading state · empty state.

Each route card shows: title, town, distance in **miles**, difficulty, quality score, and
the instructor byline (avatar, display name, ✓ verified badge). Clicking the byline opens
the instructor's public profile; clicking the card opens the route.

---

## Functional test cases

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| DISC-001 | Discover loads with no query | any | Seeded | Open `/discover` | The 4 published routes are listed. In-review and flagged routes are **absent** |
| DISC-002 | Search by route title | any | — | Type `Isleworth` | `Isleworth town loop` is returned |
| DISC-003 | Search by instructor name | any | — | Type `Demo Driver` | All routes contributed by that account are returned |
| DISC-004 | Search by test centre name | any | — | Type `Wood Green` | `Wood Green busy junctions` is returned |
| DISC-005 | Search by town | any | — | Type `Hayes` | The Yeading route is returned |
| DISC-006 | Search by postcode | any | — | Type `TW7` | The Isleworth route is returned |
| DISC-007 | Search is case-insensitive | any | — | Type `isleworth`, then `ISLEWORTH` | Identical results |
| DISC-008 | Partial-word search | any | — | Type `Isle` | The Isleworth route is returned (substring match) |
| DISC-009 | Misspelled search returns nothing | any | — | Type `Islewurth` | Empty state. **This is correct** — there is no fuzzy matching |
| DISC-010 | Search with no results | any | — | Type `zzzzzzzz` | Empty state, not an error and not an endless spinner |
| DISC-011 | Clear the search | any | A search is active | Clear the input | The full published list returns |
| DISC-012 | Whitespace-only search | any | — | Type three spaces | Treated as no query — the full list is returned |
| DISC-013 | Instructor routes are boosted | any | Two published routes are `is_instructor` | Open `/discover` with no query | `Mill Hill test route` and `Wood Green busy junctions` sort above the other two, then by quality score |
| DISC-014 | Unpublished routes never appear | any | Seeded review-queue routes exist | Search `pending`, then `flagged` | No results — neither in-review nor flagged routes are searchable |
| DISC-015 | Route card content | any | — | Inspect a card | Title, town, **miles** (not km), difficulty, quality, instructor byline with verified badge |
| DISC-016 | Instructor byline opens the profile | any | — | Click the instructor name on a card | Navigates to `/instructors/:id` |
| DISC-017 | Card opens the route | any | — | Click the card body | Navigates to `/route/:id` |
| DISC-018 | Legacy `/search` redirect | any | — | Open `/search` | Redirected to `/discover` |
| DISC-019 | Special characters in the search | any | — | Type `%`, then `_`, then `'` | No SQL error and no crash. Note: `%` and `_` are SQL `LIKE` wildcards — record what the app actually returns and confirm the behaviour with the product owner (`Needs Clarification`) |
| DISC-020 | Very long search term | any | — | Paste 500 characters | Handled without error; empty result set |
| DISC-021 | Unicode search term | any | — | Type `Café`, then `日本` | No crash; empty result set |
| DISC-022 | Rapid typing / request racing | any | — | Type a term quickly, then delete it quickly | The final rendered list matches the final query — an earlier in-flight response must not overwrite a newer one |
| DISC-023 | **API** — cursor pagination | any | Needs > 20 published routes; create more or reduce `take` | `GET /api/routes?take=2`, then repeat with the returned `nextCursor` | Each page returns 2 items plus a `nextCursor`; the last page returns `nextCursor: null`; no item is repeated or skipped |
| DISC-024 | **API** — `take` is capped | any | — | `GET /api/routes?take=999` | At most **50** items returned |
| DISC-025 | **API** — nearest test centres | any | — | `GET /api/search/test-centres?near=51.6023,-0.2470` | Up to 10 centres ordered by distance, Mill Hill first, each with a `meters` value |
| DISC-026 | **API** — malformed `near` | any | — | `GET /api/search/test-centres?near=abc` | **400** `near must be "lat,lng"` |
| DISC-027 | **API** — test-centre postcode search is prefix-only | any | — | `GET /api/search/test-centres?q=NW7`, then `?q=W7 1RB` | `NW7` matches Mill Hill; the mid-string `W7 1RB` does **not** |
| DISC-028 | Search API is unauthenticated | — | No token | `GET /api/search/routes?q=Mill` | **200** with results. Confirm this is intended (`Needs Clarification`) |
| DISC-029 | Backend unreachable | any | Stop the API | Open `/discover` | A readable error banner is shown — not a blank page, and not an endless spinner |

---

## Traceability

| Test IDs | UI | API | Service |
|---|---|---|---|
| DISC-001, DISC-023, DISC-024 | `DiscoverPage.tsx` | `GET /api/routes` | `RoutesService.list()` |
| DISC-002 … DISC-014 | `DiscoverPage.tsx` | `GET /api/search/routes` | `SearchService.routes()` |
| DISC-025 … DISC-027 | *(no UI — API only)* | `GET /api/search/test-centres` | `SearchService.testCentresNear()`, `testCentresSearch()` |
| DISC-015, DISC-016 | `RouteCard.tsx`, `InstructorByline.tsx` | — | `withInstructor()` |
</content>
