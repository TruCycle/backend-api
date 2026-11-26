import { Co2EstimationService } from './co2-estimation.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemDto } from './dto/create-item.dto';

describe('Listing measurements contract', () => {
  const listing = { title: 'Chair', condition: 'good', category: 'furniture',
    address_line: 'Synthetic address', postcode: 'E16 2RD', pickup_option: 'exchange' };
  it('accepts unknown measurements without inventing activity values', async () => {
    const dto = plainToInstance(CreateItemDto, listing);
    expect(await validate(dto)).toEqual([]);
    for (const key of ['sizeUnit', 'sizeLength', 'sizeBreadth', 'sizeHeight', 'weightKg'] as const) expect(dto[key]).toBeUndefined();
    expect(await new Co2EstimationService().estimateSavedCo2Kg(dto)).toBeNull();
  });
  it.each(['size_length', 'size_breadth', 'size_height', 'weight_kg'])('still rejects invalid declared %s', async key => {
    expect((await validate(plainToInstance(CreateItemDto, { ...listing, [key]: -1 }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CreateItemDto, { ...listing, [key]: 'unknown' }))).length).toBeGreaterThan(0);
  });
  it('preserves genuinely supplied measurements', async () => {
    const dto = plainToInstance(CreateItemDto, { ...listing, size_unit: 'm', size_length: 2, size_breadth: 1, size_height: 0.5, weight_kg: 7 });
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ sizeUnit: 'm', sizeLength: 2, sizeBreadth: 1, sizeHeight: 0.5, weightKg: 7 });
  });
});

describe('Avoided emissions estimation boundary', () => {
  const fetchMock = jest.fn();
  const configured = () => new Co2EstimationService();
  beforeEach(() => {
    process.env.CLIMATIQ_API_KEY = 'synthetic-key';
    process.env.CLIMATIQ_EMISSION_FACTOR_ID = 'synthetic-factor';
    process.env.CLIMATIQ_API_URL = 'https://api.example.test/estimate';
    process.env.CO2_AVOIDED_METHOD_REFERENCE = 'synthetic-reviewed-method-v1';
    global.fetch = fetchMock;
    fetchMock.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });
  it.each(['CLIMATIQ_API_KEY', 'CLIMATIQ_EMISSION_FACTOR_ID', 'CLIMATIQ_API_URL', 'CO2_AVOIDED_METHOD_REFERENCE'])('does not invent missing %s', async key => {
    delete process.env[key];
    expect(await configured().estimateSavedCo2Kg({ weightKg: 1 })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{}, {weightKg: -1}, {weightKg: 0}, {weightKg: NaN}, {sizeUnit:'unknown',sizeLength:1,sizeBreadth:1,sizeHeight:1}])('requires positive supported activity %j', async input => {
    expect(await configured().estimateSavedCo2Kg(input as never)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([[1000,'g',1],[1,'kg',1],[1,'t',1000],[0,'kg',0],[-1,'kg',null],['1','kg',null],[1,'lb',null],[1,undefined,null],[Infinity,'kg',null]])('validates value/unit %s/%s', async (co2e, co2e_unit, expected) => {
    fetchMock.mockResolvedValue({ok:true,json:async()=>({co2e,co2e_unit})});
    expect(await configured().estimateSavedCo2Kg({weightKg:1})).toBe(expected);
  });
  it('converts dimensions without fabricating weight and blocks redirects', async () => {
    fetchMock.mockResolvedValue({ok:true,json:async()=>({co2e:1,co2e_unit:'kg'})});
    await configured().estimateSavedCo2Kg({sizeUnit:'inch',sizeLength:1,sizeBreadth:1,sizeHeight:1});
    const [, request] = fetchMock.mock.calls[0];
    expect(request.redirect).toBe('error');
    expect(JSON.parse(request.body).parameters).toEqual({volume:0.0254**3,volume_unit:'m3'});
  });
  it.each(['fetch','body'])('bounds %s even when provider ignores abort', async part => {
    jest.useFakeTimers();
    fetchMock.mockReturnValue(part === 'fetch' ? new Promise(()=>undefined) : Promise.resolve({ok:true,json:()=>new Promise(()=>undefined)}));
    const result = configured().estimateSavedCo2Kg({weightKg:1});
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await result).toBeNull();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('does not read an error body or retry', async () => {
    const json=jest.fn();fetchMock.mockResolvedValue({ok:false,status:429,json});
    expect(await configured().estimateSavedCo2Kg({weightKg:1})).toBeNull();
    expect(json).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
