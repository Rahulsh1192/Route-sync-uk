# Email verification gate — design

**Date:** 2026-08-18
**Status:** implemented 2026-08-18 — see
[the plan](../plans/2026-08-18-email-verification-gate.md). One deviation: Flutter *is*
installed on the development machine, so the mobile change was verified with
`flutter analyze` rather than by review alone. It remains unrun on a device.

## Problem

Registration already mints a verification link and emails it
([`AuthService.register`](../../../apps/api/src/modules/auth/auth.service.ts)), but nothing
depends on the result:

- `register` returns an access + refresh token pair, so a brand-new account is signed in
  before the link is ever opened.
- No guard, route or query reads `users.email_verified`. Its only consumer is OAuth account
  linking, which refuses to link an unverified address to a Google/Apple identity.
- Nothing in any client tells the user an email was sent, or to which address.
- There is no way for an operator to see whether an account confirmed its address, short of
  querying the database by hand.

## What we are building

1. Signing up sends the link and **does not** sign the user in. The create-account form is
   replaced by a confirmation panel naming the address in masked form.
2. Opening the link confirms the address, then offers a button to sign in **and**
   auto-redirects to the login page.
3. Password sign-in is refused until the address is confirmed.
4. An operator can see per-account verification state in the admin console.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Existing unverified accounts | **Grandfather**: backfill `email_verified = true` before the gate goes live | Nobody who can sign in today loses access. Locally that is 1 row; production is unknown until the migration runs |
| Where the gate lives | Server-side in `login()` | No client can opt out, and mobile/web/future clients inherit one rule |
| Resend mechanism | Re-submitting the signup form, with the correct password | Needs no session and creates no new mail-sending oracle |
| Mobile app | Updated in the same change | The `register` response shape changes; leaving Flutter untouched breaks its signup |

Rejected alternatives:

- **Soft gate** (issue tokens, restrict the app behind a guard, nag with a banner). Better
  for conversion, but the requirement is no access before confirmation.
- **`emailVerified` as a JWT claim checked by `JwtAuthGuard`.** Spreads the rule across
  every request and leaves refresh ambiguous for an account verified mid-session.
- **Dedicated unauthenticated resend endpoint taking only an address.** Would let anyone
  cause mail to be sent from our domain to any address they guess is registered. The
  password-proving path gives the same UX without that.

## API contract

### `POST /auth/register`

Returns **202** `{ status: 'verification_sent', email: 'r•••••9@gmail.com' }`. No tokens.

202 rather than 201 because the meaningful outcome is "we have sent you something", and the
same response has to serve the resend case, where nothing is created.

Behaviour by account state:

| Account state | Password | Result |
| --- | --- | --- |
| No account | — | Create, send link, `202` |
| Exists, unverified | correct | **Resend** link, `202`. Display name / phone / emergency contact in the request are ignored — resending a link must not rewrite a profile |
| Exists, unverified | wrong | `409 Email already registered` |
| Exists, verified | either | `409 Email already registered` |
| Exists, OAuth-only (no password hash) | any | `409` — nothing to compare against, so the resend path cannot open |
| Exists, unverified, **suspended or soft-deleted** | correct | `409`, and no mail. A suspended account must not be able to make us send mail, and the response must not distinguish it |

The 409 for a wrong password matters: an attacker must not be able to tell an unverified
account from a verified one, and `409` for a known address is already today's behaviour, so
this leaks nothing new.

`displayName` becomes optional on the DTO and required in the service for the create case
only. The resend path is reached by re-posting this form, and the sign-in screen's resend
action has an email and a password but no display name; sending a fabricated one to satisfy
validation would put junk on the wire and into the database if the assumption were ever
wrong.

Rate limiting:

- `@Throttle({ default: { limit: 5, ttl: 60_000 } })` on the route — it now sends mail on a
  repeatable path and currently has no throttle at all.
- The existing per-account cap of 5 verification emails per rolling hour
  (`tooManyRecentTokens`) still applies. On the resend path it returns **429** with a plain
  message instead of a silent `202`: the caller has proved they hold the password, so
  telling them to wait is not a disclosure.

### `POST /auth/login`

Order of checks, which is load-bearing:

1. account exists and has a password hash → else `401 Invalid credentials`
2. not suspended → else `401 Account suspended`
3. **password correct** → else `401 Invalid credentials`
4. **`email_verified`** → else `403 { code: 'email_not_verified', message: 'Confirm your email address to sign in. Check your inbox for the link.' }`

Verification is checked *after* the password. Checking it earlier would turn login into an
oracle for which addresses are registered but unconfirmed.

### Unchanged

- `POST /auth/verify-email` and `POST /auth/verify-email/resend` keep their current
  behaviour and remain in place. The authenticated resend stays useful for an operator
  session and for a future in-app banner.
- Google and Apple sign-in never call `login()`, and the provider has already asserted the
  address, so those paths are untouched.
- `resetPassword` continues to set `email_verified = true`: completing a reset proves
  control of the inbox, so it remains a second route to a verified account.

### Masking

A pure function beside [`email-tokens.ts`](../../../apps/api/src/modules/auth/email-tokens.ts),
so all three clients render identical text and the rule is tested once.

Rules, by length of the local part (the domain is never masked):

| Length | Rule | Input | Output |
| --- | --- | --- | --- |
| ≥ 3 | first + (length − 2) bullets + last | `rahul.sh3919@gmail.com` | `r••••••••••9@gmail.com` |
| 2 | first + one bullet | `ab@example.com` | `a•@example.com` |
| 1 | one bullet | `a@example.com` | `•@example.com` |

The two short cases need their own rule: "keep the first and last character" would leave a
two-character local part entirely unmasked.

The domain stays visible: this is the user's own address, shown back to them so they can
tell they typed it correctly, and hiding the domain removes the part that makes that
possible.

