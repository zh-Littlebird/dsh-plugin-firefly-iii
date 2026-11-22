/** firefly_lookup: accounts, categories, tags, budgets, search, autocomplete and related records. */
import { jsonTool, pageInfo, paginationHint } from '../toolkit.js';
import { assertDateRange, assertTransactionType } from '../policy.js';
import { fail } from '../errors.js';
import {
  compactAccount,
  compactAttachment,
  compactAvailableBudget,
  compactBill,
  compactBudget,
  compactBudgetLimit,
  compactCategory,
  compactCurrency,
  compactExchangeRate,
  compactGeneric,
  compactLinkType,
  compactObjectGroup,
  compactPiggyBank,
  compactRecurrence,
  compactRule,
  compactRuleGroup,
  compactTag,
  compactTransactionGroup,
  compactTransactionLink,
} from '../format.js';

export const LIST_RESOURCES = [
  'all',
  'accounts',
  'categories',
  'tags',
  'budgets',
  'budget-limits',
  'available-budgets',
  'bills',
  'subscriptions',
  'piggy-banks',
  'recurrences',
  'rules',
  'rule-groups',
  'link-types',
  'transaction-links',
  'currencies',
  'exchange-rates',
  'object-groups',
  'attachments',
];

/** Autocomplete-only names that are not valid `list` resources. */
export const AUTOCOMPLETE_ONLY_RESOURCES = ['transactions-with-meta'];

export const LOOKUP_RESOURCES = [...LIST_RESOURCES, ...AUTOCOMPLETE_ONLY_RESOURCES];

export function compactFor(resource, json) {
  switch (resource) {
    case 'accounts':
      return compactAccount(json);
    case 'categories':
      return compactCategory(json);
    case 'tags':
      return compactTag(json);
    case 'budgets':
      return compactBudget(json);
    case 'budget-limits':
      return compactBudgetLimit(json);
    case 'available-budgets':
      return compactAvailableBudget(json);
    case 'bills':
    case 'subscriptions':
      return compactBill(json);
    case 'piggy-banks':
      return compactPiggyBank(json);
    case 'recurrences':
    case 'recurring':
      return compactRecurrence(json);
    case 'rules':
      return compactRule(json);
    case 'rule-groups':
      return compactRuleGroup(json);
    case 'link-types':
      return compactLinkType(json);
    case 'transaction-links':
      return compactTransactionLink(json);
    case 'currencies':
      return compactCurrency(json);
    case 'exchange-rates':
      return compactExchangeRate(json);
    case 'object-groups':
      return compactObjectGroup(json);
    case 'attachments':
      return compactAttachment(json);
    case 'transactions':
      return compactTransactionGroup(json);
    case 'transactions-with-meta':
      return compactGeneric(json);
    default:
      return compactGeneric(json);
  }
}

const RELATED_ROUTES = {
  account: {
    transactions: (id) => `accounts/${id}/transactions`,
    attachments: (id) => `accounts/${id}/attachments`,
    'piggy-banks': (id) => `accounts/${id}/piggy-banks`,
  },
  category: {
    transactions: (id) => `categories/${id}/transactions`,
    attachments: (id) => `categories/${id}/attachments`,
  },
  tag: {
    transactions: (id) => `tags/${encodeURIComponent(id)}/transactions`,
    attachments: (id) => `tags/${encodeURIComponent(id)}/attachments`,
  },
  budget: {
    transactions: (id) => `budgets/${id}/transactions`,
    attachments: (id) => `budgets/${id}/attachments`,
  },
  'piggy-bank': {
    events: (id) => `piggy-banks/${id}/events`,
    attachments: (id) => `piggy-banks/${id}/attachments`,
  },
  transaction: {
    attachments: (id) => `transactions/${id}/attachments`,
    'piggy-bank-events': (id) => `transactions/${id}/piggy-bank-events`,
  },
  bill: {
    transactions: (id) => `bills/${id}/transactions`,
    rules: (id) => `bills/${id}/rules`,
    attachments: (id) => `bills/${id}/attachments`,
  },
  subscription: {
    transactions: (id) => `subscriptions/${id}/transactions`,
    rules: (id) => `subscriptions/${id}/rules`,
    attachments: (id) => `subscriptions/${id}/attachments`,
  },
  recurrence: {
    transactions: (id) => `recurrences/${id}/transactions`,
  },
};

