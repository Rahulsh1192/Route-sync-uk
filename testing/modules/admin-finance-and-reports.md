# Module — Admin: Revenue, Community Fund, Instructor Earnings & Reports

**Prefix:** `ADM-FIN-###`

Four console panels grouped here because they share a role model and a data source.

---

## Module overview

| Panel | Web path | API | Roles |
|---|---|---|---|
| **Revenue** | `/admin` → Revenue | `GET /api/admin/revenue` | **`admin` only** |
| **Community Fund** | `/admin` → Community Fund | `GET /api/admin/fund/summary`, `GET /fund/beneficiaries` (read: moderator+admin) · `POST /fund/beneficiaries`, `/fund/allocate`, `/fund/payout`, `/fund/run-contribution` (**admin only**) | mixed |
| **Instructor Earnings** | `/admin` → Instructor Earnings | `GET /api/admin/revshare/runs`, `/revshare/instructors`, `/revshare/runs/:period` (read: moderator+admin) · `POST /api/admin/revshare/run` (**admin only**) | mixed |
| **Reports** | `/admin` → Reports | `GET /api/admin/reports`, `GET /api/admin/moderation-log` | `moderator`, `admin` |

**Components:** [panels/Revenue.tsx](../../apps/web/src/admin/panels/Revenue.tsx) ·
[panels/Fund.tsx](../../apps/web/src/admin/panels/Fund.tsx) ·
[panels/Earnings.tsx](../../apps/web/src/admin/panels/Earnings.tsx) ·
[panels/Reports.tsx](../../apps/web/src/admin/panels/Reports.tsx)

**Backend:** [admin.service.ts](../../apps/api/src/modules/admin/admin.service.ts) ·
[fund.service.ts](../../apps/api/src/modules/fund/fund.service.ts) ·
[fund.constants.ts](../../apps/api/src/modules/fund/fund.constants.ts) ·
[revshare.service.ts](../../apps/api/src/modules/revshare/revshare.service.ts)

---

## Business rules found in the implementation

### Revenue

- `activeMonthly` and `activeYearly` count `subscriptions` with the matching plan and
  `status = 'active'`.
- **`mrrMinor = activeMonthly × 499 + round(activeYearly × 2999 / 12)`**, formatted as
  `£x.xx`, currency `GBP`.
- ⚠ **The yearly figure used here is 2999 (£29.99), but the sale price in `plans()` and
  in `fund.constants.ts` is 3999 (£39.99).** See `ADM-FIN-003` and
  [13-TESTING-GAPS.md](../13-TESTING-GAPS.md).

### Community Fund

- Net-profit formula, applied per period:
  `gross = active_monthly × 499 + active_yearly × (3999 / 12)`;
  `net_profit = gross × (1 − 0.40)`; `fund_amount = net_profit × 10 %`.
- `COST_RATIO` **0.40** and `ALLOCATION_PCT` **10** are explicit, auditable assumptions
  stored on every allocation entry.
- **The monthly contribution runs on a cron** — 1st of the month at midnight — and is
  **idempotent per period**: a second run for the same period is skipped. A period with no
  net profit records nothing.
- `manualAllocation` and `payout` both require `amountMinor ≥ 1`.
- **A payout cannot exceed the fund balance** —
  `400 Payout exceeds fund balance (£x.xx)`.
- Both actions write an `audit_log` entry.
- **`GET /api/fund/summary` and `/api/fund/reports` are public** and unauthenticated,
  deliberately, so the figures are openly auditable.

### Instructor Earnings (rev-share, shadow mode)

Tunable via `platform_config` keys, with these defaults:

| Key | Default | Meaning |
|---|---|---|
| `revshare_instructor_pct` | **0** | Instructor share. **Zero by default** — the charity + marketing model |
| `revshare_min_view_seconds` | 30 | Minimum watch time for a view to qualify |
| `revshare_min_view_pct` | 25 | Minimum percentage watched to qualify |
| `revshare_holdback_pct` | 10 | Held back against refunds |
| `revshare_holdback_days` | 90 | Holdback period |
| `revshare_min_payout_minor` | 2000 | £20.00 minimum payout |
| `revshare_payout_day` | 5 | Day of month |

- The attribution run is also a **monthly cron**, **idempotent per period**, and
  attributes each centre's gross to the instructors whose routes were watched there.
- **With `instructorPct = 0`, every instructor balance is £0.00.** That is correct, not a
  bug.

