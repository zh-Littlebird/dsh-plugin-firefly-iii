/** Credential resolution: stored record first, then explicit environment fallback. */
import { FireflyError } from './errors.js';

export const CREDENTIAL_KEY = 'firefly-iii/default';
export const TOKEN_ENV = 'FIREFLY_III_ACCESS_TOKEN';

/** Read the token without ever logging or returning it to a model-facing surface. */
export async function resolveToken(ctx) {
  const credentials = ctx.get('credentials');
  if (credentials) {
    const record = await credentials.readRecord(CREDENTIAL_KEY);
    if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key.trim() !== '') {
      return { token: record.key.trim(), source: 'credentials' };
    }
  }
  const envToken = process.env[TOKEN_ENV];
  if (typeof envToken === 'string' && envToken.trim() !== '') {
    return { token: envToken.trim(), source: 'environment' };
  }
  throw new FireflyError(
    'AUTH_NOT_CONFIGURED',
    `No Firefly III token is configured. Run /firefly-token <token>, or set ${TOKEN_ENV} for this process. Obtain a token in Firefly III under Profile → OAuth → Personal Access Tokens.`,
  );
}

export async function saveToken(ctx, token) {
  const credentials = ctx.get('credentials');
  if (!credentials) throw new FireflyError('CREDENTIALS_UNAVAILABLE', 'The credentials service is unavailable in this profile.');
  const value = String(token ?? '').trim();
  if (value.length < 20) {
    throw new FireflyError('INVALID_TOKEN', 'The token looks too short; Firefly III personal access tokens are long JWT strings.');
  }
  await credentials.modifyRecord(CREDENTIAL_KEY, async (current) => ({
    kind: 'api-key',
    key: value,
    ...(current?.kind === 'api-key' && current.env ? { env: current.env } : {}),
  }));
}

export async function tokenStatus(ctx) {
  const credentials = ctx.get('credentials');
  const record = credentials ? await credentials.readRecord(CREDENTIAL_KEY) : undefined;
  const stored = record?.kind === 'api-key' && typeof record.key === 'string' && record.key.trim() !== '';
  const env = typeof process.env[TOKEN_ENV] === 'string' && process.env[TOKEN_ENV].trim() !== '';
  return { stored, environment: env, configured: stored || env };
}

export async function clearToken(ctx) {
  const credentials = ctx.get('credentials');
  if (!credentials) throw new FireflyError('CREDENTIALS_UNAVAILABLE', 'The credentials service is unavailable in this profile.');
  await credentials.deleteRecord(CREDENTIAL_KEY);
}
