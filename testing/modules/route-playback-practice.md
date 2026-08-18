# Module — Watch (Playback) & Practice

**Prefix:** `PLAY-###`

---

## Module overview

| | |
|---|---|
| **Purpose** | **Watch** — play the recorded drive (front and rear dashcam) with a map marker that moves along the GPS track. **Practice** — replay the same route as spoken turn-by-turn instructions, no video. |
| **Web paths** | `/route/:id/watch` · `/route/:id/practice` (both lazy-loaded — heavy media libraries) |
| **Entry point** | The **Watch** and **Practice** buttons on `/route/:id` |
| **API** | `GET /api/routes/:id/playback` · `GET /api/routes/:id/practice` · `GET /api/routes/:id/track` · `GET /api/routes/:id/hls/:token/:view/:file` · `POST /api/routes/:id/watch` (beacon) · `POST /api/routes/:id/session-complete` |
| **Roles** | All — entitlement-gated, not role-gated |
| **Components** | [WatchPage.tsx](../../apps/web/src/pages/WatchPage.tsx) · [PracticePage.tsx](../../apps/web/src/pages/PracticePage.tsx) · [apps/web/src/player/](../../apps/web/src/player/) · [apps/web/src/map/RouteMap](../../apps/web/src/map/) |
| **Backend** | `playback()`, `practice()`, `track()`, `hlsAsset()`, `issueHlsToken()` in [routes.service.ts](../../apps/api/src/modules/routes/routes.service.ts) · [revshare.service.ts](../../apps/api/src/modules/revshare/revshare.service.ts) (`recordWatch`) |
| **Dependencies** | Access decision ([route-detail-access-paywall.md](route-detail-access-paywall.md)) · media worker output (`route_videos`, `route_track_points`, `route_markers`, `route_instructions`, `route_clip_timeline`) · object storage |

---

## Preconditions

