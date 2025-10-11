import { RoleCode } from './role.entity';

// Normalize a single raw role string to a canonical code
function canonicalize(raw: string): string {
  const code = String(raw || '').trim().toLowerCase();
  if (!code) return '';
  // Accept 'donor' as an alias of 'customer'
  if (code === 'donor') return RoleCode.CUSTOMER;
  return code;
}

// Expand aliases so that 'customer' and 'collector' are treated equivalently
function expandAliases(codes: string[]): string[] {
  const s = new Set<string>(codes);
  // Treat customer as donor/collector and vice versa
  if (s.has(RoleCode.CUSTOMER)) s.add(RoleCode.COLLECTOR);
  if (s.has(RoleCode.COLLECTOR)) s.add(RoleCode.CUSTOMER);
  return Array.from(s);
}

export function extractRoleCodes(payload: any): string[] {
  if (!payload) {
    return [];
  }
  const roles: any[] = Array.isArray(payload?.roles) ? payload.roles : [];
  const normalized: string[] = [];
  for (const raw of roles) {
    if (!raw) continue;
    if (typeof raw === 'string') {
      normalized.push(canonicalize(raw));
      continue;
    }
    if (typeof raw === 'object' && typeof raw.code === 'string') {
      normalized.push(canonicalize(raw.code));
      continue;
    }
    normalized.push(canonicalize(String(raw)));
  }
  return expandAliases(normalized.filter(Boolean));
}

export function userHasRole(payload: any, role: RoleCode): boolean {
  const roles = extractRoleCodes(payload);
  return roles.includes(role);
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

// Used at input boundaries (e.g., registration) to accept aliases
export function normalizeIncomingRole(input?: any): RoleCode {
  const raw = typeof input === 'string' ? input : String(input ?? '');
  const code = canonicalize(raw);
  switch (code) {
    case RoleCode.CUSTOMER:
      return RoleCode.CUSTOMER;
    case RoleCode.COLLECTOR:
      return RoleCode.COLLECTOR;
    case RoleCode.FACILITY:
      return RoleCode.FACILITY;
    case RoleCode.ADMIN:
      return RoleCode.ADMIN;
    case RoleCode.FINANCE:
      return RoleCode.FINANCE;
    case RoleCode.PARTNER:
      return RoleCode.PARTNER;
    default:
      // Default to 'customer' for unknown or empty inputs
      return RoleCode.CUSTOMER;
  }
}
