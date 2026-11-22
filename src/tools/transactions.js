/** firefly_transactions: transaction queries, updates, deletion and account bulk move. */
import { jsonTool, pageInfo, paginationHint } from '../toolkit.js';
import {
  compactSplit,
  compactTransactionGroup,
  attributesOf,
} from '../format.js';
import {
  assertDateRange,
  assertTransactionType,
  confirmRoutineWrite,
  fetchMetadata,
  normalizeSplit,
  requireApproval,
} from '../policy.js';
import { FireflyError, fail } from '../errors.js';
import { transactionSplitSchema } from '../schemas.js';

const CORE_FIELDS = ['type', 'date', 'amount', 'description', 'source_id', 'destination_id', 'category_id', 'budget_id', 'tags', 'notes'];

function transactionEndpoint(id) {
  return `transactions/${encodeURIComponent(id)}`;
}

function existingSplitsOf(payload) {
  return Array.isArray(payload?.data?.attributes?.transactions) ? payload.data.attributes.transactions : [];
}

const PRESERVED_FIELDS = [
  'transaction_journal_id',
  'type',
  'date',
  'amount',
  'description',
  'source_id',
  'destination_id',
  'category_id',
  'budget_id',
  'tags',
  'notes',
  'currency_id',
  'currency_code',
  'foreign_amount',
  'foreign_currency_id',
  'foreign_currency_code',
  'bill_id',
  'piggy_bank_id',
  'reconciled',
  'order',
  'internal_reference',
  'external_id',
  'external_url',
  'sepa_cc',
  'sepa_ct_op',
  'sepa_ct_id',
  'sepa_db',
  'sepa_country',
  'sepa_ep',
  'sepa_ci',
  'sepa_batch_id',
  'interest_date',
  'book_date',
  'process_date',
  'due_date',
  'payment_date',
  'invoice_date',
];

function normalizeExisting(split) {
  const result = {};
  for (const field of PRESERVED_FIELDS) {
    if (split[field] !== undefined) result[field] = Array.isArray(split[field]) ? [...split[field]] : split[field];
  }
  return result;
}

function changedFields(before, after) {
  const changed = [];
  for (const field of CORE_FIELDS) {
    if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) changed.push(field);
  }
  return changed;
}

async function forceBudgetId(split, metadata, config, warnings) {
  if (!split.budget_name) return;
  if (split.budget_id) {
    delete split.budget_name;
    return;
  }
  const needle = String(split.budget_name).trim().toLowerCase();
  const matches = (metadata.budgets?.items ?? []).filter((item) => String(item.name).trim().toLowerCase() === needle);
  if (matches.length === 1) {
    split.budget_id = String(matches[0].id);
    delete split.budget_name;
    return;
  }
  throw new FireflyError(
    'BUDGET_NAME_UNSUPPORTED',
    `Cannot update budget "${split.budget_name}": Firefly III ignores budget_name on update. Pass an exact budget_id from firefly_lookup.`,
  );
}

