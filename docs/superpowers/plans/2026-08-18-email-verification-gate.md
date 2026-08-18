# Email Verification Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make confirming an email address a precondition of signing in with a password, and tell the user — in all three clients — that a link was sent, to which (masked) address.

**Architecture:** The rule lives server-side. `AuthService.register` stops issuing tokens and returns `{ status, email }` with the address masked; a second signup for an existing *unverified* account with the *correct* password resends the link instead of 409-ing, which is what gives the UI a resend button with no session. `AuthService.login` refuses an unverified account with `403 { code: 'email_not_verified' }`, checked **after** the password so the endpoint cannot be used to discover which addresses are registered. Existing accounts are grandfathered by a one-line backfill migration run before the gate ships.

**Tech Stack:** NestJS 10 + Prisma 6 (`engineType = "client"`, `pg` adapter) on the API, Vite + React 18 + react-router 6 on the web, Flutter/Dio on mobile, PostgreSQL, Jest (ts-jest) for API tests.

**Spec:** [`docs/superpowers/specs/2026-08-18-email-verification-gate-design.md`](../specs/2026-08-18-email-verification-gate-design.md)

## Global Constraints

- Verification is checked **after** the password in `login()`. Never before.
- `register` answers `409 Email already registered` for every existing-account case except unverified + correct password + not suspended + not soft-deleted.
- Masking rules, exactly: local part ≥3 → first + (length − 2) bullets + last; length 2 → first + one bullet; length 1 → one bullet. Domain never masked. Bullet character is `•` (U+2022).
- The error code literal is `email_not_verified` in API, web and mobile.
- Copy for the login refusal: `Confirm your email address to sign in. Check your inbox for the link.`
- The web submit button in register mode reads `Send verification link`.
- API tests that need a database live in `*.db.spec.ts` and skip unless `TEST_DATABASE_URL` is set — that convention is already in place and must be preserved.
- Web has no test runner; its verification command is `npm run build` in `apps/web` (which runs `tsc --noEmit` first).
- No Flutter toolchain is available; mobile changes are compile-checked by review only and flagged for on-device verification.

---

### Task 1: `maskEmail` helper

**Files:**
- Create: `apps/api/src/modules/auth/mask-email.ts`
- Test: `apps/api/src/modules/auth/mask-email.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `maskEmail(email: string): string`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/auth/mask-email.spec.ts`:

```ts
import { maskEmail } from './mask-email';

describe('maskEmail', () => {
  it('keeps the first and last character of a local part of three or more', () => {
    expect(maskEmail('rahul.sh3919@gmail.com')).toBe('r••••••••••9@gmail.com');
  });

  it('masks everything after the first character of a two-character local part', () => {
    // "keep first and last" would leave this address entirely unmasked.
    expect(maskEmail('ab@example.com')).toBe('a•@example.com');
  });

  it('masks a single-character local part completely', () => {
    expect(maskEmail('a@example.com')).toBe('•@example.com');
  });

  it('leaves the domain readable so the user can spot a typo in it', () => {
    expect(maskEmail('someone@sub.domain.co.uk')).toContain('@sub.domain.co.uk');
  });

  it('splits on the last @, which is the one that separates local part from domain', () => {
    expect(maskEmail('a"b"c@d@example.com')).toBe('a•••••••d@example.com');
  });

  it('returns anything that is not an address unchanged rather than throwing', () => {
    expect(maskEmail('not-an-address')).toBe('not-an-address');
    expect(maskEmail('@example.com')).toBe('@example.com');
    expect(maskEmail('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest mask-email -v`
Expected: FAIL — `Cannot find module './mask-email'`.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/modules/auth/mask-email.ts`:

```ts
/**
 * Mask an email address for display back to the person who just typed it.
 *
 * Lives in the API rather than in each client so that web, mobile and anything later show
 * the same string — the masking rule is user-visible copy, and three implementations would
 * drift.
 *
 * The domain is deliberately left readable. This is the user's own address being shown back
 * to them so they can confirm they typed it correctly, and the domain is the part that
 * makes a typo recognisable ("@gmial.com").
 */
const BULLET = '•';

export function maskEmail(email: string): string {
  // The LAST @ separates local part from domain: a quoted local part may legally contain one.
  const at = email.lastIndexOf('@');
  // Not an address we can reason about (no @, or nothing before it). Return it untouched
  // rather than throwing: this runs on a response path, and failing to mask a malformed
  // string must not turn a successful signup into a 500.
  if (at <= 0) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at); // includes the '@'

  if (local.length === 1) return `${BULLET}${domain}`;
  if (local.length === 2) return `${local[0]}${BULLET}${domain}`;
  return `${local[0]}${BULLET.repeat(local.length - 2)}${local[local.length - 1]}${domain}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest mask-email -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/mask-email.ts apps/api/src/modules/auth/mask-email.spec.ts
git commit -m "feat(api): add maskEmail for showing a signup address back to the user"
```

---

### Task 2: Carry a machine-readable `code` through the error envelope

The problem+json filter currently drops every field except `message`, so a client cannot tell "not verified" from "bad credentials" without matching on prose. Both ends of the wire need the field before Task 4 can use it.