### Reports

- `GET /api/admin/reports` returns **open** reports only, newest first, limit 50.
- **Nothing in the application creates a report.** There is no "report this route" UI or
  endpoint — see [13-TESTING-GAPS.md](../13-TESTING-GAPS.md).

---

## UI components

| Panel | Elements |
|---|---|
| Revenue | Subscription breakdown by plan and status, active monthly/yearly counts, formatted MRR |
| Community Fund | Fund summary and balance · **Monthly Contribution → Run now** button · **Beneficiaries** section with a name input (`placeholder="Name"`), description input and add button · **Record a Payout** with a beneficiary `<select>`, an amount input (`placeholder="0.00"`) and a submit button · **Recent Transactions** table · a note that the figures are public at `/api/fund/summary` |
| Instructor Earnings | **Monthly attribution run → Run now** · **Runs** table with a per-row detail button · a run-detail drawer with a Close button · **Instructor balances** table |
| Reports | Table with **Target**, **Reason**, **Status**, **Reported** columns · loading state · error alert (`role="alert"`) · empty state *"No open reports. All clear!"* |

---

## Functional test cases

### Revenue

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-FIN-001 | Revenue panel loads | admin | Seeded (2 active `premium_yearly`) | `/admin` → **Revenue** | Breakdown by plan and status, active counts, and a formatted MRR |
| ADM-FIN-002 | Counts match the database | admin | — | Compare with `SELECT plan, status, count(*) FROM subscriptions GROUP BY plan, status;` | The panel matches |
| ADM-FIN-003 | **MRR uses £29.99 for yearly** | admin | 2 active yearly subscriptions | Read the MRR | `round(2 × 2999 / 12)` = **500** pence = **£5.00**. The **sale price is £39.99**, which would give £6.67. Confirm the figure and raise the inconsistency — see [13](../13-TESTING-GAPS.md) |
| ADM-FIN-004 | **Moderator is denied** | moderator | Moderator account | Click **Revenue** in the sidebar | **403 Insufficient role**. The nav item is **not hidden**, so confirm the panel shows a readable error rather than an empty or broken view. API test: `PERM-018`; the missing UI gating is **PI-06** |
| ADM-FIN-005 | Learner API bypass | user | Learner token | `GET /api/admin/revenue` | **403** |

### Community Fund

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-FIN-006 | Fund panel loads | admin | Fresh database | `/admin` → **Community Fund** | Summary with a zero balance, an empty beneficiary list and an empty transactions table |
| ADM-FIN-007 | Add a beneficiary | admin | — | Name `QA Charity`, description → Add | Created and selectable in the payout dropdown |
| ADM-FIN-008 | **Run the monthly contribution** | admin | 2 active yearly subscriptions | Click **Run now** | A `contribution` transaction is recorded, or the run reports "no net profit" for the period. Verify the amount against the formula: `gross = 0×499 + 2×(3999/12) = 666`; `net = 666 × 0.6 = 400`; `fund = 40` pence |
| ADM-FIN-009 | **Contribution is idempotent** | admin | ADM-FIN-008 done | Click **Run now** again for the same period | Skipped — no second transaction for that period |
| ADM-FIN-010 | **Payout within the balance** | admin | A beneficiary and a positive balance | Record a payout of less than the balance | Recorded; the balance decreases; a transaction appears |
| ADM-FIN-011 | **Payout exceeding the balance** | admin | — | Attempt a payout larger than the balance | **400 Payout exceeds fund balance (£x.xx)** |
| ADM-FIN-012 | Zero / negative amounts | admin | — | Payout of `0`, then allocation of `-100` | **400 Amount must be positive** in both cases (`@Min(1)` also rejects them at DTO level) |
| ADM-FIN-013 | Manual allocation | admin | — | `POST /api/admin/fund/allocate` with `{amountMinor:1000, period:"monthly:2026-08"}` | An `allocation` transaction with `allocation_pct = 10` and the acting admin recorded |
| ADM-FIN-014 | Fund actions are audited | admin | ADM-FIN-010 done | `SELECT * FROM audit_log WHERE action LIKE 'fund.%' ORDER BY created_at DESC;` | Entries for the allocation and the payout, with the acting admin's id |
| ADM-FIN-015 | **Public transparency endpoints** | — | **No token** | `GET /api/fund/summary` and `GET /api/fund/reports?year=2026` | **200** without any authentication — deliberate. Confirm no personal data is exposed in the payload |
| ADM-FIN-016 | **Moderator can read, not write** | moderator | Moderator account | Open the panel; then try to add a beneficiary and record a payout | Reads succeed; **both writes return 403**. The UI does not hide the forms — record that |

