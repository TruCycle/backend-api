import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SearchItemsDto } from './search-items.dto';

describe('Actual search DTO transforms and validation', () => {
  it('accepts absent origins for catalogue browsing', async () => {
    const dto = plainToInstance(SearchItemsDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.lat).toBeUndefined();
    expect(dto.lng).toBeUndefined();
  });
  it.each(['nonsense', '', ' ', 'Infinity', 'NaN', '0x10', '0b10', [], {}, null])('rejects supplied malformed latitude %j instead of dropping it', async (value) => {
    const dto = plainToInstance(SearchItemsDto, { lat: value });
    expect(dto.lat).not.toBeUndefined();
    expect((await validate(dto)).map((error) => error.property)).toContain('lat');
  });
  it.each(['nonsense', '', 'Infinity', '181'])('rejects malformed longitude %j', async (value) => {
    expect((await validate(plainToInstance(SearchItemsDto, { lng: value }))).map((error) => error.property)).toContain('lng');
  });
  it('converts valid query strings without rounding fractional page inputs', async () => {
    const dto = plainToInstance(SearchItemsDto, { lat: '51.5', lng: '-0.06', radius: '7', postcode: ' e16 2rd ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ lat: 51.5, lng: -0.06, radius: 7, postcode: 'E16 2RD' });
    expect((await validate(plainToInstance(SearchItemsDto, { page: '1.5' }))).map((error) => error.property)).toContain('page');
  });
});