**Files:**
- Modify: `apps/api/src/common/filters/all-exceptions.filter.ts:36-37`
- Test: `apps/api/src/common/filters/all-exceptions.filter.spec.ts`
- Modify: `apps/web/src/api/client.ts:114-118` (`ApiError`) and `apps/web/src/api/client.ts:175` (throw site)
- Modify: `apps/mobile/lib/core/api_client.dart:7-13` (`ApiException`) and its throw site at `:108-111`

**Interfaces:**
- Produces: response body field `code?: string`; `ApiError.code?: string` (web); `ApiException.code` (Dart).

- [ ] **Step 1: Write the failing test**

`apps/api/src/common/filters/all-exceptions.filter.spec.ts`:

```ts
import { ArgumentsHost, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Drive the filter with a fake host and hand back the JSON body it produced. */
function invoke(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/api/auth/login' }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  it('forwards a machine-readable code from an object payload', () => {
    const { status, body } = invoke(
      new ForbiddenException({ message: 'Confirm your email address', code: 'email_not_verified' }),
    );
    expect(status).toBe(403);
    expect(body.code).toBe('email_not_verified');
    expect(body.title).toBe('Confirm your email address');
  });

  it('omits code when the exception carries only a message', () => {
    const { body } = invoke(new UnauthorizedException('Invalid credentials'));
    expect(body.code).toBeUndefined();
    expect(body.title).toBe('Invalid credentials');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest all-exceptions -v`
Expected: FAIL — `expect(received).toBe('email_not_verified')`, received `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/common/filters/all-exceptions.filter.ts`, inside the `res.status(status).json({…})` object, add after the `detail` line:

```ts
      // A stable identifier for the *reason*, for cases where a client has to branch on it
      // (e.g. an unverified email at sign-in, which needs a different screen from bad
      // credentials). Absent unless a thrower opts in, so nothing else changes shape.
      code: typeof payload === 'object' ? (payload as any).code : undefined,
```

In `apps/web/src/api/client.ts`, replace the `ApiError` class:

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Stable reason identifier from the API, when it sends one (e.g. `email_not_verified`). */
    public code?: string,
  ) {
    super(message);
  }
}
```

and the throw site at the bottom of `request`:

```ts
    throw new ApiError(res.status, body.title || body.detail || `HTTP ${res.status}`, body.code);
```

In `apps/mobile/lib/core/api_client.dart`, replace `ApiException` and its throw:

```dart
/// Thrown for non-2xx API responses, carrying the server's problem+json title and,
/// when present, its stable `code` (e.g. `email_not_verified`).
class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.code});
  final int? statusCode;
  final String message;
  final String? code;
  @override
  String toString() => message;
}
```

```dart
      throw ApiException(
        e.response?.statusCode,
        msg,
        code: data is Map ? data['code'] as String? : null,
      );
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd apps/api && npx jest all-exceptions -v` → PASS, 2 tests.
Run: `cd apps/web && npm run build` → exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/filters apps/web/src/api/client.ts apps/mobile/lib/core/api_client.dart
git commit -m "feat: carry a stable error code through the problem+json envelope"
```

---

### Task 3: `register` sends a link instead of a session, and resends on demand

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts:72-104` (`register`)
- Modify: `apps/api/src/modules/auth/auth.controller.ts:22-29` (status code + throttle)
- Modify: `apps/api/src/modules/auth/dto/auth.dto.ts:12-14` (`displayName` becomes optional)
- Test: `apps/api/src/modules/auth/auth-email.db.spec.ts` (new `describe` block)

**Interfaces:**
- Consumes: `maskEmail` from Task 1.
- Produces: `AuthService.register(...): Promise<RegistrationResult>` where
  `interface RegistrationResult { status: 'verification_sent'; email: string }` — exported from
  `auth.service.ts`. Task 7 (web) and Task 9 (mobile) consume `{ status, email }` off the wire.

**Why `displayName` becomes optional:** the resend path is reached by re-posting the signup
form, and the login screen's "send the link again" action has an email and a password but no
display name. Sending a fake one to satisfy validation would put junk on the wire. It stays
required for *creating* an account, enforced in the service where the distinction is known.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/modules/auth/auth-email.db.spec.ts`, inside the top-level
`describeDb`:

