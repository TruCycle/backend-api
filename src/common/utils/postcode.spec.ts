import { normalizePostcode, resolveOutwardPostcode } from './postcode';

describe('Outward postcode public projection', () => {
  const examples = [
    ['M2', '5BQ'], ['M34', '3AB'], ['DN5', '7XY'], ['DN16', '9AA'],
    ['W1A', '4WW'], ['EC1A', '1HQ'], ['SW1A', '1AA'], ['E16', '2RD'],
    ['GIR', '0AA'], ['BF1', '0AA'], ['JE2', '3QQ'], ['IM1', '1AE'],
  ];

  it.each(examples)('projects spaced %s %s to its outward code', (outward, inward) => {
    expect(resolveOutwardPostcode(`${outward} ${inward}`)).toBe(outward);
  });

  it.each(examples)('never returns the compact inward component of %s%s', (outward, inward) => {
    const result = resolveOutwardPostcode(`${outward}${inward}`);
    expect(result).toBe(outward);
    expect(result).not.toContain(inward);
  });

  it.each(examples)('retains an already outward-only %s', (outward) => {
    expect(resolveOutwardPostcode(outward)).toBe(outward);
  });

  it.each([
    ['  sw1a1aa  ', 'SW1A'], [' ec1a   1hq ', 'EC1A'], ['e16\t2rd', 'E16'],
    ['dn16\n9aa', 'DN16'], ['\tm2\n', 'M2'],
  ])('normalises casing and separator whitespace in %j', (input, expected) => {
    expect(resolveOutwardPostcode(input)).toBe(expected);
  });

  it.each([
    undefined, null, '', ' ', 'Unknown location', '34 Abbey Road', 'E16 2RD London',
    'E162RDLondon', 'E16 2', 'E16 2R', 'E16-2RD', 'E16/2RD', 'E16 2RD; DROP TABLE user',
    'SW 1A 1AA', 'S W1A1AA', 'London E16', '12345', 'ABCDE', 'SW1A1AA\u200b',
    '<img src=x>', 'E16\u00002RD', 'E16 2RD 3AB', 'E16 2RD\n34 Abbey Road',
  ])('fails closed for unsupported or malformed input %j', (input) => {
    expect(resolveOutwardPostcode(input)).toBeNull();
  });

  it('does not throw or echo malformed persisted non-string values', () => {
    for (const value of [12, {}, [], true]) {
      expect(resolveOutwardPostcode(value as unknown as string)).toBeNull();
    }
  });

  it('leaves full-postcode storage normalization unchanged', () => {
    expect(normalizePostcode('  sw1a  1aa ')).toBe('SW1A 1AA');
    expect(normalizePostcode('sw1a1aa')).toBe('SW1A1AA');
  });
});