async function listOne(client, resource, args, config, signal) {
  const limit = args.limit ?? config.pageSize;
  const page = args.page ?? 1;
  const filters = {
    type: args.type,
    start: args.start,
    end: args.end,
    page,
    limit,
  };
  // Firefly III 6.7 added the active/inactive filter to GET /v1/accounts.
  if (resource === 'accounts' && args.active !== undefined) filters.active = args.active;
  if (resource === 'accounts' && args.date) filters.date = args.date;
  const paths = {
    accounts: 'accounts',
    categories: 'categories',
    tags: 'tags',
    budgets: 'budgets',
    'budget-limits': 'budget-limits',
    'available-budgets': 'available-budgets',
    bills: 'bills',
    subscriptions: 'subscriptions',
    'piggy-banks': 'piggy-banks',
    recurrences: 'recurrences',
    rules: 'rules',
    'rule-groups': 'rule-groups',
    'link-types': 'link-types',
    'transaction-links': 'transaction-links',
    currencies: 'currencies',
    'exchange-rates': 'exchange-rates',
    'object-groups': 'object-groups',
    attachments: 'attachments',
  };
  const path = paths[resource];
  if (!path) fail('INVALID_PARAMETER', `resource "${resource}" cannot be listed with firefly_lookup.list.`);
  if (resource === 'budget-limits') {
    assertDateRange(args.start, args.end);
    filters.start = args.start;
    filters.end = args.end;
  }
  const payload = await client.get(path, filters, { signal });
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return {
    resource,
    items: data.map((entry) => compactFor(resource, entry)),
    meta: pageInfo(payload, limit),
  };
}

