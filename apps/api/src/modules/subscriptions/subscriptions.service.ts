import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SubscriptionPlan, SubscriptionStatus, BillingSource } from '@prisma/client';

const PREMIUM_PLANS: SubscriptionPlan[] = [
  SubscriptionPlan.premium_monthly,
  SubscriptionPlan.premium_yearly,
];
const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.active,
  SubscriptionStatus.trialing,
  SubscriptionStatus.past_due, // grace period
];

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * True if the user holds ANY active premium subscription. Use this only for
   * gates that are not tied to a specific test centre. For route access use
   * {@link isPremiumForCentre}, since Premium is purchased per test centre.
   */
  async isPremium(userId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, plan: { in: PREMIUM_PLANS }, status: { in: ACTIVE_STATUSES } },
    });
    if (!sub) return false;
    if (sub.currentPeriodEnd && sub.currentPeriodEnd < new Date()) return false;
    return true;
  }

  /**
   * Authoritative per-centre premium check. Premium is purchased per test centre
   * and is not switchable, so route access is granted only when the user has an
   * active premium subscription for that route's centre.
   *
   * A subscription with `testCentreId = null` is a legacy/universal grant and
   * covers every centre (grandfathered so existing subscribers aren't locked out).
   * Routes with no test centre fall back to the any-active-premium check.
   */
  async isPremiumForCentre(userId: string, testCentreId: string | null): Promise<boolean> {
    if (!testCentreId) return this.isPremium(userId);
    const sub = await this.prisma.subscription.findFirst({
      where: {
        userId,
        plan: { in: PREMIUM_PLANS },
        status: { in: ACTIVE_STATUSES },
        OR: [{ testCentreId }, { testCentreId: null }], // exact centre or universal
      },
    });
    if (!sub) return false;
    if (sub.currentPeriodEnd && sub.currentPeriodEnd < new Date()) return false;
    return true;
  }

  /** Test centres the user currently has active premium access to (null = universal). */
  async premiumTestCentreIds(userId: string): Promise<Array<string | null>> {
    const subs = await this.prisma.subscription.findMany({
      where: { userId, plan: { in: PREMIUM_PLANS }, status: { in: ACTIVE_STATUSES } },
      select: { testCentreId: true, currentPeriodEnd: true },
    });
    const now = new Date();
    return subs
      .filter((s) => !s.currentPeriodEnd || s.currentPeriodEnd >= now)
      .map((s) => s.testCentreId);
  }

  async mySubscription(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, plan: { in: PREMIUM_PLANS }, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    const centres = await this.premiumTestCentreIds(userId);
    const hasAnyPremium = centres.length > 0;
    return {
      plan: sub?.plan ?? SubscriptionPlan.free,
      status: sub?.status ?? SubscriptionStatus.active,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      // Premium is per test centre; these are the centres the user has unlocked.
      // `null` in the list means a legacy/universal subscription (all centres).
      premiumTestCentreIds: centres,
      // Kept for backward-compatible clients: true if ANY premium is active.
      // Per-route access must still be checked against the route's centre.
      entitlements: {
        unlimitedRoutes: hasAnyPremium,
        practiceMode: hasAnyPremium,
        multiView: hasAnyPremium,
        offline: hasAnyPremium,
        instructorRoutes: hasAnyPremium,
        aiInsights: hasAnyPremium,
      },
    };
  }

  plans() {
    return [
      {
        id: 'free',
        name: 'Demo (Free)',
        priceMinor: 0,
        currency: 'GBP',
        perTestCentre: false,
        features: ['One route total across the account'],
      },
      {
        id: 'premium_monthly',
        name: 'Premium Monthly',
        priceMinor: 499,
        currency: 'GBP',
        interval: 'month',
        // Premium is purchased per test centre and is not switchable.
        perTestCentre: true,
        features: ['Unlimited routes for one test centre', 'Practice mode', 'Multi-view', 'Offline', 'Instructor routes', 'AI learning insights'],
      },
      {
        id: 'premium_yearly',
        name: 'Premium Yearly',
        priceMinor: 3999,
        currency: 'GBP',
        interval: 'year',
        perTestCentre: true,
        features: ['Unlimited routes for one test centre', 'Everything in monthly', 'Best value — save 33%'],
      },
    ];
  }

  /**
   * Upsert subscription state from a verified webhook (Stripe or RevenueCat).
   * Webhook signature verification happens in the controller before this is called.
   */
  async applyEntitlement(params: {
    userId: string;
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    source: BillingSource;
    externalId?: string;
    testCentreId?: string | null;
    currentPeriodEnd?: Date;
    priceMinor?: number;
  }) {
    const testCentreId = params.testCentreId ?? null;

    // Subscriptions are keyed on (user, test centre): each centre is its own
    // purchase, so a new centre must not overwrite an existing one. Prefer to
    // match the exact centre; fall back to the external subscription id so
    // renewals/cancellations from a webhook update the right row even when the
    // centre isn't echoed back in the event payload.
    const existing = await this.prisma.subscription.findFirst({
      where: {
        userId: params.userId,
        OR: [
          { testCentreId },
          ...(params.externalId ? [{ externalId: params.externalId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: {
          plan: params.plan,
          status: params.status,
          source: params.source,
          externalId: params.externalId,
          // Only set the centre when we know it; don't clobber a stored centre
          // with null on a renewal event that omits it.
          ...(params.testCentreId !== undefined ? { testCentreId } : {}),
          currentPeriodEnd: params.currentPeriodEnd,
          priceMinor: params.priceMinor,
        },
      });
    } else {
      await this.prisma.subscription.create({ data: { ...params, testCentreId } });
    }
    this.logger.log(
      `Entitlement updated for ${params.userId}: ${params.plan}/${params.status}` +
        ` (centre ${testCentreId ?? 'universal'})`,
    );
  }

  /** Append a raw billing event for audit/reconciliation (Stripe or RevenueCat). */
  async logEvent(source: BillingSource, eventType: string, payload: unknown, userId?: string) {
    await this.prisma.$executeRaw`
      INSERT INTO subscription_events (id, user_id, source, event_type, payload, received_at)
      VALUES (gen_random_uuid(), ${userId ?? null}::uuid, ${source}::billing_source,
              ${eventType}, ${JSON.stringify(payload)}::jsonb, now())`;
  }

  /** Map a RevenueCat product identifier to a plan. */
  planFromProduct(productId: string): SubscriptionPlan {
    const p = productId.toLowerCase();
    if (p.includes('year') || p.includes('annual')) return SubscriptionPlan.premium_yearly;
    return SubscriptionPlan.premium_monthly;
  }
}
