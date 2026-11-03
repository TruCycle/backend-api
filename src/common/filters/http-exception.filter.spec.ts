import { ArgumentsHost, BadRequestException, HttpException, Logger } from '@nestjs/common';

import { HttpExceptionFilter } from './http-exception.filter';
describe('HTTP failure privacy boundary', () => {
  let log: jest.SpyInstance;
  beforeEach(() => { log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });
  afterEach(() => jest.restoreAllMocks());
  function catchError(error: unknown) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(error, host);
    return res;
  }
  it.each([new Error('SQL SECRET address token'), new HttpException({ message: 'PROVIDER_EMAIL_SECRET', stack: 'PRIVATE_STACK' }, 503), { headers: { authorization: 'TOKEN' }, body: 'MESSAGE' }])('sanitizes server failures %#', (error) => {
    const res = catchError(error);
    expect(res.status).toHaveBeenCalledWith(error instanceof HttpException ? 503 : 500);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: 'An unexpected error occurred', data: null });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|PRIVATE|TOKEN|MESSAGE|SQL/);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ operation: 'http_request', errorClass: expect.any(String), status: expect.any(Number) }));
  });
  it('preserves expected validation arrays', () => {
    const res = catchError(new BadRequestException(['postcode must be valid', 'title is required']));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'error', message: ['postcode must be valid', 'title is required'], data: null });
    expect(log).not.toHaveBeenCalled();
  });
  it('preserves explicit client string messages', () => {
    expect(catchError(new HttpException('Not found', 404)).json).toHaveBeenCalledWith({ status: 'error', message: 'Not found', data: null });
  });
});
