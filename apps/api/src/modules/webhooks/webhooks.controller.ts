import {
  Body,
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { StripeService } from '../subscriptions/stripe.service';
import { PrismaService } from '../../database/prisma.service';
import {
  BillingSource,
  SubscriptionStatus,
  UploadStatus,
} from '@prisma/client';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger('Webhooks');

  constructor(
    private subs: SubscriptionsService,
    private stripe: StripeService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Stripe (web subscriptions)
  // -------------------------------------------------------------------------
  @Post('stripe')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody) throw new BadRequestException('Missing raw body');

    let event: Stripe.Event;
    try {
      event = this.stripe.constructEvent(req.rawBody, signature);
    } catch (err) {
      // Signature mismatch / tampering — reject.
      throw new BadRequestException(`Webhook signature verification failed: ${(err as Error).message}`);
    }

    await this.subs.logEvent(BillingSource.stripe, event.type, event);

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId = s.client_reference_id ?? s.metadata?.userId;
        if (userId && s.subscription) {
          const sub = await this.stripe.getSubscription(String(s.subscription));
          await this.applyStripeSubscription(userId, sub);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (userId) await this.applyStripeSubscription(userId, sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (userId) {
          await this.subs.applyEntitlement({
            userId,
            plan: 'free',
            status: SubscriptionStatus.canceled,
            source: BillingSource.stripe,
            externalId: sub.id,
            testCentreId: sub.metadata?.testCentreId ?? null,
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const subId = inv.subscription ? String(inv.subscription) : null;
        if (subId) {
          const sub = await this.stripe.getSubscription(subId);
          const userId = sub?.metadata?.userId;
          if (userId && sub) {
            // Move to past_due (grace period); entitlement guard still allows access.
            await this.applyStripeSubscription(userId, sub, SubscriptionStatus.past_due);
          }
        }
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        // Actual money collected — the source of truth for rev-share pools.
        await this.recordStripeInvoice(event.data.object as Stripe.Invoice);
        break;
      }
      case 'charge.refunded': {
        const ch = event.data.object as Stripe.Charge;
        const invoiceId = typeof ch.invoice === 'string' ? ch.invoice : ch.invoice?.id;
        if (invoiceId && ch.amount_refunded > 0) {
          // amount_refunded is cumulative on the charge; recordRefund is idempotent.
          await this.subs.recordRefund(BillingSource.stripe, invoiceId, ch.amount_refunded);
        }
        break;
      }
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
    return { received: true };
  }

  /** Record a paid subscription invoice as collected revenue (idempotent). */
  private async recordStripeInvoice(inv: Stripe.Invoice) {
    const amount = inv.amount_paid ?? 0;
    const subId = inv.subscription ? String(inv.subscription) : null;
    if (amount <= 0 || !subId) return; // only paid subscription invoices feed rev-share
    const sub = await this.stripe.getSubscription(subId);
    const userId = sub?.metadata?.userId;
    if (!userId || !sub) return;
    const plan = this.stripe.planFromPrice(sub.items.data[0]?.price?.id);
    const line = inv.lines?.data?.[0];
    const startMs = (line?.period?.start ?? inv.created ?? Math.floor(Date.now() / 1000)) * 1000;
    const endMs = line?.period?.end
      ? line.period.end * 1000
      : this.addMonths(new Date(startMs), plan === 'premium_yearly' ? 12 : 1).getTime();
    await this.subs.recordInvoice({
      userId,
      plan,
      source: BillingSource.stripe,
      amountMinor: amount,
      currency: (inv.currency ?? 'gbp').toUpperCase(),
      testCentreId: sub.metadata?.testCentreId ?? null,
      externalId: inv.id,
      periodStart: new Date(startMs),
      periodEnd: new Date(endMs),
      paidAt: inv.status_transitions?.paid_at
        ? new Date(inv.status_transitions.paid_at * 1000)
        : new Date(),
    });
  }

  private addMonths(d: Date, m: number): Date {
    const x = new Date(d);
    x.setMonth(x.getMonth() + m);
    return x;
  }

  private async applyStripeSubscription(
    userId: string,
    sub: Stripe.Subscription | null,
    statusOverride?: SubscriptionStatus,
  ) {
    if (!sub) return;
    const priceId = sub.items.data[0]?.price?.id;
    const plan = this.stripe.planFromPrice(priceId);
    await this.subs.applyEntitlement({
      userId,
      plan,
      status: statusOverride ?? this.mapStripeStatus(sub.status),
      source: BillingSource.stripe,
      externalId: sub.id,
      // Which test centre this per-centre subscription unlocks (set at checkout).
      testCentreId: sub.metadata?.testCentreId ?? null,
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      priceMinor: sub.items.data[0]?.price?.unit_amount ?? undefined,
    });
  }

  private mapStripeStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
    switch (s) {
      case 'active':
        return SubscriptionStatus.active;
      case 'trialing':
        return SubscriptionStatus.trialing;
      case 'past_due':
      case 'unpaid':
        return SubscriptionStatus.past_due;
      case 'canceled':
      case 'incomplete_expired':
        return SubscriptionStatus.canceled;
      default:
        return SubscriptionStatus.expired;
    }
  }

  // -------------------------------------------------------------------------
  // RevenueCat (mobile IAP — Apple / Google)
  // -------------------------------------------------------------------------
  @Post('revenuecat')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async revenuecat(@Headers('authorization') auth: string, @Body() body: any) {
    const secret = this.config.get<string>('REVENUECAT_WEBHOOK_SECRET');
    if (secret && auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Invalid RevenueCat webhook authorization');
    }

    const ev = body?.event;
    if (!ev) throw new BadRequestException('Missing event');
    const userId: string | undefined = ev.app_user_id;
    await this.subs.logEvent(BillingSource.apple, ev.type ?? 'unknown', body, userId);
    if (!userId) return { received: true };

    const source =
      ev.store === 'PLAY_STORE' ? BillingSource.google : BillingSource.apple;
    const plan = this.subs.planFromProduct(ev.product_id ?? '');
    const expiresMs = ev.expiration_at_ms ?? ev.expires_date_ms;
    // Per-centre Premium on mobile: the app sets a `test_centre_id` RevenueCat
    // subscriber attribute at purchase; null falls back to a universal grant.
    const testCentreId: string | null =
      ev.subscriber_attributes?.test_centre_id?.value ?? null;

    switch (ev.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
        await this.subs.applyEntitlement({
          userId,
          plan,
          status: SubscriptionStatus.active,
          source,
          externalId: ev.transaction_id,
          testCentreId,
          currentPeriodEnd: expiresMs ? new Date(Number(expiresMs)) : undefined,
        });
        // Only actual charges feed rev-share revenue (not uncancel/plan-change).
        if (ev.type === 'INITIAL_PURCHASE' || ev.type === 'RENEWAL') {
          const priceMajor = ev.price_in_purchased_currency ?? ev.price;
          const amountMinor =
            priceMajor != null
              ? Math.round(Number(priceMajor) * 100)
              : plan === 'premium_yearly'
              ? 3999
              : 499;
          const startMs = Number(ev.purchased_at_ms ?? ev.event_timestamp_ms ?? Date.now());
          const endMs = expiresMs
            ? Number(expiresMs)
            : this.addMonths(new Date(startMs), plan === 'premium_yearly' ? 12 : 1).getTime();
          await this.subs.recordInvoice({
            userId,
            plan,
            source,
            amountMinor,
            currency: (ev.currency ?? 'GBP').toUpperCase(),
            testCentreId,
            externalId: ev.transaction_id,
            periodStart: new Date(startMs),
            periodEnd: new Date(endMs),
          });
        }
        break;
      case 'CANCELLATION':
      case 'EXPIRATION':
        await this.subs.applyEntitlement({
          userId,
          plan: 'free',
          status: SubscriptionStatus.canceled,
          source,
          externalId: ev.transaction_id,
          testCentreId,
        });
        // A support-initiated cancellation is a refund — reverse the collected
        // revenue for that charge so it drops out of the rev-share pool.
        if (ev.cancel_reason === 'CUSTOMER_SUPPORT' && ev.transaction_id) {
          const priceMajor = ev.price_in_purchased_currency ?? ev.price;
          const amountMinor =
            priceMajor != null
              ? Math.round(Number(priceMajor) * 100)
              : plan === 'premium_yearly'
              ? 3999
              : 499;
          await this.subs.recordRefund(source, ev.transaction_id, amountMinor);
        }
        break;
      case 'REFUND':
        if (ev.transaction_id) {
          const priceMajor = ev.price_in_purchased_currency ?? ev.price;
          const amountMinor =
            priceMajor != null
              ? Math.round(Number(priceMajor) * 100)
              : plan === 'premium_yearly'
              ? 3999
              : 499;
          await this.subs.recordRefund(source, ev.transaction_id, amountMinor);
        }
        break;
      case 'BILLING_ISSUE':
        await this.subs.applyEntitlement({
          userId,
          plan,
          status: SubscriptionStatus.past_due,
          source,
          externalId: ev.transaction_id,
          testCentreId,
        });
        break;
      default:
        this.logger.debug(`Unhandled RevenueCat event: ${ev.type}`);
    }
    return { received: true };
  }

  // -------------------------------------------------------------------------
  // Internal: media worker pipeline status callback
  // -------------------------------------------------------------------------
  @Post('worker/upload-status')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async workerStatus(@Body() body: { uploadId: string; status: string; error?: string }) {
    const status = (body.status as UploadStatus) ?? UploadStatus.processing;
    await this.prisma.upload.update({
      where: { id: body.uploadId },
      data: { status, error: body.error },
    });
    return { ok: true };
  }
}
