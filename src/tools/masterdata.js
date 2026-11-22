/** firefly_masterdata: accounts, categories, tags, budgets and budget limits. */
import { jsonTool, pageInfo, paginationHint } from '../toolkit.js';
import { compactFor } from './lookup.js';
import { compactBudgetLimit, compactTransactionGroup } from '../format.js';
import {
  assertCreateAllowed,
  assertDateRange,
  assertTransactionType,
  confirmRoutineWrite,
  requireApproval,
  requireFields,
} from '../policy.js';
import { fail } from '../errors.js';

const RESOURCE_PATHS = {
  account: { path: 'accounts', plural: 'accounts', createKey: 'accounts', label: 'account' },
  category: { path: 'categories', plural: 'categories', createKey: 'categories', label: 'category' },
  tag: { path: 'tags', plural: 'tags', createKey: 'tags', label: 'tag' },
  budget: { path: 'budgets', plural: 'budgets', createKey: 'budgets', label: 'budget' },
};

const REQUIRED_CREATE_FIELDS = {
  account: ['name', 'type'],
  category: ['name'],
  tag: ['tag'],
  budget: ['name'],
};

function pathFor(resource, id) {
  const spec = RESOURCE_PATHS[resource];
  if (!spec) fail('INVALID_PARAMETER', `resource must be one of ${Object.keys(RESOURCE_PATHS).join(', ')}.`);
  const segment = encodeURIComponent(String(id ?? ''));
  return id === undefined ? spec.path : `${spec.path}/${segment}`;
}

function createEndpoint(resource) {
  return pathFor(resource);
}

async function callAndCompact(client, path, query, signal, plural) {
  const payload = await client.get(path, query, { signal });
  const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
  return { payload, items: data.map((entry) => compactFor(plural, entry)) };
}

