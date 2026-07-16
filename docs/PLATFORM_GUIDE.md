# RouteSync — Complete Platform Guide

> **Version:** 2026 · **Audience:** Sales demos, client onboarding, internal training

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [The Three Roles](#2-the-three-roles)
3. [Learner Journey — Full Cycle](#3-learner-journey--full-cycle)
4. [Instructor (ADI) Journey — Full Cycle](#4-instructor-adi-journey--full-cycle)
5. [Admin Journey — Full Cycle](#5-admin-journey--full-cycle)
6. [Feature Reference by Role](#6-feature-reference-by-role)
7. [Subscription & Pricing](#7-subscription--pricing)
8. [Demo Walkthrough Scripts](#8-demo-walkthrough-scripts)
9. [Test Accounts](#9-test-accounts)

---

## 1. Platform Overview

**RouteSync** is a UK driving-test learning platform that connects learner drivers with real, GPS-synchronised dashcam footage of local test routes — and lets them practise those routes as turn-by-turn British English voice navigation, exactly like a sat-nav but for their actual driving test.

It also connects learners directly with verified **Approved Driving Instructors (ADIs)** for lesson bookings, and gives instructors a professional tool to upload routes, earn reputation, and grow their driving business.

### The core loop

```
ADI records a test route while driving  →  uploads it to RouteSync
      ↓
Platform AI processes it automatically
(GPS validation · privacy blur · quality score · voice instructions)
      ↓
Admin reviews and publishes the route
      ↓
Learner finds the route for their test centre
      ↓
Learner watches the real drive · practises with voice guidance
      ↓
Learner books the ADI for a real lesson · passes their test
```

### What makes it unique

| Feature | RouteSync | YouTube | Theory apps |
|---|---|---|---|
| Real test-route footage | ✅ Test-centre specific | ❌ Hit and miss | ❌ Not applicable |
| GPS-synchronised video | ✅ Frame-perfect | ❌ | ❌ |
| British English voice practice | ✅ Like the real test | ❌ | ❌ |
| Verified ADI instructor booking | ✅ Built-in | ❌ | ❌ |
| AI learning summaries | ✅ Post-session | ❌ | ❌ |
| Offline access | ✅ Encrypted | ❌ | Partial |
| GDPR-compliant privacy blur | ✅ Automatic AI | Manual | ❌ |

---

## 2. The Three Roles

### 👤 Learner Driver
A person learning to drive in the UK who wants to familiarise themselves with their test routes before test day.

- **Accesses via:** Web app (any browser) or mobile app (iOS/Android)
- **Free plan:** Browse routes, watch 1 sample route
- **Premium plan:** Unlimited routes, practice mode, AI summaries, offline access
- **No Premium needed to:** Book an instructor

---

### 🎓 Instructor (ADI)
An Approved Driving Instructor (DVSA-registered) who uploads routes and optionally accepts lesson bookings through the platform.

- **Accesses via:** Web app or mobile app
- **Core tools:** Route upload, availability management, booking management
- **Optional:** Subscribe to the Premium Route Library (same as learners) for lesson planning

---

### 🛡️ Admin / Moderator
RouteSync internal staff who review uploaded routes, verify instructor credentials, manage users, and oversee platform revenue.

- **Accesses via:** Admin Console (web, desktop only)
- **Requires:** `admin` or `moderator` role

---

## 3. Learner Journey — Full Cycle

### Step 1 — Create an Account

Open **http://localhost:5174** (or the production URL).

**Option A — Register**
1. Click **"New here? Create an account"**
2. Enter: Display name · Email · Password
3. Click **Create account** — you're logged in immediately

**Option B — Demo (no account)**
1. Click **"✨ Explore the demo (no account)"**
2. The full app loads with sample routes — no backend required
3. Video player and voice practice work fully in demo mode

---

### Step 2 — Discover Routes

After login you land on the **Discover** page.

- A grid of published routes appears, sorted by quality score
- Each card shows: **Route name · Test centre town · Difficulty · Distance · Duration · Roundabout count**
- Colour-coded quality badges: green (70+) · amber (50–69)
- Routes tagged **Instructor** are from verified ADIs

---

### Step 3 — Search for Your Test Centre

Click **Search** in the navigation bar.

1. Type your test centre name, town, or postcode (e.g. "Mill Hill" or "NW7")
2. Filter by difficulty: Beginner · Intermediate · Advanced · **Test standard**
3. Click **Search**
4. Results show all matching routes

---

### Step 4 — Watch a Route

Click any route card → Route Detail page.

Click **▶ Watch route**.

The **video player** opens with four viewing modes:

| Mode | What you see |
|---|---|
| **Front** | Driver's-eye view, road ahead |
| **Rear** | Rear window view |
| **Split** | Both cameras side by side |
| **Map** | GPS track on a live map, car position updating in real time |

**Timeline controls:**
- Scrubber bar at the bottom — drag to any point
- Junction and roundabout markers above the scrubber — click to jump directly to that moment
- Play/Pause · 0.5× slow motion
- HUD shows current time · active junction label · total duration

> **Free plan note:** Only the 1 sample route is watchable without Premium. All others redirect to the upgrade screen.

---

### Step 5 — Practise a Route (Premium)

Go back to the Route Detail page.

Click **🧭 Practice route**.

The **Practice mode** opens — *no video, just like the real test*.

| Control | Action |
|---|---|
| **Start** | Begins the session; clock starts counting |
| **Stop** | Pauses the session |
| **Restart** | Returns to the beginning |

As time progresses, the app reads turn instructions aloud in **British English**:

> *"In 200 metres, turn left"*
> *"At the roundabout, take the third exit"*
> *"Bear right at the junction"*
> *"You have reached your destination"*

Run the route 5–10 times and the instructions become automatic.

---

### Step 6 — AI Learning Summary (Premium)

After completing a watch or practice session, the app generates a personalised summary:

- **Key junctions to remember** on that specific route
- **One focus area** (e.g. "Watch your mirror signal manoeuvre sequence at the roundabout")
- **Encouragement** based on your session count

The summary appears as a card after the session ends.

---

### Step 7 — Track Progress

Navigate to **Account → View progress** (or `/account/progress`).

The Progress page shows:

| Stat | What it measures |
|---|---|
| Routes watched | Total unique routes you've viewed |
| Practice runs | Total voice practice sessions completed |
| Watch time | Total time spent watching routes |
| Current streak | Consecutive days you've practised |
| Best streak | Your longest consecutive practice run |

Below the stats: a full **Route History** list with completion percentage bars for each route.

---

### Step 8 — Book an Instructor

Navigate to **Instructors** in the navigation bar (or **Account → Find instructors**).

**Finding an instructor:**
1. Enter a postcode or area (optional) and maximum price (optional)
2. Click **Search**
3. Browse instructor cards — each shows: name, ADI verification badge, reputation score, routes contributed, lesson price, years of experience

**Booking a lesson:**
1. Click any instructor card → their **Profile page**
2. Read their bio and see their available time slots
3. Click a slot to select it (highlighted)
4. Add an optional message (e.g. "Preparing for Mill Hill test — need roundabout practice")
5. Click **Request lesson — £XX.XX**
6. A booking request is created — the instructor confirms it

**Managing bookings:**
- Navigate to **My Bookings** (via nav or `/bookings`)
- See all upcoming and past bookings with status: Pending · Confirmed · Completed · Cancelled
- Cancel any pending or confirmed booking from this screen

---

### Step 9 — Upgrade to Premium

Navigate to **Account → Upgrade** or go to `/paywall`.

| Plan | Price | Best for |
|---|---|---|
| **Free** | £0 | Browsing, 1 sample route |
| **Premium Monthly** | £4.99/month | Test coming up soon |
| **Premium Yearly** | £39.99/year | Long-term learners (save 33%) |

> **Booking an instructor does NOT require Premium.** Anyone can book a lesson.

Premium includes:
- ✅ Unlimited routes for your test centre
- ✅ Practice mode with UK voice guidance
- ✅ Multi-view playback (front · rear · split · map)
- ✅ AI-generated learning summaries
- ✅ Offline route access (mobile app)
- ✅ Verified instructor routes

---

### Step 10 — Install as a PWA (Add to Home Screen)

On the **Account** page, if your browser supports installation:

1. An **"📲 Install RouteSync"** card appears
2. Click **Install** → browser's native install dialog appears
3. The app installs to your home screen and runs fullscreen like a native app

On **iPhone/iPad:**
1. Open in Safari → Share icon → **"Add to Home Screen"** → **Add**

The installed app works **offline** for cached routes and practice mode.

---

## 4. Instructor (ADI) Journey — Full Cycle

### Step 1 — Register an Account

Same as the learner registration. URL: **http://localhost:5174**

Register with your professional email. Your account starts as a standard user.

---

### Step 2 — Accept the Footage Agreement

Before uploading any routes, you must accept the **Footage Licensing Agreement** — confirming you have the right to publish the dashcam footage.

1. Navigate to **Contribute** (via Account page or nav)
2. The agreement is presented on first visit
3. Click **Accept** — one-time action, never asked again

---

### Step 3 — Submit Your ADI Verification

1. In the **Contribute** section, click **"🎓 Become a verified instructor"**
2. Enter your **DVSA ADI licence number** (e.g. ADI78341)
3. Upload your **ADI certificate** or provide a link to evidence
4. Click **Submit**

A RouteSync admin will review your application (typically within 24 hours).

**After verification you receive:**
- ✅ A **Verified Instructor** badge visible to all learners
- 🔼 Your routes appear **higher in search results**
- ⚡ **Fast-tracked** route approvals (admin prioritises your uploads)
- 🏅 An **instructor reputation bonus**

---

### Step 4 — Set Up Your Instructor Profile

After verification, complete your professional profile:

- Bio — describe your experience and specialisms
- Years of experience
- Lesson price (£/hour) — default is £35
- Service area — the postcodes and areas you cover
- Toggle **"Accepting bookings"** on or off at any time

This is what learners see when they search for instructors.

---

### Step 5 — Upload a Route (with Video)

1. In **Contribute**, click **"⬆️ Upload a new route"**

2. Fill in the details:
   - Route title (e.g. "Mill Hill Test Centre — Roundabout Route")
   - Description (optional but helps learners)
   - Target test centre
   - Difficulty level

3. Attach your files:
   - **Front camera video** — one or more MP4 clips (multiple clips stitched automatically)
   - **Rear camera video** — optional but strongly recommended
   - **GPX file** — GPS track from your dashcam or a phone GPS app

4. Tick the licensing agreement checkbox

5. Click **Upload** — you're taken to the live status page

**Pipeline stages (all automatic):**

| Stage | What the platform does |
|---|---|
| Ingest | Receives and stores your files securely |
| Clip sort | Orders multiple clips by recording timestamp |
| Gap detection | Finds any gaps or overlaps between clips |
| Merge | Stitches all clips into one continuous video |
| GPS validation | Checks GPS track for accuracy, drift, speed anomalies |
| Sync engine | Aligns video frame-by-frame to GPS coordinates |
| Privacy blur | AI detects and blurs all faces and number plates |
| Quality score | Calculates overall score 0–100 (GPS + video + sync) |
| Navigation | Generates British English turn-by-turn instructions |
| Ready for review | Admin is notified to approve and publish |

Typical processing time: **2–5 minutes** for a 20-minute route.

---

### Step 6 — Upload a GPS-Only Route (No Video Yet)

If you've driven a route but don't have video footage yet:

1. Upload the **GPX file only** — no video required
2. Route is processed as a **"Map only"** route
3. Learners can immediately use it in **map practice mode**
4. Any verified ADI can attach video later (including you or a colleague)

**To attach video to an existing map-only route:**
1. Find the route in the catalogue — it shows a "Map only" badge
2. Click **"Contribute video to this route"**
3. Upload front/rear video clips
4. System merges them with the GPS and upgrades to full video automatically

---

### Step 7 — Set Availability Slots

Let learners know when you're available for lessons:

1. Go to your instructor settings
2. Add slots: select date · start time · end time
3. Repeat for each available day
4. Learners see only **available (unbooked) slots** on your profile

You can remove any slot that hasn't been booked. Booked slots require a cancellation.

---

### Step 8 — Manage Lesson Bookings

When a learner requests a lesson, you receive an in-app notification.

Navigate to **My Bookings**:

| Action | When to use |
|---|---|
| **Confirm** | Accept the learner's request — lesson is now booked |
| **Decline** | Turn down the request (add a reason) |
| **Mark completed** | After the lesson takes place |
| **Mark no show** | If the learner doesn't attend |
| **Cancel** | If you need to cancel — slot becomes available again |

Booking statuses: **Pending → Confirmed → Completed / Cancelled / No show**

---

### Step 9 — ADI Account Security

RouteSync enforces **one active session per ADI** at all times:

- Logging in on a new device **immediately signs out all other devices**
- Prevents licence sharing and protects your uploaded content
- If you're signed out unexpectedly, the login screen shows:
  *"You were signed out because your account was used on another device"*

---

### Step 10 — Earn Credits, Reputation & Badges

Every published route earns:
- **Credits** — platform currency (future marketplace use)
- **Reputation points** — based on publish volume, quality scores, and instructor status

**Badges:**

| Badge | How to earn |
|---|---|
| 🏅 First Route | Publish your first route |
| 🥈 10 Routes | Publish 10 routes |
| 🥇 50 Routes | Publish 50 routes |
| ⭐ High Quality | Consistently score above the quality threshold |
| 🎓 Verified Instructor | DVSA ADI status confirmed by admin |

---

## 5. Admin Journey — Full Cycle

Admin console: **http://localhost:5180**
Login: `demo@routesync.uk` / `Password123!`

---

### Dashboard Header

The top bar always shows live platform stats:
- **Users** — total registered accounts
- **Published** — total live routes
- **Premium** — active premium subscribers

---

### ⏳ Review Queue — Approving Routes

The most important daily task. Every upload appears here before going live.

**Per route row:**
- Title and contributor
- Quality score (colour-coded: green ≥70, amber 50–69, red <50)
- Sync confidence %
- **Instructor** badge — fast-tracked routes from verified ADIs
- **Map only** badge — GPS-only routes (no video)
- Submission date

**To review:**
1. Click **Review →**
2. A side panel opens:
   - **Thumbnail** of the route
   - **Quality metrics:** GPS score · Sync confidence · Overall score
   - **Pipeline stages** — every stage with its status (done/skipped/flagged/failed)
   - **Video renditions** — view · resolution · duration for each file
3. **Approve & publish** — route goes live immediately for all users
4. **Reject** — enter a reason; the contributor sees this in their upload status

---

### 👥 Users — Account Management

Search any user by name or email.

**Change role:**

| Role | Permissions |
|---|---|
| `user` | Browse, subscribe, book lessons |
| `contributor` | + Upload routes |
| `instructor` | + Receive lesson bookings (verified ADI only) |
| `moderator` | + Review routes, handle reports |
| `admin` | Full platform access |

**Suspend / Reinstate:**
- Click **Suspend** — account locked, user sees "Account suspended" on login
- Click **Reinstate** — access fully restored immediately

---

### 🎓 Instructors — ADI Verification

All pending ADI applications.

**Each application shows:**
- Applicant name and email
- ADI number submitted (e.g. ADI78341)
- Evidence link (click **View ↗** to open the certificate document)
- Date submitted

**Actions:**
- **Verify** → Role upgraded to `instructor`, badge awarded, search boost applied
- **Reject** → Enter optional notes; applicant is notified and can reapply

> Note: Tom Briggs in the test data has no evidence document — this demonstrates the "no evidence" state in the UI.

---

### 📅 Bookings — Platform Overview

Full table of all lesson bookings across the platform.

| Column | What it shows |
|---|---|
| Date | Lesson date and start time |
| Learner | Who booked the lesson |
| Instructor | The ADI delivering the lesson |
| Status | Pending · Confirmed · Cancelled · Completed · No show |
| Amount | Total charged to the learner |
| Platform fee | RouteSync's revenue from this booking (10% of lesson fee) |

---

### 💰 Revenue — Financial Dashboard

**Top stat cards:**
- **Estimated MRR** — total monthly recurring revenue from all active subscriptions
- **Monthly subscribers** — count on the £4.99/month plan
- **Yearly subscribers** — count on the £39.99/year plan

**Breakdown table:**
Every unique combination of plan + status with subscriber count. Shows the full health of subscription distribution.

---

### 🏦 Community Fund

RouteSync contributes 10% of net profit to the Instructor Community Fund monthly.

**Balance overview:** Contributed · Paid out · Current balance

**Monthly contribution:**
- Runs automatically on the 1st of each month
- **Run now** — records the current month's contribution immediately (idempotent)

**Beneficiaries:**
1. Add a beneficiary (e.g. "North London ADI Network", "Individual Instructor — Sarah Johnson")
2. Select them when recording payouts

**Recording a payout:**
1. Select beneficiary from dropdown
2. Enter amount in pounds
3. Click **Pay out**

All transactions are publicly visible at `/api/fund/summary` — full transparency.

---

### 🚩 Reports — Flagged Content

User-submitted content reports.

| Column | What it shows |
|---|---|
| Target | Route/user/comment that was reported + truncated ID |
| Reason | Why the user reported it |
| Status | Starts as `open` |
| Date | When it was reported |

Admins take action in the **Users** or **Review Queue** panels, then the report is considered resolved.

---

## 6. Feature Reference by Role

| Feature | Free Learner | Premium Learner | Instructor | Admin |
|---|---|---|---|---|
| Browse route catalogue | ✅ | ✅ | ✅ | ✅ |
| Watch 1 sample route | ✅ | ✅ | ✅ | ✅ |
| Watch unlimited routes | ❌ | ✅ | ✅ | ✅ |
| Practice mode (voice) | ❌ | ✅ | ✅ | ✅ |
| Multi-view playback | ❌ | ✅ | ✅ | ✅ |
| AI learning summaries | ❌ | ✅ | ✅ | ✅ |
| Offline route access | ❌ | ✅ | ✅ | ✅ |
| Progress tracking | ✅ | ✅ | ✅ | ✅ |
| Book an instructor | ✅ | ✅ | N/A | ✅ |
| Upload routes | ❌ | ❌ | ✅ | ✅ |
| GPS-only route upload | ❌ | ❌ | ✅ | ✅ |
| Deferred video attach | ❌ | ❌ | ✅ | ✅ |
| Set availability slots | ❌ | ❌ | ✅ | ✅ |
| Receive lesson bookings | ❌ | ❌ | ✅ verified only | — |
| Earn credits & badges | ❌ | ❌ | ✅ | — |
| Review uploaded routes | ❌ | ❌ | ❌ | ✅ |
| Verify instructors | ❌ | ❌ | ❌ | ✅ |
| Manage users | ❌ | ❌ | ❌ | ✅ |
| View revenue data | ❌ | ❌ | ❌ | ✅ |
| Community Fund admin | ❌ | ❌ | ❌ | ✅ |
| View all bookings | ❌ | ❌ | ❌ | ✅ |

---

## 7. Subscription & Pricing

### Consumer Plans

| Plan | Price | Included |
|---|---|---|
| **Free** | £0 | Browse + 1 sample route |
| **Premium Monthly** | £4.99 / month | Everything |
| **Premium Yearly** | £39.99 / year | Everything + 33% saving vs monthly |

### Instructor Lesson Bookings

- Each ADI sets their own **lesson price** (default £35/hour)
- RouteSync charges a **10% platform service fee** added to the lesson price
- Example: £35 lesson → learner pays £38.50 → instructor receives £35 → RouteSync keeps £3.50
- The platform fee % is configurable by admin without a code deploy

### Community Fund

- **10% of RouteSync's net profit** is contributed to the Instructor Community Fund every month
- Distributed to verified ADI contributors as a reward for building the content library
- Full public ledger at `/api/fund/summary` — complete transparency

---

## 8. Demo Walkthrough Scripts

### Script A — Learner Demo (5 minutes)

*"Let me show you what a learner driver experiences."*

| Step | What to say | What to do |
|---|---|---|
| 1 | "No account needed — let's use the demo mode" | Open http://localhost:5174, click **✨ Explore the demo** |
| 2 | "Here are all the routes for different test centres across the UK" | Show Discover page grid |
| 3 | "Each card shows the route, distance, roundabout count, quality score" | Point to a card |
| 4 | "Let me open one" | Click any route → Route Detail |
| 5 | "This is actual dashcam footage from a real car driving the test route" | Click **▶ Watch route** |
| 6 | "Front and rear cameras simultaneously" | Click **Split** view |
| 7 | "Live GPS map — the car's position updates in real time" | Click **Map** view |
| 8 | "Click any marker to jump straight to that junction" | Click a scrubber marker |
| 9 | "Now watch this — Practice mode. No video. Just voice, like the real test." | Go back → click **🧭 Practice route** |
| 10 | "British English — exactly what they'll hear in their head on test day" | Click **Start**, let 2 instructions play |
| 11 | "Do this 10 times at home and test day feels familiar, not frightening" | Pause |

---

### Script B — Instructor Demo (5 minutes)

*"Now let me show you what an ADI gets from RouteSync."*

| Step | What to say | What to do |
|---|---|---|
| 1 | "Sign in as our demo instructor" | Login as `instructor@routesync.uk` |
| 2 | "This is the contributor dashboard — reputation, credits, badges" | Show Contribute page |
| 3 | "Upload is simple — front cam, rear cam, GPS file. Multiple clips are fine." | Show Upload page briefly |
| 4 | "The platform handles everything — blurs faces and plates automatically" | Describe pipeline |
| 5 | "Learners find you here" | Navigate to /instructors |
| 6 | "They see your price, bio, and available slots" | Click Sarah Johnson's profile |
| 7 | "They pick a slot and request a lesson — you confirm or decline" | Show available slots |
| 8 | "All your bookings in one place" | Show My Bookings |
| 9 | "Payment is handled by the platform. You receive the lesson fee directly." | Mention Stripe Connect |

---

### Script C — Admin Demo (5 minutes)

*"Here's the operations side — what the RouteSync team sees."*

| Step | What to say | What to do |
|---|---|---|
| 1 | "Admin console — login" | Open http://localhost:5180, login as demo@routesync.uk |
| 2 | "Live platform stats at the top — users, published routes, premium subs" | Point to header |
| 3 | "Review Queue — every uploaded route lands here first" | Click Review Queue |
| 4 | "Quality score, sync confidence, GPS — all automatic" | Point to scores |
| 5 | "Let me open one and show you what we check" | Click Review → on any route |
| 6 | "Every pipeline stage, quality breakdown, full video details" | Walk through drawer |
| 7 | "One click to publish — learners see it immediately" | Click Approve |
| 8 | "Instructor verifications — three pending today" | Click Instructors |
| 9 | "ADI number, evidence certificate, verify or reject" | Show James Carter row |
| 10 | "Bookings — full picture of every lesson on the platform" | Click Bookings |
| 11 | "Revenue — MRR, subscriber breakdown" | Click Revenue |
| 12 | "Community Fund — 10% of profit back to instructors, fully transparent" | Click Community Fund |

---

## 9. Test Accounts

### Login Credentials

| Role | Email | Password | Notes |
|---|---|---|---|
| **Admin** | `demo@routesync.uk` | `Password123!` | Full admin console access + web app |
| **Instructor** (verified ADI) | `instructor@routesync.uk` | `Password123!` | Has profile, slots, and 1 confirmed booking |
| **Learner** | `learner@routesync.uk` | `Password123!` | Has 1 confirmed booking with Sarah Johnson |
| Pending ADI 1 | `james.carter@example.com` | `Password123!` | Shows pending verification in admin panel |
| Pending ADI 2 | `priya.sharma@example.com` | `Password123!` | Shows pending verification in admin panel |
| Pending ADI 3 | `tom.briggs@example.com` | `Password123!` | No evidence document — demonstrates that state |

### Quick-Start URLs

| URL | What opens |
|---|---|
| **http://localhost:5174** | Consumer web app (learner / instructor) |
| http://localhost:5174/discover | Route catalogue |
| http://localhost:5174/search | Search routes by test centre |
| http://localhost:5174/instructors | Browse and book instructors |
| http://localhost:5174/bookings | My lesson bookings |
| http://localhost:5174/account | Account settings |
| http://localhost:5174/account/progress | Learning progress dashboard |
| http://localhost:5174/paywall | Subscription upgrade page |
| **http://localhost:5180** | Admin console |
| http://localhost:3000/docs | Full API documentation (Swagger) |
| http://localhost:9001 | MinIO storage console (dev only) |

---

*RouteSync — Helping every UK learner pass first time.*
*Guide prepared: July 2026*
