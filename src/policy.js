/** Firefly III policy: dates, metadata resolution, auto-create gates and approvals. */
import { FireflyError, fail } from './errors.js';

const TRANSACTION_TYPES = ['withdrawal', 'deposit', 'transfer', 'reconciliation', 'opening balance'];
const AUTO_CREATE_LABELS = {
  accounts: 'account',
  categories: 'category',
  tags: 'tag',
  budgets: 'budget',
  piggyBanks: 'piggy bank',
};

export function timeZoneOffset(timeZone, date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
      year: 'numeric',
    }).formatToParts(new Date(`${date}T12:00:00Z`));
    const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
    if (raw === 'GMT') return '+00:00';
    const match = /^GMT([+-])(\d{2}):?(\d{2})?$/.exec(raw);
    if (!match) return '+00:00';
    return `${match[1]}${match[2]}:${match[3] ?? '00'}`;
  } catch {
    return '+00:00';
  }
}

/**
 * Normalize a transaction timestamp. Firefly III accepts date-only values, but
 * Firefly bookkeeping here requires a real time: a midnight placeholder hides
 * information and breaks ordering, so it is rejected as NEED_TIME.
 */
export function normalizeTransactionDate(value, timeZone, field = 'date') {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new FireflyError('NEED_TIME', `${field} is required and must include HH:MM:SS; ask the user instead of inventing a time.`);
  }
  const text = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (!match) {
    throw new FireflyError(
      'NEED_TIME',
      `${field} must look like 2026-11-17T14:35:00+08:00 (a date plus a real HH:MM:SS time). Received: ${text}`,
    );
  }
  const [, date, hour, minute, second = '00', zone] = match;
  if (hour === '00' && minute === '00' && second === '00') {
    throw new FireflyError(
      'NEED_TIME',
      `${field} is exactly midnight, which is rejected as a placeholder. Ask the user for the real time.`,
    );
  }
  const normalizedZone = zone === 'Z' ? '+00:00' : normalizeOffset(zone) ?? timeZoneOffset(timeZone, date);
  return `${date}T${hour}:${minute}:${second}${normalizedZone}`;
}

function normalizeOffset(zone) {
  if (!zone) return undefined;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  return match ? `${match[1]}${match[2]}:${match[3]}` : undefined;
}

export function assertDate(value, field) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new FireflyError('INVALID_DATE', `${field} must be YYYY-MM-DD. Received: ${text || '(empty)'}`);
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new FireflyError('INVALID_DATE', `${field} is not a real calendar date: ${text}`);
  return text;
}

export function assertDateRange(start, end, { required = true } = {}) {
  if (!required && !start && !end) return { start: undefined, end: undefined };
  if (!start || !end) fail('INVALID_DATE', 'Both start and end are required for this operation.');
  const s = assertDate(start, 'start');
  const e = assertDate(end, 'end');
  if (s >= e) fail('INVALID_DATE', `start (${s}) must be earlier than end (${e}); Firefly III rejects equal or reversed ranges.`);
  return { start: s, end: e };
}

export function assertTransactionType(value) {
  const text = String(value ?? '').trim();
  if (text === '' || text === 'all') return text || undefined;
  const normalized = text.toLowerCase();
  if (!TRANSACTION_TYPES.includes(normalized)) {
    fail('INVALID_PARAMETER', `type must be one of ${TRANSACTION_TYPES.join(', ')} (or all). Received: ${text}`);
  }
  return normalized;
}

export function assertPlainObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FireflyError('INVALID_PAYLOAD', `${label} must be a JSON object.`);
  }
  return value;
}

export function requireFields(data, fields, label) {
  assertPlainObject(data, label);
  const missing = fields.filter((field) => data[field] === undefined || data[field] === null || data[field] === '');
  if (missing.length > 0) {
    throw new FireflyError('INVALID_PAYLOAD', `${label} is missing required field(s): ${missing.join(', ')}.`);
  }
  return data;
}

export function assertCreateAllowed(config, resource, label) {
  const key = resource;
  if (!(key in AUTO_CREATE_LABELS)) return;
  if (config.autoCreate[key] !== true) {
    throw new FireflyError(
      'AUTO_CREATE_DISABLED',
      `Creating ${label ?? AUTO_CREATE_LABELS[key]} is disabled (autoCreate.${key}=false). Choose an existing ${AUTO_CREATE_LABELS[key]} instead, or enable autoCreate.${key} in the plugin configuration.`,
    );
  }
}

