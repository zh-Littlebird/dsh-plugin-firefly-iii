/**
 * Runtime settings behind the Web "Firefly III" settings page.
 *
 * The page edits the loader row's Config through the Host `configEditor`
 * service, so saved values land in the profile's own patch layer and are
 * applied by the normal Loader path — the plugin never rewrites
 * `cordis.patch.yml` itself.
 *
 * `apply` receives the effective Config, which is what the tools use; after a
 * save the Loader restarts this plugin with the new Config, so both the page
 * and the tools converge on one source of truth.
 */

export const AUTO_CREATE_KEYS = ['accounts', 'categories', 'tags', 'budgets', 'piggyBanks'];

export const AUTO_CREATE_DEFAULTS = {
  accounts: false,
  categories: false,
  tags: false,
  budgets: false,
  piggyBanks: false,
};

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

/** Match the Firefly loader row across the shapes a Loader entry may expose. */
function findEntry(editor) {
  const entries = editor.entries();
  const matches = (value) =>
    typeof value === 'string' &&
    (value === 'firefly-iii' || value === 'include:firefly-iii' || value === 'dsh-plugin-firefly-iii');
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
      const credentials = ctx.get('credentials');
      const record = credentials ? await credentials.readRecord('firefly-iii/default') : undefined;
      const stored = record?.kind === 'api-key' && typeof record.key === 'string' && record.key.trim() !== '';
      const environment = typeof process.env.FIREFLY_III_ACCESS_TOKEN === 'string' && process.env.FIREFLY_III_ACCESS_TOKEN.trim() !== '';
      return { stored, environment, configured: stored || environment };
    } catch {
      return { stored: false, environment: false, configured: false, unavailable: true };
    }
  }

  function target() {
    const editor = editorOf(ctx);
    if (editor === undefined) {
      return { editor: undefined, entry: undefined, reason: '当前组合没有挂载 configEditor 服务，页面只能读取、不能保存。' };
    }
    const entry = findEntry(editor);
    if (entry === undefined) {
      return { editor, entry: undefined, reason: '没有找到名为 firefly-iii 的插件配置行，无法保存。' };
    }
    return { editor, entry, reason: null };
  }

  return {
    async view() {
      const { editor, entry, reason } = target();
      const token = await tokenView();
      return {
        ok: true,
        plugin: 'firefly-iii',
        autoCreate: { ...AUTO_CREATE_DEFAULTS, ...pickAutoCreate(config.autoCreate) },
        defaults: { ...AUTO_CREATE_DEFAULTS },
        connection: {
          baseUrl: String(config.baseUrl ?? ''),
          currency: String(config.currency ?? ''),
          timeZone: String(config.timeZone ?? ''),
          expectedApiPrefix: String(config.expectedApiPrefix ?? ''),
        },
        writes: { confirmWrites: config.confirmWrites !== false },
        token,
        editable: editor !== undefined && entry !== undefined,
        editorAvailable: editor !== undefined,
        entryId: entry === undefined ? null : (entry.patchId ?? entry.id ?? null),
        reason,
      };
    },

    async save(rawAutoCreate) {
      const patch = normalizeAutoCreatePatch(rawAutoCreate);
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
        // everything the row needs instead of sending only autoCreate.
        if (typeof base.baseUrl !== 'string' || base.baseUrl.trim() === '') base.baseUrl = config.baseUrl;
        if (typeof base.currency !== 'string' || base.currency.trim() === '') base.currency = config.currency;
        if (typeof base.timeZone !== 'string' || base.timeZone.trim() === '') base.timeZone = config.timeZone;
        const inheritedAutoCreate = isPlainObject(base.autoCreate)
          ? pickAutoCreate(base.autoCreate)
          : pickAutoCreate(config.autoCreate);
        const autoCreate = {
          ...AUTO_CREATE_DEFAULTS,
          ...inheritedAutoCreate,
          ...patch,
        };
        return { ...base, autoCreate };
      });
      return { ok: true, autoCreate: patch };
    },
  };
}