```ts
  describe('registering when the address is already taken', () => {
    const conflict = 'Email already registered';

    it('returns the masked address and no tokens', async () => {
      const result = await auth.register('learner@phase28.test', 'Password123!', 'Sam Learner');
      // "learner" is 7 characters: first + 5 bullets + last.
      expect(result).toEqual({ status: 'verification_sent', email: 'l•••••r@phase28.test' });
      expect((result as unknown as { accessToken?: string }).accessToken).toBeUndefined();
    });

    it('resends the link when the password is correct and the account is unverified', async () => {
      const user = await register();
      mail.reset();

      const result = await auth.register('learner@phase28.test', 'Password123!', 'Sam Learner');

      expect(result.status).toBe('verification_sent');
      expect(mail.sent).toHaveLength(1);
      const rows = await prisma.emailToken.count({ where: { userId: user.id } });
      expect(rows).toBe(2); // the original plus the resent one
    });

    it('ignores profile fields on the resend path', async () => {
      const user = await register();
      await auth.register('learner@phase28.test', 'Password123!', 'Someone Else');

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.displayName).toBe('Sam Learner');
    });

    it('refuses, and sends nothing, when the password is wrong', async () => {
      await register();
      mail.reset();

      await expect(
        auth.register('learner@phase28.test', 'WrongPassword1!', 'Sam Learner'),
      ).rejects.toThrow(conflict);
      expect(mail.sent).toHaveLength(0);
    });

    it('refuses once the account is already verified', async () => {
      const user = await register();
      await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });

      await expect(
        auth.register('learner@phase28.test', 'Password123!', 'Sam Learner'),
      ).rejects.toThrow(conflict);
    });

    it('refuses a suspended account without disclosing that it is suspended', async () => {
      const user = await register();
      await prisma.user.update({ where: { id: user.id }, data: { isSuspended: true } });
      mail.reset();

      await expect(
        auth.register('learner@phase28.test', 'Password123!', 'Sam Learner'),
      ).rejects.toThrow(conflict);
      expect(mail.sent).toHaveLength(0);
    });

    it('rejects a resend past the hourly cap with a 429 rather than a silent success', async () => {
      const user = await register();
      // Four more, taking the hour's total to the cap of five.
      for (let i = 0; i < 4; i += 1) {
        await auth.register('learner@phase28.test', 'Password123!', 'Sam Learner');
      }
      expect(await prisma.emailToken.count({ where: { userId: user.id } })).toBe(5);

      await expect(
        auth.register('learner@phase28.test', 'Password123!', 'Sam Learner'),
      ).rejects.toThrow(/Too many/i);
    });

    it('requires a display name to create a new account', async () => {
      await expect(
        auth.register('nameless@phase28.test', 'Password123!', undefined),
      ).rejects.toThrow(/display name/i);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Set up the scratch database once (ports: local Postgres is published on 5433 by
`infra/docker-compose.yml`; the container name comes from `docker ps`):

```bash
docker exec -i infra-postgres-1 psql -U routesync -d postgres -c 'CREATE DATABASE phase29_test'
docker exec -i infra-postgres-1 psql -U routesync -d phase29_test < db/bootstrap.sql
docker exec -i infra-postgres-1 psql -U routesync -d phase29_test < db/migrate_phase_28.sql
```

Run:

```bash
cd apps/api
TEST_DATABASE_URL=postgresql://routesync:routesync@localhost:5434/phase29_test npx jest auth-email -v
```

Expected: the new block fails — `register` still resolves with `accessToken`/`refreshToken`
and throws `Email already registered` for the resend case.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/modules/auth/auth.service.ts`, add the imports and exported type:

```ts
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common'; // add to the existing @nestjs/common import
import { maskEmail } from './mask-email';

/**
 * What a signup returns now: proof that we sent something, not a session.
 *
 * No tokens by design — an account that has not confirmed its address must not hold one,
 * or the gate in `login` would be trivially bypassed by registering.
 */
export interface RegistrationResult {
  status: 'verification_sent';
  email: string; // masked, for display back to the user
}
```

Replace `register` with:

```ts
  async register(
    email: string,
    password: string,
    displayName?: string,
    contact?: ContactDetails,
  ): Promise<RegistrationResult> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return this.resendVerificationForSignup(existing, password);

    // Required to create an account, but not to resend a link — the resend path is reached
    // by re-posting a form that may not carry a name (the sign-in screen has no name field).
    if (!displayName || displayName.trim().length < 2) {
      throw new BadRequestException('A display name of at least 2 characters is required');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: displayName.trim(),
        identities: { create: { provider: AuthProvider.email, providerUid: email } },
        subscriptions: { create: {} }, // free plan by default
      },
    });

    // Written separately, in raw SQL, because the Phase 26 contact columns are not in the
    // generated Prisma client. Passing them to `user.create` would throw
    // "Unknown argument" — Prisma validates against its own schema, not the database.
    await this.writeContactDetails(user.id, contact);

    // Awaited rather than left floating: `MailService.send` resolves on every failure
    // path instead of throwing, so this can only add the provider's latency, never turn
    // a successful signup into an error. In exchange, a delivery failure is logged
    // against the request that caused it rather than surfacing detached from it.
    await this.sendVerificationEmail(user.id);

    return { status: 'verification_sent', email: maskEmail(email) };
  }

  /**
   * A signup attempt for an address that already has an account.
   *
   * Re-submitting the form is how a user asks for another link — there is no session at
   * this point to authorise a "resend" endpoint with. Sending only when the password is
   * correct is what keeps that from becoming a way to make us mail an address on demand:
   * whoever supplies the right password could sign in anyway.
   *
   * Every refusal is the same `409`, deliberately. A different answer for "verified",
   * "suspended" or "wrong password" would let someone probe the state of an account they
   * do not control.
   */
  private async resendVerificationForSignup(
    existing: { id: string; email: string | null; passwordHash: string | null; emailVerified: boolean; isSuspended: boolean; deletedAt: Date | null },
    password: string,
  ): Promise<RegistrationResult> {
    const conflict = () => new ConflictException('Email already registered');

    if (!existing.email || existing.emailVerified) throw conflict();
    // OAuth-only account: nothing to compare a password against.
    if (!existing.passwordHash) throw conflict();
    if (existing.isSuspended || existing.deletedAt) throw conflict();
    if (!(await bcrypt.compare(password, existing.passwordHash))) throw conflict();

    // Checked here rather than leaving `sendVerificationEmail` to swallow it: the caller has
    // proved they hold the password, so "wait an hour" is honest and actionable, whereas a
    // silent 202 reads as "sent" and produces a support request.
    if (await this.tooManyRecentTokens(existing.id, EmailTokenPurpose.verify_email)) {
      throw new HttpException(
        'Too many verification emails requested. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.sendVerificationEmail(existing.id);
    return { status: 'verification_sent', email: maskEmail(existing.email) };
  }
```

