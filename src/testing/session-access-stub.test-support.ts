import { UnauthorizedException } from '@nestjs/common';

import { AuthSessionsService } from '../modules/auth/auth-sessions.service';

export const syntheticSessionId = '00000000-0000-4000-8000-000000000001';
// Purpose/status/socket unit tests isolate those boundaries. Real session-store
// ownership, rotation/revocation and rollback are tested in auth-sessions.spec.ts.
export function sessionAccessStub(): AuthSessionsService {
  return {
    assertActive: async (principal: Record<string, unknown>) => {
      if (principal.sid !== syntheticSessionId) throw new UnauthorizedException('Invalid session');
    },
    activeKeys: async (principals: Array<Record<string, unknown>>) => new Set(principals.filter(principal => principal.sid === syntheticSessionId)
      .map(principal => `${principal.sid}:${principal.sub}`)),
  } as unknown as AuthSessionsService;
}
