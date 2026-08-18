# 04 — Authentication Testing

**Prefix:** `AUTH-###`

Covers only what the application actually implements. Scenarios that do not apply
(e.g. MFA, account lockout after N failures, CAPTCHA) are listed in §7 as *not
implemented* so nobody wastes time testing for them.

---

## 1. Module overview

| | |
|---|---|
| **Purpose** | Establish who the user is, and keep that session alive |
| **Web paths** | `/login`, `/forgot-password`, `/reset-password?token=`, `/verify-email?token=` |
| **API** | `/api/auth/*`, plus `GET /api/users/me` for the role used by the UI |
| **Key source** | [auth.controller.ts](../apps/api/src/modules/auth/auth.controller.ts) · [auth.service.ts](../apps/api/src/modules/auth/auth.service.ts) · [email-tokens.ts](../apps/api/src/modules/auth/email-tokens.ts) · [LoginPage.tsx](../apps/web/src/pages/LoginPage.tsx) · [AuthContext.tsx](../apps/web/src/auth/AuthContext.tsx) |
| **Roles** | All — and *no* role is required to reach the login page |

---

## 2. Preconditions

- API and web app running; database seeded (see [12-TEST-ENVIRONMENT-AND-DATA.md](12-TEST-ENVIRONMENT-AND-DATA.md)).
- Seeded accounts available.
- **For `AUTH-020` … `AUTH-032` (email verification and password reset) you need working
  outbound email.** The token is only ever delivered in the email — its SHA-256 is what
  is stored in the database, so there is **no way to recover the link from the database
  or the logs**. Without `RESEND_API_KEY` and `MAIL_FROM` configured, the API logs
  `Email not configured … dropped` and these flows **cannot be completed**.
  See [12-TEST-ENVIRONMENT-AND-DATA.md §5](12-TEST-ENVIRONMENT-AND-DATA.md).

---

## 3. UI components on the auth screens

| Screen | Elements |
|---|---|
| `/login` — sign-in tab | Branded hero (logo, wordmark, tagline, 3 feature bullets); "Welcome back" heading; **Email** input (`type=email`, required); **Password** field with a show/hide control ([PasswordField.tsx](../apps/web/src/components/PasswordField.tsx)); **Sign in** button (disabled while busy, label changes to "Please wait…"); **Forgotten your password?** link; **New here? Create an account** toggle; inline error banner; session-invalidated banner |
| `/login` — register tab | Adds **Display name** (required), **Mobile number** *(optional)*, **Emergency contact name** *(optional)*, **Emergency contact number** *(optional)*; primary button becomes **Create account**; the "Forgotten your password?" link is **hidden** |
| `/forgot-password` | Email input, submit button (disabled until an address is typed), error text, and a "Check your inbox" confirmation state |
| `/reset-password` | New password + confirm password, length hint, mismatch message, error banner, success state with a button back to `/login`; a distinct "That link is incomplete" state when `?token=` is absent |
| `/verify-email` | Three states — "Confirming your email…", "Email confirmed", "That link didn't work" |

---

