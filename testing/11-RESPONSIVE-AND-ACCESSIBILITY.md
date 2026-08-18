# 11 — Responsive UI and Accessibility

**Prefixes:** `UI-###` (responsive/layout) · `A11Y-###` (accessibility)

The application declares no supported-browser or supported-device list —
`Needs Clarification`. Everything below is derived from the CSS breakpoints and the ARIA
attributes actually present in the code.

---

## 1. Breakpoints found in the code

From [apps/web/src/index.css](../apps/web/src/index.css) and
[apps/web/src/admin/admin.css](../apps/web/src/admin/admin.css):

| Breakpoint | What changes | File |
|---|---|---|
| **`min-width: 700px`** | **The key one.** The desktop header nav appears and the bottom tab bar is hidden (`display: none !important`); content bottom padding changes | index.css:191 |
| `min-width: 560px` | Layout adjustment | index.css:428 |
| `min-width: 640px` | Test-centre grid → **2 columns** | index.css:781 |
| `min-width: 760px` | Two further layout adjustments | index.css:617, 712 |
| `min-width: 900px` | Layout adjustments | index.css:431, 771 |
| `min-width: 960px` | Test-centre grid → **3 columns** | index.css:782 |
| `max-width: 768px` | Admin console layout | admin.css:838 |
| `max-width: 480px` | Admin console layout | admin.css:845 |

Also present, and worth testing:

- **`prefers-color-scheme: light`** — a full light-theme variable set (index.css:85,
  admin.css:86). The default is **dark**.
- **`prefers-reduced-motion: reduce`** — all animations and transitions reduced to
  0.01 ms (index.css:118).

---

## 2. Responsive test cases

Test each viewport in DevTools device emulation **and**, if possible, on a real device.
The Vite dev server binds to the LAN (`host: true`), so a phone on the same network can
open `http://<your-ip>:5174`.

| Test ID | Viewport | Check | Expected |
|---|---|---|---|
| UI-001 | 375 × 667 (small phone) | Learner shell | **Bottom tab bar** visible with 4 tabs; desktop header nav hidden |
| UI-002 | 375 × 667 | Test-centre list | **1 column** |
| UI-003 | 699 px wide | Boundary below 700 | Bottom tab bar still present |
| UI-004 | 700 px wide | **Boundary at 700** | Bottom bar disappears; desktop nav appears. No overlap and no double navigation |
| UI-005 | 640 px wide | Test-centre grid | **2 columns** |
| UI-006 | 960 px wide | Test-centre grid | **3 columns** |
| UI-007 | 768 × 1024 (tablet portrait) | Whole app | Desktop nav; readable layout; no horizontal scrolling |
| UI-008 | 1366 × 768 (laptop) | Whole app | Full desktop layout |
| UI-009 | 1920 × 1080 | Whole app | Content does not stretch to unreadable line lengths |
| UI-010 | 375 px | **Watch page** | Video, map and the control bar all usable; view-mode buttons reachable; the seek slider is draggable with a finger |
| UI-011 | 375 px | **Watch page, "All" mode** | Front, rear and map do not overlap or overflow |
| UI-012 | 375 px | **Upload wizard** | All four steps usable; file pickers reachable; the step bar does not overflow |
| UI-013 | 375 px | **Admin console** | Below 768 px the console reflows (admin.css:838). Confirm the sidebar is still reachable and tables do not force horizontal page scroll |
| UI-014 | 480 px | **Admin console** | Second reflow (admin.css:845) applies cleanly |
| UI-015 | 375 px | **Admin tables** (Users, Bookings, Fund, Earnings) | Wide tables scroll **within their container**, not the whole page |
| UI-016 | 375 px | **Instructor dashboard** | Profile form, slot form and bookings list all usable |
| UI-017 | 375 px | **Login / register** | The hero and the auth card stack; every field reachable; the keyboard does not obscure the submit button |
| UI-018 | 375 px | **Paywall** | Both plan cards readable and tappable |
| UI-019 | Any | Long content — a 160-character centre name, a 1 000-character description | Text wraps; no overflow and no clipped text |
| UI-020 | Any | The **DEMO** pill (when demo mode is on) | Does not overlap the nav |
| UI-021 | Landscape phone (667 × 375) | Watch page | Video is usable; controls are not pushed off-screen |
| UI-022 | Any | Modals and overlays (admin route detail, run detail drawer) | Fit the viewport; the close control is always reachable |

---

## 3. Theme and motion

| Test ID | Scenario | Expected |
|---|---|---|
| UI-023 | OS set to **light mode** | The light variable set applies across both the learner app and the admin console; **all text stays readable** — check the muted text, pills, error banners and stat tiles specifically |
| UI-024 | OS set to **dark mode** | The default dark theme |
| UI-025 | Toggle the OS theme with the app open | The theme follows without a reload |
| UI-026 | OS **reduce motion** enabled | Animations and transitions are effectively instant. Check the spinner, nav transitions and progress bars |

---

## 4. Accessibility

### 4.1 What the code already does

Verified present:

- `:focus-visible` outlines on buttons, admin nav items and the password toggle —
  deliberately **not** `:focus`, so a mouse click does not leave a ring.
- `aria-label` on: the test-centre search, the route search, the seek slider, the ±10 s
  skip buttons, admin role selects, admin suspend/reinstate buttons, and the admin nav.
- `role="navigation"` + `aria-label="Main navigation"` on the admin sidebar;
  `role="banner"` on the topbar; `role="region" aria-label="Key metrics"` on the stat
  tiles; `aria-current="page"` on the active nav item.
