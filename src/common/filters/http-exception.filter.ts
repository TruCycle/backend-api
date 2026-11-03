import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

import { safeFailure } from '../utils/safe-log';

// Standardized error response format
// { status: 'error', message: string, data: null }
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      if (statusCode >= 500) {
        this.logger.error({ ...safeFailure('http_request', exception), status: statusCode });
        res.status(statusCode).json({ status: 'error', message: 'An unexpected error occurred', data: null });
        return;
      }
      const payload = exception.getResponse() as { message?: string | string[] } | string;
      const message =
        typeof payload === 'string'
          ? payload
          : payload?.message || exception.message || 'Request failed';

      res.status(statusCode).json({ status: 'error', message, data: null });
      return;
    }

    // Fallback 500
    this.logger.error({ ...safeFailure('http_request', exception), status: HttpStatus.INTERNAL_SERVER_ERROR });
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ status: 'error', message: 'An unexpected error occurred', data: null });
  }
}
