import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/** RFC-7807-ish problem+json error envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url}`, (exception as Error)?.stack);
    }

    res.status(status).json({
      type: 'about:blank',
      status,
      title: typeof payload === 'string' ? payload : (payload as any).message ?? 'Error',
      detail: typeof payload === 'object' ? (payload as any).message : undefined,
      // A stable identifier for the *reason*, for the cases where a client has to branch on
      // it — an unverified email at sign-in needs a different screen from bad credentials,
      // and matching on prose would break the first time the wording changed. Absent unless
      // a thrower opts in, so no existing response changes shape.
      code: typeof payload === 'object' ? (payload as any).code : undefined,
      instance: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
