import { EmailService } from './email.service';

describe('EmailService provider outcomes', () => {
  const params = { to: 'fixture@example.invalid', subject: 'Verify your email', html: '<p>Fixture</p>' };
  const originalEnvironment = process.env;
  let provider: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnvironment, BREVO_API_KEY: 'fixture', RESEND_API_KEY: 'fixture' };
    provider = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    process.env = originalEnvironment;
  });

  it('reports provider acceptance without sending a duplicate', async () => {
    provider.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(new EmailService().sendEmail(params)).resolves.toEqual({ status: 'accepted' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('uses the backup provider after a definitive configuration rejection', async () => {
    provider
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(new EmailService().sendEmail(params)).resolves.toEqual({ status: 'accepted' });
    expect(provider.mock.calls.map(([url]) => new URL(String(url)).hostname))
      .toEqual(['api.brevo.com', 'api.resend.com']);
  });

  it('does not retry an ambiguous provider failure through the backup', async () => {
    provider.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(new EmailService().sendEmail(params)).resolves.toEqual({ status: 'failed' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('returns a timeout and aborts a stalled provider request', async () => {
    jest.useFakeTimers();
    provider.mockReturnValueOnce(new Promise(() => {}));
    const delivery = new EmailService().sendEmail(params);
    await jest.advanceTimersByTimeAsync(10000);
    await expect(delivery).resolves.toEqual({ status: 'timeout' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
