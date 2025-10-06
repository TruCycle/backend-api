import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { SKIP_RESPONSE_ENVELOPE_KEY } from '../decorators/skip-response-envelope.decorator';

// Wrap all successful responses in the standard envelope
// { status: 'success', message: 'OK', data: <original> }
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const res: any = http.getResponse?.() ?? null;
    const shouldSkip = this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (shouldSkip) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // Avoid wrapping 204 No Content responses
        const statusCode = res?.statusCode;
        if (statusCode === 204) {
          return undefined;
        }
        // If handler already returned a standard envelope, pass it through
        if (data && typeof data === 'object' && 'status' in data && 'data' in data) {
          return data;
        }
        const message = data && typeof data === 'object' && 'message' in data ? (data as any).message : 'OK';
        const payload = data && typeof data === 'object' && 'data' in data ? (data as any).data : data;
        return {
          status: 'success',
          message,
          data: payload ?? null,
        };
      }),
    );
  }
}

