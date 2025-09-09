import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

// Standardized error response format
// { status: 'error', message: string, data: null }
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse() as any;
      const message =
        typeof payload === 'string'
          ? payload
          : payload?.message || exception.message || 'Request failed';

      res.status(statusCode).json({ status: 'error', message, data: null });
      return;
    }

    // Fallback 500
    // eslint-disable-next-line no-console
    console.error('Unhandled error', exception);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ status: 'error', message: 'An unexpected error occurred', data: null });
  }
}
