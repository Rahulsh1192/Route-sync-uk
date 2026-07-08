# RouteSync Mobile (Flutter)

iOS + Android learner app. Structure follows `docs/ARCHITECTURE.md` §4.

## Run

```bash
# generate the native iOS/Android runners (one-time; needs the Flutter SDK)
flutter create . --org uk.routesync --platforms ios,android
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api   # Android emulator
flutter analyze && flutter test
```

> `lib/` is fully written; only the generated `android/` + `ios/` runner folders are
> missing (they come from `flutter create .`). Configure `API_BASE_URL` (and
> `REVENUECAT_KEY` for IAP) via `--dart-define`.

## Implemented (`lib/`)

- **Core** — Dio API client with bearer + auto token-refresh interceptor, secure
  token store, build-time `Env`, `go_router` with auth-redirect.
- **Auth** — email login/register + Google/Apple buttons (social wiring marked TODO).
- **Discover / Search / Route detail** — list, filter, preview with Watch/Practice.
- **Route player** — `MasterTimelineController` drives front/rear video on one clock
  (offset-aware resync), with Front/Rear/Split/Map views, scrubber, telemetry HUD,
  and slow-motion. Map view needs a track-geometry endpoint to draw the polyline.
- **Practice mode** — timeline clock speaks UK-English instructions via `flutter_tts`,
  no video, with a progress checklist.
- **Paywall** — plan cards (RevenueCat IAP purchase flow marked TODO).
- **Contribute** — instructor-verification form (live) + upload flow placeholder.

## Still to wire

- Social sign-in token exchange (google_sign_in / sign_in_with_apple → API).
- RevenueCat purchase flow in the paywall.
- Resumable multi-clip upload (file_picker → presigned PUT → status polling).
- Offline downloads + map polyline (needs track-geometry in the playback manifest).

## The two pieces of real mobile engineering

1. **Master timeline controller** (`lib/shared/player/`) — one `position` (ms) drives
   front/rear `VideoController`s (each offset by `syncOffsetMs` from the playback
   manifest), the map camera, and the telemetry HUD. Scrubbing sets `position`;
   the controller fans out seeks and resyncs every N frames. View modes (Front /
   Rear / Split / Map) change rendering only, never the clock. Slow-mo scales
   `playbackRate` on all controllers together.
2. **Offline packager** (`lib/features/offline/`) — download signed video + GPX +
   pre-rendered UK-English voice + map tiles into an encrypted, compressed package
   (premium only). Wi-Fi-only default + size warnings.

## Practice mode

Reuses GPX interpolation + markers from the player, drops video, and feeds
`GET /api/routes/:id/practice` instructions to `flutter_tts` (locale `en-GB`).

## Subscriptions

Use **RevenueCat** (`purchases_flutter`) for Apple/Google IAP — **not** Stripe
inside the app (store policy). Web checkout uses Stripe; both reconcile to the
server-side entitlement via webhooks.