## 4. Registration and login

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| AUTH-001 | Register with the minimum required fields | anon | Email not already registered | 1. Open `/login` 2. Click **New here? Create an account** 3. Enter display name, a new email, a password of ≥ 8 characters 4. Submit | Account created; tokens saved to `localStorage` (`rs_access`, `rs_refresh`); redirected via `/` to `/test-centres`; new user's role is `user` |
| AUTH-002 | Register with all optional contact fields | anon | — | As AUTH-001 plus mobile `07700 900123`, emergency name, emergency number | Account created; the values appear on `/account` after sign-in |
| AUTH-003 | Register with an already-registered email | anon | Use `learner@routesync.uk` | Submit the register form | **409** — `Email already registered`; shown in the inline error banner; no account created |
| AUTH-004 | Register with a password shorter than 8 characters | anon | — | Enter `Pass1` and submit | **400** validation error naming the password; account not created |
| AUTH-005 | Register with a malformed email | anon | — | Enter `not-an-email` | Blocked by the browser (`type=email` + `required`). Bypass the client by calling `POST /api/auth/register` directly → **400** |
| AUTH-006 | Register with a display name shorter than 2 characters | anon | — | Enter `A` as the display name | **400** validation error |
| AUTH-007 | Register with an invalid phone format | anon | — | Enter `abc` as the mobile number | **400** with the phone-format message from [phone.ts](../apps/api/src/common/validation/phone.ts) |
| AUTH-008 | Register sends a verification email | anon | Email configured | Complete AUTH-001 and check the inbox | A verification email arrives. **If email is not configured the signup still succeeds** — that is deliberate; check the API log for `Email not configured` |
| AUTH-009 | Login with valid learner credentials | user | Seeded | Sign in as `learner@routesync.uk` | Redirected to `/test-centres`; learner navigation shown |
| AUTH-010 | Login with valid admin credentials | admin | Seeded | Sign in as `admin@routesync.uk` | Redirected **straight to `/admin`**; admin console renders with sidebar |
| AUTH-011 | Login with valid instructor credentials | instructor | Seeded | Sign in as `instructor@routesync.uk` | Redirected to `/test-centres`; **staff** navigation (Contribute, My Lessons) shown |
| AUTH-012 | Login with a wrong password | anon | — | Correct email, wrong password | **401** `Invalid credentials`; error banner; still on `/login`; no tokens stored |
| AUTH-013 | Login with an unknown email | anon | — | `nobody@example.com` + any password | **401** `Invalid credentials` — the message must be **identical** to AUTH-012 (no account enumeration) |
| AUTH-014 | Login with missing credentials | anon | — | Submit with blank fields | Blocked by the browser `required` attributes. Bypassing the client → **400** |
| AUTH-015 | Login to a suspended account | any | Admin has suspended the account first (`ADM-USR-004`) | Try to sign in | **401** `Account suspended` |
| AUTH-016 | Already signed in, visit `/login` | any | Have a session | Navigate to `/login` | Redirected to `/`, then to the role landing |

---

## 5. Sessions, tokens and navigation

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| AUTH-017 | Access a protected page with no session | anon | Signed out | Enter `/test-centres` in the address bar | Redirected to `/login` |
| AUTH-018 | Browser refresh keeps the session | any | Signed in | Press F5 on any page | Still signed in; the page reloads with the same role and navigation |
| AUTH-019 | Logout | any | Signed in | Account → **Sign out** (or console sidebar → Sign out) | `rs_access` and `rs_refresh` removed from `localStorage`; redirected to `/login`; going back in browser history does **not** restore the app |
| AUTH-020 | Back/forward navigation after logout | any | Just logged out | Press the browser Back button | Guarded pages redirect to `/login` again; no protected data is visible |
| AUTH-021 | Access token expiry and silent refresh | any | Signed in; access TTL is **900 s** by default | Wait for the access token to expire (or shorten `JWT_ACCESS_TTL` to ~60 s and restart the API), then click any page that loads data | The client refreshes transparently and the page loads. No forced logout |
| AUTH-022 | Invalid / tampered access token | any | Signed in | In DevTools change one character of `rs_access`, then reload | The request 401s; the client attempts a refresh with the still-valid refresh token and recovers, or you are signed out. Record which happens |
| AUTH-023 | Missing token on an authenticated API call | — | — | Call `GET /api/users/me` with no `Authorization` header | **401** |
| AUTH-024 | Refresh token rotation | any | Signed in | Call `POST /api/auth/refresh` with the current refresh token, then call it **again with the same token** | First call: new token pair. Second call: **401** `Refresh token expired or revoked` |
| AUTH-025 | Logout revokes the refresh token | any | Signed in | Capture the refresh token, log out, then call `POST /api/auth/refresh` with it | **401** |
| AUTH-026 | **Instructor single session** | instructor | `instructor@routesync.uk` | 1. Sign in in browser A 2. Sign in as the same instructor in browser B (or a private window) 3. In browser A, trigger a request that needs a token refresh | Browser A is signed out and `/login` shows *"You were signed out because your account was used on another device."* The API returns `SESSION_INVALIDATED` |
| AUTH-027 | Multiple sessions for a **non**-instructor | user | `learner@routesync.uk` | Sign in in two browsers, use both | **Both sessions keep working.** The single-session rule applies to `instructor` only |
| AUTH-028 | Password reset revokes every session | any | Signed in in two browsers | Complete a password reset (AUTH-033), then use each browser | Both sessions fail on their next refresh; the user must sign in with the new password |

---

## 6. Email verification and password reset

