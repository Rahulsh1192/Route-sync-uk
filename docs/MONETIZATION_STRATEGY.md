# Test Routify — Monetisation & Instructor Revenue-Share (Team Brief)

> A plain-English summary for team discussion. It covers **how we make money
> today**, the **strategic choice** we're making about instructors, the
> **revenue-share model** (with examples), the **tricky edge cases**, and the
> **rollout plan**. The detailed technical spec lives in
> [REVSHARE_PLAN.md](REVSHARE_PLAN.md).

---

## 1. How the app makes money (two streams)

1. **Premium subscriptions — per test centre.** Learners pay to unlock all the
   routes at a specific test centre. **£4.99/month** or **£39.99/year**, *per
   centre* (not switchable). Free tier = one demo route. This is the primary
   revenue.
2. **Booking commission.** When a learner books a lesson with an instructor, we
   add a **10% platform fee** on top of the instructor's price. This is our cut
   of the marketplace.

> Status: both are **built in code** but **not yet collecting money** — Stripe
> isn't configured on the live site yet, and instructor payouts (Stripe Connect)
> aren't wired. See "Prerequisites" below.

---

## 2. The strategic question

Two ways to work with instructors:

- **Option A — Give instructors a share** of the subscription revenue their
  uploaded routes generate.
- **Option B — Only give instructors leads** (bookings) and pay them nothing for
  the route videos.

### Our recommendation: **do both — but lead with Option A.**

**Why not Option B alone?** Our whole product depends on a **library of real
route videos** per test centre — that's what learners pay for. Filming and
uploading a route is real effort. If instructors get nothing for that content,
they won't make videos → the library stays thin → learners won't subscribe →
there are barely any leads to hand out anyway. It stalls (chicken-and-egg).

**Why Option A scales:** paying uploaders a share creates a **flywheel**:

> more routes → more centres covered → more learners subscribe → instructors earn
> more → they upload more → …

**The hybrid (best of both):** one uploaded route earns the instructor **twice** —
(1) a share of subscription revenue, and (2) the route carries their name/photo →
profile → "book a lesson", so the **video is also their advertising** and drives
lesson bookings. That double incentive is *why they'll bother filming*.

---

## 3. The revenue-share model (with an example)

**How a learner's £4.99 flows:**

1. Money is pooled **per test centre** each month.
2. We split it: **platform keeps 55%, instructors share 45%.** (Our 55% covers
   card fees, video hosting/streaming, servers, support, and profit.)
3. The 45% instructor pool is divided between the centre's uploaders by **how
   much their routes were actually watched** (watch-time), counting **only the
   people who paid for that centre**.

**Example — "Mill Hill" test centre, one month:**
- 100 subscribers × £4.99 = **£499**.
- Platform keeps £274.45; **instructor pool = £224.55**.
- Three instructors uploaded Mill Hill routes; we look at watched minutes:

| Instructor | Watch-time share | They earn |
|---|--:|--:|
| A | 50% | £112.28 |
| B | 30% | £67.37 |
| C | 20% | £44.91 |

**Why watch-time (not "number of routes")?** It rewards the routes learners
*actually use*, not whoever uploads the most. It **self-selects for quality** and
stops people spamming low-effort uploads to grab a share.

**Plus bookings (separate money):** if a learner books instructor A for a £35
lesson, we charge £38.50 (£35 + 10%). A gets £35; we keep £3.50 — and the route A
uploaded is what put A in front of that learner.

---

## 4. The tricky edge cases (and how we handle them)

**a) Refunds & chargebacks (someone's payment gets reversed).**
Risk: we might have already paid an instructor their share of money that later
gets taken back.
- If the reversal happens **before** we pay out that month → we simply **don't
  count it** (no harm).
- If it happens **after** we've paid → we record a small **negative adjustment**
  and net it off the instructor's **next** payout.
- We keep a **10% reserve** on each payout for **90 days** to cover late
  chargebacks even if the instructor stops earning.
- **We (the platform) absorb the bank dispute fee** — instructors never pay it.

**b) "Universal" legacy subscriptions (unlock every centre).**
A few old subscriptions aren't tied to one centre, so there's no single centre's
instructors to pay. For now these go **100% to the platform** (they're rare
grandfathered cases). If we ever sell an intentional "all-centres" plan, we'd
split it by what each learner personally watched.

**c) Routes uploaded or removed mid-month.**
Because we pay on **watch-time**, this just works: a route uploaded on the 25th
only earns from the few days it was watched; a route removed on the 10th still
earns for the days it *was* watched. No special date-maths needed — watch-time is
naturally time-proportional.

---

## 5. How we'll build it (phased, low-risk)

| Phase | What ships | Money moving? |
|---|---|:--:|
| **1. Data** | Start logging **watch-time** per route (we can't pay fairly without it) | No |
| **2. Engine (shadow)** | Calculate each instructor's earnings monthly and show them in admin — **numbers only, no payouts** — to validate for a month or two | No |
| **3. Payouts** | Stripe Connect onboarding + real monthly payouts + refund/holdback handling | **Yes** |
| **4. Transparency** | Instructor "My Earnings" page + admin config controls | Yes |

Everything is recorded as a **traceable ledger** (every penny in/out, with the
exact calculation stored), so payouts are auditable and reproducible.

---

## 6. Prerequisites before real money can flow
- **Turn on Stripe** for subscriptions (currently not configured on the live site).
- **Fix a price mismatch:** the profit formula assumes a **£29.99** yearly price
  but we actually charge **£39.99** — align these so reports are accurate.
- **Stripe Connect** setup for paying instructors (identity/tax checks).

---

## 7. Decisions we'd like the team to confirm
1. **The split — 45% to instructors / 55% to platform.** Comfortable? Higher or lower?
2. **Attribution — pay by watch-time from *paying* subscribers only** (recommended)
   vs. all viewers.
3. **Booking commission — keep at 10%?**
4. **Reserve/holdback — 10% held for 90 days** acceptable to instructors?
5. Any **legal/tax** considerations for paying instructors (employment status,
   VAT, contracts)?

---

### Numbers used above (for reference)
- Premium: £4.99/mo, £39.99/yr, per centre.
- Split: 45% instructors / 55% platform.
- Booking fee: 10%.
- Holdback: 10% for 90 days. Min payout: £20. Payout: monthly.

_Detailed schema, endpoints, jobs and webhook design: see [REVSHARE_PLAN.md](REVSHARE_PLAN.md)._
