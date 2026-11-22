/** firefly_record: validated transaction creation with preview and approval. */
import { jsonTool } from '../toolkit.js';
import { renderRecord } from '../format.js';
import { compactTransactionGroup, parseAmountToCents, formatCents } from '../format.js';
import { fetchMetadata, normalizeSplit, confirmRoutineWrite } from '../policy.js';
import { fail } from '../errors.js';
import { transactionSplitSchema } from '../schemas.js';

function summarizeAmounts(splits) {
  const totals = new Map();
  for (const split of splits) {
    const currency = split.currency_code ?? '';
    totals.set(currency, (totals.get(currency) ?? 0) + parseAmountToCents(split.amount));
  }
  return [...totals.entries()]
    .filter(([currency]) => currency !== '')
    .map(([currency, cents]) => `${formatCents(cents)} ${currency}`)
    .join(', ');
}

function describeForApproval(splits) {
  return splits
    .slice(0, 5)
    .map((split) => `${split.type} ${split.amount} ${split.description} ${split.date}`)
    .join('; ');
}

function displayNames(split, metadata) {
  const nameOf = (catalogue, id) => (catalogue?.items ?? []).find((item) => String(item.id) === String(id))?.name;
  return {
    source: split.source_name ?? nameOf(metadata.accounts, split.source_id) ?? split.source_id,
    destination: split.destination_name ?? nameOf(metadata.accounts, split.destination_id) ?? split.destination_id,
    category: split.category_name ?? nameOf(metadata.categories, split.category_id) ?? split.category_id,
    budget: split.budget_name ?? nameOf(metadata.budgets, split.budget_id) ?? split.budget_id,
  };
}

export const recordTool = jsonTool({
  name: 'firefly_record',
  description:
    'Create Firefly III transactions. transactions is an array of splits: by default each split is submitted as an independent transaction; set split=true only when one purchase must be divided across categories/budgets. Without confirm=true it returns a validation preview and writes nothing. Every split needs a real HH:MM:SS timestamp.',
  parameters: {
    type: 'object',
    properties: {
      transactions: {
        type: 'array',
        items: transactionSplitSchema,
        description: 'Independent transactions by default. Each split requires type, date, amount, description, and source/destination account id or name resolved from firefly_lookup.',
      },
      split: {
        type: 'boolean',
        default: false,
        description: 'true submits all entries as splits of one transaction group; false submits each entry separately.',
      },
      confirm: {
        type: 'boolean',
        default: false,
        description: 'false (default) validates and previews only. true submits after optional approval.',
      },
      applyRules: {
        type: 'boolean',
        default: true,
        description: 'Ask Firefly III to apply rules to the new transaction(s).',
      },
      fireWebhooks: {
        type: 'boolean',
        default: true,
        description: 'Allow Firefly III to fire webhooks for the new transaction(s).',
      },
      errorIfDuplicateHash: {
        type: 'boolean',
        default: false,
        description: 'true rejects a transaction whose hash duplicates an existing one.',
      },
      groupTitle: { type: 'string', description: 'Only meaningful with split=true; title for the transaction group.' },
    },
    required: ['transactions'],
  },
  render: renderRecord,
  async execute(args, exec) {
    const { client, config } = exec;
    const signal = exec.signal;
    const entries = args.transactions;
    if (!Array.isArray(entries) || entries.length === 0) {
      fail('INVALID_PAYLOAD', 'transactions must be a non-empty array.');
    }
    if (entries.length > 50) {
      fail('INVALID_PAYLOAD', 'At most 50 splits may be submitted in one call; split the batch into smaller calls.');
    }
    const split = args.split === true;
    if (!split && args.groupTitle) {
      fail('INVALID_PAYLOAD', 'groupTitle requires split=true; independent transactions cannot share a group title.');
    }

    const metadata = await fetchMetadata(client, {
      signal,
      include: ['accounts', 'categories', 'budgets', 'tags', ...(entries.some((entry) => entry?.piggy_bank_id || entry?.piggy_bank_name) ? ['piggyBanks'] : [])],
    });
    const warnings = [];
    const normalized = entries.map((entry, index) =>
      normalizeSplit(structuredClone(entry), index, { config, metadata, timeZone: config.timeZone, warnings }),
    );

    const approvalReason = `Create ${split ? `one split transaction group with ${normalized.length} splits` : `${normalized.length} independent transaction(s)`}: ${describeForApproval(normalized)}`;
    const wrap = (splits) => ({
      transactions: splits,
      apply_rules: args.applyRules !== false,
      fire_webhooks: args.fireWebhooks !== false,
      error_if_duplicate_hash: args.errorIfDuplicateHash === true,
      ...(args.groupTitle ? { group_title: args.groupTitle } : {}),
    });

    if (!args.confirm) {
      const items = split
        ? [{ index: 1, status: 'preview', payload: wrap(normalized), display: normalized.map((entry) => displayNames(entry, metadata)) }]
        : normalized.map((entry, index) => ({
            index: index + 1,
            status: 'preview',
            payload: wrap([entry]),
            display: [displayNames(entry, metadata)],
          }));
      return {
        ok: true,
        preview: true,
        summary: `Preview only: ${split ? `1 split group / ${normalized.length} splits` : `${normalized.length} independent transaction(s)`}${summarizeAmounts(normalized) ? `; totals ${summarizeAmounts(normalized)}` : ''}. Nothing was written.`,
        items,
        counts: { planned: split ? 1 : normalized.length, splits: normalized.length },
        warnings,
        hint: 'Check type, amount, timestamp, accounts, category, budget, tags and notes. Re-call with confirm=true to submit.',
      };
    }

    await confirmRoutineWrite(exec.ctx, exec, config, {
      reason: approvalReason,
      displayReason: {
        en: approvalReason,
        zh: `准备记账：${describeForApproval(normalized)}`,
      },
    });

    const items = [];
    if (split) {
      const payload = wrap(normalized);
      const created = await client.post('transactions', payload, { signal });
      const group = compactTransactionGroup(created);
      items.push({ index: 1, status: 'created', id: group.id, payload, created: group, display: normalized.map((entry) => displayNames(entry, metadata)) });
    } else {
      for (const [index, entry] of normalized.entries()) {
        const payload = wrap([entry]);
        const created = await client.post('transactions', payload, { signal });
        const group = compactTransactionGroup(created);
        items.push({ index: index + 1, status: 'created', id: group.id, payload, created: group, display: [displayNames(entry, metadata)] });
      }
    }
    const createdIds = items.map((item) => item.id).filter(Boolean);
    return {
      ok: true,
      summary: `Created ${items.length} transaction group(s)${summarizeAmounts(normalized) ? `; totals ${summarizeAmounts(normalized)}` : ''}.`,
      items,
      counts: { created: items.length, splits: normalized.length },
      warnings,
      hint: `Verify with firefly_transactions action=get using id=${createdIds[0] ?? '?'}. Firefly III may have rewritten category, budget, tags or notes through rules; created values are returned above.`,
    };
  },
});
