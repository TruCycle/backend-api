/** Human-facing links must not inherit the API origin or URL credentials. */
export function frontendOrigin(environment: NodeJS.ProcessEnv = process.env): string | null {
  let url: URL;
  try { url = new URL(environment.FRONTEND_BASE_URL || 'https://trucycle.co.uk'); }
  catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
  return url.origin;
}
