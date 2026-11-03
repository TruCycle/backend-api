import { Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { Item, ItemPickupOption, ItemStatus } from '../items/item.entity';
import { Shop } from '../shops/shop.entity';

import { EmailService } from './email.service';
import { NearbyItemsAlertService } from './nearby-items-alert.service';
describe('Nearby email output and targeting privacy', () => {
  let logs: jest.SpyInstance[];
  let originalEnvironment: NodeJS.ProcessEnv;
  beforeEach(() => { originalEnvironment = { ...process.env }; delete process.env.FRONTEND_BASE_URL; logs = ['error', 'debug', 'log'].map((level) => jest.spyOn(Logger.prototype, level as 'error').mockImplementation(() => undefined)); });
  afterEach(() => { process.env = originalEnvironment; jest.restoreAllMocks(); });
  function fixture(kind: 'donation' | 'exchange', latitude: number | null = 51.50123, longitude: number | null = -0.12345, shopLatitude = 53.52345, shopLongitude = -2.10345) {
    const item = { id: 'item', donor: { id: 'donor' }, pickupOption: kind === 'donation' ? ItemPickupOption.DONATE : ItemPickupOption.EXCHANGE,
      status: ItemStatus.ACTIVE, dropoffLocationId: 'shop', latitude, longitude, postcode: 'E16 2RD', addressLine: 'PRIVATE_DONOR_ADDRESS', title: 'Chair', category: 'Furniture' };
    const query = jest.fn().mockResolvedValue([{ id: 'recipient', email: 'private-recipient@example.invalid' }]);
    const sendEmail = jest.fn().mockResolvedValue({ status: 'accepted' });
    const service = new NearbyItemsAlertService({ query } as unknown as DataSource, { findOne: jest.fn().mockResolvedValue(item) } as unknown as Repository<Item>,
      { findOne: jest.fn().mockResolvedValue({ name: 'PRIVATE_SHOP', addressLine: 'PRIVATE_SHOP_ADDRESS', postcode: 'W1A 1AA', latitude: latitude === null ? null : shopLatitude, longitude: longitude === null ? null : shopLongitude }) } as unknown as Repository<Shop>, { sendEmail } as unknown as EmailService);
    const run = () => kind === 'donation' ? service.sendNearbyItemDropoffEmails('item') : service.sendNearbyItemExchangeEmails('item');
    return { query, sendEmail, run };
  }
  it.each(['donation', 'exchange'] as const)('targets %s from public cell and sends outward area only', async (kind) => {
    const value = fixture(kind);
    expect(await value.run()).toBe(1);
    expect(value.query.mock.calls[0][0]).toContain(kind === 'donation' ? 'ST_MakePoint(-2.11, 53.53)' : 'ST_MakePoint(-0.13, 51.51)');
    const payload = value.sendEmail.mock.calls[0][0];
    expect(payload.to).toBe('private-recipient@example.invalid');
    expect(payload.html).toContain(`Approximate area: <strong>${kind === 'donation' ? 'W1A' : 'E16'}</strong>`);
    expect(JSON.stringify(payload)).not.toMatch(/PRIVATE_|2RD|1AA|51.50123|-0.12345|53.52345|-2.10345/);
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toContain('private-recipient');
  });
  it.each(['donation', 'exchange'] as const)('keeps same-cell %s audience query invariant', async (kind) => {
    const first = fixture(kind); const second = fixture(kind, 51.50999, -0.12001, 53.52999, -2.10001);
    await first.run(); await second.run();
    expect(first.query.mock.calls).toEqual(second.query.mock.calls);
  });
  it.each(['donation', 'exchange'] as const)('uses the frontend item route for %s instead of the API host', async kind => {
    process.env.APP_BASE_URL = 'https://api.example.invalid'; const value = fixture(kind); await value.run();
    expect(value.sendEmail.mock.calls[0][0].html).toContain('https://trucycle.co.uk/items/item');
    expect(value.sendEmail.mock.calls[0][0].html).not.toContain('https://api.example.invalid');
  });
  it.each(['donation', 'exchange'] as const)('uses an isolated configured frontend origin for %s', async kind => {
    process.env.FRONTEND_BASE_URL = 'https://staging.example.invalid/ignored?token=PRIVATE_TOKEN';
    const value = fixture(kind); await value.run();
    expect(value.sendEmail.mock.calls[0][0].html).toContain('https://staging.example.invalid/items/item');
    expect(value.sendEmail.mock.calls[0][0].html).not.toMatch(/PRIVATE_TOKEN|ignored/);
  });
  it.each(['javascript:alert(1)', 'http://public.example.invalid', 'https://user:password@example.invalid'])('does not send a link from invalid frontend configuration %s', async configured => {
    process.env.FRONTEND_BASE_URL = configured; const value = fixture('exchange');
    expect(await value.run()).toBe(0); expect(value.sendEmail).not.toHaveBeenCalled();
  });
  it.each(['donation', 'exchange'] as const)('does not fabricate %s point from null coordinates', async (kind) => {
    const value = fixture(kind, null, null);
    expect(await value.run()).toBe(0); expect(value.query).not.toHaveBeenCalled(); expect(value.sendEmail).not.toHaveBeenCalled();
  });
  it.each(['donation', 'exchange'] as const)('contains late %s recipient/provider failures', async (kind) => {
    const value = fixture(kind);
    value.query.mockResolvedValue([{ email: 'private-recipient@example.invalid' }, { email: 'next@example.invalid' }]);
    value.sendEmail.mockRejectedValueOnce(new Error('TOKEN ADDRESS private-recipient@example.invalid https://private.invalid')).mockResolvedValueOnce({ status: 'accepted' });
    expect(await value.run()).toBe(1); expect(value.sendEmail).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toMatch(/TOKEN|ADDRESS|private-recipient|private.invalid/);
    value.query.mockRejectedValueOnce(new Error('SQL PRIVATE_ADDRESS TOKEN'));
    expect(await value.run()).toBe(0);
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toMatch(/SQL|PRIVATE_ADDRESS|TOKEN/);
  });
  it.each(['unavailable', 'rejected', 'timeout', 'failed'])('does not count %s as an accepted nearby email', async status => {
    const value = fixture('exchange'); value.sendEmail.mockResolvedValue({ status });
    expect(await value.run()).toBe(0); expect(value.sendEmail).toHaveBeenCalledTimes(1);
  });
});
describe('Email provider failure containment without provider access', () => {
  let originalEnvironment: NodeJS.ProcessEnv;
  let log: jest.SpyInstance;
  beforeEach(() => { originalEnvironment = { ...process.env }; delete process.env.BREVO_API_KEY; delete process.env.RESEND_API_KEY;
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });
  afterEach(() => { process.env = originalEnvironment; jest.restoreAllMocks(); });
  it.each(['brevo', 'resend'] as const)('does not inspect or log %s response body/status text', async (provider) => {
    process.env[provider === 'brevo' ? 'BREVO_API_KEY' : 'RESEND_API_KEY'] = 'SYNTHETIC_KEY';
    const text = jest.fn().mockResolvedValue('PRIVATE_ADDRESS TOKEN recipient@example.invalid');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 429, statusText: 'PRIVATE_STATUS', text } as unknown as Response);
    await new EmailService().sendEmail({ to: 'recipient@example.invalid', subject: 'Chair', html: '<p>Approximate area E16</p>' });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(text).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({ operation: 'email_delivery', provider, status: 429 });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|TOKEN|recipient|SYNTHETIC/);
  });
  it('contains asynchronous network exception values and stack without changing no-throw delivery contract', async () => {
    process.env.BREVO_API_KEY = 'SYNTHETIC_KEY'; process.env.RESEND_API_KEY = 'SYNTHETIC_FALLBACK';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('PRIVATE_BODY TOKEN https://private.invalid'));
    await expect(new EmailService().sendEmail({ to: 'recipient@example.invalid', subject: 'Chair', html: '<p>Area</p>' })).resolves.toEqual({ status: 'failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|TOKEN|private.invalid|recipient|SYNTHETIC/);
  });
});