export const transactionsTool = jsonTool({
  name: 'firefly_transactions',
  description:
    'Query Firefly III transactions: list, get a transaction group (with splits), get one transaction journal, update splits (reads the group first and merges), delete a group, move all transactions of one account to another, or list journal links. Update and deletion need real ids from this tool or firefly_lookup; destructive calls require approval.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'journal', 'update', 'delete', 'bulk-move', 'journal-links'],
        description: 'list reads a page of transaction groups; get reads one group; journal reads one split; update mutates splits; delete removes a whole group; bulk-move reassigns every transaction of one account; journal-links lists links of one split.',
      },
      id: { type: 'string', description: 'Transaction group id for get/update/delete; transaction journal id for journal/journal-links.' },
      start: { type: 'string', description: 'YYYY-MM-DD lower bound for list.' },
      end: { type: 'string', description: 'YYYY-MM-DD upper bound (must be after start).' },
      type: { type: 'string', description: 'Transaction type filter: all, withdrawal, deposit, transfer.' },
      accountId: { type: 'string', description: 'For list: restrict to one account by id.' },
      page: { type: 'integer', description: '1-based page; default 1.' },
      limit: { type: 'integer', description: 'Page size; defaults to plugin pageSize (max 100).' },
      transactions: {
        type: 'array',
        items: transactionSplitSchema,
        description: 'For update: the splits to write. For a multi-split group send every split and keep each transaction_journal_id; omitted splits may be deleted by Firefly III.',
      },
      applyRules: { type: 'boolean', default: true, description: 'For update: let Firefly III apply rules.' },
      fireWebhooks: { type: 'boolean', default: true, description: 'For update: let Firefly III fire webhooks.' },
      fromAccountId: { type: 'string', description: 'For bulk-move: account whose transactions are reassigned.' },
      toAccountId: { type: 'string', description: 'For bulk-move: destination account id.' },
    },
    required: ['action'],
  },
  async execute(args, exec) {
    const { client, config } = exec;
    const signal = exec.signal;

    if (args.action === 'list') {
      const range = args.start || args.end ? assertDateRange(args.start, args.end) : {};
      const limit = args.limit ?? config.pageSize;
      const query = { start: range.start, end: range.end, type: assertTransactionType(args.type), page: args.page ?? 1, limit };
      const path = args.accountId ? `accounts/${encodeURIComponent(args.accountId)}/transactions` : 'transactions';
      const payload = await client.get(path, query, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const meta = pageInfo(payload, limit);
      const hint = paginationHint(meta);
      return {
        ok: true,
        summary: `${data.length} transaction group(s) returned.`,
        items: data.map((entry) => compactTransactionGroup(entry)),
        counts: { returned: data.length, total: meta.total },
        truncated: Boolean(hint),
        ...(hint ? { hint } : {}),
      };
    }

    if (args.action === 'get' || args.action === 'journal' || args.action === 'journal-links') {
      if (!args.id) fail('MISSING_FIELD', 'id is required.');
      if (args.action === 'get') {
        const payload = await client.get(transactionEndpoint(args.id), undefined, { signal });
        return {
          ok: true,
          summary: `Transaction group ${args.id}.`,
          items: [compactTransactionGroup(payload?.data, { includeNotes: true })],
          counts: { returned: 1 },
        };
      }
      if (args.action === 'journal') {
        const payload = await client.get(`transaction-journals/${encodeURIComponent(args.id)}`, undefined, { signal });
        const attributes = attributesOf(payload?.data);
        return {
          ok: true,
          summary: `Transaction journal ${args.id}.`,
          items: [compactSplit({ ...attributes, transaction_journal_id: attributes.transaction_journal_id ?? payload?.data?.id }, { includeNotes: true })],
          counts: { returned: 1 },
        };
      }
      const payload = await client.get(`transaction-journals/${encodeURIComponent(args.id)}/links`, undefined, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      return {
        ok: true,
        summary: `${data.length} link(s) for journal ${args.id}.`,
        items: data.map((entry) => attributesOf(entry)),
        counts: { returned: data.length },
      };
    }

    if (args.action === 'update') {
      if (!args.id) fail('MISSING_FIELD', 'id is required for update.');
      if (!Array.isArray(args.transactions) || args.transactions.length === 0) {
        fail('INVALID_PAYLOAD', 'transactions must contain the split(s) to update.');
      }
      const payload = await client.get(transactionEndpoint(args.id), undefined, { signal });
      const existing = existingSplitsOf(payload);
      if (existing.length === 0) fail('INVALID_RESOURCE', `Transaction group ${args.id} has no splits.`);
      if (existing.length > 1 && args.transactions.length !== existing.length) {
        fail(
          'NEED_ALL_SPLITS',
          `This group has ${existing.length} splits: send every split back with its transaction_journal_id; sending ${args.transactions.length} may delete the omitted splits.`,
        );
      }
      const metadata = await fetchMetadata(client, { signal, include: ['accounts', 'categories', 'budgets', 'tags'] });
      const warnings = [];
      const before = existing.map((split) => compactSplit(split, { includeNotes: true }));
      const mergedPayloads = [];
      for (const [index, incoming] of args.transactions.entries()) {
        let base;
        if (existing.length === 1) {
          base = normalizeExisting(existing[0]);
        } else {
          if (!incoming.transaction_journal_id) {
            fail('NEED_JOURNAL_ID', `transactions[${index}] is missing transaction_journal_id in a multi-split update.`);
          }
          const match = existing.find((split) => String(split.transaction_journal_id) === String(incoming.transaction_journal_id));
          if (!match) fail('INVALID_ID', `transaction_journal_id ${incoming.transaction_journal_id} does not belong to group ${args.id}.`);
          base = normalizeExisting(match);
        }
        const merged = { ...base, ...structuredClone(incoming) };
        await forceBudgetId(merged, metadata, config, warnings);
        normalizeSplit(merged, index, { config, metadata, timeZone: config.timeZone, warnings, update: true });
        mergedPayloads.push(merged);
      }
      const updateBody = {
        transactions: mergedPayloads,
        apply_rules: args.applyRules !== false,
        fire_webhooks: args.fireWebhooks !== false,
      };
      const detail = mergedPayloads.map((split) => `${split.type} ${split.amount} ${split.description}`).join('; ');
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Update transaction group ${args.id}: ${detail}`,
        displayReason: { en: `Update transaction group ${args.id}: ${detail}`, zh: `准备修改交易 ${args.id}：${detail}` },
      });
      await client.put(transactionEndpoint(args.id), updateBody, { signal });
      const afterPayload = await client.get(transactionEndpoint(args.id), undefined, { signal });
      const after = compactTransactionGroup(afterPayload?.data, { includeNotes: true });
      return {
        ok: true,
        summary: `Updated transaction group ${args.id}.`,
        items: [{ id: args.id, before, after }],
        counts: { splits: mergedPayloads.length },
        warnings,
        hint: 'Compare before and after; Firefly III rules may rewrite fields after submission.',
      };
    }

    if (args.action === 'delete') {
      if (!args.id) fail('MISSING_FIELD', 'id is required for delete.');
      const payload = await client.get(transactionEndpoint(args.id), undefined, { signal });
      const group = compactTransactionGroup(payload?.data, { includeNotes: true });
      const description = group.splits.map((split) => `${split.description} ${split.amount}`).join('; ');
      await requireApproval(exec.ctx, exec, {
        reason: `Delete transaction group ${args.id}: ${description}`,
        displayReason: { en: `Delete transaction group ${args.id}: ${description}`, zh: `删除交易组 ${args.id}：${description}` },
      });
      await client.delete(transactionEndpoint(args.id), { signal });
      return {
        ok: true,
        summary: `Deleted transaction group ${args.id}.`,
        items: [{ deleted: group }],
        counts: { deleted: 1 },
      };
    }

    if (args.action === 'bulk-move') {
      if (!args.fromAccountId || !args.toAccountId) {
        fail('MISSING_FIELD', 'bulk-move requires fromAccountId and toAccountId.');
      }
      if (String(args.fromAccountId) === String(args.toAccountId)) fail('INVALID_PARAMETER', 'fromAccountId and toAccountId must differ.');
      const [from, to] = await Promise.all([
        client.get(`accounts/${encodeURIComponent(args.fromAccountId)}`, undefined, { signal }),
        client.get(`accounts/${encodeURIComponent(args.toAccountId)}`, undefined, { signal }),
      ]);
      const fromName = attributesOf(from?.data).name;
      const toName = attributesOf(to?.data).name;
      const query = JSON.stringify({ where: { account_id: String(args.fromAccountId) }, update: { account_id: String(args.toAccountId) } });
      await requireApproval(exec.ctx, exec, {
        reason: `Move every transaction of account ${fromName ?? args.fromAccountId} (${args.fromAccountId}) to ${toName ?? args.toAccountId} (${args.toAccountId}). This rewrites all matching splits in one operation.`,
        displayReason: {
          en: `Move all transactions from ${fromName ?? args.fromAccountId} to ${toName ?? args.toAccountId}`,
          zh: `把账户「${fromName ?? args.fromAccountId}」的全部交易搬迁到「${toName ?? args.toAccountId}」`,
        },
      });
      await client.post('data/bulk/transactions', undefined, { signal, query: { query } });
      return {
        ok: true,
        summary: `Moved matching transactions from ${fromName ?? args.fromAccountId} to ${toName ?? args.toAccountId}.`,
        items: [{ from: { id: args.fromAccountId, name: fromName }, to: { id: args.toAccountId, name: toName } }],
        hint: 'Firefly III only supports this account-to-account move; categories, budgets and amounts cannot be bulk-updated.',
      };
    }

    return fail('INVALID_PARAMETER', `Unknown action "${args.action}".`);
  },
});