In `apps/api/src/modules/auth/dto/auth.dto.ts`, make `displayName` optional:

```ts
  /**
   * Required to create an account; omitted when re-posting this form to ask for another
   * verification link, which the service distinguishes. Length is enforced in the service
   * for the create case so both callers get one rule.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  displayName?: string;
```

In `apps/api/src/modules/auth/auth.controller.ts`, replace the register route:

```ts
  /**
   * Create an account and email a verification link — or, for an existing unverified
   * account whose password matches, send another link. No tokens either way: sign-in is
   * gated on confirming the address.
   *
   * 202, not 201: the outcome that matters to the caller is "we have sent you something",
   * and on the resend path nothing is created. Throttled because it sends mail on a path
   * that can be repeated with the same input.
   */
  @Post('register')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.displayName, {
      phone: dto.phone,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactPhone: dto.emergencyContactPhone,
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/api
TEST_DATABASE_URL=postgresql://routesync:routesync@localhost:5434/phase29_test npx jest auth-email -v
npx jest   # whole suite, no DB needed for the rest
```

Expected: the new block passes; the pre-existing Phase 28 tests still pass. One of them
(`sends a verification email to the address given`) calls `auth.register(...)` with a name —
unchanged, so it should be untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth
git commit -m "feat(api): registration sends a verification link instead of a session"
```

---

### Task 4: `login` refuses an unverified account

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts:128-139` (`login`)
- Test: `apps/api/src/modules/auth/auth-email.db.spec.ts` (new `describe` block)

**Interfaces:**
- Consumes: `code` passthrough from Task 2.
- Produces: `export const EMAIL_NOT_VERIFIED = 'email_not_verified';` from `auth.service.ts`.

- [ ] **Step 1: Write the failing tests**

Append inside `describeDb` in `apps/api/src/modules/auth/auth-email.db.spec.ts`:

```ts
  describe('signing in before the address is confirmed', () => {
    it('refuses with a 403 and a machine-readable code', async () => {
      await register();

      await expect(auth.login('learner@phase28.test', 'Password123!')).rejects.toMatchObject({
        status: 403,
        response: { code: 'email_not_verified' },
      });
    });

    it('answers a wrong password with 401, not 403', async () => {
      // Ordering matters: reporting "not verified" before checking the password would let
      // anyone discover which addresses are registered but unconfirmed.
      await register();

      await expect(auth.login('learner@phase28.test', 'WrongPassword1!')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('lets the user in once the link has been followed', async () => {
      await register();
      const token = mail.lastToken();
      await auth.verifyEmail(token);

      const tokens = await auth.login('learner@phase28.test', 'Password123!');
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/api
TEST_DATABASE_URL=postgresql://routesync:routesync@localhost:5434/phase29_test npx jest auth-email -v
```

Expected: the first test fails — login currently succeeds and returns tokens.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/modules/auth/auth.service.ts`, add near `RegistrationResult`:

```ts
/**
 * Reason code on the 403 from `login` for an unconfirmed address.
 *
 * Exported so the value is written once on this side of the wire; the clients carry the
 * same literal because they cannot import from here.
 */
