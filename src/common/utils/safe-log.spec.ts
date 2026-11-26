import { safeFailure } from './safe-log';
describe('Bounded failure telemetry', () => {
  it.each([new Error('TOKEN address email'), Object.assign(new Error('SECRET'), { name: 'PRIVATE_NAME', stack: 'PRIVATE_STACK' }), { message: 'SECRET' }, 'SECRET', null])('omits arbitrary error data %#', (error) => {
    expect(safeFailure('test_operation', error)).toEqual({ operation: 'test_operation', errorClass: error instanceof Error ? 'Error' : 'UnknownError' });
  });
  it.each([new TypeError('SECRET'), new RangeError('SECRET'), new SyntaxError('SECRET')])('retains only standard class %#', (error) => {
    expect(safeFailure('test_operation', error)).toEqual({ operation: 'test_operation', errorClass: error.constructor.name });
  });
});