- `role="alert"` on the admin Reports error.
- `scope="col"` on admin table headers.
- `aria-hidden="true"` on decorative icons and emoji.
- `id="main-content"` on the admin `<main>`.
- Keyboard handlers (`onKeyDown` for `Enter`) on the admin sidebar's `div`-based nav items.
- `autoComplete="new-password"` / `"current-password"` on the password field.

### 4.2 Test cases

| Test ID | Scenario | Expected |
|---|---|---|
| A11Y-001 | **Keyboard-only** through `/login` | Tab reaches every field and both buttons in a sensible order; Enter submits |
| A11Y-002 | Keyboard-only through the learner navigation | Every nav link reachable and activatable; the active item is identifiable |
| A11Y-003 | Keyboard-only through `/test-centres` | Search, the New button (staff) and every card reachable. **Cards are `div`s with `onClick`** — confirm whether they are keyboard-activatable at all. If not, that is a real accessibility defect |
| A11Y-004 | Keyboard-only through the **admin sidebar** | Each nav item is reachable (`tabIndex={0}`) and activates on **Enter**. Note: **Space does not activate them** — they are `div`s with `role="button"`, and native buttons respond to Space. Raise as a minor defect |
| A11Y-005 | Keyboard-only through the **Watch page** controls | The seek slider is operable with arrow keys; both skip buttons and the play/pause button are reachable; the follow checkbox is toggleable |
| A11Y-006 | Keyboard-only through the **upload wizard** | All four steps completable without a mouse. Confirm the clip **reorder** control is keyboard-operable — drag-only reordering is an accessibility defect |
| A11Y-007 | **Focus visibility** | Every interactive element shows a visible focus ring when reached by keyboard, in both light and dark themes |
| A11Y-008 | **Focus trapping in overlays** | Open the admin route-detail overlay and the earnings run drawer. Confirm focus moves into them, cannot escape behind them, **Escape closes them**, and focus returns to the trigger. The code contains no focus-trap logic — expect findings here |
| A11Y-009 | **Form labels** | Every input on `/login`, `/account`, the test-centre form, the ADI application and the instructor dashboard has an associated label or `aria-label` |
| A11Y-010 | **Error announcement** | When a form save fails, confirm the error is announced by a screen reader. Only the admin Reports error carries `role="alert"` — most `.error` banners do **not**. Raise as a finding |
| A11Y-011 | **Button naming** | Every button has a meaningful accessible name. Check the icon-only controls: the password toggle, the ±10 s skip buttons, the evidence-view button, and the clear-photo button |
| A11Y-012 | **Decorative icons** | Emoji and icons are `aria-hidden="true"` and are not read out |
| A11Y-013 | **Colour contrast** | Run an automated contrast check (axe / Lighthouse) on `/login`, `/test-centres`, `/route/:id`, `/admin`, in **both** light and dark themes. Pay particular attention to muted text (`.muted`), pills and the stat-tile labels |
| A11Y-014 | **Screen reader — learner journey** | With NVDA/VoiceOver, complete: sign in → browse centres → open a route → start playback. Record every point where the content is unnavigable or unannounced |
| A11Y-015 | **Screen reader — admin journey** | Navigate the sidebar, open the Review Queue, open a route detail, approve. Confirm the nav landmarks and the stat region are announced |
| A11Y-016 | **Skip link** | Look for a "skip to main content" link. The admin `<main>` has `id="main-content"` but **no skip link targets it** — raise as a finding |
| A11Y-017 | **Page titles** | Navigate between pages and check the browser tab title. If it never changes, screen-reader users cannot tell where they are — raise as a finding |
| A11Y-018 | **Heading hierarchy** | Each page has exactly one `h1` and no skipped levels |
| A11Y-019 | **Zoom to 200 %** | Browser zoom at 200 % — content reflows, nothing is clipped, no horizontal scrolling |
| A11Y-020 | **Text-only zoom** | Increase text size only — layouts do not break |
| A11Y-021 | **Practice mode without audio** | With TTS unavailable or muted, the instruction text still advances visibly — the module must not be audio-only |
| A11Y-022 | **Video captions** | `route_videos` supports `.vtt` through the HLS gateway and `routes.has_captions` exists. Confirm whether the player exposes a caption track. If not, record it as a gap |
| A11Y-023 | **Map alternatives** | The moving-map view conveys information visually only. Confirm the same information (route progress) is available another way, or record it as a gap |
| A11Y-024 | **Touch target size** | On a 375 px viewport, tab-bar items, view-mode buttons and the skip buttons are large enough to tap accurately (≈ 44 × 44 px) |

---

## 5. Automated tooling

Run these before manual accessibility testing — they will find the mechanical issues fast
and leave you to test the judgement calls.

| Test ID | Tool | Where | Expected |
|---|---|---|---|
| A11Y-025 | **axe DevTools** or **Lighthouse Accessibility** | `/login`, `/test-centres`, `/discover`, `/route/:id`, `/route/:id/watch`, `/account`, `/instructors/find`, `/contribute/upload`, `/admin` (each panel) | Record every violation with its impact level. Triage: critical/serious first |
| A11Y-026 | Lighthouse — **light and dark** | Same pages | Contrast violations often appear in one theme only |
| A11Y-027 | Keyboard-only pass with the mouse physically unplugged | The whole app | Any function that becomes impossible is a blocker |
</content>
