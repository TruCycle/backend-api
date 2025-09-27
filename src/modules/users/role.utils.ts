import { RoleCode } from './role.entity';

export function extractRoleCodes(payload: any): string[] {
  if (!payload) {
    return [];
  }
  const roles: any[] = Array.isArray(payload?.roles) ? payload.roles : [];
  const normalized: string[] = [];
  for (const raw of roles) {
    if (!raw) continue;
    if (typeof raw === 'string') {
      normalized.push(raw.toLowerCase());
      continue;
    }
    if (typeof raw === 'object' && typeof raw.code === 'string') {
      normalized.push(raw.code.toLowerCase());
      continue;
    }
    normalized.push(String(raw).toLowerCase());
  }
  return normalized;
}

export function userHasRole(payload: any, role: RoleCode): boolean {
  return extractRoleCodes(payload).includes(role);
}

export function userHasAnyRole(payload: any, roles: readonly RoleCode[]): boolean {
  if (!roles.length) {
    return false;
  }
  const normalized = extractRoleCodes(payload);
  for (const role of roles) {
    if (normalized.includes(role)) {
      return true;
    }
  }
  return false;
}
