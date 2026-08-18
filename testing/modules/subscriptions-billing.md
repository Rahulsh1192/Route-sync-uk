# Module — Subscriptions & Billing

**Prefix:** `SUB-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | Sell per-test-centre Premium, and turn a completed payment into an entitlement. |
| **Web paths** | `/paywall` · `/billing/success` · `/billing/cancel` · the Premium panel on `/account` |
| **API** | `GET /api/subscriptions/plans` · `GET /api/subscriptions/me` · `POST /api/subscriptions/checkout` · `POST /api/webhooks/stripe` · `POST /api/webhooks/revenuecat` |
| **Roles** | All authenticated roles can buy; nothing here is role-gated |
| **Components** | [PaywallPage.tsx](../../apps/web/src/pages/PaywallPage.tsx) · [BillingResultPage.tsx](../../apps/web/src/pages/BillingResultPage.tsx) · [AccountPage.tsx](../../apps/web/src/pages/AccountPage.tsx) |
| **Backend** | [subscriptions.service.ts](../../apps/api/src/modules/subscriptions/subscriptions.service.ts) · [stripe.service.ts](../../apps/api/src/modules/subscriptions/stripe.service.ts) · [webhooks.controller.ts](../../apps/api/src/modules/webhooks/webhooks.controller.ts) |
| **Dependencies** | **Stripe** (web) and **RevenueCat** (mobile IAP) · Test Centres (a subscription is bound to one centre) · the Access module consumes the entitlement |

---

## ⚠ Before you start

**The entitlement is granted by the webhook, not by the checkout redirect.** Landing on
`/billing/success` proves nothing. If `STRIPE_WEBHOOK_SECRET` is not configured, or
Stripe cannot reach your local API, a paid checkout will **never** unlock anything —
and that is a configuration problem, not a product defect.

For local testing, forward webhooks with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

and use the signing secret it prints as `STRIPE_WEBHOOK_SECRET`.

**Never run a real checkout against a production Stripe key.** Confirm test mode first.

---

## Business rules found in the implementation

1. **Plans** (`plans()`): Free £0 · Premium Monthly **£4.99/month** · Premium Yearly
   **£39.99/year**, `GBP`. Both premium plans are `perTestCentre: true`.
2. **Checkout** creates a Stripe hosted `subscription` session with
   `client_reference_id = userId` and `subscription_data.metadata = { userId, plan,
   testCentreId }`. Without a `testCentreId` the resulting subscription is a
   **universal** grant that unlocks every centre.
3. **Stripe is optional.** With no `STRIPE_SECRET_KEY` the API still boots and checkout
   returns **400** `Payments are not configured`. With no price id →
   **400** `No Stripe price configured for <plan>`.
4. **Webhook signature is mandatory.** A bad signature is **400**; a missing raw body is
   **400**.
5. **Handled Stripe events:** `checkout.session.completed`,
   `customer.subscription.created`/`.updated`/`.deleted`, `invoice.payment_failed`,
   `invoice.paid`/`payment_succeeded`, `charge.refunded`.
6. **Stripe status → internal status:** `active`→active, `trialing`→trialing,
   `past_due`/`unpaid`→past_due, `canceled`/`incomplete_expired`→canceled.
7. **Every webhook is logged** to `subscription_events` before it is acted on — an audit
   trail exists even for events that change nothing.
8. **RevenueCat** handles `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`,
   `UNCANCELLATION`, `CANCELLATION`, `EXPIRATION`, `REFUND`, `BILLING_ISSUE`. The centre
   comes from a `test_centre_id` subscriber attribute.
9. **Entitlement is honoured only when** the plan is premium, the status is in the active
   set, and `current_period_end` is not in the past.

---

## Functional test cases

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| SUB-001 | Plans endpoint | any | — | `GET /api/subscriptions/plans` | Three plans with the prices in rule 1 above, `currency: "GBP"`, and `perTestCentre: true` on both premium plans |
| SUB-002 | Paywall shows the plans | user | — | Open `/paywall` from a gated route | Both premium plans render with the same prices the API returns. **Any mismatch between the UI price and `plans()` is a defect** |
| SUB-003 | Own subscription — free user | user | `learner@routesync.uk` | `GET /api/subscriptions/me` | No active premium subscription is reported |
| SUB-004 | Start checkout — monthly | user | Stripe test keys + prices configured | `/paywall` → Premium Monthly | Redirected to Stripe Checkout; the session carries `client_reference_id` = the user id and `testCentreId` in the metadata |
| SUB-005 | Start checkout — yearly | user | Same | `/paywall` → Premium Yearly | As SUB-004 with the yearly price |
| SUB-006 | Complete a checkout | user | Stripe CLI forwarding webhooks | Pay with the test card `4242 4242 4242 4242` | Returned to `/billing/success`; **after the webhook is processed**, a `subscriptions` row exists with the correct `test_centre_id`, plan and `active` status |
| SUB-007 | Entitlement takes effect | user | SUB-006 completed | Open a **second** route at that centre and click Watch | Plays — no paywall |
| SUB-008 | Entitlement is centre-scoped | user | SUB-006 completed for Mill Hill | Open a route at **Isleworth** | Paywall shown for Isleworth |
| SUB-009 | Cancel at Stripe | user | On the Stripe Checkout page | Click Back / cancel | Returned to `/billing/cancel`; a readable message; **no** subscription created |
| SUB-010 | Checkout with Stripe unconfigured | user | Unset `STRIPE_SECRET_KEY`, restart | Click a plan | **400** `Payments are not configured`, surfaced as a readable error banner in the UI |
| SUB-011 | Checkout with no price id | user | Set `STRIPE_SECRET_KEY` but unset `STRIPE_PRICE_MONTHLY` | Click Premium Monthly | **400** `No Stripe price configured for premium_monthly` |
| SUB-012 | Invalid plan value | user | — | `POST /api/subscriptions/checkout` with `{"plan":"gold"}` | **400** validation error |
| SUB-013 | Invalid `testCentreId` | user | — | `POST /api/subscriptions/checkout` with `{"plan":"premium_monthly","testCentreId":"abc"}` | **400** — must be a UUID |
| SUB-014 | Unauthenticated checkout | — | No token | `POST /api/subscriptions/checkout` | **401** |
| SUB-015 | **Webhook signature is enforced** | — | — | `POST /api/webhooks/stripe` with an arbitrary JSON body and no/`bad` `stripe-signature` | **400** `Webhook signature verification failed`. **A 200 here is a critical defect** — anyone could grant themselves Premium |
| SUB-016 | Subscription cancelled at Stripe | user | Active subscription | Cancel it in the Stripe dashboard and let `customer.subscription.deleted` arrive | Internal status becomes `canceled`; the user is paywalled again on their next route |
| SUB-017 | Payment failure / dunning | user | Active subscription | Trigger `invoice.payment_failed` via the Stripe CLI | Internal status becomes `past_due`. Confirm whether access is retained or lost — **not specified in code** (`Needs Clarification`) |
| SUB-018 | Refund | user | Paid invoice | Trigger `charge.refunded` | A refund is recorded against the invoice; confirm the resulting entitlement state |
| SUB-019 | Expired period | user | Set `current_period_end` to yesterday | Open a route at that centre | Not treated as Premium; paywall shown |
| SUB-020 | Every webhook is audited | — | — | Send any Stripe event, then `SELECT * FROM subscription_events ORDER BY created_at DESC LIMIT 5;` | The event and its payload are recorded |
| SUB-021 | Account page reflects the subscription | user | Active premium | Open `/account` | The Premium panel shows the active plan. For a free user it shows an upgrade button leading to `/paywall` |
| SUB-022 | **RevenueCat webhook without a secret** | — | `REVENUECAT_WEBHOOK_SECRET` unset | `POST /api/webhooks/revenuecat` with a crafted `INITIAL_PURCHASE` body and **no** `Authorization` header | The request is **accepted** — the auth check is skipped entirely when the env var is unset. Confirm and raise as `PERM-056` / **PI-02** (see [13](../13-TESTING-GAPS.md)) |
| SUB-023 | RevenueCat webhook with a wrong secret | — | Secret **set** | `POST` with `Authorization: Bearer wrong` | **401** |
| SUB-024 | Duplicate webhook delivery | — | — | Replay the same `checkout.session.completed` event twice | Exactly one subscription remains; no duplicate rows and no double entitlement |

---

## Traceability

| Test IDs | UI | API | Logic |
|---|---|---|---|
| SUB-001, SUB-002 | `PaywallPage.tsx` | `GET /api/subscriptions/plans` | `SubscriptionsService.plans()` |
| SUB-004, SUB-005, SUB-010 … SUB-014 | `PaywallPage.tsx` | `POST /api/subscriptions/checkout` | `StripeService.createCheckoutSession()` |
| SUB-006 … SUB-008, SUB-015 … SUB-020, SUB-024 | *(server-side)* | `POST /api/webhooks/stripe` | `constructEvent()`, `applyStripeSubscription()`, `applyEntitlement()`, `recordInvoice()` |
| SUB-022, SUB-023 | *(server-side)* | `POST /api/webhooks/revenuecat` | `WebhooksController.revenuecat()` |
| SUB-003, SUB-021 | `AccountPage.tsx` | `GET /api/subscriptions/me` | `mySubscription()` |
</content>
