/**
 * Runtime settings behind the Web "Firefly III" settings page.
 *
 * The page edits three things through this service:
 *
 * - `autoCreate` switches and the instance `baseUrl`, persisted in the loader
 *   row's Config through the Host `configEditor` service, so saved values land
 *   in the profile's own patch layer and are applied by the normal Loader path
 *   — the plugin never rewrites `cordis.patch.yml` itself.
 * - The personal access token, stored as a credential record. It is written
 *   first, before any config edit, so the token is never lost if the config
 *   change restarts the plugin half-way through.
 *
 * `apply` receives the effective Config, which is what the tools use; after a
 * config save the Loader restarts this plugin with the new Config, so both the
 * page and the tools converge on one source of truth. Token reads always hit
 * the credentials service, so a saved token reaches the next tool call without
 * a restart.
 */
import { normalizeBaseUrl } from './config.js';
import { clearToken as clearStoredToken, saveToken, tokenStatus } from './credentials.js';

export const AUTO_CREATE_KEYS = ['accounts', 'categories', 'tags', 'budgets', 'piggyBanks'];

export const AUTO_CREATE_DEFAULTS = {
  accounts: false,
  categories: false,
  tags: false,
  budgets: false,
  piggyBanks: false,
};

/** Firefly III personal access tokens are long JWT strings; reject obvious typos. */
export const TOKEN_MIN_LENGTH = 20;

