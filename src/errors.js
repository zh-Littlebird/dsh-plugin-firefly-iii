/** Structured plugin failure used across tools. */
export class FireflyError extends Error {
  constructor(code, message, details) {
    const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`;
    super(`[${code}] ${message}${suffix}`);
    this.name = 'FireflyError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new FireflyError(code, message, details);
}

export function asFireflyError(error) {
  if (error instanceof FireflyError) return error;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return new FireflyError('ABORTED', 'The request was cancelled.');
    return new FireflyError('UNEXPECTED', error.message || String(error));
  }
  return new FireflyError('UNEXPECTED', String(error));
}
