# Test Routify — Monetisation & Instructor Revenue-Share (Team Brief)

> A plain-English summary for team discussion. It covers **how we make money
> today**, the **strategic choice** we're making about instructors, the
> **revenue-share model** (with examples), the **tricky edge cases**, and the
> **rollout plan**. The detailed technical spec lives in
> [REVSHARE_PLAN.md](REVSHARE_PLAN.md).

---

## 0. Launch decision (what we're actually shipping)

**At launch the instructor share of subscription revenue is 0%.** We are *not*
paying instructors a cut of subscriptions to begin with. Instead:

- **It's a social-welfare model.** Instructors record routes as a contribution to
  a good cause — subscription profit funds the **Community Fund**, which donates
  to people who need support (e.g. mental-health / "depressed community"
  charities). The instructor's route is their act of giving.
- **The instructor's payoff is marketing, not cash.** While a learner watches a
  route, the instructor's **name, photo and "Book a lesson" button** are shown.
  Every route is free advertising that drives **lesson bookings** — that's the
  business they get in return.
- **If this model doesn't work, we turn on a paid share later.** The revenue-share
  engine is fully built and runs every month in **shadow mode** (it records
  watch-time and computes what each instructor *would* earn). Switching on a real
  share is a **one-value config change** (`revshare_instructor_pct`, currently
  `0`) — **no code change, no redeploy**.

So everything in sections 2–4 below (the 45/55 split, watch-time attribution,
holdbacks) is our **designed-and-ready future option**, not what pays out today.
Today: instructors earn **£0 from subscriptions**, get **marketing + booking
leads**, and the platform's subscription profit feeds the **charity fund**.

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

### Our recommendation: **launch with Option B (charity + marketing), keep Option A built and ready.**

> Updated for the launch decision in section 0: we start with **no cash share**
> (Option B) — instructors give routes to the cause and earn through bookings —
> because it's simpler, has zero payout risk, and lets us prove demand first. The
> Option A machinery below is fully built so we can switch a paid share on the day
> the data says it's worth it. The reasoning that follows explains *why Option A
> exists and how it would work* when we enable it.

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

| Phase | What ships | Money moving? | Status |
|---|---|:--:|---|
| **1. Data** | Log **watch-time** per route + show the instructor's profile / "Book a lesson" button in the player | No | **✅ Shipped** |
| **2. Engine (shadow)** | Calculate each instructor's earnings monthly and show them in admin (**Instructor Earnings** panel) — numbers only, no payouts | No | **✅ Shipped (share = 0%)** |
| **3. Payouts** | Stripe Connect onboarding + real monthly payouts + refund/holdback handling | **Yes** | ⏸ Gated on flipping `revshare_instructor_pct` > 0 + legal sign-off |
| **4. Transparency** | Instructor "My Earnings" page + admin config controls | Yes | ⏸ With Phase 3 |

**Where we are now:** Phases 1 & 2 are live. The engine records watch-time and
computes attribution every month, but with the share at **0%** every accrual is
£0 and all subscription profit stays with the platform (feeding the charity
fund). Phase 3 is a **config flip away** — no rebuild.

Everything is recorded as a **traceable ledger** (every penny in/out, with the
exact calculation stored), so payouts are auditable and reproducible.

---

## 6. Prerequisites before real money can flow
- **Turn on Stripe** for subscriptions (currently not configured on the live site).
- ~~Fix a price mismatch (£29.99 vs £39.99 yearly)~~ — **✅ Fixed:** the profit
  formula now uses the real **£39.99** yearly price.
- **Stripe Connect** setup — only needed **if/when we enable a paid instructor
  share** (Phase 3). Not required for the launch (charity + marketing) model.

---

## 7. Decisions we'd like the team to confirm

**For launch (charity + marketing model) — confirm we're happy that:**
1. Instructors get **£0 subscription share at launch**; their reward is **marketing
   exposure + booking leads**, and subscription profit funds the **Community Fund**.
2. **Booking commission stays at 10%** (this is the instructor-facing money today).
3. Which **charity/cause** the Community Fund donates to, and how beneficiaries
   are chosen (admin already supports recording beneficiaries + payouts).

**Later, *before* we switch on a paid instructor share (the values are pre-set,
just confirm when the time comes):**
4. **The split — 45% to instructors / 55% to platform.** Higher or lower?
5. **Attribution — watch-time from *paying* subscribers only** (recommended) vs. all viewers.
6. **Reserve/holdback — 10% held for 90 days** acceptable to instructors?
7. **Legal/tax** for paying instructors (employment status, VAT, contracts) + Stripe Connect KYC.

---

### Numbers used above (for reference)
- Premium: £4.99/mo, £39.99/yr, per centre.
- Split: 45% instructors / 55% platform.
- Booking fee: 10%.
- Holdback: 10% for 90 days. Min payout: £20. Payout: monthly.

_Detailed schema, endpoints, jobs and webhook design: see [REVSHARE_PLAN.md](REVSHARE_PLAN.md)._
