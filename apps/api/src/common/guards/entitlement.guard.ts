import { CanActivate, ExecutionContext, Injectable, SetMetadata, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service';

export const REQUIRE_PREMIUM = 'require_premium';
/** Decorate a route to gate it behind an active premium subscription. */
export const RequirePremium = () => SetMetadata(REQUIRE_PREMIUM, true);

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private subscriptions: SubscriptionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_PREMIUM, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const { user } = ctx.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Authentication required');

    const isPremium = await this.subscriptions.isPremium(user.id);
    if (!isPremium) {
      throw new ForbiddenException('Premium subscription required');
    }
    return true;
  }
}