- Signed in with a satisfied access decision for the route (Premium for its centre, or it
  is the account's claimed demo route). Otherwise the API returns **403**.
- Seeded routes have front + rear video and markers.
- **Practice mode needs `route_instructions` rows.** Verify the seeded route has some
  before failing a practice test:
  `SELECT count(*) FROM route_instructions WHERE route_id = '22222222-2222-2222-2222-222222222222';`
  If the count is 0, practice will render "Route complete" immediately — that is a data
  gap, not a UI defect.
- **Speech synthesis** must be available in the browser for practice audio.

---

## Business rules found in the implementation

1. **Both endpoints commit the access decision** — opening Watch or Practice claims the
   account's free demo route if none is claimed yet.
2. **Video is never public.** Playback mints an **HMAC-SHA256 token** over
   `routeId.userId.expiry`, keyed with `JWT_ACCESS_SECRET`, and puts it in the URL
   **path**. TTL = `SIGNED_URL_TTL`, default **3 600 s**.
3. The HLS gateway rejects: a token minted for a **different route**, an expired token, a
   bad signature, an unknown `view` (only `front` / `rear`), and any filename not matching
   `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(m3u8|ts|m4s|mp4|vtt)$` — which blocks `../`,
   absolute paths and encoded traversal.
4. **Playlists are served inline; media segments are a 302** to a **900 s** presigned URL.
   Responses are `Cache-Control: private, no-store`.
5. **Seeded routes bypass the gateway** because their `manifest_key` is an absolute
   external URL. Only worker-processed routes exercise the gateway.
6. The playback response carries `streams`, `markers`, `track`, `clipTimeline`,
   `durationS`, `syncConfidence`, junction/roundabout counts and `preview`.
7. **Only on-route track points are returned** (`WHERE on_route`), so the marker never
   jumps to places the footage does not visit.
8. **View modes:** `all` (front + rear + map together), `front`, `rear`, `split`, `map`.
   The **Map** button is hidden when the route has no track; the **Rear** button is hidden
   when there is no rear stream.
9. **Skip is ±10 seconds.** A "follow the marker" toggle is available whenever the map is
   shown.
10. **Practice speaks `text_ukenglish` using an `en-GB` voice** when one is available,
    stepping through instructions on the route's clock. Controls: Start/Stop and
    **↺ Restart**.
11. The watch-time beacon accepts `secondsWatched` between **0 and 86 400** and a `source`
    of `playback` or `practice`.

---

## UI components

| Screen | Elements |
|---|---|
| `/route/:id/watch` | Back button · video panes (front / rear) · map pane with a rotating, interpolated marker on the R1 polyline · **seek slider** (`aria-label="Seek"`) · **⏪ 10s** (`aria-label="Back 10 seconds"`) · Play/Pause · **10s ⏩** (`aria-label="Forward 10 seconds"`) · elapsed / total time · **"Keep the map centred on the marker"** follow checkbox · view-mode buttons **All · Front · Rear · Split · Map** |
| `/route/:id/practice` | Back button · large current-instruction text · Start / Stop · **↺ Restart** · the full instruction list · a **"Book a lesson with this instructor"** call to action linking to `/instructors/:id` |

---

## Functional test cases

### Watch

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| PLAY-001 | Open the player | user | Entitled | Route detail → **Watch** | `/route/:id/watch` loads (brief spinner while the lazy chunk downloads), then the front video plays |
| PLAY-002 | Default view mode | user | Route has front + rear + track | Open Watch | Mode **All** — front, rear and map in one container |
| PLAY-003 | Switch to Front / Rear / Split / Map | user | Same | Click each view button | The layout changes. Switching views must **not** restart or re-buffer the video — playback position is preserved |
| PLAY-004 | **Map** button hidden without a track | user | A route with no `route_track_points` | Open Watch | The Map button is absent — not present-but-broken |
| PLAY-005 | **Rear** button hidden without a rear stream | user | A route with only a front video | Open Watch | The Rear button is absent |
| PLAY-006 | Play / pause | user | — | Toggle the button | Video pauses and resumes; the label reflects the state |
| PLAY-007 | Seek | user | — | Drag the seek slider | Video and the map marker both jump to that position |
| PLAY-008 | Skip back 10 s | user | Playing at ≥ 20 s | Click **⏪ 10s** | Position moves back exactly 10 s |
| PLAY-009 | Skip forward 10 s | user | — | Click **10s ⏩** | Position moves forward 10 s |
| PLAY-010 | Skip past the boundaries | user | At 0 s, then at the end | Skip back at 0 s; skip forward at the end | Clamped to 0 and to the duration; no negative time and no error |
| PLAY-011 | Map marker follows playback | user | Route with a track | Play and watch the map | The marker moves along the polyline, interpolated and rotated to the bearing |
| PLAY-012 | Follow toggle | user | Map shown | Untick **Keep the map centred**, pan the map away, keep playing | The map no longer recentres. Re-tick it → the map snaps back to the marker |
| PLAY-013 | Front and rear stay in sync | user | Route with both views | Watch in **All** mode, then seek | Both panes show the same moment (`sync_offset_ms` applied) and stay aligned after a seek |
| PLAY-014 | **HLS gateway — valid token** | user | A **worker-processed** route (not a seeded one) | Open Watch, then in DevTools → Network inspect the `.m3u8` request | Served from `/api/routes/:id/hls/<token>/front/index.m3u8` with `Cache-Control: private, no-store`; segment requests return **302** to a presigned URL |
| PLAY-015 | **HLS gateway — token replay across routes** | user | Two worker-processed routes A and B | Take the token from route A's playback URL and request `/api/routes/<B>/hls/<tokenA>/front/index.m3u8` | **403** `Token is for a different route` |
| PLAY-016 | **HLS gateway — path traversal** | user | Valid token | Request `.../front/..%2f..%2fsecret.m3u8` and `.../front/../../etc/passwd` | **400** `Unsupported HLS asset name`. Anything other than a 4xx is a **critical security defect** |
| PLAY-017 | **HLS gateway — unknown view** | user | Valid token | Request `.../hls/<token>/side/index.m3u8` | **400** `Unknown view 'side'` |
| PLAY-018 | **HLS gateway — tampered token** | user | — | Change one character of the token in the URL | **403** `Invalid playback token` |
| PLAY-019 | **HLS gateway — expired token** | user | Set `SIGNED_URL_TTL=60`, restart the API | Start playback, wait 61 s, then request a new segment | **403** `Playback token has expired`. Record how the player surfaces this to the user |
| PLAY-020 | Watch-time beacon fires | user | — | Watch for ~30 s, then leave the page. Check `route_watch_events` | A row is recorded with roughly the seconds watched and `source = 'playback'` |
| PLAY-021 | Beacon rejects an out-of-range value | user | — | `POST /api/routes/:id/watch` with `secondsWatched: 999999` | **400** (max 86 400) |
| PLAY-022 | Beacon rejects an unknown source | user | — | `POST` with `source: "hacking"` | **400** |
| PLAY-023 | Leave and return mid-route | user | — | Watch to ~30 s, go Back, re-enter Watch | The page loads cleanly. Record whether playback resumes at 0 or at 30 s — resume behaviour is not specified in code (`Needs Clarification`) |
| PLAY-024 | Route with **no video at all** (map-only) | user | A `has_video = false` route | Open Watch | Handled gracefully — the map view is offered, no broken video element |
| PLAY-025 | Storage unreachable | user | Stop the MinIO container | Open Watch on a worker-processed route | A readable error, not an infinite spinner |

### Practice

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| PLAY-026 | Open practice mode | user | Entitled; the route has instructions | Route detail → **Practice** | `/route/:id/practice` loads; the first instruction is shown; **no video is displayed** |
| PLAY-027 | Start speaks the instructions | user | Browser audio available | Click **Start** | Instructions are spoken in sequence in UK English; the highlighted instruction advances with them |
| PLAY-028 | Stop | user | Running | Click **Stop** | Speech stops; the position is retained |
| PLAY-029 | Restart | user | Part-way through | Click **↺ Restart** | Returns to the first instruction |
| PLAY-030 | Reaching the end | user | — | Let it run to the last instruction | Shows **"Route complete 🎉"**; no crash and no runaway speech |
| PLAY-031 | Route with **no** instructions | user | A route with 0 `route_instructions` rows | Open Practice | Shows "Route complete" immediately. This is a **data** gap — raise it against the content, not the UI |
| PLAY-032 | "Book a lesson with this instructor" | user | Route has a contributor | Scroll the practice page | The call to action is present and navigates to `/instructors/:id` |
| PLAY-033 | Speech synthesis unavailable | user | A browser/profile without TTS | Open Practice and Start | The instruction text still advances visibly; the page does not crash |
| PLAY-034 | Practice without entitlement | user | Demo claim spent elsewhere | Open `/route/<other>/practice` directly | Redirected/blocked; the API returns **403** |

---

## Traceability

| Test IDs | UI | API | Logic |
|---|---|---|---|
| PLAY-001 … PLAY-013, PLAY-023 … PLAY-025 | `WatchPage.tsx`, `player/`, `map/RouteMap` | `GET /api/routes/:id/playback` | `RoutesService.playback()`, `trackPoints()`, `clipTimeline()` |
| PLAY-014 … PLAY-019 | video element requests | `GET /api/routes/:id/hls/:token/:view/:file` | `issueHlsToken()`, `verifyHlsToken()`, `hlsAsset()` |
| PLAY-020 … PLAY-022 | `WatchPage.tsx` beacon | `POST /api/routes/:id/watch` | `RevshareService.recordWatch()` |
| PLAY-026 … PLAY-034 | `PracticePage.tsx` | `GET /api/routes/:id/practice` | `RoutesService.practice()` |
</content>
