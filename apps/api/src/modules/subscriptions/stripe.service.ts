import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { SubscriptionPlan } from '@prisma/client';

/**
 * Wraps the Stripe SDK: Checkout session creation, webhook signature verification,
 * and price→plan mapping. Degrades gracefully when Stripe isn't configured (dev)
 * so the rest of the API still boots.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe?: Stripe;

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (key) {
      this.stripe = new Stripe(key, { apiVersion: '2024-06-20' });
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not set — Stripe features disabled');
    }
  }

  get enabled(): boolean {
    return !!this.stripe;
  }

  /** Create a hosted Checkout session for a premium plan. client_reference_id = userId. */
  async createCheckoutSession(userId: string, plan: 'premium_monthly' | 'premium_yearly') {
    if (!this.stripe) throw new BadRequestException('Payments are not configured');
    const price =
      plan === 'premium_monthly'
        ? this.config.get<string>('STRIPE_PRICE_MONTHLY')
        : this.config.get<string>('STRIPE_PRICE_YEARLY');
    if (!price) throw new BadRequestException(`No Stripe price configured for ${plan}`);

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: userId,
      // tie the resulting subscription back to our user for webhook reconciliation
      subscription_data: { metadata: { userId, plan } },
      success_url: this.config.get<string>('CHECKOUT_SUCCESS_URL')!,
      cancel_url: this.config.get<string>('CHECKOUT_CANCEL_URL')!,
    });
    return { url: session.url };
  }

  /** Verify the webhook signature against the raw body. Throws on tampering. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.stripe) throw new BadRequestException('Payments are not configured');
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new BadRequestException('Webhook secret not configured');
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }

  /** Look up the plan a Stripe Price ID corresponds to. */
  planFromPrice(priceId?: string | null): SubscriptionPlan {
    if (priceId && priceId === this.config.get<string>('STRIPE_PRICE_YEARLY')) {
      return SubscriptionPlan.premium_yearly;
    }
    if (priceId && priceId === this.config.get<string>('STRIPE_PRICE_MONTHLY')) {
      return SubscriptionPlan.premium_monthly;
    }
    return SubscriptionPlan.premium_monthly;
  }

  /** Retrieve a subscription to read its current price/period. */
  async getSubscription(id: string): Promise<Stripe.Subscription | null> {
    if (!this.stripe) return null;
    return this.stripe.subscriptions.retrieve(id);
  }
}