export const EMAIL_NOT_VERIFIED = 'email_not_verified';
```

Add `ForbiddenException` to the existing `@nestjs/common` import, then insert into `login`
immediately after the bcrypt comparison and before the `lastLoginAt` update:

```ts
    // After the password, never before: a 403 for an unverified account is an admission
    // that the address is registered, so it must only be reachable by someone who has
    // already proved they hold the credentials.
    if (!user.emailVerified) {
      throw new ForbiddenException({
        message: 'Confirm your email address to sign in. Check your inbox for the link.',
        code: EMAIL_NOT_VERIFIED,
      });
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/api
TEST_DATABASE_URL=postgresql://routesync:routesync@localhost:5434/phase29_test npx jest auth-email -v
npx jest
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth-email.db.spec.ts
git commit -m "feat(api): refuse sign-in until the email address is confirmed"
```

---

### Task 5: Grandfather existing accounts

Must be applied before the gated API serves traffic, or every existing user is locked out
until it runs.

**Files:**
- Create: `db/migrate_phase_29.sql`

**Interfaces:**
- Consumes: nothing. Produces: `users.email_verified = true` for every pre-existing row.

- [ ] **Step 1: Write the migration**

`db/migrate_phase_29.sql`:

```sql
-- ============================================================================
-- Phase 29 — grandfather existing accounts before the verification gate
--
-- Sign-in now requires `users.email_verified`. Until Phase 28 nothing could set that flag
-- for an email/password account, so every account created before it — including the seeded
-- demo logins — sits at false. Applying the gate without this backfill would lock out
-- every existing user, which is a far worse outcome than trusting addresses that were
-- already in use.
--
-- Run this BEFORE deploying the API that carries the gate. Running it early is harmless;
-- running it late is an outage.
--
-- Idempotent: the WHERE clause makes a second run a no-op.
-- ============================================================================

BEGIN;

UPDATE users
   SET email_verified = true,
       updated_at     = now()
 WHERE email_verified = false;

COMMIT;

-- Confirm afterwards — expect a single row, `true`:
--   SELECT email_verified, count(*) FROM users WHERE deleted_at IS NULL GROUP BY 1;
```

- [ ] **Step 2: Apply it to the local database and verify**

```bash
docker exec -i infra-postgres-1 psql -U routesync -d routesync < db/migrate_phase_29.sql
docker exec -i infra-postgres-1 psql -U routesync -d routesync \
  -c 'SELECT email_verified, count(*) FROM users WHERE deleted_at IS NULL GROUP BY 1;'
```

Expected: one row, `t | 8`. (Before the run it was `f | 1`, `t | 7`.)

- [ ] **Step 3: Commit**

```bash
git add db/migrate_phase_29.sql
git commit -m "feat(db): backfill email_verified so the gate does not lock out existing users"
```

---

### Task 6: Show verification state in the admin console

**Files:**
- Modify: `apps/api/src/modules/admin/admin.service.ts:169-171` (list query)
- Modify: `apps/web/src/admin/api.ts:44-53` (`AdminUser`)
- Modify: `apps/web/src/admin/panels/Users.tsx:74-120` (header + cell)

**Interfaces:**
- Produces: `AdminUser.emailVerified: boolean`.

- [ ] **Step 1: Add the column to the query**

In `apps/api/src/modules/admin/admin.service.ts`, extend the `SELECT` in the users listing:

```ts
      SELECT id, email, display_name AS "displayName", role,
             is_suspended AS "isSuspended", email_verified AS "emailVerified",
             created_at AS "createdAt",
```

(keep the remaining selected columns and the `WHERE`/`ORDER BY` exactly as they are)

- [ ] **Step 2: Add the field to the web type**

In `apps/web/src/admin/api.ts`, inside `interface AdminUser`, after `isSuspended`:

```ts
  /** Phase 29. Whether the account has confirmed its address; sign-in requires it. */
  emailVerified: boolean;
```

- [ ] **Step 3: Render it**

In `apps/web/src/admin/panels/Users.tsx`, leave the `<th>Email</th>` header alone — the pill
sits under the address rather than in its own column, so the table gains no width. Replace
the email cell (`:86`) with:

```tsx
                <td className="meta">
                  {u.email ?? '—'}
                  {u.email && (
                    <div style={{ marginTop: 2 }}>
                      {u.emailVerified ? (
                        <span className="pill good">Verified</span>
                      ) : (
                        // Not a fault to fix from here: the account simply has not opened
                        // its link yet, and it cannot sign in until it does.
                        <span className="pill warn">Unverified</span>
                      )}
                    </div>
                  )}
                </td>
```

- [ ] **Step 4: Verify**

```bash
cd apps/web && npm run build
```

Expected: exits 0. Then, with the API running, open `/admin` → Users and confirm each row
shows a Verified or Unverified pill under the address.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/admin.service.ts apps/web/src/admin
git commit -m "feat(admin): show whether each account has confirmed its email address"
```

---

### Task 7: Web — confirmation panel, resend, and the sign-in refusal

**Files:**
- Modify: `apps/web/src/api/client.ts:190-203` (`register` return type)
- Modify: `apps/web/src/auth/AuthContext.tsx:14-19,64-73` (`register` returns the masked address)
- Modify: `apps/web/src/pages/LoginPage.tsx` (states, submit, panel, banner)

**Interfaces:**
- Consumes: `{ status, email }` from Task 3; `ApiError.code` from Task 2; `email_not_verified`.
- Produces: `useAuth().register(...): Promise<string>` — resolves to the masked address.

- [ ] **Step 1: Update the client's return type**

In `apps/web/src/api/client.ts`:

```ts
  /**
   * Create an account, or ask for another verification link for one that exists.
   *
   * Returns no tokens: the API will not sign in an account that has not confirmed its
   * address. Re-posting this with the same email and the correct password is how the UI
   * resends the link — there is no session yet to authorise anything else.
   */
  register: (
    email: string,
    password: string,
    displayName: string | undefined,
    contact?: ContactDetailsInput,
  ) =>
    request<{ status: string; email: string }>('/auth/register', {
      method: 'POST',
      // Spread rather than always sending the keys: the API treats an absent field as
      // "leave alone" and an empty string as "clear", so sending '' at signup would be a
      // pointless instruction to clear something that was never set.
      body: JSON.stringify({
        email,
        password,
        ...(displayName ? { displayName } : {}),
        ...(contact ?? {}),
      }),
    }),
```

- [ ] **Step 2: Update `AuthContext`**

In `apps/web/src/auth/AuthContext.tsx`, the interface member becomes:

```ts
  /**
   * Create an account (or resend its verification link). Resolves to the masked address the
   * link went to. Deliberately does NOT authenticate: the account cannot sign in until the
   * address is confirmed.
   */
  register: (
    email: string,
    password: string,
    name: string | undefined,
    contact?: ContactDetailsInput,
  ) => Promise<string>;
```

and the implementation:

```ts
  const register = useCallback(async (
    email: string,
    password: string,
    name: string | undefined,
    contact?: ContactDetailsInput,
  ) => {
    const r = await api.register(email, password, name, contact);
    return r.email;
  }, []);
```

- [ ] **Step 3: Update `LoginPage`**

Add to the imports:

```tsx
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
```

Add state beside the existing `useState` calls:

```tsx
  const [params, setParams] = useSearchParams();
  /** Masked address a link was just sent to — non-null means show the confirmation panel. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notVerified, setNotVerified] = useState(false);
  const justVerified = params.get('verified') === '1';
```

Strip the query flag once read, so a refresh or a shared URL does not keep claiming success:

```tsx
  useEffect(() => {
    if (justVerified) setParams({}, { replace: true });
  }, [justVerified, setParams]);
```

Replace `submit` with:

```tsx
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotVerified(false);
    try {
      if (isRegister) {
        // Only send fields the user actually filled: the API treats an empty string as
        // "clear this", which is a meaningless instruction on a brand-new account.
        const masked = await register(email.trim(), password, name.trim(), {
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(iceName.trim() ? { emergencyContactName: iceName.trim() } : {}),
          ...(icePhone.trim() ? { emergencyContactPhone: icePhone.trim() } : {}),
        });
        // No navigation: signing up no longer produces a session. The confirmation panel
        // replaces the form until the user has followed the link in their inbox.
        setSentTo(masked);
        return;
      }
      await login(email.trim(), password);
      // Role-based landing (admins → console, everyone else → Test Centres).
      nav('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_not_verified') setNotVerified(true);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ask for another link. Re-posts the signup call, which is the resend path: the API sends
   * a new link when the address exists, is unconfirmed, and the password matches.
   *
   * Used from both the confirmation panel and the "not verified" message on sign-in, so it
   * passes the name only when the form has one.
   */
  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const masked = await register(email.trim(), password, name.trim() || undefined);
      setSentTo(masked);
      setNotVerified(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
```

Inside the auth card, immediately after the `<h2>`/`<p className="muted">` pair, render the
confirmation panel *instead of* the form when `sentTo` is set — wrap the existing `<form>`
and the two buttons below it in `{!sentTo && (…)}` and add:

```tsx
          {sentTo && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Check your inbox</h3>
              <p className="muted">
                We&apos;ve sent a verification link to <strong>{sentTo}</strong>. Open it to
                confirm your address, then sign in.
              </p>
              <p className="muted" style={{ fontSize: 13 }}>
                The link works once and expires after 24 hours. Nothing after a few minutes?
                Check your spam folder.
              </p>
              {error && <div className="error">{error}</div>}
              <button className="btn secondary" disabled={busy} onClick={resend}>
                {busy ? 'Sending…' : 'Send it again'}
              </button>
              <button
                className="btn secondary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setSentTo(null);
                  setIsRegister(false);
                  setPassword('');
                }}
              >
                Back to sign in
              </button>
            </div>
          )}
```

Add the two notices above the form, next to the existing `sessionInvalidated` block:

```tsx
          {justVerified && (
            <div className="pill good" style={{ marginTop: 16, display: 'inline-block' }}>
              Email confirmed — sign in to continue.
            </div>
          )}

          {notVerified && (
            <div className="error" style={{ marginTop: 16 }}>
              Confirm your email address to sign in. Check your inbox for the link.
              <button
                className="btn secondary"
                style={{ marginTop: 8 }}
                disabled={busy}
                onClick={resend}
              >
                {busy ? 'Sending…' : 'Send the link again'}
              </button>
            </div>
          )}
```

Change the submit button's register label:

```tsx
              {busy ? 'Please wait…' : isRegister ? 'Send verification link' : 'Sign in'}
```

- [ ] **Step 4: Verify**

```bash
cd apps/web && npm run build
```

Expected: exits 0 (`useEffect` must be added to the React import — the build fails loudly if
it is missing).

Then by hand, against a running API: create an account → the panel names the masked address
and no session exists (reloading `/` returns to the login screen); press **Send it again** →
a second email arrives; try to sign in → the "confirm your email" message with its resend
button; follow the link → confirmation, then the login page with the green banner; sign in →
in.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/auth/AuthContext.tsx apps/web/src/pages/LoginPage.tsx
git commit -m "feat(web): confirm-your-email panel after signup, and gate sign-in on it"
```

---

### Task 8: Web — verification confirms, then redirects to sign in

**Files:**
- Modify: `apps/web/src/pages/VerifyEmailPage.tsx:1-2,48-85`

**Interfaces:**
- Consumes: the `?verified=1` banner from Task 7.

- [ ] **Step 1: Add the redirect**

Change the imports:

```tsx
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
```

Add inside the component, after the existing redemption effect:

```tsx
  const nav = useNavigate();

  /**
   * Send the user to the sign-in screen once the address is confirmed.
   *
   * Delayed rather than immediate so the confirmation is actually readable, and `replace`
   * so the Back button doesn't return to a page whose single-use token is already spent.
   * The button below does the same thing for anyone who would rather not wait.
   */
  useEffect(() => {
    if (state !== 'done') return;
    const timer = setTimeout(() => nav('/login?verified=1', { replace: true }), 3000);
    return () => clearTimeout(timer);
  }, [state, nav]);
```

In the `done` branch, point the button at the flagged URL and say what is about to happen:

```tsx
        {state === 'done' && (
          <>
            <h1>Email confirmed</h1>
            <p className="muted">
              Thanks — your address is verified. Sign in to continue; we&apos;ll take you
              there in a moment.
            </p>
            <Link className="btn" to="/login?verified=1">
              Continue to sign in
            </Link>
          </>
        )}
```

In the `failed` branch, replace the now-impossible advice (an unverified account cannot sign
in, so it cannot reach the account page):

```tsx
            <p className="muted">
              Links expire after 24 hours and can only be used once. Start signing up again
              with the same email and password to get a fresh one.
            </p>
```

- [ ] **Step 2: Verify**

```bash
cd apps/web && npm run build
```

Expected: exits 0. By hand: open a link, confirm the page redirects to `/login?verified=1`
after ~3 seconds and that the banner shows; press the button before then and confirm it
lands on the same place.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/VerifyEmailPage.tsx
git commit -m "feat(web): send a confirmed user to sign-in, by button and automatically"
```

---

### Task 9: Mobile — same flow in Flutter

Cannot be run here (no Flutter toolchain). Keep the diff small and mirror the web copy
exactly so the two clients cannot drift.

**Files:**
- Modify: `apps/mobile/lib/data/repositories.dart:15-19` (`register`)
- Modify: `apps/mobile/lib/features/auth/auth_controller.dart:24-26,62-63`
- Modify: `apps/mobile/lib/features/auth/login_screen.dart:48-81,107-113`

**Interfaces:**
- Consumes: `{ status, email }` from Task 3; `ApiException.code` from Task 2.
- Produces: `AuthController.pendingVerificationEmail` (`String?`), `AuthController.clearPendingVerification()`.

- [ ] **Step 1: Repository returns the masked address**

```dart
  /// Create an account, or ask for another verification link for one that exists.
  ///
  /// Saves no tokens: the API will not sign in an account that has not confirmed its
  /// address. Returns the masked address the link was sent to.
  Future<String> register(String email, String password, String displayName) async {
    final res = await _api.post('/auth/register',
        body: {'email': email, 'password': password, 'displayName': displayName});
    return (res['email'] as String?) ?? email;
  }
```

- [ ] **Step 2: Controller holds the pending state**

Add beside the existing fields:

```dart
  /// Masked address a verification link was just sent to. Non-null means the UI should show
  /// the check-your-inbox panel: signup no longer produces a session.
  String? pendingVerificationEmail;

  /// True when the last sign-in failed only because the address is unconfirmed.
  bool emailNotVerified = false;
```

Replace `register`, and reset the flag in `login`:

```dart
  Future<bool> login(String email, String password) {
    emailNotVerified = false;
    return _run(() => _auth.login(email, password));
  }

  Future<bool> register(String email, String password, String name) async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      pendingVerificationEmail = await _auth.register(email, password, name);
      return true;
    } catch (e) {
      error = e.toString();
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  void clearPendingVerification() {
    pendingVerificationEmail = null;
    notifyListeners();
  }
```

`_run` sets `status = authenticated` on success, which is why `register` no longer uses it.
Add the code check to `_run`'s catch so a refused sign-in is distinguishable:

```dart
    } catch (e) {
      error = e.toString();
      if (e is ApiException && e.code == 'email_not_verified') emailNotVerified = true;
      return false;
    }
```

with `import '../../core/api_client.dart';` already present in the file.

- [ ] **Step 3: Screen shows the panel**

In `login_screen.dart`, immediately inside the column that currently starts with
`if (_register)`, add the panel and short-circuit the form:

```dart
                if (auth.pendingVerificationEmail != null) ...[
                  const Text('Check your inbox',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Text(
                    'We\'ve sent a verification link to ${auth.pendingVerificationEmail}. '
                    'Open it to confirm your address, then sign in.',
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'The link works once and expires after 24 hours. Nothing after a few '
                    'minutes? Check your spam folder.',
                    style: TextStyle(fontSize: 13),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: auth.busy ? null : _submit,
                    child: Text(auth.busy ? 'Sending…' : 'Send it again'),
                  ),
                  TextButton(
                    onPressed: () {
                      auth.clearPendingVerification();
                      setState(() => _register = false);
                      _password.clear();
                    },
                    child: const Text('Back to sign in'),
                  ),
                ] else ...[
```

and close that `else` branch with `],` after the existing Apple button block. Inside it, the
existing error `Text` gains the resend affordance:

```dart
                  if (auth.error != null) ...[
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(auth.error!,
                          style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ),
                    if (auth.emailNotVerified)
                      OutlinedButton(
                        onPressed: auth.busy ? null : _resend,
                        child: Text(auth.busy ? 'Sending…' : 'Send the link again'),
                      ),
                  ],
```

and the submit label becomes:

```dart
                      : Text(_register ? 'Send verification link' : 'Sign in'),
```

Add the resend handler beside `_submit`:

```dart
  /// Re-post the signup call, which is the resend path on the API.
  void _resend() {
    final auth = context.read<AuthController>();
    auth.register(_email.text.trim(), _password.text,
        _name.text.trim().isEmpty ? 'Test Routify user' : _name.text.trim());
  }
```

- [ ] **Step 4: Verify what can be verified here**

Run: `cd apps/mobile && flutter analyze`
Expected: it will not run in this environment — record that, and state plainly in the commit
message and to the user that mobile is unverified and needs a device check.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib
git commit -m "feat(mobile): check-your-inbox after signup, and surface the sign-in gate"
```

---

### Task 10: Documentation

**Files:**
- Modify: `testing/04-AUTHENTICATION-TESTING.md`
- Modify: `docs/superpowers/specs/2026-08-18-email-verification-gate-design.md` (status line)

- [ ] **Step 1: Correct the rows the gate makes wrong**

Four existing rows in `testing/04-AUTHENTICATION-TESTING.md` now describe behaviour that no
longer exists. Replace them:

`AUTH-001` — expected result becomes:

```text
Account created but **no session**: the form is replaced by "Check your inbox" naming the masked address (e.g. `l•••••r@gmail.com`); `rs_access`/`rs_refresh` are **absent** from `localStorage`; a verification email arrives; new user's role is `user`
```

`AUTH-003` — split into the two cases the API now distinguishes:

```text
| AUTH-003 | Register with an email that is already registered **and verified** | anon | Use `learner@routesync.uk` | Submit the register form | **409** — `Email already registered`; inline error banner; no account created |
| AUTH-003a | Re-register an **unverified** address with the **correct** password | anon | Register a fresh address first, do not open the link | Submit the same email + password again | **202**; "Check your inbox" again; a **second** email arrives; still no session. This is the resend path |
| AUTH-003b | Re-register an unverified address with the **wrong** password | anon | As above | Submit the same email with a different password | **409** `Email already registered` — identical to AUTH-003, and **no email sent**. Any difference from AUTH-003 is a defect (it would disclose the account's state) |
```

`AUTH-008` — expected result becomes:

```text
A verification email arrives. **If email is not configured the signup still returns 202 but the account can never sign in** — check the API log for `Email not configured`. This makes working outbound email a hard requirement for every test below
```

`AUTH-012` — add to the expected result: `and **not** the "confirm your email" message, even
if that account is unverified (see AUTH-051)`.

- [ ] **Step 2: Add the new rows**

Append to §4 of `testing/04-AUTHENTICATION-TESTING.md`:

```text
| AUTH-049 | Signup creates no session | anon | — | Complete AUTH-001, then reload `/` | Redirected to `/login` — signing up does not sign you in |
| AUTH-050 | Sign in before confirming | anon | Registered, link not opened | Enter the correct email and password on the sign-in tab | **403** `Confirm your email address to sign in. Check your inbox for the link.` with a **Send the link again** button; no tokens stored |
| AUTH-051 | Wrong password before confirming | anon | As AUTH-050 | Correct email, wrong password | **401** `Invalid credentials` — *not* the 403. The password is checked first so the endpoint cannot reveal which addresses are registered but unconfirmed |
| AUTH-052 | Resend from the confirmation panel | anon | On the "Check your inbox" panel | Press **Send it again** | A second email arrives; panel still shown; still no session |
| AUTH-053 | Resend from the sign-in refusal | anon | On the AUTH-050 message | Press **Send the link again** | **202**; the confirmation panel replaces the form; a fresh email arrives |
| AUTH-054 | Per-account cap on the signup resend | anon | Unverified account | Submit the signup form 6 times in an hour with the correct password | The 6th returns **429** `Too many verification emails requested. Try again in an hour.` — not a silent success |
| AUTH-055 | Confirming redirects to sign-in | anon | Have a valid link | Open the link and wait | **"Email confirmed"**, then after ~3 s the browser lands on `/login` showing **"Email confirmed — sign in to continue."** Pressing **Continue to sign in** does the same immediately. Browser Back must not return to the spent link |
| AUTH-056 | Sign in after confirming | user | Just confirmed | Enter the same email and password | Signed in; redirected to `/test-centres`; tokens present in `localStorage` |
| AUTH-057 | Existing accounts were grandfathered | any | `db/migrate_phase_29.sql` applied | Sign in as each seeded account (`learner@`, `instructor@`, `admin@routesync.uk`) | All sign in normally — the backfill marked pre-existing accounts verified. A 403 here means the migration did not run |
| AUTH-058 | Admin sees verification state | admin | Signed in as admin; one unverified account exists | `/admin` → **Users** | Each row shows **Verified** or **Unverified** under the email; the unverified account's pill flips to Verified once it opens its link |
| AUTH-059 | Mobile signup and gate | anon | Flutter build on a device | Register in the app, then try to sign in before confirming | Same as AUTH-001/AUTH-050: a check-your-inbox panel naming the masked address, no session, and the refusal message with a resend button on sign-in |
```

Then update §1's **Key source** row to include
[mask-email.ts](../apps/api/src/modules/auth/mask-email.ts), and §2's preconditions to state
that outbound email is now required for **all** registration tests, not only AUTH-020+.

- [ ] **Step 3: Mark the spec implemented**

Change the spec's status line to `implemented 2026-08-18 — see docs/superpowers/plans/2026-08-18-email-verification-gate.md`.

- [ ] **Step 4: Commit**

```bash
git add testing/04-AUTHENTICATION-TESTING.md docs/superpowers/specs
git commit -m "docs(testing): manual steps for the email verification gate"
```

---

## Deployment order (not a code task — do not skip)

1. `db/migrate_phase_29.sql` against **Supabase**, before the API deploy.
2. Deploy API and web together. An old web build expects tokens from `register`; a new web
   build against an old API never shows the panel.
3. Mobile last, after an on-device check.
