import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// Wrap all successful responses in the standard envelope
// { status: 'success', message: 'OK', data: <original> }
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
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