/** Saved-value reasons the page can explain; never a stack trace. */
export class FireflySettingsError extends Error {
  constructor(code, message, hint = null) {
    super(message);
    this.name = 'FireflySettingsError';
    this.code = code;
    this.hint = hint;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickAutoCreate(source) {
  const picked = {};
  if (!isPlainObject(source)) return picked;
  for (const key of AUTO_CREATE_KEYS) {
    if (typeof source[key] === 'boolean') picked[key] = source[key];
  }
  return picked;
}

/** Validate a partial `autoCreate` patch; unknown keys and non-booleans fail. */
export function normalizeAutoCreatePatch(raw) {
  if (!isPlainObject(raw)) {
    throw new FireflySettingsError('INVALID_SETTINGS', 'autoCreate 必须是对象', '请求体应形如 {"autoCreate":{"accounts":true}}');
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    throw new FireflySettingsError('INVALID_SETTINGS', 'autoCreate 至少需要一个开关', '请刷新页面后重试');
  }
  const patch = {};
  for (const key of keys) {
    if (!AUTO_CREATE_KEYS.includes(key)) {
      throw new FireflySettingsError('INVALID_SETTINGS', `未知开关 autoCreate.${key}`, `可用开关：${AUTO_CREATE_KEYS.join('、')}`);
    }
    if (typeof raw[key] !== 'boolean') {
      throw new FireflySettingsError('INVALID_SETTINGS', `autoCreate.${key} 必须是布尔值`, '请刷新页面后重试');
    }
    patch[key] = raw[key];
  }
  return patch;
}

/**
 * Validate one Settings-page payload. Every field is optional, but a payload
 * with nothing to write fails instead of pretending to save.
 *
 * @returns {{ autoCreate?: Record<string, boolean>, baseUrl?: string, token?: string, clearToken: boolean }}
 */
export function normalizeSettingsPatch(raw) {
  if (!isPlainObject(raw)) {
    throw new FireflySettingsError('INVALID_SETTINGS', '设置必须是对象', '请求体应形如 {"baseUrl":"https://firefly.example.com/"}');
  }
  const patch = { clearToken: false };
  if (raw.autoCreate !== undefined) patch.autoCreate = normalizeAutoCreatePatch(raw.autoCreate);
  if (raw.baseUrl !== undefined) {
    if (typeof raw.baseUrl !== 'string') {
      throw new FireflySettingsError('INVALID_SETTINGS', '实例地址必须是字符串', '请求体应形如 {"baseUrl":"https://firefly.example.com/"}');
    }
    const normalized = normalizeBaseUrl(raw.baseUrl);
    if (normalized === null) {
      throw new FireflySettingsError(
        'INVALID_SETTINGS',
        '实例地址必须是以 http(s) 开头的完整 URL；只有本机地址可以使用 http。',
        '例如 https://firefly.example.com/，粘贴以 /api 结尾的地址也可以，会自动去掉。',
      );
    }
    patch.baseUrl = normalized;
  }
  if (raw.token !== undefined) {
    if (typeof raw.token !== 'string') {
      throw new FireflySettingsError('INVALID_SETTINGS', '令牌必须是字符串', '请刷新页面后重试');
    }
    const token = raw.token.trim();
    if (token.length < TOKEN_MIN_LENGTH) {
      throw new FireflySettingsError(
        'INVALID_TOKEN',
        '令牌看起来太短；Firefly III 个人访问令牌是很长的 JWT 字符串。',
        '在 Firefly III 的 Profile → OAuth → Personal Access Tokens 里创建新令牌。',
      );
    }
    patch.token = token;
  }
  if (raw.clearToken !== undefined) {
    if (typeof raw.clearToken !== 'boolean') {
      throw new FireflySettingsError('INVALID_SETTINGS', 'clearToken 必须是布尔值', '请刷新页面后重试');
    }
    patch.clearToken = raw.clearToken;
  }
  if (patch.token !== undefined && patch.clearToken) {
    throw new FireflySettingsError('INVALID_SETTINGS', '不能在同一次保存里同时设置和清除令牌', '请刷新页面后重试');
  }
  if (patch.autoCreate === undefined && patch.baseUrl === undefined && patch.token === undefined && !patch.clearToken) {
    throw new FireflySettingsError('INVALID_SETTINGS', '没有可保存的改动', '请刷新页面后重试');
  }
  return patch;
}

/** Match the Firefly loader row across the shapes a Loader entry may expose. */
function findEntry(editor) {
  const entries = editor.entries();
  const matches = (value) =>
    typeof value === 'string' &&
    (value === 'firefly-iii' ||
      value === 'include:firefly-iii' ||
      value === '@local/firefly-iii' ||
      value === 'dsh-plugin-firefly-iii');
  return entries.find((entry) => ['id', 'patchId', 'entryId', 'name'].some((field) => matches(entry?.[field])));
}

function editorOf(ctx) {
  try {
    return ctx.get('configEditor');
  } catch {
    return undefined;
  }
}

/**
 * One service per plugin mount: it closes over the effective Config and reads
 * the editor lazily, because `configEditor` may mount after this plugin.
 */
export function createSettingsService(ctx, config) {
  async function tokenView() {
    try {
      const status = await tokenStatus(ctx);
      let writable = false;
      try {
        writable = ctx.get('credentials') !== undefined;
      } catch {
        writable = false;
      }
      return { ...status, writable };
    } catch {
      return { stored: false, environment: false, configured: false, writable: false, unavailable: true };
    }
  }

  function target() {
    const editor = editorOf(ctx);
    if (editor === undefined) {
      return { editor: undefined, entry: undefined, reason: '当前组合没有挂载 configEditor 服务，连接参数只能读取、不能保存。' };
    }
    const entry = findEntry(editor);
    if (entry === undefined) {
      return { editor, entry: undefined, reason: '没有找到名为 firefly-iii 的插件配置行，无法保存。' };
    }
    return { editor, entry, reason: null };
  }

  function effectiveBaseUrl() {
    return String(config.baseUrl ?? '');
  }

  return {
    async view() {
      const { editor, entry, reason } = target();
      const token = await tokenView();
      const baseUrl = effectiveBaseUrl();
      return {
        ok: true,
        plugin: 'firefly-iii',
        autoCreate: { ...AUTO_CREATE_DEFAULTS, ...pickAutoCreate(config.autoCreate) },
        defaults: { ...AUTO_CREATE_DEFAULTS },
        connection: {
          baseUrl,
          configured: baseUrl !== '',
          currency: String(config.currency ?? ''),
          timeZone: String(config.timeZone ?? ''),
          expectedApiPrefix: String(config.expectedApiPrefix ?? ''),
          // Without a config editor the page may only show the URL and token.
          editable: editor !== undefined && entry !== undefined,
        },
        writes: { confirmWrites: config.confirmWrites !== false },
        token,
        editable: editor !== undefined && entry !== undefined,
        editorAvailable: editor !== undefined,
        entryId: entry === undefined ? null : (entry.patchId ?? entry.id ?? null),
        reason,
      };
    },

    /**
     * Persist one Settings-page payload: switches and instance URL through the
     * config editor, the token through the credentials service.
     *
     * @returns {{ ok: true, saved: object, pendingRestart: boolean }}
     */
    async save(raw) {
      const patch = normalizeSettingsPatch(raw);

      // Credentials first: a config edit may restart this plugin, and an
      // interrupted restart must not lose a token the user just pasted.
      if (patch.token !== undefined) await saveToken(ctx, patch.token);
      if (patch.clearToken) await clearStoredToken(ctx);

      const currentBaseUrl = effectiveBaseUrl();
      const baseUrlChanged = patch.baseUrl !== undefined && patch.baseUrl !== currentBaseUrl;
      const changesConfig = patch.autoCreate !== undefined || baseUrlChanged;
      let pendingRestart = false;

      if (changesConfig) {
        const { editor, entry, reason } = target();
        if (editor === undefined || entry === undefined) {
          throw new FireflySettingsError('EDITOR_UNAVAILABLE', reason ?? '无法保存插件配置', '请手动编辑 profile 的 cordis.patch.yml');
        }
        await editor.edit(entry, (current, inherited) => {
          const base = {
            ...(isPlainObject(inherited) ? inherited : {}),
            ...(isPlainObject(current) ? current : {}),
          };
          // The profile layer replaces the row's Config wholesale, so restate
          // everything the row needs instead of sending only the changed field.
          if (patch.baseUrl !== undefined) base.baseUrl = patch.baseUrl;
          else if (typeof base.baseUrl !== 'string' || base.baseUrl.trim() === '') base.baseUrl = currentBaseUrl;
          if (typeof base.currency !== 'string' || base.currency.trim() === '') base.currency = config.currency;
          if (typeof base.timeZone !== 'string' || base.timeZone.trim() === '') base.timeZone = config.timeZone;
          const inheritedAutoCreate = isPlainObject(base.autoCreate)
            ? pickAutoCreate(base.autoCreate)
            : pickAutoCreate(config.autoCreate);
          const autoCreate = {
            ...AUTO_CREATE_DEFAULTS,
            ...inheritedAutoCreate,
            ...(patch.autoCreate ?? {}),
          };
          return { ...base, autoCreate };
        });
        pendingRestart = true;
      }

      return {
        ok: true,
        saved: {
          ...(patch.autoCreate === undefined ? {} : { autoCreate: patch.autoCreate }),
          ...(patch.baseUrl === undefined ? {} : { baseUrl: patch.baseUrl }),
          token: patch.token !== undefined ? 'saved' : patch.clearToken ? 'cleared' : null,
        },
        pendingRestart,
      };
    },
  };
}