### Instructor Earnings

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-FIN-017 | Earnings panel loads | admin | Fresh database | `/admin` → **Instructor Earnings** | Empty runs table and empty balances table, with no error |
| ADM-FIN-018 | **Run attribution** | admin | Some `route_watch_events` exist (create them via `PLAY-020`) | Click **Run now** | A run row appears for the previous month's period |
| ADM-FIN-019 | Run detail | admin | ADM-FIN-018 done | Click the detail button on the run | A drawer opens with the per-line attribution; **Close** dismisses it |
| ADM-FIN-020 | **Balances are £0.00** | admin | Default config | Look at instructor balances | Every balance is **£0.00**, because `revshare_instructor_pct` defaults to **0**. **Correct behaviour, not a defect** |
| ADM-FIN-021 | Non-zero share | admin | `INSERT INTO platform_config(key,value) VALUES('revshare_instructor_pct','20') ON CONFLICT (key) DO UPDATE SET value='20';` | Re-run attribution for a different period | Non-zero balances are attributed to the instructors whose routes were watched |
| ADM-FIN-022 | **Attribution is idempotent** | admin | ADM-FIN-018 done | Click **Run now** again for the same period | The run is skipped; no duplicate rows |
| ADM-FIN-023 | Run for an explicit period | admin | — | `POST /api/admin/revshare/run` with `{"period":"2026-07"}` | A run is created for that period |
| ADM-FIN-024 | Malformed period | admin | — | `POST` with `{"period":"not-a-period"}` | Record the behaviour — `periodBounds()` parses the string with `Number`, so an invalid value produces `NaN` dates. A 500 or a silently empty run is worth raising (`Potential Issue`) |
| ADM-FIN-025 | **Moderator can read, not run** | moderator | Moderator account | Open the panel; then click **Run now** | Reads succeed; the run returns **403** |

### Reports

| Test ID | Scenario | Role | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|
| ADM-FIN-026 | Reports panel — empty | admin / moderator | Fresh database | `/admin` → **Reports** | *"No open reports. All clear!"* |
| ADM-FIN-027 | Reports panel — with data | admin | Insert a row into `reports` manually (**nothing in the app creates one**) | Reload | The row renders with target type, reason, status and reported date |
| ADM-FIN-028 | **No way to raise a report** | user | — | Look for a "report this route" control anywhere in the learner UI | **There is none.** Record this as a product gap, not a defect ([13](../13-TESTING-GAPS.md)) |
| ADM-FIN-029 | **No way to action a report** | admin | A report exists | Look for resolve/dismiss controls in the panel | **There are none** — the panel is read-only and no endpoint changes a report's status. Record as a gap |
| ADM-FIN-030 | Moderation log | admin / moderator | Some moderation has happened | `GET /api/admin/moderation-log` | The 50 most recent audit entries, newest first |
| ADM-FIN-031 | Error state | admin | Stop the API | Open the Reports panel | An error alert with `role="alert"` — not a blank panel |
| ADM-FIN-032 | Learner API bypass | user | Learner token | `GET /api/admin/reports` | **403** |

---

## Traceability

| Test IDs | UI | API | Guard | Logic |
|---|---|---|---|---|
| ADM-FIN-001 … ADM-FIN-005 | `panels/Revenue.tsx` | `GET /api/admin/revenue` | **`@Roles('admin')`** | `AdminService.revenue()` |
| ADM-FIN-006 … ADM-FIN-016 | `panels/Fund.tsx` | `/api/admin/fund/*`, `/api/fund/*` | mixed — reads `moderator+admin`, writes **`admin`** | `FundService`, `ALLOCATION_PCT`, `COST_RATIO` |
| ADM-FIN-017 … ADM-FIN-025 | `panels/Earnings.tsx` | `/api/admin/revshare/*` | reads `moderator+admin`, run **`admin`** | `RevshareService.runAttribution()`, `config()` |
| ADM-FIN-026 … ADM-FIN-032 | `panels/Reports.tsx` | `GET /api/admin/reports`, `/moderation-log` | `@Roles('moderator','admin')` | `reports()`, `moderationLog()` |
</content>
