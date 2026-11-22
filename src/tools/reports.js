/** firefly_reports: official summary, chart, insight and budget analysis plus local wrappers. */
import { jsonTool } from '../toolkit.js';
import {
  attributesOf,
  compactBudgetLimit,
  dropUndefined,
  formatCents,
  parseAmountToCents,
} from '../format.js';
import { assertDate, assertDateRange } from '../policy.js';
import { fail } from '../errors.js';

const INSIGHT_GROUPS = {
  expense: ['expense', 'asset', 'bill', 'no-bill', 'subscription', 'no-subscription', 'budget', 'no-budget', 'category', 'no-category', 'tag', 'no-tag', 'total'],
  income: ['revenue', 'asset', 'category', 'no-category', 'tag', 'no-tag', 'total'],
  transfer: ['asset', 'category', 'no-category', 'tag', 'no-tag', 'total'],
};
const INSIGHT_FILTER_PARAMS = { bill: 'bills[]', subscription: 'bills[]', budget: 'budgets[]', category: 'categories[]', tag: 'tags[]' };

function todayInZone(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function monthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month));
  if (!match) fail('INVALID_DATE', 'month must be YYYY-MM.');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) fail('INVALID_DATE', 'month must be between YYYY-01 and YYYY-12.');
  const start = `${year}-${pad(monthNumber)}-01`;
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const endExclusive = next.toISOString().slice(0, 10);
  return { start, endExclusive, month: `${year}-${pad(monthNumber)}` };
}

