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

  it('does not overwrite explicit details with the free-text reason', async () => {
    const { dto } = await parse({ reason: 'Took it', details: 'Seen at 9am' });
    expect(dto).toMatchObject({ reason: 'other', details: 'Seen at 9am' });
  });

  it('still rejects a missing or blank reason', async () => {
    expect((await parse({})).errors).not.toHaveLength(0);
    expect((await parse({ reason: '   ' })).errors).not.toHaveLength(0);
  });
});
