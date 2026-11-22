/** Minimal Firefly III REST client over the Node/Electron global fetch. */
import { FireflyError } from './errors.js';

const FORBIDDEN_PATH = /(^|\/)(data\/purge|data\/destroy|cron|batch\/finish)(\/|$)/i;

function normalizePath(path) {
  const value = String(path ?? '').replace(/^\/+/, '').replace(/^api\/v1\//, '');
  if (value === '' || FORBIDDEN_PATH.test(value)) {
    throw new FireflyError(
      'ENDPOINT_FORBIDDEN',
      'This endpoint is permanently blocked by the plugin policy (/data/purge, /data/destroy, cron and batch finish are not exposed).',
    );
  }
  return value;
}

function buildQuery(query) {
  const params = new URLSearchParams();
  if (!query) return params;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null || entry === '') continue;
        params.append(key, String(entry));
      }
    } else {
      params.append(key, String(value));
    }
  }
  return params;
}

function parseBody(text) {
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Collapse an HTML error page into one readable line instead of dumping tags. */
function plainMessage(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return '';
  if (raw.startsWith('<')) {
    return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  }
  return raw.slice(0, 500);
}

function errorFromResponse(status, body, text) {
  const bodyMessage = body && typeof body === 'object' && typeof body.message === 'string' ? body.message : '';
  const message = bodyMessage || plainMessage(text) || `HTTP ${status}`;
  const details = body && typeof body === 'object' ? { status, errors: body.errors, exception: body.exception } : { status };

  if (status === 401) {
    // 6.7.9 reports a missing object as 404, so 401 is authentication only.
    return new FireflyError(
      'AUTH_FAILED',
      `${message} Firefly III returns 401 when the personal access token is missing, invalid or revoked; save a fresh token with /firefly-token.`,
      details,
    );
  }
  if (status === 404) {
    // 6.7.9 answers 404 for both an unknown route and a missing object id.
    return new FireflyError(
      'ENDPOINT_UNAVAILABLE',
      `${message} No object or endpoint matches this request (HTTP 404); confirm the id, and check that the instance exposes the endpoint.`,
      details,
    );
  }
  if (status === 422) {
    return new FireflyError('VALIDATION_FAILED', message, details);
  }
  if (status === 409) {
    return new FireflyError('CONFLICT', message, details);
  }
  if (status === 429) {
    return new FireflyError('RATE_LIMITED', message, details);
  }
  if (status >= 500) {
    return new FireflyError('SERVER_ERROR', message, details);
  }
  return new FireflyError('API_ERROR', message, { status, ...details });
}

function combineSignals(signal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Firefly III request timed out after ${timeoutMs} ms`)), timeoutMs);
  timeout.unref?.();
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export class FireflyClient {
  constructor(config, token, options = {}) {
    this.config = config;
    this.token = token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.basePath = `${config.baseUrl.replace(/\/+$/, '')}/api/v1`;
  }

  url(path, query) {
    const normalized = normalizePath(path);
    const params = buildQuery(query);
    const suffix = params.toString();
    return `${this.basePath}/${normalized}${suffix ? `?${suffix}` : ''}`;
  }

  headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      ...extra,
    };
  }

  async requestRaw(method, path, options = {}) {
    const { query, body, signal, headers, timeoutMs = this.config.requestTimeoutMs } = options;
    const combined = combineSignals(signal, timeoutMs);
    const init = { method, headers: this.headers(headers), signal: combined.signal };
    if (body !== undefined) {
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        init.body = body;
      } else if (typeof body === 'string') {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
    }
    let response;
    const requestUrl = this.url(path, query);
    try {
      response = await this.fetchImpl(requestUrl, init);
    } catch (error) {
      if (combined.signal.aborted) {
        throw new FireflyError('ABORTED', 'The Firefly III request was cancelled or timed out.');
      }
      throw new FireflyError(
        'NETWORK_ERROR',
        `Could not reach ${this.config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      combined.cleanup();
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? '';
    const text = contentType.includes('json') || contentType.startsWith('text/') ? buffer.toString('utf8') : '';
    if (!response.ok) throw errorFromResponse(response.status, parseBody(text), text);
    return { status: response.status, headers: response.headers, buffer, contentType, text };
  }

  async request(method, path, options = {}) {
    const result = await this.requestRaw(method, path, options);
    if (result.status === 204 || result.buffer.length === 0) return undefined;
    if (result.contentType.includes('json')) return parseBody(result.text);
    return result.buffer;
  }

  get(path, query, options = {}) {
    return this.request('GET', path, { ...options, query });
  }

  post(path, body, options = {}) {
    return this.request('POST', path, { ...options, body });
  }

  put(path, body, options = {}) {
    return this.request('PUT', path, { ...options, body });
  }

  delete(path, options = {}) {
    return this.request('DELETE', path, options);
  }

  async about(signal) {
    const payload = await this.get('about', undefined, { signal });
    return payload?.data ?? payload;
  }

  /**
   * Walk pages until exhausted or maxPages is reached.
   * Returns data plus a truncation flag so policy checks never treat a partial
   * catalogue as complete.
   */
  async listAll(path, query = {}, options = {}) {
    const { maxPages = 10, pageSize = 100, signal } = options;
    const data = [];
    let page = 1;
    let totalPages = 1;
    let total = undefined;
    let truncated = false;
    while (page <= maxPages) {
      const payload = await this.get(path, { ...query, page, limit: pageSize }, { signal });
      const batch = Array.isArray(payload?.data) ? payload.data : [];
      data.push(...batch);
      const pagination = payload?.meta?.pagination;
      totalPages = Number(pagination?.total_pages ?? 1) || 1;
      total = Number(pagination?.total ?? pagination?.total_entries ?? data.length);
      if (page >= totalPages) break;
      page += 1;
      if (page > maxPages) truncated = true;
    }
    if (page > totalPages) truncated = false;
    return { data, total, totalPages, truncated };
  }
}

export { normalizePath, buildQuery };
