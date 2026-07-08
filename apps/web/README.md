# RouteSync Web (React + Vite)

The **consumer-facing** RouteSync app as a responsive, mobile-first web app — works
in any phone or desktop browser. (The Flutter app in `apps/mobile` is the future
native build; this web app is what ships first.)

## Run

```bash
npm install
npm run dev        # http://localhost:5174  (proxies /api -> http://localhost:3000)
```

`vite.config.ts` sets `host: true`, so in dev you can open it on your **phone's
browser** at `http://<your-computer-LAN-IP>:5174` (same Wi-Fi) to test mobile.

```bash
npm run build      # tsc --noEmit + vite build  -> dist/
```

## What's implemented

- **Responsive shell** — top nav on desktop, bottom tab bar on mobile, safe-area aware.
- **Auth** — email login/register against `/auth`, JWT in localStorage with silent
  refresh on 401.
- **Discover / Search** — route list + filters (`/routes`, `/search/routes`).
- **Route detail** — entitlement pre-check → routes free users to the paywall.
- **Watch** — `useMasterTimeline` coordinates front + rear **HLS** `<video>` on one
  clock (offset-aware resync), with Front/Rear/Split/Map views, scrubber, HUD with
  junction/roundabout markers, and slow-motion. HLS via `hls.js` (or native on Safari/iOS).
- **Practice** — timeline clock speaks UK-English instructions via the browser
  **Web Speech API** (`speechSynthesis`, `en-GB`), no video, with a progress checklist.
- **Paywall** — Stripe Checkout redirect (`POST /subscriptions/checkout`).

## Performance

The Watch page (hls.js + leaflet, ~680 KB) is **lazy-loaded**, so first paint is
~58 KB gzipped — important on mobile data.

## Still to wire

- Google/Apple social sign-in (email works today).
- Map view route polyline (needs lat/lon track geometry added to the playback manifest).
- PWA manifest + service worker for installable / offline behaviour.