export function assertNotForbiddenAction(action) {
  const text = String(action ?? '').toLowerCase();
  if (['purge', 'destroy', 'purge-data', 'destroy-data', 'cron', 'batch-finish'].includes(text)) {
    throw new FireflyError('ENDPOINT_FORBIDDEN', 'Purging or destroying Firefly III data is permanently disabled in this plugin.');
  }
}

export async function fetchMetadata(client, options = {}) {
  const { signal, include = ['accounts', 'categories', 'budgets', 'tags'], maxPages = 10 } = options;
  const specs = {
    accounts: { path: 'accounts', pick: (a) => ({ id: a.id, name: a.name, type: a.type }) },
    categories: { path: 'categories', pick: (a) => ({ id: a.id, name: a.name }) },
    budgets: { path: 'budgets', pick: (a) => ({ id: a.id, name: a.name }) },
    tags: { path: 'tags', pick: (a) => ({ id: a.id, name: a.tag }) },
    piggyBanks: { path: 'piggy-banks', pick: (a) => ({ id: a.id, name: a.name }) },
  };
  const result = {};
  await Promise.all(
    include.map(async (key) => {
      const spec = specs[key];
      if (!spec) return;
      const page = await client.listAll(spec.path, {}, { signal, maxPages, pageSize: 100 });
      const items = page.data.map((resource) => {
        const attributes = {
          ...(resource?.attributes ?? resource),
          id: resource?.id ?? resource?.attributes?.id,
        };
        return spec.pick(attributes);
      });
      result[key] = { items, truncated: page.truncated };
    }),
  );
  return result;
}