function addMonths(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

export function summaryEntries(payload) {
  const data = payload?.data ?? payload ?? {};
  if (Array.isArray(data)) {
    return data.map((entry) => ({
      key: entry.key,
      title: entry.title,
      value: entry.monetary_value ?? entry.value,
      currency: entry.currency_code,
      parsed: entry.value_parsed,
    }));
  }
  return Object.entries(data)
    .filter(([, entry]) => entry && typeof entry === 'object')
    .map(([key, entry]) =>
      dropUndefined({
        key: entry.key ?? key,
        title: entry.title,
        value: entry.monetary_value ?? entry.value,
        currency: entry.currency_code,
        parsed: entry.value_parsed,
      }),
    );
}

function insightEntries(payload) {
  // Firefly III insight endpoints return a bare JSON array.
  const data = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return data.map((entry) => {
    const a = attributesOf(entry);
    return dropUndefined({
      id: a.id,
      name: a.name,
      title: a.title,
      key: a.key,
      currency: a.currency_code,
      amount: a.monetary_value ?? a.sum ?? a.amount ?? a.difference,
      difference: a.difference,
      differenceFloat: a.difference_float,
    });
  });
}

/** Firefly III chart series are bare arrays; keep the newest 60 points per series. */
function compactChartItem(entry) {
  const a = attributesOf(entry);
  const points =
    a.entries && typeof a.entries === 'object' && !Array.isArray(a.entries) ? Object.entries(a.entries) : undefined;
  const trimmed = points && points.length > 60 ? points.slice(-60) : points;
  return dropUndefined({
    label: a.label,
    currency: a.currency_code,
    period: a.period,
    type: a.type,
    startDate: a.start_date,
    endDate: a.end_date,
    pointCount: points?.length,
    entries: trimmed ? Object.fromEntries(trimmed) : undefined,
    pcEntries: a.pc_entries && Object.keys(a.pc_entries).length > 0 ? a.pc_entries : undefined,
    truncated: points && points.length > 60 ? true : undefined,
  });
}

function chartItems(payload, limit = 60) {
  // Firefly III chart endpoints return a bare JSON array.
  const data = Array.isArray(payload) ? payload : payload?.data;
  if (Array.isArray(data)) return data.slice(0, limit).map((entry) => compactChartItem(entry));
  if (data && typeof data === 'object') {
    return Object.entries(data)
      .slice(0, limit)
      .map(([key, value]) => ({ key, value }));
  }
  return [];
}

function groupTotals(splits, selector) {
  const totals = new Map();
  for (const split of splits) {
    if (split.type !== 'withdrawal') continue;
    const key = selector(split) || '未归类';
    totals.set(key, (totals.get(key) ?? 0) + parseAmountToCents(split.amount));
  }
  return [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 20).map(([name, cents]) => ({ name, amount: formatCents(cents) }));
}

async function fetchSplits(client, start, end, signal, maxPages = 25) {
  const page = await client.listAll('transactions', { start, end }, { signal, maxPages, pageSize: 100 });
  const splits = [];
  let expenseCents = 0;
  let incomeCents = 0;
  let transferCents = 0;
  const counts = { withdrawal: 0, deposit: 0, transfer: 0 };
  for (const group of page.data) {
    const attributes = attributesOf(group);
    for (const split of attributes.transactions ?? []) {
      splits.push(split);
      const cents = parseAmountToCents(split.amount);
      if (split.type === 'withdrawal') {
        expenseCents += cents;
        counts.withdrawal += 1;
      } else if (split.type === 'deposit') {
        incomeCents += cents;
        counts.deposit += 1;
      } else if (split.type === 'transfer') {
        transferCents += cents;
        counts.transfer += 1;
      }
    }
  }
  return { splits, expenseCents, incomeCents, transferCents, counts, truncated: page.truncated };
}

export const reportsTool = jsonTool({
  name: 'firefly_reports',
  description:
    'Read Firefly III financial analysis: official basic summary, account/balance/budget/category charts (budget charts can include limits), expense/income/transfer insights (including subscription groups), net worth, budget status, plus local monthly report and trend wrappers. Prefer official endpoints over guessing totals.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['summary', 'chart-account', 'chart-balance', 'chart-budget', 'chart-category', 'insight', 'networth', 'report', 'trend', 'budget-status'],
        description: 'Which analysis to run. report and trend are plugin-side aggregations over bounded transaction pages.',
      },
      start: { type: 'string', description: 'YYYY-MM-DD start (required for summary/charts/insight).' },
      end: { type: 'string', description: 'YYYY-MM-DD end; must be later than start.' },
      period: { type: 'string', description: 'Chart period such as 1D, 1W, 1M, 3M, 6M, 1Y.' },
      scope: { type: 'string', enum: ['expense', 'income', 'transfer'], description: 'Insight scope.' },
      group: {
        type: 'string',
        description: 'Insight group: expense supports expense/asset/bill/no-bill/subscription/no-subscription/budget/no-budget/category/no-category/tag/no-tag/total; income and transfer support their own subsets.',
      },
      filterIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional ids for bill/budget/category/tag grouping; only those groups accept a filter.',
      },
      accountIds: { type: 'array', items: { type: 'string' }, description: 'Optional account ids limiting the analysis.' },
      currency: { type: 'string', description: 'Optional ISO currency code for summary/net worth.' },
      month: { type: 'string', description: 'For report: YYYY-MM; defaults to the current month in the plugin time zone.' },
      includeLimits: { type: 'boolean', description: 'For chart-budget: use the Firefly III 6.7 overview-with-limits variant so each bucket carries its budget limits.' },
      trendPeriod: { type: 'string', enum: ['monthly', 'quarterly', 'yearly'], description: 'For trend bucket size; default monthly.' },
      count: { type: 'integer', description: 'For trend: number of periods to include (default 6, max 24).' },
      asOf: { type: 'string', description: 'For networth: YYYY-MM-DD as-of date; defaults to today.' },
    },
    required: ['action'],
  },
  async execute(args, exec) {
    const { client, config } = exec;
    const signal = exec.signal;

    if (args.action === 'summary' || args.action === 'networth') {
      let range;
      if (args.action === 'networth') {
        const asOf = assertDate(args.asOf ?? todayInZone(config.timeZone), 'asOf');
        range = { start: shiftDate(asOf, -1), end: asOf };
      } else {
        range = assertDateRange(args.start, args.end);
      }
      const payload = await client.get('summary/basic', { start: range.start, end: range.end, currency_code: args.currency }, { signal });
      const entries = summaryEntries(payload);
      if (args.action === 'networth') {
        const netWorth = entries.filter((entry) => String(entry.key ?? '').startsWith('net-worth-in-'));
        return {
          ok: true,
          summary: `Net worth as of ${range.end} (${netWorth.length} currency entr${netWorth.length === 1 ? 'y' : 'ies'}).`,
          items: netWorth,
          counts: { returned: netWorth.length },
        };
      }
      return {
        ok: true,
        summary: `Basic summary for ${range.start}..${range.end}: ${entries.length} entries.`,
        items: entries,
        counts: { returned: entries.length },
      };
    }

    if (args.action.startsWith('chart-')) {
      const range = assertDateRange(args.start, args.end);
      const query = { start: range.start, end: range.end };
      let path;
      if (args.action === 'chart-account') {
        path = 'chart/account/overview';
        query.period = args.period;
        if (args.accountIds?.length) query['accounts[]'] = args.accountIds;
      } else if (args.action === 'chart-balance') {
        path = 'chart/balance/balance';
        query.period = args.period;
        if (args.accountIds?.length) query['accounts[]'] = args.accountIds;
      } else if (args.action === 'chart-budget') {
        path = args.includeLimits ? 'chart/budget/overview-with-limits' : 'chart/budget/overview';
      } else {
        path = 'chart/category/overview';
      }
      const payload = await client.get(path, query, { signal });
      const items = chartItems(payload);
      return {
        ok: true,
        summary: `${args.action} for ${range.start}..${range.end}.`,
        items,
        counts: { returned: items.length },
        hint: 'Official chart output; chart-budget and chart-category do not accept id filters. includeLimits only applies to chart-budget (Firefly III 6.7+).',
      };
    }

    if (args.action === 'insight') {
      const scope = String(args.scope ?? '').toLowerCase();
      const group = String(args.group ?? '').toLowerCase();
      if (!INSIGHT_GROUPS[scope]) fail('INVALID_PARAMETER', `scope must be one of ${Object.keys(INSIGHT_GROUPS).join(', ')}.`);
      if (!INSIGHT_GROUPS[scope].includes(group)) {
        fail('INVALID_PARAMETER', `group "${group}" is not valid for ${scope}: ${INSIGHT_GROUPS[scope].join(', ')}.`);
      }
      const range = assertDateRange(args.start, args.end);
      const query = { start: range.start, end: range.end };
      if (args.accountIds?.length) query['accounts[]'] = args.accountIds;
      const filterParam = INSIGHT_FILTER_PARAMS[group];
      if (args.filterIds?.length) {
        if (!filterParam) fail('INVALID_PARAMETER', `group "${group}" does not accept filterIds.`);
        query[filterParam] = args.filterIds;
      }
      const payload = await client.get(`insight/${scope}/${group}`, query, { signal });
      const items = insightEntries(payload);
      return {
        ok: true,
        summary: `${scope}/${group} insight for ${range.start}..${range.end}: ${items.length} entries.`,
        items,
        counts: { returned: items.length },
        hint: 'no-* groups surface missing links (missing budget/category/tag/bill); total is the official total.',
      };
    }

    if (args.action === 'budget-status') {
      const range = assertDateRange(args.start, args.end);
      const [budgetsPayload, limitsPayload] = await Promise.all([
        client.get('budgets', { start: range.start, end: range.end }, { signal }),
        client.get('budget-limits', { start: range.start, end: range.end }, { signal }),
      ]);
      const limits = (Array.isArray(limitsPayload?.data) ? limitsPayload.data : []).map((entry) => compactBudgetLimit(entry));
      const limitsByBudget = new Map();
      for (const limit of limits) {
        if (!limitsByBudget.has(String(limit.budgetId))) limitsByBudget.set(String(limit.budgetId), []);
        limitsByBudget.get(String(limit.budgetId)).push(limit);
      }
      const budgets = (Array.isArray(budgetsPayload?.data) ? budgetsPayload.data : []).map((entry) => {
        const a = attributesOf(entry);
        const spent = Array.isArray(a.spent) ? a.spent.map((s) => ({ currency: s.currency_code, spent: s.sum })) : [];
        return { id: a.id, name: a.name, spent, limits: limitsByBudget.get(String(a.id)) ?? [] };
      });
      return {
        ok: true,
        summary: `${budgets.length} budget(s) with ${limits.length} limit(s) for ${range.start}..${range.end}.`,
        items: budgets,
        counts: { budgets: budgets.length, limits: limits.length },
      };
    }

    if (args.action === 'report') {
      const month = args.month ?? todayInZone(config.timeZone).slice(0, 7);
      const range = monthRange(month);
      const summaryPayload = await client.get('summary/basic', { start: range.start, end: range.endExclusive, currency_code: args.currency }, { signal });
      const summary = summaryEntries(summaryPayload);
      const splitsResult = await fetchSplits(client, range.start, range.endExclusive, signal);
      const byCategory = groupTotals(splitsResult.splits, (split) => split.category_name);
      const byBudget = groupTotals(splitsResult.splits, (split) => split.budget_name);
      const byTag = groupTotals(splitsResult.splits, (split) => (Array.isArray(split.tags) ? split.tags[0] : undefined));
      const bySourceAccount = groupTotals(splitsResult.splits, (split) => split.source_name);
      return {
        ok: true,
        summary: `Report ${month}: income ${formatCents(splitsResult.incomeCents)}, expense ${formatCents(splitsResult.expenseCents)}, transfers ${formatCents(splitsResult.transferCents)}.`,
        items: [
          { section: 'summary', entries: summary },
          { section: 'by_category', entries: byCategory },
          { section: 'by_budget', entries: byBudget },
          { section: 'by_tag', entries: byTag },
          { section: 'by_source_account', entries: bySourceAccount },
          { section: 'counts', entries: splitsResult.counts },
        ],
        counts: splitsResult.counts,
        truncated: splitsResult.truncated,
        hint: 'Totals are cents-exact plugin aggregation over up to 2500 splits; use insight endpoints for official grouped values.',
      };
    }

    if (args.action === 'trend') {
      const bucket = args.trendPeriod ?? 'monthly';
      const count = Math.min(Math.max(Number(args.count ?? 6), 1), 24);
      const currentMonth = todayInZone(config.timeZone).slice(0, 7);
      const startMonth = addMonths(currentMonth, -(count - 1));
      const start = monthRange(startMonth).start;
      const endExclusive = monthRange(currentMonth).endExclusive;
      const splitsResult = await fetchSplits(client, start, endExclusive, signal);
      const buckets = new Map();
      for (let index = 0; index < count; index += 1) {
        const month = addMonths(startMonth, index);
        const [year, monthNumber] = month.split('-').map(Number);
        const quotient = Math.floor((monthNumber - 1) / 3);
        const key =
          bucket === 'monthly'
            ? month
            : bucket === 'quarterly'
              ? `${year}-Q${quotient + 1}`
              : `${year}`;
        if (!buckets.has(key)) buckets.set(key, { period: key, income: 0, expense: 0 });
      }
      for (const split of splitsResult.splits) {
        const date = String(split.date ?? '').slice(0, 10);
        const [year, monthNumber] = date.split('-').map(Number);
        const key =
          bucket === 'monthly'
            ? date.slice(0, 7)
            : bucket === 'quarterly'
              ? `${year}-Q${Math.floor((monthNumber - 1) / 3) + 1}`
              : `${year}`;
        const entry = buckets.get(key);
        if (!entry) continue;
        const cents = parseAmountToCents(split.amount);
        if (split.type === 'withdrawal') entry.expense += cents;
        else if (split.type === 'deposit') entry.income += cents;
      }
      const items = [...buckets.values()].map((entry) => ({
        period: entry.period,
        income: formatCents(entry.income),
        expense: formatCents(entry.expense),
        net: formatCents(entry.income - entry.expense),
      }));
      return {
        ok: true,
        summary: `${bucket} trend over ${count} period(s), ${start}..${endExclusive}.`,
        items,
        counts: { periods: items.length },
        truncated: splitsResult.truncated,
        hint: 'Local aggregation from transaction splits; verify against official insight endpoints when exact reconciliation matters.',
      };
    }

    return fail('INVALID_PARAMETER', `Unknown action "${args.action}".`);
  },
});
