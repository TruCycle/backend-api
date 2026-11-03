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
