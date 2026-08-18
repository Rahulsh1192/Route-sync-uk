# Module — Route Detail, Access Decision & Paywall

**Prefix:** `RTA-###`

This is the **commercial heart of the product**. Test it carefully and read the warning
about one-shot state below before you start.

---

## Module overview

| | |
|---|---|
| **Purpose** | Show a driving route, decide whether the signed-in user may open it, and route them to the paywall when they may not. |
| **Web paths** | `/route/:id` · `/paywall` |
| **Entry point** | Any route card on `/discover`, `/test-centres/:id`, `/instructors/:id`, or a progress-history item |
| **API** | `GET /api/routes/:id` (detail) · `GET /api/routes/:id/access` (**dry-run** decision) · `GET /api/routes/:id/playback` / `/practice` / `/track` (each **commits** the decision) |
| **Roles** | Every role is treated identically. Entitlement, not role, decides access |
| **Components** | [RouteDetailPage.tsx](../../apps/web/src/pages/RouteDetailPage.tsx) · [PaywallPage.tsx](../../apps/web/src/pages/PaywallPage.tsx) |
| **Backend** | `resolveAccess()`, `access()`, `detail()` in [routes.service.ts](../../apps/api/src/modules/routes/routes.service.ts) · `isPremiumForCentre()` in [subscriptions.service.ts](../../apps/api/src/modules/subscriptions/subscriptions.service.ts) |
| **Dependencies** | Subscriptions (per-centre Premium) · `demo_route_claims` table · Test Centres (a route's centre determines which subscription unlocks it) |

---

## ⚠ One-shot state — read before testing

The free-demo allowance is **one route per account, for the lifetime of the account**,
and it is claimed **permanently** the first time the account opens *any* route in watch,
practice or track mode.

- `GET /api/routes/:id/access` is a **dry run** and does **not** claim.
- `GET /api/routes/:id/playback`, `/practice` and `/track` **do** claim
  (`resolveAccess(..., commit = true)`).

Once claimed, you cannot re-test `RTA-002`/`RTA-003` with that account. Either register a
fresh account, or clear the claim:

```sql
DELETE FROM demo_route_claims
 WHERE user_id = (SELECT id FROM users WHERE email = 'learner@routesync.uk');
```

---

## Business rules found in the implementation

The decision in `resolveAccess()`, in order:

1. **Premium for this route's test centre → `ok`.** A subscription row with
   `test_centre_id = <the route's centre>` **or** `test_centre_id IS NULL` (a legacy /
   universal grant), plan in (`premium_monthly`, `premium_yearly`), status in the active
   set, and `current_period_end` not in the past.
2. **Otherwise, if the account already has a demo claim:** `ok` if the claim is for *this*
   route, `PAYWALL` for every other route.
3. **Otherwise (no claim yet):** `ok` — and on a committing call this route becomes the
   claim.

Also:

- Only **published, non-deleted** routes resolve at all; anything else is `404 Route not
  found`, whatever the entitlement.
- A denied commit throws **403** `Premium subscription required for this test centre`.
- The dry-run response is `{ allowed, reason, testCentreId, centreLabel }` where `reason`
  is `'ok'` or `'PAYWALL'`.
- Premium is **per test centre and is not switchable** — buying Premium for Mill Hill
  does nothing for Isleworth.
- Plans: Free £0 · Premium Monthly **£4.99/month** · Premium Yearly **£39.99/year**,
  all `GBP`, both premium plans `perTestCentre: true`.

---

## UI components

| Screen | Elements |
|---|---|
| `/route/:id` | Back button · H1 route title · thumbnail/preview · distance, duration, difficulty, junction and roundabout counts, quality, sync confidence · instructor byline · link to the owning test centre · **paywall notice** when `access.reason === 'PAYWALL'` · **Watch** button · **Practice** button |
| `/paywall` | Back button · H1 naming the test centre being unlocked · plan cards for Premium Monthly and Premium Yearly with price and feature list · a button per plan that starts Stripe checkout · error banner |

---

## Functional test cases

### The access decision

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| RTA-001 | Route detail renders | user | Seeded | Open any published route from `/discover` | Title, stats (miles, difficulty, junctions, roundabouts, quality), instructor byline and the test-centre link all render |
| RTA-002 | **First route is free** | user | **Fresh account with no demo claim** | Open a route → click **Watch** | The player opens. A `demo_route_claims` row now exists for this user and this route |
| RTA-003 | **Second route hits the paywall** | user | The account from RTA-002 | Go back → open a **different** route | The detail page shows the paywall notice; clicking **Watch** navigates to `/paywall` for that route's centre, **not** the player |
| RTA-004 | Returning to the claimed route still works | user | The account from RTA-002 | Reopen the first route and click **Watch** | Plays. The claim is permanent, not one-time-only |
| RTA-005 | Premium unlocks every route at that centre | user | Grant Premium for Mill Hill ([12 §6](../12-TEST-ENVIRONMENT-AND-DATA.md)) and clear the demo claim | Open **two different** Mill Hill routes and watch each | Both play; no paywall |
| RTA-006 | Premium does **not** unlock another centre | user | Same account, Premium for Mill Hill only | Open the Isleworth route | Paywall — the notice names the **Isleworth** centre, not Mill Hill |
| RTA-007 | Universal (legacy) subscription unlocks everything | admin | `admin@routesync.uk` has `premium_yearly` with `test_centre_id = NULL` | Open routes at three different centres | All play; no paywall anywhere |
| RTA-008 | Expired subscription is not honoured | user | Set `current_period_end` to a past date on the user's subscription row | Open a route at that centre | Falls back to the demo rule — paywall if the claim is elsewhere |
| RTA-009 | Cancelled / inactive subscription | user | Set the subscription `status` to `canceled` | Open a route at that centre | Not treated as Premium |
| RTA-010 | Access check does **not** claim | user | Fresh account | Open a route detail page (which calls `/access`) but **do not** click Watch or Practice. Then check `demo_route_claims` | **No row exists.** Then open a *different* route and Watch it — that second route becomes the claim |
| RTA-011 | Unpublished route is not reachable | user | Route `77777777-…` is `in_review` | Open `/route/77777777-7777-7777-7777-777777777777` | **404 Route not found** — even for an admin |
| RTA-012 | Non-existent route id | user | — | Open `/route/00000000-0000-0000-0000-000000000000` | Clean "not found" handling, no crash |
| RTA-013 | Route detail links to its test centre | user | — | Click the centre name on a route detail page | Navigates to `/test-centres/:id` |

### Paywall and checkout entry

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| RTA-014 | Paywall names the correct centre | user | Demo claim already spent | Open a route at a different centre → Watch | `/paywall` heading names **that route's** test centre |
| RTA-015 | Paywall shows both plans and prices | user | — | Open `/paywall` | Premium Monthly **£4.99** and Premium Yearly **£39.99** are shown with their feature lists |
| RTA-016 | Paywall reached directly | user | — | Open `/paywall` with no query string | Renders without crashing. Record what centre (if any) it claims to unlock — `Needs Clarification` |
| RTA-017 | Back from the paywall | user | On `/paywall` | Click Back | Returns to the previous page; no subscription created |
| RTA-018 | Continue to checkout | user | Stripe test keys configured | Click a plan | Redirected to Stripe Checkout — continue in [subscriptions-billing.md](subscriptions-billing.md) |
| RTA-019 | Checkout with Stripe not configured | user | `STRIPE_SECRET_KEY` unset | Click a plan | A readable error banner. **Not** a blank page or an unhandled promise rejection |

### Authorisation and bypass

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| RTA-020 | **API bypass** — playback without entitlement | user | Demo claim spent elsewhere; no Premium | `GET /api/routes/<other-route>/playback` with the learner's token | **403** `Premium subscription required for this test centre`. A 200 with stream URLs is a **critical revenue defect** |
| RTA-021 | **API bypass** — practice without entitlement | user | Same | `GET /api/routes/<other-route>/practice` | **403** |
| RTA-022 | **API bypass** — track without entitlement | user | Same | `GET /api/routes/<other-route>/track` | **403** — the GPS track is gated exactly like the video |
| RTA-023 | Unauthenticated playback | — | No token | `GET /api/routes/<id>/playback` | **401** |
| RTA-024 | Route **detail** is not gated | — | No token | `GET /api/routes/<id>` | **200** — metadata and preview images are deliberately public. Confirm no stream URL, GPS track or instruction text is present in this response. **If any is, that is a critical defect** |
| RTA-025 | Instructor is gated like a learner | instructor | `instructor@routesync.uk` has a **free** subscription | Watch two different routes | The second one hits the paywall. Contributing routes does **not** grant access to others' routes |
| RTA-026 | Concurrent first-open race | user | Fresh account | Open two different routes in two tabs and click **Watch** in both as close to simultaneously as possible | Exactly **one** route is claimed. The other returns **403 / paywall**. Two claims for one account is a defect (the service has explicit race handling — verify it holds) |

---

## Traceability

| Test IDs | UI | API | Logic |
|---|---|---|---|
| RTA-001, RTA-011 … RTA-013 | `RouteDetailPage.tsx` | `GET /api/routes/:id` | `RoutesService.detail()` |
| RTA-002 … RTA-010, RTA-026 | `RouteDetailPage.tsx` | `GET /api/routes/:id/access` | `resolveAccess(commit=false)`, `demo_route_claims` |
| RTA-020 … RTA-022, RTA-025 | Watch / Practice buttons | `/playback`, `/practice`, `/track` | `resolveAccess(commit=true)` → `enforce()` |
| RTA-005 … RTA-009 | — | — | `SubscriptionsService.isPremiumForCentre()` |
| RTA-014 … RTA-019 | `PaywallPage.tsx` | `POST /api/subscriptions/checkout` | `StripeService.createCheckoutSession()` |
</content>