function normalizeName(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function fuzzyCandidates(items, name, limit = 8) {
  const needle = normalizeName(name);
  const values = items
    .filter((item) => item.name !== undefined)
    .filter((item) => normalizeName(item.name).includes(needle) || needle.includes(normalizeName(item.name)))
    .slice(0, limit)
    .map((item) => ({ id: item.id, name: item.name }));
  return values.length > 0 ? values : items.slice(0, limit).map((item) => ({ id: item.id, name: item.name }));
}

function resolveNamedEntity(options) {
  const {
    split,
    idField,
    nameField,
    label,
    entity,
    autoCreate,
    catalogue,
    warnings,
    required = false,
  } = options;
  const rawId = split[idField];
  const rawName = split[nameField];
  if ((rawId === undefined || rawId === null || rawId === '') && (rawName === undefined || rawName === null || String(rawName).trim() === '')) {
    if (required) {
      throw new FireflyError(
        'MISSING_FIELD',
        `${label} is required: pass ${idField} or ${nameField} from a real firefly_lookup result (autoCreate.${entity}=false forbids guessing).`,
      );
    }
    return;
  }
  const items = catalogue?.items ?? [];
  const truncated = catalogue?.truncated === true;
  if (rawId !== undefined && rawId !== null && rawId !== '') {
    const id = String(rawId);
    if (!autoCreate && !truncated && items.length > 0 && !items.some((item) => String(item.id) === id)) {
      throw new FireflyError('INVALID_ID', `${label} id ${id} does not exist in the current ${label} list; use firefly_lookup and pass a real id.`);
    }
    split[idField] = id;
    delete split[nameField];
    return;
  }
  const name = String(rawName).trim();
  const matches = items.filter((item) => normalizeName(item.name) === normalizeName(name));
  if (matches.length === 1) {
    split[idField] = String(matches[0].id);
    delete split[nameField];
    return;
  }
  if (matches.length > 1) {
    throw new FireflyError(
      'AMBIGUOUS_NAME',
      `${label} name "${name}" matches ${matches.length} objects; pass ${idField} instead.`,
      { candidates: matches.map((item) => ({ id: item.id, name: item.name })) },
    );
  }
  if (autoCreate) {
    warnings.push(`${label} "${name}" does not exist and will be created because autoCreate.${entity}=true.`);
    return;
  }
  throw new FireflyError(
    'AUTO_CREATE_DISABLED',
    `${label} "${name}" does not exist and autoCreate.${entity}=false forbids creating it implicitly. Choose an existing object by id or name.`,
    { candidates: fuzzyCandidates(items, name) },
  );
}

function normalizeTags(split, autoCreate, metadata, warnings) {
  if (!Array.isArray(split.tags)) {
    if (split.tags === undefined || split.tags === null || split.tags === '') return;
    throw new FireflyError('INVALID_PAYLOAD', 'tags must be an array of tag names, not ids or a comma-separated string.');
  }
  split.tags = split.tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (autoCreate.tags) return;
  const known = new Set((metadata.tags?.items ?? []).map((item) => normalizeName(item.name)));
  const unknown = split.tags.filter((tag) => !known.has(normalizeName(tag)));
  if (unknown.length > 0) {
    throw new FireflyError(
      'AUTO_CREATE_DISABLED',
      `Tag(s) ${unknown.map((tag) => `"${tag}"`).join(', ')} do not exist and autoCreate.tags=false forbids creating them implicitly. Choose existing tags.`,
      { candidates: fuzzyCandidates(metadata.tags?.items ?? [], unknown[0]) },
    );
  }
}

function validateSplitBasics(split, index) {
  if (typeof split !== 'object' || split === null || Array.isArray(split)) {
    throw new FireflyError('INVALID_PAYLOAD', `transactions[${index}] must be an object.`);
  }
  const type = split.type === undefined ? undefined : assertTransactionType(split.type);
  if (!type) fail('INVALID_PAYLOAD', `transactions[${index}].type is required (withdrawal, deposit or transfer).`);
  split.type = type;
  if (split.amount === undefined || split.amount === null || split.amount === '') {
    fail('INVALID_PAYLOAD', `transactions[${index}].amount is required.`);
  }
  const amount = typeof split.amount === 'number' ? split.amount.toFixed(2) : String(split.amount).trim();
  if (!/^\d+(?:\.\d+)?$/.test(amount)) fail('INVALID_PAYLOAD', `transactions[${index}].amount must be a positive decimal string.`);
  split.amount = amount;
  if (split.description === undefined || String(split.description).trim() === '') {
    fail('INVALID_PAYLOAD', `transactions[${index}].description is required.`);
  }
  split.description = String(split.description).trim();
}

/**
 * Normalize one transaction split against live metadata.
 * Returns a payload safe for TransactionStore/TransactionSplitUpdate.
 */
export function normalizeSplit(split, index, options) {
  const { config, metadata, timeZone, warnings, update = false } = options;
  validateSplitBasics(split, index);
  split.date = normalizeTransactionDate(split.date, timeZone, `transactions[${index}].date`);
  const specs = [
    ['source_id', 'source_name', 'source account', 'accounts'],
    ['destination_id', 'destination_name', 'destination account', 'accounts'],
    ['category_id', 'category_name', 'category', 'categories'],
    ['budget_id', 'budget_name', 'budget', 'budgets'],
  ];
  for (const [idField, nameField, label, entity] of specs) {
    resolveNamedEntity({
      split,
      idField,
      nameField,
      label,
      entity,
      autoCreate: config.autoCreate[entity],
      catalogue: metadata[entity],
      warnings,
      required: label.includes('account') && !update,
    });
  }
  normalizeTags(split, config.autoCreate, metadata, warnings);
  if (split.notes !== undefined) split.notes = String(split.notes);
  return split;
}

export async function requireApproval(ctx, exec, options) {
  const { reason, displayReason = {}, toolName = exec.name } = options;
  const approval = ctx.get('approval');
  if (!approval) {
    throw new FireflyError('APPROVAL_UNAVAILABLE', 'The approval service is unavailable in this profile, so this action was refused.');
  }
  if (!exec.agent) {
    throw new FireflyError('APPROVAL_UNAVAILABLE', 'This action needs an interactive agent session to request approval.');
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName,
    callId: exec.callId,
    reason,
    displayReason: { en: displayReason.en ?? reason, zh: displayReason.zh ?? displayReason.en ?? reason },
    signal: exec.signal,
  });
  if (outcome !== 'allowed-once') {
    throw new FireflyError('APPROVAL_DENIED', `Approval outcome was "${outcome}"; nothing was changed.`);
  }
}

/** Routine writes honour confirmWrites; destructive actions always call requireApproval directly. */
export async function confirmRoutineWrite(ctx, exec, config, options) {
  if (!config.confirmWrites) return;
  await requireApproval(ctx, exec, options);
}
