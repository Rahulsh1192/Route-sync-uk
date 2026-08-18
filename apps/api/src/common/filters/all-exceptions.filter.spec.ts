import { ArgumentsHost, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Drive the filter with a fake host and hand back the status and JSON body it produced. */
function invoke(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/api/auth/login' }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  it('forwards a machine-readable code from an object payload', () => {
    const { status, body } = invoke(
      new ForbiddenException({ message: 'Confirm your email address', code: 'email_not_verified' }),
    );

    expect(status).toBe(403);
    expect(body.code).toBe('email_not_verified');
    expect(body.title).toBe('Confirm your email address');
  });

  it('omits code when the exception carries only a message', () => {
    const { body } = invoke(new UnauthorizedException('Invalid credentials'));

    expect(body.code).toBeUndefined();
    expect(body.title).toBe('Invalid credentials');
  });
});
