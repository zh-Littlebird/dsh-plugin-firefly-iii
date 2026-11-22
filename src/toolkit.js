/** Shared tool registration wrapper. */
import { asFireflyError } from './errors.js';
import { renderResult } from './format.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
    counts: { type: 'object', additionalProperties: true },
    truncated: { type: 'boolean' },
    hint: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: true,
};

/**
 * Drop values the host's lossless-JSON output validator rejects.
 *
 * DSH snapshots every tool result and rejects an own property whose value is
 * `undefined` (it cannot survive a JSON round trip). Tool bodies routinely
 * build optional fields such as `hint: paginationHint(meta)` that are
 * `undefined` when there is no next page, so normalize once here instead of
 * auditing every return shape.
 */
export function losslessJson(value) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? 0 : value;
  }
  if (type !== 'object') return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const item = losslessJson(entry);
      return item === undefined ? null : item;
    });
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const item = losslessJson(entry);
    if (item !== undefined) result[key] = item;
  }
  return result;
}

export function jsonTool(options) {
  const { name, description, parameters, execute, render = renderResult } = options;
  return {
    name,
    description,
    parameters,
    output: {
      schema: OUTPUT_SCHEMA,
      render,
    },
    async execute(args, exec) {
      try {
        return losslessJson(await execute(args ?? {}, exec));
      } catch (error) {
        throw asFireflyError(error);
      }
    },
  };
}

export function pageInfo(payload, fallbackLimit) {
  const pagination = payload?.meta?.pagination ?? {};
  const limit = Number(pagination.per_page ?? fallbackLimit ?? 0) || undefined;
  const total = Number(pagination.total ?? pagination.total_entries ?? 0) || 0;
  const page = Number(pagination.current_page ?? 1) || 1;
  const totalPages = Number(pagination.total_pages ?? 1) || 1;
  return { page, limit, total, totalPages };
}

export function paginationHint(info) {
  if (!info || !info.page) return undefined;
  if (info.page < info.totalPages) {
    return `page ${info.page + 1} of ${info.totalPages} has more; pass page=${info.page + 1}.`;
  }
  return undefined;
}

export function csvIds(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map((item) => String(item).trim()).filter(Boolean);
}
