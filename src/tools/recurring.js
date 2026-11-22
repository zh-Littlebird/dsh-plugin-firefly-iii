/** firefly_recurring: bills/subscriptions, recurring transactions, piggy banks. */
import { jsonTool } from '../toolkit.js';
import { compactFor } from './lookup.js';
import { compactTransactionGroup } from '../format.js';
import {
  assertCreateAllowed,
  assertDate,
  confirmRoutineWrite,
  requireApproval,
  requireFields,
} from '../policy.js';
import { fail } from '../errors.js';

const RESOURCES = {
  bill: { path: 'bills', plural: 'bills', label: 'bill/subscription', createFields: ['name', 'amount_min', 'amount_max', 'date', 'repeat_freq'] },
  subscription: { path: 'subscriptions', plural: 'subscriptions', label: 'subscription', createFields: ['name', 'amount_min', 'amount_max', 'date', 'repeat_freq'] },
  recurrence: {
    path: 'recurrences',
    plural: 'recurrences',
    label: 'recurrence',
    createFields: ['type', 'title', 'first_date', 'repeat_until', 'repetitions', 'transactions'],
  },
  'piggy-bank': {
    path: 'piggy-banks',
    plural: 'piggy-banks',
    label: 'piggy bank',
    createFields: ['name', 'account_id', 'target_amount', 'start_date'],
  },
};

function specFor(resource) {
  const spec = RESOURCES[resource];
  if (!spec) fail('INVALID_PARAMETER', `resource must be one of ${Object.keys(RESOURCES).join(', ')}.`);
  return spec;
}

