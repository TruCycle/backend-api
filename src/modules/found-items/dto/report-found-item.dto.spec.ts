import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReportFoundItemDto } from './report-found-item.dto';

async function parse(body: Record<string, unknown>) {
  const dto = plainToInstance(ReportFoundItemDto, body);
  return { dto, errors: await validate(dto) };
}

describe('ReportFoundItemDto reason compatibility', () => {
  it('keeps a known reason and its details', async () => {
    const { dto, errors } = await parse({ reason: ' unsafe ', details: ' broken glass ' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ reason: 'unsafe', details: 'broken glass' });
  });

  it('files free-text reasons from older clients under other and preserves the text', async () => {
    const { dto, errors } = await parse({ reason: 'Someone already took it' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ reason: 'other', details: 'Someone already took it' });
  });

  it('keeps both the free-text reason and explicit details', async () => {
    const { dto, errors } = await parse({ reason: 'Blocking the pavement', details: 'Next to the bus stop' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ reason: 'other', details: 'Blocking the pavement — Next to the bus stop' });
  });

  it('caps combined details at the details limit', async () => {
    const { dto, errors } = await parse({ reason: 'x'.repeat(100), details: 'y'.repeat(1000) });
    expect(errors).toHaveLength(0);
    expect(dto.details).toHaveLength(1000);
  });

  it('still rejects a missing or blank reason', async () => {
    expect((await parse({})).errors).not.toHaveLength(0);
    expect((await parse({ reason: '   ' })).errors).not.toHaveLength(0);
  });
});
