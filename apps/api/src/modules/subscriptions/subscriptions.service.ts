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

  /** Authoritative premium check used by EntitlementGuard. Server-side only. */
  async isPremium(userId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, plan: { in: PREMIUM_PLANS }, status: { in: ACTIVE_STATUSES } },
    });
    if (!sub) return false;
    if (sub.currentPeriodEnd && sub.currentPeriodEnd < new Date()) return false;
    return true;
  }

  async mySubscription(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      plan: sub?.plan ?? SubscriptionPlan.free,
      status: sub?.status ?? SubscriptionStatus.active,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      entitlements: {
        unlimitedRoutes: PREMIUM_PLANS.includes(sub?.plan ?? SubscriptionPlan.free),
        practiceMode: PREMIUM_PLANS.includes(sub?.plan ?? SubscriptionPlan.free),
        multiView: PREMIUM_PLANS.includes(sub?.plan ?? SubscriptionPlan.free),
        offline: PREMIUM_PLANS.includes(sub?.plan ?? SubscriptionPlan.free),
        instructorRoutes: PREMIUM_PLANS.includes(sub?.plan ?? SubscriptionPlan.free),
        aiInsights: PREMIUM_PLANS.includes(sub?.plan ?? SubscriptionPlan.free),
      },
    };
  }

  plans() {
    return [
      { id: 'free', name: 'Free', priceMinor: 0, currency: 'GBP', features: ['1 sample route'] },
      {
        id: 'premium_monthly',
        name: 'Premium Monthly',
        priceMinor: 499,
        currency: 'GBP',
        interval: 'month',
        features: ['Unlimited routes', 'Practice mode', 'Multi-view', 'Offline', 'Instructor routes', 'AI learning insights'],
      },
      {
        id: 'premium_yearly',
        name: 'Premium Yearly',
        priceMinor: 3999,
        currency: 'GBP',
        interval: 'year',
        features: ['Everything in monthly', 'Best value — save 33%'],
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
    currentPeriodEnd?: Date;
    priceMinor?: number;
  }) {
    const existing = await this.prisma.subscription.findFirst({
      where: { userId: params.userId },
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
          currentPeriodEnd: params.currentPeriodEnd,
          priceMinor: params.priceMinor,
        },
      });
    } else {
      await this.prisma.subscription.create({ data: params });
    }
    this.logger.log(`Entitlement updated for ${params.userId}: ${params.plan}/${params.status}`);
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
