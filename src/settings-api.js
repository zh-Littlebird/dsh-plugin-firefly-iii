/**
 * Loopback-only HTTP surface behind the Web "Firefly III" settings section.
 *
 * GET  /firefly-iii-ui/settings  effective Config snapshot for the page
 * PUT  /firefly-iii-ui/settings  persist autoCreate/baseUrl through configEditor
 *                                and the access token through credentials
 * POST /firefly-iii-ui/test      verify token + API version against the
 *                                instance, optionally using unsaved draft values
 *
 * No token value is ever returned: the page only learns whether one exists.
 */
import { FireflyClient } from './client.js';
import { normalizeBaseUrl } from './config.js';
import { resolveToken } from './credentials.js';
import { FireflyError } from './errors.js';
import { FireflySettingsError, normalizeSettingsPatch, TOKEN_MIN_LENGTH } from './settings.js';

export const ROUTE_PREFIX = '/firefly-iii-ui';
const WRITE_HEADER = 'x-firefly-iii-ui';
const MAX_BODY_BYTES = 64 * 1024;

function resolveWebServer(scope) {
  try {
    const service = scope.get('webServer');
    if (service !== undefined) return service;
  } catch {
    // Fall through to the reflected member.
  }
  try {
    return scope.webServer;
  } catch {
    return undefined;
  }
}

/**
 * Mount the two exact routes once `webServer` is available; skip in headless
 * profiles.
 *
 * Exact paths, rather than one prefix route, keep the surface to the endpoints
 * the page actually uses. Every registration runs inside a Context effect, so
 * the web server drops both routes when this plugin stops or restarts — a
 * plugin-owned route that outlived its context would make the next mount fail
 * with a duplicate-path error and leave the page talking to stale code.
 */
export function registerSettingsRoute(ctx, handler) {
  const paths = [`${ROUTE_PREFIX}/settings`, `${ROUTE_PREFIX}/test`];
  const mount = (scope) => {
    const webServer = resolveWebServer(scope);
    if (webServer === undefined) return;
    for (const path of paths) {
      scope.effect(() => {
        try {
          return webServer.register({ kind: 'exact', path, handler });
        } catch {
          // Another mount of this plugin already owns the path in this
          // process; the page keeps working through that registration.
          return () => {};
        }
      });
    }
  };
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      mount(webCtx);
    });
    return;
  }
  if (resolveWebServer(ctx) !== undefined) mount(ctx);
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

function stripCode(message) {
  return String(message ?? '').replace(/\s+\[[A-Z0-9_]+\]$/, '');
}

function sendError(res, error) {
  const code = error instanceof FireflySettingsError ? error.code : 'INTERNAL';
  const hint = error instanceof FireflySettingsError ? error.hint : null;
  const status =
    code === 'EDITOR_UNAVAILABLE'
      ? 409
      : code === 'INVALID_SETTINGS' || code === 'INVALID_TOKEN' || code === 'INVALID_BODY' || code === 'BODY_TOO_LARGE'
        ? 400
        : 500;
  sendJson(res, status, { error: { code, message: stripCode(error instanceof Error ? error.message : String(error)), hint } });
}

function isLoopback(address) {
  if (address === undefined) return false;
  return address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.');
}

function isLoopbackHostname(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
}

/**
 * Desktop shells may serve the page from a non-http scheme (or send an opaque
 * `null` Origin); those values carry no meaningful host but only occur in the
 * local shell. Cross-site HTTP writes stay restricted to loopback origins, and
 * every write additionally needs the page's custom header.
 */
function isTrustedWriteOrigin(origin) {
  if (origin === undefined || origin === null || origin === 'null' || String(origin).trim() === '') return true;
  try {
    const url = new URL(String(origin));
    if (url.protocol === 'http:' || url.protocol === 'https:') return isLoopbackHostname(url.hostname);
    return true;
  } catch {
    return false;
  }
}

function hasWriteHeader(req) {
  const header = req.headers[WRITE_HEADER];
  return Array.isArray(header) ? header[0] === '1' : header === '1';
}

