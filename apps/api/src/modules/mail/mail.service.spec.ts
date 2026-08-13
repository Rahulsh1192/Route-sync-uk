import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

/** Minimal stand-in for ConfigService — the real one only ever has `get` called on it. */
function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const message = {
  to: 'learner@example.com',
  subject: 'Confirm your email address',
  html: '<p>hello</p>',
  text: 'hello',
};

const configured = {
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'Test Routify <noreply@send.testroutify.uk>',
};

describe('MailService when no API key is configured', () => {
  it('reports that it is not configured instead of throwing', async () => {
    // Email is optional infrastructure, exactly like Stripe and Sentry. An API that
    // refuses to run because nobody has set up email yet is a worse failure than one
    // that cannot send email.
    const result = await new MailService(configWith({})).send(message);
    expect(result).toEqual({ sent: false, reason: 'not_configured' });
  });

  it('makes no network call at all', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await new MailService(configWith({})).send(message);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('MailService when configured', () => {
  let fetchSpy: jest.SpyInstance;

  const respondWith = (status: number, body: unknown) => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response);
  };

  afterEach(() => jest.restoreAllMocks());

  it('reports the id Resend returned', async () => {
    respondWith(200, { id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c' });
    const result = await new MailService(configWith(configured)).send(message);
    expect(result).toEqual({ sent: true, id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c' });
  });

  it('posts to the Resend send endpoint', async () => {
    respondWith(200, { id: 'x' });
    await new MailService(configWith(configured)).send(message);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('authenticates with the API key as a bearer token', async () => {
    respondWith(200, { id: 'x' });
    await new MailService(configWith(configured)).send(message);
    const headers = fetchSpy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends the from address, recipient, subject and both bodies', async () => {
    respondWith(200, { id: 'x' });
    await new MailService(configWith(configured)).send(message);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      from: 'Test Routify <noreply@send.testroutify.uk>',
      to: ['learner@example.com'],
      subject: 'Confirm your email address',
      html: '<p>hello</p>',
      text: 'hello',
    });
  });

  it('reports rejection without throwing when Resend refuses the message', async () => {
    // 403 is what an unverified domain returns. A signup must not 500 because of it.
    respondWith(403, { message: 'The domain is not verified' });
    const result = await new MailService(configWith(configured)).send(message);
    expect(result).toMatchObject({ sent: false, reason: 'rejected' });
  });

  it('reports failure without throwing when the network call itself fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await new MailService(configWith(configured)).send(message);
    expect(result).toMatchObject({ sent: false, reason: 'error' });
  });

  it('treats a missing MAIL_FROM as not configured, rather than sending from nowhere', async () => {
    const fetchSpy2 = jest.spyOn(global, 'fetch');
    const result = await new MailService(
      configWith({ RESEND_API_KEY: 're_test_key' }),
    ).send(message);
    expect(result).toEqual({ sent: false, reason: 'not_configured' });
    expect(fetchSpy2).not.toHaveBeenCalled();
  });
});

describe('MailService.isConfigured', () => {
  it('is false with no key and true with both settings present', () => {
    expect(new MailService(configWith({})).isConfigured()).toBe(false);
    expect(new MailService(configWith(configured)).isConfigured()).toBe(true);
  });
});
