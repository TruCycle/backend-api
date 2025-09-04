import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = request.headers['x-request-id'] || undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse() as any;
      const message =
        typeof res === 'string' ? res : res?.message || exception.message;
      const code = typeof res === 'object' && res?.code ? res.code : undefined;
      response.status(status).json({
        code: code || 'HTTP_ERROR',
        message,
        details: typeof res === 'object' ? res?.error || res : undefined,
        requestId,
      });
      return;
    }

    // Fallback 500
    // eslint-disable-next-line no-console
    console.error('Unhandled error', exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    });
  }
}

