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
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
    return { received: true };
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
          currentPeriodEnd: expiresMs ? new Date(Number(expiresMs)) : undefined,
        });
        break;
      case 'CANCELLATION':
      case 'EXPIRATION':
        await this.subs.applyEntitlement({
          userId,
          plan: 'free',
          status: SubscriptionStatus.canceled,
          source,
          externalId: ev.transaction_id,
        });
        break;
      case 'BILLING_ISSUE':
        await this.subs.applyEntitlement({
          userId,
          plan,
          status: SubscriptionStatus.past_due,
          source,
          externalId: ev.transaction_id,
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
