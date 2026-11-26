/** Only fixed operation labels and bounded error classes belong in application logs.
 * Never pass errors, request data, provider bodies or stack traces to the logger.
 */
export function safeErrorClass(error: unknown): string {
  if (error instanceof TypeError) return 'TypeError';
  if (error instanceof RangeError) return 'RangeError';
  if (error instanceof SyntaxError) return 'SyntaxError';
  return error instanceof Error ? 'Error' : 'UnknownError';
}
export function safeFailure(operation: string, error: unknown) {
  return { operation, errorClass: safeErrorClass(error) };
}

export function releaseLogFields(): { release?: string } {
  const release = process.env.APP_RELEASE_SHA || process.env.RAILWAY_GIT_COMMIT_SHA;
  return release && /^[0-9a-f]{40}$/i.test(release) ? { release } : {};
}