export const masterdataTool = jsonTool({
  name: 'firefly_masterdata',
  description:
    'Maintain Firefly III master data: accounts, categories, tags, budgets, budget limits, available budgets and budget-transaction checks. Creating a resource is refused when its autoCreate switch is false. Deleting objects and changing budget limits always require approval.',
  parameters: {
    type: 'object',
    properties: {
      resource: {
        type: 'string',
        enum: ['account', 'category', 'tag', 'budget'],
        description: 'Object family for list/get/create/update/delete. Budget limits use action=limit-* with budgetId.',
      },
      action: {
        type: 'string',
        enum: [
          'list',
          'get',
          'create',
          'update',
          'delete',
          'limits-list',
          'limit-get',
          'limit-create',
          'limit-update',
          'limit-delete',
          'available-budgets',
          'available-budget-get',
          'budget-transactions',
          'budget-limit-transactions',
          'transactions-without-budget',
        ],
        description: 'CRUD for master data plus budget-limit and budget-transaction inspection actions.',
      },
      id: { type: 'string', description: 'Object id (tag name or id for tags); budget id for budget-limit actions.' },
      budgetId: { type: 'string', description: 'Budget id for budget-limit actions.' },
      limitId: { type: 'string', description: 'Budget limit id for limit-get/update/delete and budget-limit-transactions.' },
      data: {
        type: 'object',
        description: 'Fields for create/update. account needs name+type (credit_card_type/monthly_payment_date for ccAsset); category needs name, optional color (6 hex chars without #); tag needs tag; budget needs name. Budget limit needs amount,start,end.',
      },
      start: { type: 'string', description: 'YYYY-MM-DD lower bound for list/budget reads/report checks.' },
      end: { type: 'string', description: 'YYYY-MM-DD upper bound (must be after start).' },
      type: { type: 'string', description: 'Account type filter or transaction type filter (all, withdrawal, deposit, transfer).' },
      active: { type: 'boolean', description: 'For accounts: true lists active accounts, false lists disabled ones; omit for all (Firefly III 6.7+).' },
      date: { type: 'string', description: 'For accounts: YYYY-MM-DD; returns balances calculated as of that date.' },
      page: { type: 'integer', description: '1-based page for list actions; default 1.' },
      limit: { type: 'integer', description: 'Page size; defaults to plugin pageSize (max 100).' },
    },
    required: ['action'],
  },
  async execute(args, exec) {
    const { client, config } = exec;
    const signal = exec.signal;
    const action = args.action;

    if (action === 'available-budgets') {
      const range = args.start || args.end ? assertDateRange(args.start, args.end) : {};
      const payload = await client.get('available-budgets', { start: range.start, end: range.end }, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      return {
        ok: true,
        summary: `${data.length} available-budget record(s).`,
        items: data.map((entry) => compactFor('available-budgets', entry)),
        counts: { returned: data.length },
      };
    }
    if (action === 'available-budget-get') {
      if (!args.id) fail('MISSING_FIELD', 'id is required.');
      const payload = await client.get(`available-budgets/${encodeURIComponent(args.id)}`, undefined, { signal });
      return { ok: true, summary: `Available budget ${args.id}.`, items: [compactFor('available-budgets', payload?.data)] };
    }
    if (action === 'budget-transactions' || action === 'budget-limit-transactions') {
      if (!args.budgetId) fail('MISSING_FIELD', 'budgetId is required.');
      const limit = args.limit ?? config.pageSize;
      const query = {
        start: args.start,
        end: args.end,
        type: assertTransactionType(args.type),
        page: args.page ?? 1,
        limit,
      };
      if (args.start || args.end) {
        const range = assertDateRange(args.start, args.end);
        query.start = range.start;
        query.end = range.end;
      }
      let path;
      if (action === 'budget-limit-transactions') {
        if (!args.limitId) fail('MISSING_FIELD', 'limitId is required for budget-limit-transactions.');
        path = `budgets/${encodeURIComponent(args.budgetId)}/limits/${encodeURIComponent(args.limitId)}/transactions`;
        delete query.start;
        delete query.end;
      } else {
        path = `budgets/${encodeURIComponent(args.budgetId)}/transactions`;
      }
      const payload = await client.get(path, query, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const meta = pageInfo(payload, limit);
      const hint = paginationHint(meta);
      return {
        ok: true,
        summary: `${data.length} transaction group(s) matched.`,
        items: data.map((entry) => compactTransactionGroup(entry)),
        counts: { returned: data.length, total: meta.total },
        truncated: Boolean(hint),
        ...(hint ? { hint } : {}),
      };
    }
    if (action === 'transactions-without-budget') {
      const limit = args.limit ?? config.pageSize;
      const query = { page: args.page ?? 1, limit, type: assertTransactionType(args.type) };
      if (args.start || args.end) {
        const range = assertDateRange(args.start, args.end);
        query.start = range.start;
        query.end = range.end;
      }
      const payload = await client.get('budgets/transactions-without-budget', query, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const meta = pageInfo(payload, limit);
      const hint = paginationHint(meta);
      return {
        ok: true,
        summary: `${data.length} transaction group(s) without a budget.`,
        items: data.map((entry) => compactTransactionGroup(entry)),
        counts: { returned: data.length, total: meta.total },
        truncated: Boolean(hint),
        ...(hint ? { hint } : {}),
      };
    }

    if (action === 'limits-list' || action === 'limit-get' || action === 'limit-create' || action === 'limit-update' || action === 'limit-delete') {
      const budgetId = args.budgetId ?? args.id;
      if (!budgetId) fail('MISSING_FIELD', 'budgetId is required for budget-limit actions.');
      if (action === 'limits-list') {
        const query = { page: args.page ?? 1, limit: args.limit ?? config.pageSize };
        if (args.start || args.end) {
          const range = assertDateRange(args.start, args.end);
          query.start = range.start;
          query.end = range.end;
        }
        const payload = await client.get(`budgets/${encodeURIComponent(budgetId)}/limits`, query, { signal });
        const data = Array.isArray(payload?.data) ? payload.data : [];
        return {
          ok: true,
          summary: `${data.length} budget limit(s) for budget ${budgetId}.`,
          items: data.map((entry) => compactBudgetLimit(entry)),
          counts: { returned: data.length },
        };
      }
      if (action === 'limit-get' || action === 'limit-update' || action === 'limit-delete') {
        if (!args.limitId) fail('MISSING_FIELD', 'limitId is required.');
      }
      const limitPath = `budgets/${encodeURIComponent(budgetId)}/limits/${encodeURIComponent(args.limitId ?? '')}`;
      if (action === 'limit-get') {
        const payload = await client.get(limitPath, undefined, { signal });
        return { ok: true, summary: `Budget limit ${args.limitId}.`, items: [compactBudgetLimit(payload?.data)] };
      }
      if (action === 'limit-create') {
        assertCreateAllowed(config, 'budgets', 'budget limit');
        const data = requireFields(args.data, ['amount', 'start', 'end'], 'budget limit');
        const body = { ...data, budget_id: Number(budgetId) };
        assertDateRange(body.start, body.end);
        await confirmRoutineWrite(exec.ctx, exec, config, {
          reason: `Create budget limit ${body.amount} for budget ${budgetId} (${body.start}..${body.end})`,
          displayReason: { en: `Create budget limit ${body.amount}`, zh: `新增预算额度 ${body.amount}` },
        });
        const payload = await client.post(`budgets/${encodeURIComponent(budgetId)}/limits`, body, { signal });
        return { ok: true, summary: `Created budget limit for budget ${budgetId}.`, items: [compactBudgetLimit(payload?.data)] };
      }
      if (action === 'limit-update') {
        const data = requireFields(args.data, [], 'budget limit update');
        if (data.start && data.end) assertDateRange(data.start, data.end);
        const body = { ...data };
        delete body.budget_id;
        await requireApproval(exec.ctx, exec, {
          reason: `Update budget limit ${args.limitId} of budget ${budgetId}`,
          displayReason: { en: `Update budget limit ${args.limitId}`, zh: `修改预算额度 ${args.limitId}` },
        });
        const payload = await client.put(limitPath, body, { signal });
        return { ok: true, summary: `Updated budget limit ${args.limitId}.`, items: [compactBudgetLimit(payload?.data)] };
      }
      await requireApproval(exec.ctx, exec, {
        reason: `Delete budget limit ${args.limitId} of budget ${budgetId}`,
        displayReason: { en: `Delete budget limit ${args.limitId}`, zh: `删除预算额度 ${args.limitId}` },
      });
      await client.delete(limitPath, { signal });
      return { ok: true, summary: `Deleted budget limit ${args.limitId}.`, items: [{ deletedLimitId: args.limitId }] };
    }

    const resource = args.resource;
    const spec = RESOURCE_PATHS[resource];
    if (!spec || !['list', 'get', 'create', 'update', 'delete'].includes(action)) {
      fail('INVALID_PARAMETER', 'resource and action must identify a supported master-data operation.');
    }

    if (action === 'list') {
      const query = { page: args.page ?? 1, limit: args.limit ?? config.pageSize };
      if (resource === 'account') {
        query.type = args.type;
        if (args.active !== undefined) query.active = args.active;
        if (args.date) query.date = args.date;
      }
      if (resource === 'budget' && (args.start || args.end)) {
        const range = assertDateRange(args.start, args.end);
        query.start = range.start;
        query.end = range.end;
      }
      const payload = await client.get(spec.path, query, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const meta = pageInfo(payload, args.limit ?? config.pageSize);
      const hint = paginationHint(meta);
      return {
        ok: true,
        summary: `${data.length} ${spec.label}(s).`,
        items: data.map((entry) => compactFor(spec.plural, entry)),
        counts: { returned: data.length, total: meta.total },
        truncated: Boolean(hint),
        ...(hint ? { hint } : {}),
      };
    }

    if (action === 'get') {
      if (!args.id) fail('MISSING_FIELD', 'id is required.');
      const query = resource === 'budget' && (args.start || args.end) ? assertDateRange(args.start, args.end) : {};
      const payload = await client.get(pathFor(resource, args.id), query, { signal });
      return { ok: true, summary: `${spec.label} ${args.id}.`, items: [compactFor(spec.plural, payload?.data)] };
    }

    if (action === 'create') {
      assertCreateAllowed(config, spec.createKey, spec.label);
      const data = requireFields(args.data, REQUIRED_CREATE_FIELDS[resource], `${spec.label} create`);
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Create ${spec.label} ${data.name ?? data.tag}`,
        displayReason: { en: `Create ${spec.label} ${data.name ?? data.tag}`, zh: `新建${spec.label}「${data.name ?? data.tag}」` },
      });
      const payload = await client.post(createEndpoint(resource), data, { signal });
      return { ok: true, summary: `Created ${spec.label} ${data.name ?? data.tag}.`, items: [compactFor(spec.plural, payload?.data)] };
    }

    if (action === 'update') {
      if (!args.id) fail('MISSING_FIELD', 'id is required.');
      const data = requireFields(args.data, [], `${spec.label} update`);
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Update ${spec.label} ${args.id}`,
        displayReason: { en: `Update ${spec.label} ${args.id}`, zh: `修改${spec.label} ${args.id}` },
      });
      const payload = await client.put(pathFor(resource, args.id), data, { signal });
      return { ok: true, summary: `Updated ${spec.label} ${args.id}.`, items: [compactFor(spec.plural, payload?.data)] };
    }

    if (!args.id) fail('MISSING_FIELD', 'id is required.');
    const target = await client.get(pathFor(resource, args.id), undefined, { signal });
    const compact = compactFor(spec.plural, target?.data);
    await requireApproval(exec.ctx, exec, {
      reason: `Delete ${spec.label} ${args.id} (${compact.name ?? compact.tag ?? compact.id})`,
      displayReason: { en: `Delete ${spec.label} ${args.id}`, zh: `删除${spec.label} ${args.id}` },
    });
    await client.delete(pathFor(resource, args.id), { signal });
    return { ok: true, summary: `Deleted ${spec.label} ${args.id}.`, items: [{ deleted: compact }], counts: { deleted: 1 } };
  },
});
