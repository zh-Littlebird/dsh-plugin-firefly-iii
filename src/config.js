/**
 * Plugin configuration and Cordis Schema (Standard Schema v1).
 *
 * The bundle intentionally declares no npm dependencies, so instead of a
 * Schemastery schema it exports a small Standard Schema implementation.
 * Cordis reads `Config['~standard'].validate(raw)` during activation.
 */

const DEFAULTS = {
  baseUrl: '',
  currency: 'CNY',
  timeZone: 'Asia/Shanghai',
  autoCreate: {
    accounts: false,
    categories: false,
    tags: false,
    budgets: false,
    piggyBanks: false,
  },
  confirmWrites: true,
  pageSize: 25,
  maxAttachmentMb: 10,
  expectedApiPrefix: '6.7.',
  requestTimeoutMs: 30000,
};

const AUTO_CREATE_KEYS = ['accounts', 'categories', 'tags', 'budgets', 'piggyBanks'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol === 'http:' && !local) return null;
  // Strip a trailing /api or /api/v1 so operators can paste either URL form.
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api(?:\/v1)?$/, '');
  return url.toString().replace(/\/+$/, '') + '/';
}

/** Merge defaults and validate. Returns `{ value }` or `{ issues }` per Standard Schema. */
export function normalizeConfig(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const issues = [];
  const config = {
    ...DEFAULTS,
    ...source,
    autoCreate: {
      ...DEFAULTS.autoCreate,
      ...(isPlainObject(source.autoCreate) ? source.autoCreate : {}),
    },
  };

  const envBaseUrl = process.env.FIREFLY_III_BASE_URL;
  if ((config.baseUrl === '' || config.baseUrl === undefined) && envBaseUrl) {
    config.baseUrl = envBaseUrl;
  }
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (baseUrl === null) {
    issues.push({
      message: 'baseUrl must be an absolute http(s) URL; plain http is only accepted for localhost.',
      path: ['baseUrl'],
    });
  } else if (baseUrl === '') {
    issues.push({
      message: 'baseUrl is required (for example https://firefly.example.com/).',
      path: ['baseUrl'],
    });
  } else {
    config.baseUrl = baseUrl;
  }

  if (typeof config.currency !== 'string' || !/^[A-Za-z]{3}$/.test(config.currency.trim())) {
    issues.push({ message: 'currency must be a three-letter ISO code such as CNY.', path: ['currency'] });
  } else {
    config.currency = config.currency.trim().toUpperCase();
  }

  if (typeof config.timeZone !== 'string' || !isValidTimeZone(config.timeZone)) {
    issues.push({ message: 'timeZone must be a valid IANA zone such as Asia/Shanghai.', path: ['timeZone'] });
  }

  if (!Number.isInteger(config.pageSize) || config.pageSize < 1 || config.pageSize > 100) {
    issues.push({ message: 'pageSize must be an integer between 1 and 100.', path: ['pageSize'] });
  }

  if (!Number.isFinite(config.maxAttachmentMb) || config.maxAttachmentMb < 1 || config.maxAttachmentMb > 1024) {
    issues.push({ message: 'maxAttachmentMb must be between 1 and 1024.', path: ['maxAttachmentMb'] });
  }

  if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1000 || config.requestTimeoutMs > 120000) {
    issues.push({ message: 'requestTimeoutMs must be an integer between 1000 and 120000.', path: ['requestTimeoutMs'] });
  }

  if (typeof config.confirmWrites !== 'boolean') {
    issues.push({ message: 'confirmWrites must be a boolean.', path: ['confirmWrites'] });
  }

  if (typeof config.expectedApiPrefix !== 'string') {
    issues.push({ message: 'expectedApiPrefix must be a string.', path: ['expectedApiPrefix'] });
  }

  for (const key of AUTO_CREATE_KEYS) {
    if (typeof config.autoCreate[key] !== 'boolean') {
      issues.push({ message: `autoCreate.${key} must be a boolean.`, path: ['autoCreate', key] });
    }
  }

  if (issues.length > 0) return { issues };
  return { value: config };
}

const SCHEMASTERy = Symbol.for('schemastery');

function nativeField(type, meta = {}, extra = {}) {
  return { type, meta, [SCHEMASTERy]: true, ...extra };
}

function nativeObject(dict, meta = {}) {
  return { type: 'object', meta, dict, [SCHEMASTERy]: true };
}

/**
 * Cordis recognizes a native Schemastery graph through `Symbol.for('schemastery')`
 * and projects it for Config inspection. Validation still runs through the
 * Standard Schema validator below, so the graph only carries display metadata
 * and defaults while one validator remains the single source of truth.
 */
const NATIVE_CONFIG = nativeObject(
  {
    baseUrl: nativeField('string', {
      required: true,
      description: 'Firefly III instance root URL, for example https://firefly.example.com/.',
    }),
    currency: nativeField('string', { default: DEFAULTS.currency, description: 'Default currency code used for reports and summaries.' }),
    timeZone: nativeField('string', { default: DEFAULTS.timeZone, description: 'IANA time zone used to normalize transaction timestamps and report periods.' }),
    autoCreate: nativeObject(
      {
        accounts: nativeField('boolean', { default: false, description: 'Allow transactions and explicit creates to create unknown accounts implicitly.' }),
        categories: nativeField('boolean', { default: false, description: 'Allow unknown category names to be created implicitly.' }),
        tags: nativeField('boolean', { default: false, description: 'Allow unknown tag names to be created implicitly.' }),
        budgets: nativeField('boolean', { default: false, description: 'Allow unknown budget names and budget limits to be created.' }),
        piggyBanks: nativeField('boolean', { default: false, description: 'Allow piggy banks to be created.' }),
      },
      { default: { ...DEFAULTS.autoCreate } },
    ),
    confirmWrites: nativeField('boolean', {
      default: true,
      description: 'Ask for approval before routine writes. Destructive writes always ask regardless of this value.',
    }),
    pageSize: nativeField('number', { default: 25, min: 1, max: 100, step: 1, description: 'Default page size for list and search tools (1-100).' }),
    maxAttachmentMb: nativeField('number', { default: 10, min: 1, max: 1024, description: 'Maximum attachment upload size in MiB.' }),
    expectedApiPrefix: nativeField('string', { default: '6.7.', description: 'Supported Firefly III API series; /firefly-status warns when /about reports a different one.' }),
    requestTimeoutMs: nativeField('number', {
      default: 30000,
      min: 1000,
      max: 120000,
      step: 1,
      description: 'Per-request timeout in milliseconds.',
    }),
  },
  { default: { ...DEFAULTS } },
);

export const Config = {
  ...NATIVE_CONFIG,
  '~standard': {
    version: 1,
    vendor: 'firefly-iii-dsh-plugin',
    validate(raw) {
      return normalizeConfig(raw);
    },
  },
};

export { DEFAULTS as configDefaults };