export const lookupTool = jsonTool({
  name: 'firefly_lookup',
  description:
    'Read live Firefly III metadata and records before any write: list accounts (optionally active-only or as of a date), categories/tags/budgets and other resources, autocomplete a name (including transaction metadata), search transactions or accounts, or fetch records related to one object. Use this instead of guessing ids.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'autocomplete', 'search', 'search-accounts', 'related'],
        description: 'list reads one resource; autocomplete finds a name; search runs the transaction search syntax; search-accounts searches account names/IBAN/number; related reads children of one object.',
      },
      resource: {
        type: 'string',
        enum: LOOKUP_RESOURCES,
        description: 'For list: the resource to read. Use all for accounts, categories, budgets and tags in one call. transactions-with-meta is autocomplete only.',
      },
      query: { type: 'string', description: 'Search or autocomplete text (required for search, search-accounts and autocomplete).' },
      field: {
        type: 'string',
        enum: ['all', 'name', 'iban', 'number', 'id'],
        default: 'all',
        description: 'search-accounts field to match; default all.',
      },
      type: {
        type: 'string',
        description: 'Optional account type filter (asset, liability, expense, revenue, cash) or transaction type filter (all, withdrawal, deposit, transfer).',
      },
      relation: {
        type: 'string',
        description: 'For related: transactions, attachments, piggy-banks, events, rules, piggy-bank-events.',
      },
      relatedTo: {
        type: 'string',
        enum: ['account', 'category', 'tag', 'budget', 'piggy-bank', 'transaction', 'bill', 'subscription', 'recurrence'],
        description: 'For related: object kind that owns the id.',
      },
      id: { type: 'string', description: 'For related: exact object id (tag name is accepted for tag).' },
      start: { type: 'string', description: 'YYYY-MM-DD lower bound for list/related transaction reads.' },
      end: { type: 'string', description: 'YYYY-MM-DD upper bound (must be after start).' },
      active: { type: 'boolean', description: 'For accounts: true lists active accounts, false lists disabled ones; omit for all (Firefly III 6.7+).' },
      date: { type: 'string', description: 'For accounts: YYYY-MM-DD; returns balances calculated as of that date.' },
      page: { type: 'integer', description: '1-based page for list/search; default 1.' },
      limit: { type: 'integer', description: 'Page size; defaults to the plugin pageSize (max 100).' },
    },
    required: ['action'],
  },
  async execute(args, exec) {
    const { client, config } = exec;
    const signal = exec.signal;
    const action = args.action;
    if (action === 'search') {
      if (!args.query) fail('MISSING_FIELD', 'query is required for search.');
      const limit = args.limit ?? config.pageSize;
      const payload = await client.get('search/transactions', { query: args.query, page: args.page ?? 1, limit }, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const meta = pageInfo(payload, limit);
      return {
        ok: true,
        summary: `${data.length} transaction group(s) matched "${args.query}".`,
        items: data.map((entry) => compactTransactionGroup(entry)),
        counts: { returned: data.length, total: meta.total },
        truncated: Boolean(paginationHint(meta)),
        ...(paginationHint(meta) ? { hint: paginationHint(meta) } : {}),
      };
    }
    if (action === 'search-accounts') {
      if (!args.query) fail('MISSING_FIELD', 'query is required for search-accounts.');
      const limit = args.limit ?? config.pageSize;
      const payload = await client.get(
        'search/accounts',
        { query: args.query, field: args.field ?? 'all', type: args.type, page: args.page ?? 1, limit },
        { signal },
      );
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const meta = pageInfo(payload, limit);
      return {
        ok: true,
        summary: `${data.length} account(s) matched "${args.query}".`,
        items: data.map((entry) => compactFor('accounts', entry)),
        counts: { returned: data.length, total: meta.total },
        truncated: Boolean(paginationHint(meta)),
        ...(paginationHint(meta) ? { hint: paginationHint(meta) } : {}),
      };
    }
    if (action === 'autocomplete') {
      if (!args.query) fail('MISSING_FIELD', 'query is required for autocomplete.');
      if (!args.resource || args.resource === 'all') fail('INVALID_PARAMETER', 'resource is required for autocomplete.');
      const limit = args.limit ?? 10;
      const payload = await client.get(
        `autocomplete/${args.resource}`,
        { query: args.query, limit },
        { signal },
      );
      // Firefly III autocomplete endpoints return a bare JSON array, not JSON:API.
      const data = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
      return {
        ok: true,
        summary: `${data.length} autocomplete result(s) for "${args.query}".`,
        items: data.map((entry) => compactFor(args.resource, entry)),
        counts: { returned: data.length },
      };
    }
    if (action === 'related') {
      if (!args.relatedTo || !args.id || !args.relation) {
        fail('MISSING_FIELD', 'related requires relatedTo, id and relation.');
      }
      const route = RELATED_ROUTES[args.relatedTo]?.[args.relation];
      if (!route) {
        fail('INVALID_PARAMETER', `relation "${args.relation}" is not available for ${args.relatedTo}.`);
      }
      const query = {};
      if (args.relation === 'transactions') {
        if (args.start || args.end) {
          const range = assertDateRange(args.start, args.end);
          query.start = range.start;
          query.end = range.end;
        }
        query.type = assertTransactionType(args.type);
        query.limit = args.limit ?? config.pageSize;
        query.page = args.page ?? 1;
      }
      const payload = await client.get(route(args.id), query, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const compact =
        args.relation === 'transactions'
          ? data.map((entry) => compactTransactionGroup(entry))
          : data.map((entry) => {
              if (args.relation === 'attachments') return compactAttachment(entry);
              if (args.relation === 'piggy-banks') return compactPiggyBank(entry);
              if (args.relation === 'rules') return compactRule(entry);
              if (args.relation === 'events' || args.relation === 'piggy-bank-events') return compactGeneric(entry);
              return compactFor(args.resource ?? 'accounts', entry);
            });
      return {
        ok: true,
        summary: `${data.length} ${args.relation} record(s) related to ${args.relatedTo} ${args.id}.`,
        items: compact,
        counts: { returned: data.length },
      };
    }
    if (action !== 'list') fail('INVALID_PARAMETER', `Unknown action "${action}".`);
    if (args.resource === 'all' || (!args.resource && action === 'list')) {
      const resources = ['accounts', 'categories', 'budgets', 'tags'];
      const results = await Promise.all(resources.map((resource) => listOne(client, resource, args, config, signal)));
      return {
        ok: true,
        summary: `Live metadata: ${results.map((result) => `${result.resource}=${result.items.length}`).join(', ')}.`,
        items: results,
        counts: Object.fromEntries(results.map((result) => [result.resource, result.items.length])),
        hint: 'Pass resource to read one table; ids shown here are the only ids safe to submit when autoCreate is false.',
      };
    }
    const result = await listOne(client, args.resource, args, config, signal);
    return {
      ok: true,
      summary: `${result.items.length} ${result.resource} record(s).`,
      items: result.items,
      counts: { returned: result.items.length, total: result.meta.total },
      truncated: Boolean(paginationHint(result.meta)),
      hint:
        args.resource === 'accounts' && !args.type && args.active === undefined
          ? 'Default listing includes disabled accounts; pass type=asset|expense|revenue|liability|cash or active=true to narrow.'
          : paginationHint(result.meta),
    };
  },
});
