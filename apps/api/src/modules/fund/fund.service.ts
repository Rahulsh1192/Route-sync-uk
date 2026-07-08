import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import {
  ALLOCATION_PCT,
  COST_RATIO,
  PRICE_MONTHLY_MINOR,
  PRICE_YEARLY_MINOR,
} from './fund.constants';

/**
 * Instructor Community Fund: a transparent double-entry-style ledger in
 * fund_transactions. Monthly the platform contributes 10% of net profit; admins
 * record payouts to beneficiaries; everything is exposed via a public report.
 *
 * fund_transactions / fund_beneficiaries are not in the Prisma client, so raw SQL.
 */
@Injectable()
export class FundService {
  private readonly logger = new Logger(FundService.name);

  constructor(private prisma: PrismaService) {}

  // --- transparency reads (also used by admin) -----------------------------
  async summary() {
    const totals = await this.prisma.$queryRaw<Array<{ entry_type: string; total: string }>>`
      SELECT entry_type, COALESCE(SUM(amount_minor), 0)::bigint AS total
      FROM fund_transactions GROUP BY entry_type`;
    const recent = await this.prisma.$queryRaw`
      SELECT entry_type, amount_minor, currency, period, description, net_profit_minor,
             allocation_pct, created_at
      FROM fund_transactions ORDER BY created_at DESC LIMIT 25`;
    const beneficiaries = await this.listBeneficiaries();

    type Total = { entry_type: string; total: string };
    const contributed = Number(totals.find((t: Total) => t.entry_type === 'contribution')?.total ?? 0);
    const paidOut = Number(totals.find((t: Total) => t.entry_type === 'payout')?.total ?? 0);

    return {
      allocationPct: ALLOCATION_PCT,
      costRatio: COST_RATIO,
      totals,
      contributedMinor: contributed,
      paidOutMinor: paidOut,
      balanceMinor: contributed - paidOut,
      currency: 'GBP',
      recent,
      beneficiaries,
    };
  }

  /** Monthly breakdown for a given year, for historical transparency reports. */
  reports(year: number) {
    const prefix = `monthly:${year}-%`;
    return this.prisma.$queryRaw`
      SELECT period, entry_type,
             SUM(amount_minor)::bigint AS total,
             MAX(net_profit_minor)::bigint AS net_profit_minor
      FROM fund_transactions
      WHERE period LIKE ${prefix}
      GROUP BY period, entry_type
      ORDER BY period`;
  }

  // --- beneficiaries --------------------------------------------------------
  listBeneficiaries() {
    return this.prisma.$queryRaw`
      SELECT id, name, description, user_id, created_at FROM fund_beneficiaries
      ORDER BY created_at DESC`;
  }

  async createBeneficiary(name: string, description?: string, userId?: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO fund_beneficiaries (id, name, description, user_id)
      VALUES (gen_random_uuid(), ${name}, ${description ?? null}, ${userId ?? null}::uuid)
      RETURNING id`;
    return { id: rows[0].id, name };
  }

  // --- ledger writes --------------------------------------------------------
  async payout(actorId: string, beneficiaryId: string, amountMinor: number, description?: string) {
    if (amountMinor < 1) throw new BadRequestException('Amount must be positive');
    const balance = (await this.summary()).balanceMinor;
    if (amountMinor > balance) {
      throw new BadRequestException(`Payout exceeds fund balance (£${(balance / 100).toFixed(2)})`);
    }
    await this.prisma.$executeRaw`
      INSERT INTO fund_transactions (id, entry_type, amount_minor, currency, description,
                                     beneficiary_id, created_by)
      VALUES (gen_random_uuid(), 'payout', ${amountMinor}, 'GBP', ${description ?? null},
              ${beneficiaryId}::uuid, ${actorId}::uuid)`;
    await this.audit(actorId, 'fund.payout', { beneficiaryId, amountMinor });
    return { ok: true };
  }

  async manualAllocation(actorId: string, amountMinor: number, period: string, description?: string) {
    if (amountMinor < 1) throw new BadRequestException('Amount must be positive');
    await this.prisma.$executeRaw`
      INSERT INTO fund_transactions (id, entry_type, amount_minor, currency, period, description,
                                     allocation_pct, created_by)
      VALUES (gen_random_uuid(), 'allocation', ${amountMinor}, 'GBP', ${period},
              ${description ?? null}, ${ALLOCATION_PCT}, ${actorId}::uuid)`;
    await this.audit(actorId, 'fund.allocate', { amountMinor, period });
    return { ok: true };
  }

  // --- net profit + automated monthly contribution --------------------------
  /** Compute the fund contribution for a period from active subscriptions. */
  async computeContribution(): Promise<{
    grossMinor: number;
    netProfitMinor: number;
    fundMinor: number;
  }> {
    const [monthly, yearly] = await Promise.all([
      this.prisma.subscription.count({ where: { plan: 'premium_monthly', status: 'active' } }),
      this.prisma.subscription.count({ where: { plan: 'premium_yearly', status: 'active' } }),
    ]);
    const grossMinor = monthly * PRICE_MONTHLY_MINOR + Math.round((yearly * PRICE_YEARLY_MINOR) / 12);
    const netProfitMinor = Math.round(grossMinor * (1 - COST_RATIO));
    const fundMinor = Math.round((netProfitMinor * ALLOCATION_PCT) / 100);
    return { grossMinor, netProfitMinor, fundMinor };
  }

  /**
   * Record the monthly 10%-of-net-profit contribution. Idempotent per period.
   * Runs on the 1st of each month for the month just ended.
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async runMonthlyContribution(periodOverride?: string) {
    const now = new Date();
    // default: the month that just ended
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const period = periodOverride ?? `monthly:${prev.toISOString().slice(0, 7)}`;

    const existing = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM fund_transactions
      WHERE entry_type = 'contribution' AND period = ${period} LIMIT 1`;
    if (existing.length) {
      this.logger.log(`Fund contribution for ${period} already recorded; skipping`);
      return { skipped: true, period };
    }

    const { grossMinor, netProfitMinor, fundMinor } = await this.computeContribution();
    if (fundMinor <= 0) {
      this.logger.log(`No net profit for ${period}; no contribution`);
      return { skipped: true, period, reason: 'no_profit' };
    }

    await this.prisma.$executeRaw`
      INSERT INTO fund_transactions (id, entry_type, amount_minor, currency, period, description,
                                     net_profit_minor, allocation_pct)
      VALUES (gen_random_uuid(), 'contribution', ${fundMinor}, 'GBP', ${period},
              ${'Automated 10% of net profit'}, ${netProfitMinor}, ${ALLOCATION_PCT})`;
    this.logger.log(
      `Fund contribution ${period}: gross ${grossMinor}, net ${netProfitMinor}, fund ${fundMinor} (pence)`,
    );
    return { period, grossMinor, netProfitMinor, fundMinor };
  }

  private async audit(actorId: string, action: string, payload: unknown) {
    await this.prisma.$executeRaw`
      INSERT INTO audit_log (actor_id, action, entity_type, after)
      VALUES (${actorId}::uuid, ${action}, 'fund', ${JSON.stringify(payload)}::jsonb)`;
  }
}
