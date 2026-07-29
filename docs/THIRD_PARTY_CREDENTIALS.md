# Third-Party Accounts & Credentials — Registration Tracker

> ⚠️ **This is a TRACKER, not a secret store.** It is committed to git — **never
> paste real keys, tokens, passwords, or connection strings here.** Put actual
> values only in: local `apps/api/.env` (git-ignored), the **Render** dashboard
> (API + worker env), **Vercel** (web env), and your password manager.
>
> Use the **Status** box to track registration: ☐ not started · ◐ registered,
> not yet wired · ☑ live & verified.

---

## How values reach each app
| App | Where env vars live |
|---|---|
| API (NestJS) | local `apps/api/.env` · **Render** service env |
| Worker (Python) | local env · **Render** worker env |
| Web (React/Vite) | `apps/web/.env` · **Vercel** project env |
| Mobile (Flutter) | native config files (see Auth section) + build secrets |

---

## 1. Core infrastructure (required for the app to run)

| Service | Register at | Credential → env var | Used by | Cost | Status |
|---|---|---|---|---|:--:|
| **Postgres + PostGIS** (Supabase) | supabase.com | connection string → `DATABASE_URL` | API, Worker | Free tier → paid | ☐ |
| **Redis** (Render Redis / Upstash) | render.com / upstash.com | URL → `REDIS_URL` | API (queue), Worker | Free tier → paid | ☐ |
| **Object storage** (Cloudflare R2 *recommended*, or AWS S3) | cloudflare.com R2 | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | API, Worker | R2 has no egress fee | ☐ |
| **API hosting** (Render) | render.com | account + service; set `API_BASE_URL` | — | Free tier → paid | ☐ |
| **Web hosting** (Vercel) | vercel.com | account + project | — | Free tier | ☐ |
| **JWT secrets** *(self-generated, not a vendor)* | `openssl rand -base64 48` | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | API | free | ☐ |

> R2 is recommended over S3 for **cost** (zero egress — you stream a lot of video).

---

## 2. Authentication (mobile sign-in)

| Provider | Register at | Credential → env var | Notes | Cost | Status |
|---|---|---|---|---|:--:|
| **Google OAuth** | Google Cloud Console → Credentials | client IDs → `GOOGLE_CLIENT_ID` (comma-separate iOS + Android + web/server) | Android also needs the app's **SHA-1** fingerprint; iOS needs the reversed-client-id in `Info.plist` | free | ☐ |
| **Sign in with Apple** | Apple Developer → Certificates, IDs & Profiles | Service/App ID → `APPLE_CLIENT_ID` (the token `aud`) | Backend verification (built) only needs this | in Apple Dev Program | ☐ |
| **Apple — server flow (optional)** | Apple Developer → Keys (.p8) | `APPLE_TEAM_ID`, `APPLE_KEY_ID` + the `.p8` key | Only needed for **token revocation / auth-code exchange** (advanced); not required for basic login | — | ☐ |

> **Email/password login needs nothing here** — it works out of the box.
> Apple button is **mandatory on iOS** whenever Google is offered (App Store rule 4.8).

---

## 3. Payments & subscriptions

| Service | Register at | Credential → env var | Used by | Cost | Status |
|---|---|---|---|---|:--:|
| **Stripe** (web subscriptions) | dashboard.stripe.com | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | API | % per transaction | ☐ |
| Stripe checkout redirects | — | `CHECKOUT_SUCCESS_URL`, `CHECKOUT_CANCEL_URL` | API | — | ☐ |
| **RevenueCat** (mobile in-app purchases) | revenuecat.com | `REVENUECAT_WEBHOOK_SECRET` | API | free < $2.5k/mo tracked | ☐ |
| **Stripe Connect** (instructor payouts — *deferred*) | Stripe → Connect | (added when rev-share turns on) | API | — | ☐ |

> Payments are **not active yet** (Stripe unconfigured). Set the price IDs to the
> real £4.99/mo and £39.99/yr products when you create them.

---

## 4. Media processing (worker)

| Service | Register / host | Credential → env var | Notes | Cost | Status |
|---|---|---|---|---|:--:|
| **Valhalla** (map-matching / routing) | self-host (Docker) or a hosted routing API | `VALHALLA_URL` | Used by the worker for road-network matching + turn instructions | self-host = infra only | ☐ |
| AI blur / transcription toggles | — | `ENABLE_AI_BLUR`, `ENABLE_WHISPER`, `YOLO_MODEL` | feature flags + local model path, **not** credentials | free | ☐ |
| Worker → API callback | — | `API_BASE_URL` | worker posts processing status back | — | ☐ |

---

## 5. Geo / maps

| Service | Register at | Credential | Notes | Cost | Status |
|---|---|---|---|---|:--:|
| **postcodes.io** (UK postcode → lat/lng) | — | **none** | Free, keyless, already integrated for test-centre geocoding | free | ☑ |
| **Map tiles** (OpenStreetMap) | — (or MapTiler/Stadia for production) | none now; key if you move to a paid tile host | Currently hitting `tile.openstreetmap.org` directly — fine for dev, get a proper tile provider for production traffic | free → paid | ☐ |

---

## 6. Monitoring (optional but recommended)

| Service | Register at | Credential → env var | Cost | Status |
|---|---|---|---|:--:|
| **Sentry** (error tracking) | sentry.io | `SENTRY_DSN` | free tier | ☐ |

---

## 7. App store / developer program accounts (to publish the mobile app)

| Account | Register at | Cost | Needed for | Status |
|---|---|---|---|:--:|
| **Apple Developer Program** | developer.apple.com | **$99 / year** | iOS build, Sign in with Apple, App Store | ☐ |
| **Google Play Console** | play.google.com/console | **$25 one-time** | Android build + Play Store | ☐ |

---

## 8. Deferred (not needed at launch)
| Service | For | Why deferred |
|---|---|---|
| **SMS provider** (Twilio / AWS SNS / Firebase Phone Auth) | phone-number login | cost + toll-fraud risk; email/Google/Apple cover launch |
| **Stripe Connect** | paying instructors a rev-share | instructor share is 0% at launch (charity + marketing model) |

---

### Quick "minimum to run" checklist
- [ ] `DATABASE_URL` (Supabase) · `REDIS_URL` · S3/R2 keys · `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET`
- [ ] `GOOGLE_CLIENT_ID` + `APPLE_CLIENT_ID` (for social login; email works without them)
- [ ] Stripe keys **only when** you switch on paid subscriptions
