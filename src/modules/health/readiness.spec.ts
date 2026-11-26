import { checkReadiness } from './readiness';

describe('checkReadiness', () => {
  const expected = ['A1700000000001', 'B1700000000002'];

  it('is ready when every registered migration is applied', async () => {
    await expect(checkReadiness(async () => [{ name: 'A1700000000001' }, { name: 'B1700000000002' }], expected)).resolves.toBe(true);
  });

  it('is not ready when a registered migration is pending', async () => {
    await expect(checkReadiness(async () => [{ name: 'A1700000000001' }], expected)).resolves.toBe(false);
  });

  it('is not ready when the database cannot be queried', async () => {
    await expect(checkReadiness(async () => { throw new Error('connection refused'); }, expected)).resolves.toBe(false);
  });
});