> **Blocked without configured outbound email.** See §2.

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| AUTH-029 | Verify a new email address | user | Registered; verification email received | Click the link in the email → opens `/verify-email?token=…` | "Confirming your email…" then **"Email confirmed"**; `users.email_verified` becomes `true` |
| AUTH-030 | Verification link opened while already signed in | user | Signed in | Open the verification link in the same browser | The page still processes the token — it is **not** redirected away. This is deliberate |
| AUTH-031 | Reuse a verification link | user | Link already redeemed | Click the same link a second time | **"That link didn't work"** — `401 This link is invalid or has expired` |
| AUTH-032 | Expired verification link | user | Link older than **24 hours** | Click the link | "That link didn't work" |
| AUTH-033 | Verify with a missing or malformed token | anon | — | Open `/verify-email` with no `?token=`, and with `?token=abc` | Error state. At API level a token shorter than 43 characters is a **400** validation failure, not a 401 |
| AUTH-034 | Resend verification (throttle) | user | Signed in, unverified | Call `POST /api/auth/verify-email/resend` **4 times within a minute** | The first 3 return **202**; the 4th returns **429 Too Many Requests** |
| AUTH-035 | Per-account email cap | user | Signed in, unverified | Request 6 verification emails within one hour (spread out to avoid the per-minute throttle) | The endpoint still returns 202, but no 6th email is sent; the API log shows `Rate-limited verify_email` |
| AUTH-036 | Request a password reset for a **known** address | anon | — | `/forgot-password` → `learner@routesync.uk` → submit | **202**; "Check your inbox" confirmation; reset email arrives |
| AUTH-037 | Request a password reset for an **unknown** address | anon | — | `/forgot-password` → `nobody@example.com` | **Identical** 202 and identical confirmation screen. No email. **Any difference in response, wording or timing is a defect** (account enumeration) |
| AUTH-038 | Request a reset for a **suspended** account | anon | Account suspended | Submit that address | Same 202 and same screen; no email sent |
| AUTH-039 | Forgot-password throttle | anon | — | Submit 6 times within a minute | The 6th returns **429** |
| AUTH-040 | Complete a password reset | user | Reset email received | Open the link → enter a new password twice → submit | "Password changed" state; button returns to `/login`; the new password works and the old one returns 401 |
| AUTH-041 | Reset link is single-use | user | Link already used | Click it again | `401 This link is invalid or has expired` |
| AUTH-042 | Reset link expires after 1 hour | user | Link older than 60 minutes | Click it | Expired error |
| AUTH-043 | A newer reset link invalidates the older one | user | Request two reset emails in a row | Use the **first** link | It fails — redeeming any token spends every live token of that purpose for the user |
| AUTH-044 | New password below the minimum | user | Valid reset link | Enter a 5-character password | Client shows *"Use at least 8 characters."*; the submit button stays disabled. At API level → **400** |
| AUTH-045 | Passwords do not match | user | Valid reset link | Enter two different passwords | *"Those two don't match."*; submit disabled |
| AUTH-046 | Reset page without a token | anon | — | Open `/reset-password` with no query string | **"That link is incomplete"** state |
| AUTH-047 | A verification token cannot be redeemed as a reset token | — | Have a verification token | `POST /api/auth/reset-password` with that token | **401** — purposes are not interchangeable |
| AUTH-048 | Completing a reset also marks the email verified | user | Unverified account | Complete a reset | `users.email_verified` becomes `true` without a separate verification step |

---

## 7. Not implemented — do not raise these as defects

Verified absent from the codebase. If any of these are business requirements, they are
**gaps**, not bugs — see [13-TESTING-GAPS.md](13-TESTING-GAPS.md).

| Feature | Status |
|---|---|
| Multi-factor authentication | Not implemented |
| Account lockout after N failed logins | Not implemented (only the IP throttle: 120 req/min) |
| CAPTCHA on login or registration | Not implemented |
| "Remember me" / session length choice | Not implemented — refresh TTL is fixed at 30 days |
| Password complexity rules beyond length ≥ 8 | Not implemented |
| Password history / reuse prevention | Not implemented |
| Forced password change | Not implemented |
| Email change flow | Not implemented — there is no endpoint to change `users.email` |
| Google / Apple sign-in **buttons** in the web app | Backend implemented, **no UI**. Testable only by calling `POST /api/auth/oauth/google` / `/apple` directly with a real ID token |
| Account activation gate | Not implemented — an unverified account can use the whole app |
| Idle session timeout | Not implemented |
</content>