/** A mutation is only accepted from the local settings page. */
function rejectUntrustedWrite(req, res) {
  if (!isTrustedWriteOrigin(req.headers.origin)) {
    sendJson(res, 403, {
      error: {
        code: 'FORBIDDEN',
        message: '写入必须来自本机页面',
        hint: `origin=${String(req.headers.origin)}`,
      },
    });
    return true;
  }
  if (!hasWriteHeader(req)) {
    sendJson(res, 403, { error: { code: 'FORBIDDEN', message: '缺少设置页写入标识', hint: null } });
    return true;
  }
  return false;
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new FireflySettingsError('BODY_TOO_LARGE', '请求体过大', '请刷新页面后重试');
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FireflySettingsError('INVALID_BODY', '请求体不是合法 JSON', '请刷新页面后重试');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FireflySettingsError('INVALID_BODY', '请求体必须是 JSON 对象', '请刷新页面后重试');
  }
  return value;
}

/**
 * Resolve the connection the test should use: unsaved draft values from the
 * page when present, else the saved configuration and credential.
 */
async function resolveTestTarget(ctx, config, body) {
  let baseUrl = String(config.baseUrl ?? '');
  if (body.baseUrl !== undefined) {
    if (typeof body.baseUrl !== 'string') {
      return { failure: '实例地址必须是字符串' };
    }
    const normalized = normalizeBaseUrl(body.baseUrl);
    if (normalized === null) {
      return { failure: '实例地址必须是以 http(s) 开头的完整 URL；只有本机地址可以使用 http。' };
    }
    if (normalized === '') return { failure: '还没有填写实例地址。' };
    baseUrl = normalized;
  }
  if (baseUrl === '') return { failure: '还没有配置实例地址，请先保存实例地址。' };

  let token;
  let source;
  if (body.token !== undefined) {
    if (typeof body.token !== 'string' || body.token.trim().length < TOKEN_MIN_LENGTH) {
      return { failure: '令牌看起来太短；Firefly III 个人访问令牌是很长的 JWT 字符串。' };
    }
    token = body.token.trim();
    source = 'draft';
  } else {
    try {
      ({ token, source } = await resolveToken(ctx));
    } catch (error) {
      return { failure: error instanceof Error ? stripCode(error.message) : String(error) };
    }
  }
  return { baseUrl, token, source };
}

/** Build the HTTP handler; `ctx` supplies the token and HTTP client facts. */
export function createSettingsHandler({ ctx, config, settings }) {
  return async (req, res) => {
    try {
      const remote = req.socket?.remoteAddress;
      if (!isLoopback(remote)) {
        sendJson(res, 403, { error: { code: 'FORBIDDEN', message: '该设置界面只允许本机访问', hint: null } });
        return;
      }
      const url = new URL(req.url ?? ROUTE_PREFIX, 'http://127.0.0.1');
      const pathname = url.pathname.replace(/\/+$/, '') || ROUTE_PREFIX;

      if (pathname === `${ROUTE_PREFIX}/settings`) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          sendJson(res, 200, await settings.view());
          return;
        }
        if (req.method === 'PUT') {
          if (rejectUntrustedWrite(req, res)) return;
          const body = await readJsonBody(req);
          // Validate before any write so a bad field cannot leave half a change.
          normalizeSettingsPatch(body);
          sendJson(res, 200, await settings.save(body));
          return;
        }
        sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 GET / PUT', hint: null } });
        return;
      }

      if (pathname === `${ROUTE_PREFIX}/test`) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 POST', hint: null } });
          return;
        }
        if (rejectUntrustedWrite(req, res)) return;
        const body = await readJsonBody(req);
        const target = await resolveTestTarget(ctx, config, body);
        if (target.failure !== undefined) {
          sendJson(res, 200, { ok: false, message: target.failure });
          return;
        }
        try {
          const client = new FireflyClient({ ...config, baseUrl: target.baseUrl }, target.token);
          const about = await client.about();
          const version = String(about?.version ?? 'unknown');
          const apiVersion = String(about?.api_version ?? version);
          const prefix = String(config.expectedApiPrefix ?? '');
          const mismatch = prefix !== '' && !apiVersion.startsWith(prefix);
          sendJson(res, 200, {
            ok: !mismatch,
            version,
            apiVersion,
            source: target.source,
            baseUrl: target.baseUrl,
            hint: mismatch ? `API 版本不以 ${prefix} 开头；请核对实例版本或 expectedApiPrefix。` : null,
          });
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            baseUrl: target.baseUrl,
            message: error instanceof FireflyError ? stripCode(error.message) : error instanceof Error ? stripCode(error.message) : String(error),
          });
        }
        return;
      }

      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '未知端点', hint: `可用端点：${ROUTE_PREFIX}/settings、${ROUTE_PREFIX}/test` } });
    } catch (error) {
      sendError(res, error);
    }
  };
}