export const recurringTool = jsonTool({
  name: 'firefly_recurring',
  description:
    'Manage Firefly III subscriptions/bills, recurring transactions and piggy banks: list, get, create, update, delete, trigger one recurrence occurrence, or read the transactions/events created by an object. Deletion and recurrence triggering always require approval.',
  parameters: {
    type: 'object',
    properties: {
      resource: {
        type: 'string',
        enum: ['bill', 'subscription', 'recurrence', 'piggy-bank'],
        description: 'Object family. Prefer subscription for new recurring bills; bill remains for compatibility.',
      },
      action: {
        type: 'string',
        enum: ['list', 'get', 'create', 'update', 'delete', 'trigger', 'transactions', 'events'],
        description: 'trigger is only valid for recurrence; events only for piggy-bank; transactions for bill/subscription/recurrence.',
      },
      id: { type: 'string', description: 'Object id for get/update/delete/trigger/transactions/events.' },
      data: {
        type: 'object',
        description: 'Create/update fields matching Firefly III schemas. Bill/subscription need name,amount_min,amount_max,date,repeat_freq; recurrence needs type,title,first_date,repeat_until,repetitions,transactions; piggy bank needs name,account_id,target_amount,start_date.',
      },
      date: { type: 'string', description: 'For trigger: YYYY-MM-DD occurrence date of the recurrence.' },
      active: { type: 'boolean', description: 'Optional convenience filter applied to list results.' },
    },
    required: ['resource', 'action'],
  },
  async execute(args, exec) {
    const { client, config } = exec;
    const signal = exec.signal;
    const spec = specFor(args.resource);

    if (args.action === 'list') {
      const payload = await client.get(spec.path, undefined, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const items = data.map((entry) => compactFor(spec.plural, entry));
      return {
        ok: true,
        summary: `${items.length} ${spec.label} record(s).`,
        items: args.active === undefined ? items : items.filter((item) => item.active === args.active),
        counts: { returned: items.length },
      };
    }

    if (!args.id && args.action !== 'create') fail('MISSING_FIELD', 'id is required.');

    if (args.action === 'get') {
      const payload = await client.get(`${spec.path}/${encodeURIComponent(args.id)}`, undefined, { signal });
      return { ok: true, summary: `${spec.label} ${args.id}.`, items: [compactFor(spec.plural, payload?.data)] };
    }

    if (args.action === 'transactions' || args.action === 'events') {
      const relation = args.action === 'events' ? 'events' : 'transactions';
      if (relation === 'events' && args.resource !== 'piggy-bank') fail('INVALID_PARAMETER', 'events are only available for piggy-banks.');
      if (relation === 'transactions' && args.resource === 'piggy-bank') fail('INVALID_PARAMETER', 'piggy-banks expose events, not transactions.');
      const payload = await client.get(`${spec.path}/${encodeURIComponent(args.id)}/${relation}`, undefined, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const items =
        relation === 'transactions'
          ? data.map((entry) => compactTransactionGroup(entry))
          : data.map((entry) => {
              const a = entry?.attributes ?? entry ?? {};
              return { id: entry?.id ?? a.id, amount: a.amount, date: a.date, piggyBankId: a.piggy_bank_id, type: a.type };
            });
      return {
        ok: true,
        summary: `${items.length} ${relation} record(s) for ${spec.label} ${args.id}.`,
        items,
        counts: { returned: items.length },
      };
    }

    if (args.action === 'create') {
      if (args.resource === 'piggy-bank') assertCreateAllowed(config, 'piggyBanks', 'piggy bank');
      const data = requireFields(args.data, spec.createFields, `${spec.label} create`);
      if (args.resource === 'bill' || args.resource === 'subscription') {
        data.date = assertDate(data.date, 'date');
      }
      if (args.resource === 'recurrence') {
        data.first_date = assertDate(data.first_date, 'first_date');
        data.repeat_until = assertDate(data.repeat_until, 'repeat_until');
        if (!Array.isArray(data.transactions) || data.transactions.length === 0) {
          fail('INVALID_PAYLOAD', 'recurrence.transactions must be a non-empty array of recurrence transaction objects.');
        }
      }
      if (args.resource === 'piggy-bank') data.start_date = assertDate(data.start_date, 'start_date');
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Create ${spec.label} ${data.name ?? data.title}`,
        displayReason: { en: `Create ${spec.label} ${data.name ?? data.title}`, zh: `新建${spec.label}「${data.name ?? data.title}」` },
      });
      const payload = await client.post(spec.path, data, { signal });
      return { ok: true, summary: `Created ${spec.label} ${data.name ?? data.title}.`, items: [compactFor(spec.plural, payload?.data)] };
    }

    if (args.action === 'update') {
      const data = requireFields(args.data, [], `${spec.label} update`);
      if (data.date) data.date = assertDate(data.date, 'date');
      if (data.first_date) data.first_date = assertDate(data.first_date, 'first_date');
      if (data.repeat_until) data.repeat_until = assertDate(data.repeat_until, 'repeat_until');
      if (data.start_date) data.start_date = assertDate(data.start_date, 'start_date');
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Update ${spec.label} ${args.id}`,
        displayReason: { en: `Update ${spec.label} ${args.id}`, zh: `修改${spec.label} ${args.id}` },
      });
      const payload = await client.put(`${spec.path}/${encodeURIComponent(args.id)}`, data, { signal });
      return { ok: true, summary: `Updated ${spec.label} ${args.id}.`, items: [compactFor(spec.plural, payload?.data)] };
    }

    if (args.action === 'trigger') {
      if (args.resource !== 'recurrence') fail('INVALID_PARAMETER', 'trigger is only valid for recurrence.');
      const date = assertDate(args.date, 'date');
      const payload = await client.get(`recurrences/${encodeURIComponent(args.id)}`, undefined, { signal });
      const recurrence = compactFor('recurrences', payload?.data);
      await requireApproval(exec.ctx, exec, {
        reason: `Trigger recurrence ${args.id} (${recurrence.title}) for occurrence ${date}; Firefly III creates the transaction now and labels it with today's date.`,
        displayReason: {
          en: `Trigger recurrence ${recurrence.title} for ${date}`,
          zh: `立即触发周期交易「${recurrence.title}」(${date})`,
        },
      });
      const created = await client.post(`recurrences/${encodeURIComponent(args.id)}/trigger`, undefined, { signal, query: { date } });
      return {
        ok: true,
        summary: `Triggered recurrence ${args.id} for ${date}.`,
        items: [created ? compactFor('transactions', created?.data) : { recurrenceId: args.id, date, triggered: true }],
        hint: 'Triggering creates a real transaction; delete it with firefly_transactions if it was only a test.',
      };
    }

    if (args.action === 'delete') {
      const payload = await client.get(`${spec.path}/${encodeURIComponent(args.id)}`, undefined, { signal });
      const compact = compactFor(spec.plural, payload?.data);
      const extra = args.resource === 'recurrence' ? ' Deletion does not remove transactions this recurrence already created.' : '';
      await requireApproval(exec.ctx, exec, {
        reason: `Delete ${spec.label} ${args.id} (${compact.name ?? compact.title}).${extra}`,
        displayReason: {
          en: `Delete ${spec.label} ${compact.name ?? compact.title}${extra}`,
          zh: `删除${spec.label}「${compact.name ?? compact.title}」${extra}`,
        },
      });
      await client.delete(`${spec.path}/${encodeURIComponent(args.id)}`, { signal });
      return { ok: true, summary: `Deleted ${spec.label} ${args.id}.${extra}`, items: [{ deleted: compact }], counts: { deleted: 1 } };
    }

    return fail('INVALID_PARAMETER', `Unknown action "${args.action}".`);
  },
});
