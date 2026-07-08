import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { SubscriptionsService } from './subscriptions.service';
import { StripeService } from './stripe.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class CheckoutDto {
  @IsIn(['premium_monthly', 'premium_yearly'])
  plan!: 'premium_monthly' | 'premium_yearly';
}

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subs: SubscriptionsService,
    private readonly stripe: StripeService,
  ) {}

  @Get('plans')
  plans() {
    return this.subs.plans();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return this.subs.mySubscription(user.id);
  }

  /** Web checkout. Mobile clients use RevenueCat IAP instead of this endpoint. */
  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.stripe.createCheckoutSession(user.id, dto.plan);
  }
}