## Web

- **[`api/client.ts`](../../../apps/web/src/api/client.ts)** — `ApiError` gains an optional
  `code` read from the JSON body, so the UI branches on the reason instead of matching a
  message string. `register`'s return type becomes
  `{ status: string; email: string }`.
- **[`auth/AuthContext.tsx`](../../../apps/web/src/auth/AuthContext.tsx)** — `register` no
  longer saves tokens or marks the session authenticated; it returns the masked address.
- **[`pages/LoginPage.tsx`](../../../apps/web/src/pages/LoginPage.tsx)** —
  - submit button in register mode reads **"Send verification link"**;
  - on success the form is replaced by a confirmation panel: *"Verification link sent to
    `r••••••••••9@gmail.com`"*, that it expires in 24 hours, a check-your-spam note, a
    **Send it again** button (re-posts the held values through the same register call), and
    **Back to sign in**;
  - a `403 email_not_verified` from sign-in renders that message plus a **Send the link
    again** action, which reuses the register path with the email and password already in
    state;
  - `?verified=1` renders a success banner and is then stripped from the URL.
- **[`pages/VerifyEmailPage.tsx`](../../../apps/web/src/pages/VerifyEmailPage.tsx)** — on
  success, keep the existing "Continue to sign in" button and additionally redirect to
  `/login?verified=1` after 3 seconds (`replace: true`, so Back does not return to a spent
  token). The failure copy stops saying "sign in and request a new one from your account
  page", which is no longer possible for an unverified account — it points at the signup
  form instead.

Deliberately omitted: polling from the confirmation panel so the original tab notices
verification completing in another tab. It needs a public "is this address verified"
endpoint, which is an enumeration oracle.

## Mobile (Flutter)

- **[`data/repositories.dart`](../../../apps/mobile/lib/data/repositories.dart)** —
  `AuthRepository.register` returns the masked address instead of saving tokens.
- **[`features/auth/auth_controller.dart`](../../../apps/mobile/lib/features/auth/auth_controller.dart)** —
  `register` sets a `pendingVerificationEmail` rather than `status = authenticated`; login
  surfaces the not-verified error distinctly from bad credentials.
- **[`features/auth/login_screen.dart`](../../../apps/mobile/lib/features/auth/login_screen.dart)** —
  the same check-your-inbox panel, with resend, and the not-verified message on sign-in.

No Flutter toolchain is available in the development environment, so this is written and
reviewed but not run. It needs verifying on a device before release.

## Data

`db/migrate_phase_29.sql`:

```sql
UPDATE users SET email_verified = true, updated_at = now()
WHERE email_verified = false;
```

Run **before** the API carrying the gate goes live, against local Postgres and against
Supabase. Ordering matters in one direction only: applying it late locks out existing users
until it runs; applying it early is harmless.

Verification query for the operator:

```sql
SELECT email_verified, count(*) FROM users WHERE deleted_at IS NULL GROUP BY 1;
```

## Admin visibility

Three layers, answering three different questions:

- **`users.email_verified`** — the fact. **`email_tokens`** — the history: `created_at` when
  a link was issued, `sent_to` for the address it went to, `used_at` for whether it was
  clicked.
- **Admin → Users** gains a Verified / Unverified pill beside each email:
  `email_verified AS "emailVerified"` added to the list query at
  [`admin.service.ts:169`](../../../apps/api/src/modules/admin/admin.service.ts), to
  `AdminUser` in [`admin/api.ts`](../../../apps/web/src/admin/api.ts), and rendered in
  [`admin/panels/Users.tsx`](../../../apps/web/src/admin/panels/Users.tsx) using the
  existing `pill good` / `pill warn` classes. No "unverified only" filter — the existing
  search plus a visible pill covers the need, and a filter is cheap to add later.
- **Resend → Emails** — whether the message was *delivered*, which is not the same question
  as whether the person clicked.

`Me` / `/users/me` is deliberately not extended: once the gate exists, a signed-in
password account is verified by definition, so a banner in the app would be dead UI.

## Testing

API (jest, following [`auth-email.db.spec.ts`](../../../apps/api/src/modules/auth/auth-email.db.spec.ts)
for anything touching the database):

1. masking — the three cases in the table above, plus an address with no local part beyond
   one character
2. `register` returns no tokens, and does return `status` + masked email
3. `register` on an existing unverified account with the correct password resends: a second
   `email_tokens` row exists, response is `202`
4. `register` on an existing unverified account with the wrong password → `409`
5. `register` on a verified account → `409` even with the correct password
6. `register` on a suspended unverified account with the correct password → `409`, and no
   new `email_tokens` row
7. `register` past the hourly cap → `429`
8. `login` unverified → `403` with `code: 'email_not_verified'`
9. `login` unverified **with the wrong password** → `401`, not `403` (the ordering rule)
10. `login` verified → tokens as before
11. `verifyEmail` flips the flag and a subsequent `login` succeeds (end-to-end of the gate)

Manual: [`testing/04-AUTHENTICATION-TESTING.md`](../../../testing/04-AUTHENTICATION-TESTING.md)
gains the web and mobile steps — signup shows the masked address, no session is created,
sign-in is refused, the link confirms and redirects, sign-in then succeeds, and the admin
pill flips.

## Rollout order

1. Run the backfill migration (local, then Supabase).
2. Deploy the API and web together — a web build that expects tokens from `register` breaks
   against the new API, and an old API with the new web build never shows the confirmation
   panel.
3. Ship the mobile build after verifying signup and sign-in on a device.

## Out of scope

- Blocking Google/Apple sign-ins whose provider reports an unverified address.
- An in-app unverified banner or a re-verification flow for a changed email address.
- Expiring unverified accounts that never confirm.
