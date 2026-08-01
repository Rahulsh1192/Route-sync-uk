import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Guards internal service-to-service endpoints the media worker calls (Phase 24).
 *
 * The worker has no user session, so it authenticates with a shared secret in
 * `x-worker-secret`. Two deliberate choices:
 *
 *  * When `WORKER_SHARED_SECRET` is unset the route is CLOSED, not open. An
 *    internal endpoint that silently accepts anonymous callers because someone
 *    forgot an env var is a much worse failure than a broken pipeline stage — the
 *    503 is loud and points straight at the missing config.
 *  * Comparison is constant-time over SHA-256 digests, so the check leaks neither
 *    the secret's length nor a prefix through timing.
 */
@Injectable()
export class WorkerSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.config.get<string>('WORKER_SHARED_SECRET');
    if (!expected) {
      throw new ServiceUnavailableException('Internal worker API is not configured');
    }

    const req = ctx.switchToHttp().getRequest();
    const provided = req.headers['x-worker-secret'];
    if (typeof provided !== 'string' || provided.length === 0) {
      throw new ForbiddenException('Missing worker credentials');
    }

    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(expected).digest();
    if (!timingSafeEqual(a, b)) throw new ForbiddenException('Invalid worker credentials');

    return true;
  }
}
