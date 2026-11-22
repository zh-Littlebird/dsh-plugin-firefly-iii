import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { FireflyClient } from '../src/client.js';
import {
  assertDateRange,
  normalizeTransactionDate,
  normalizeSplit,
} from '../src/policy.js';
import { compactTransactionGroup, parseAmountToCents, formatCents } from '../src/format.js';

function config(overrides = {}) {
  const result = normalizeConfig({
    baseUrl: 'https://firefly.example.com/',
    confirmWrites: false,
    ...overrides,
  });
  assert.ok(result.value, JSON.stringify(result.issues));
  return result.value;
}

test('config normalizes defaults and rejects non-https remote URLs', () => {
  const cfg = config();
  assert.equal(cfg.baseUrl, 'https://firefly.example.com/');
  assert.equal(cfg.currency, 'CNY');
  assert.equal(cfg.expectedApiPrefix, '6.7.');
  assert.equal(cfg.autoCreate.accounts, false);
  const bad = normalizeConfig({ baseUrl: 'http://firefly.example.com' });
  assert.ok(bad.issues.some((issue) => issue.path[0] === 'baseUrl'));
  const local = normalizeConfig({ baseUrl: 'http://localhost:8080/' });
  assert.ok(local.value);
});

test('config strips pasted /api/v1 suffixes', () => {
  const cfg = config({ baseUrl: 'https://firefly.example.com/api/v1/' });
  assert.equal(cfg.baseUrl, 'https://firefly.example.com/');
});

test('client maps 401, 422 and blocks forbidden endpoints', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('accounts')) {
      return new Response(JSON.stringify({ message: 'Unauthenticated.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ message: '至少需要一笔交易', errors: { 'transactions.0.description': ['必填'] } }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new FireflyClient(config(), 'token', { fetchImpl });
  await assert.rejects(() => client.get('accounts'), (error) => error.code === 'AUTH_FAILED' && error.message.includes('401'));
  await assert.rejects(() => client.post('transactions', {}), (error) => {
    assert.equal(error.code, 'VALIDATION_FAILED');
    assert.ok(error.message.includes('至少需要一笔交易'));
    return true;
  });
  await assert.rejects(() => client.get('data/purge'), (error) => error.code === 'ENDPOINT_FORBIDDEN');
  assert.equal(calls.length, 2);
});

test('client maps 6.7 404 responses and strips HTML error pages', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('accounts/1')) {
      return new Response(JSON.stringify({ message: 'Resource not found', exception: 'NotFoundHttpException' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('<html><body><h1>Not Found</h1></body></html>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    });
  };
  const client = new FireflyClient(config(), 'token', { fetchImpl });
  await assert.rejects(
    () => client.get('accounts/1'),
    (error) => error.code === 'ENDPOINT_UNAVAILABLE' && error.message.includes('404') && error.message.includes('Resource not found'),
  );
  await assert.rejects(
    () => client.get('missing-endpoint'),
    (error) =>
      error.code === 'ENDPOINT_UNAVAILABLE' &&
      error.message.includes('Not Found') &&
      !error.message.includes('<html>'),
  );
});

test('client parses JSON:API media types returned by Firefly III', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ data: [{ id: '1', attributes: { name: 'x' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/vnd.api+json; charset=utf-8' },
    });
  const client = new FireflyClient(config(), 'token', { fetchImpl });
  const payload = await client.get('accounts');
  assert.equal(payload.data[0].id, '1');
});

test('client builds array query parameters and paginates', async () => {
  const urls = [];
  let page = 1;
  const fetchImpl = async (url) => {
    urls.push(url);
    const payload = {
      data: [{ id: String(page), attributes: { name: `a${page}` } }],
      meta: { pagination: { current_page: page, total_pages: 2, total: 2, per_page: 1 } },
    };
    page += 1;
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new FireflyClient(config(), 'token', { fetchImpl });
  const result = await client.listAll('insight/expense/category', { 'accounts[]': ['1', '2'], start: '2026-01-01', end: '2026-02-01' }, { pageSize: 1 });
  assert.equal(result.data.length, 2);
  assert.equal(result.totalPages, 2);
  assert.ok(urls[0].includes('accounts%5B%5D=1'));
  assert.ok(urls[0].includes('accounts%5B%5D=2'));
  assert.ok(urls[0].includes('page=1'));
  assert.ok(urls[1].includes('page=2'));
});

test('transaction dates require explicit non-midnight time', () => {
  assert.equal(normalizeTransactionDate('2026-11-17T14:35:00+08:00', 'Asia/Shanghai'), '2026-11-17T14:35:00+08:00');
  assert.equal(normalizeTransactionDate('2026-11-17T14:35', 'Asia/Shanghai'), '2026-11-17T14:35:00+08:00');
  assert.throws(() => normalizeTransactionDate('2026-11-17', 'Asia/Shanghai'), (error) => error.code === 'NEED_TIME');
  assert.throws(() => normalizeTransactionDate('2026-11-17T00:00:00', 'Asia/Shanghai'), (error) => error.code === 'NEED_TIME');
});

test('date ranges reject reversed or equal bounds', () => {
  assert.deepEqual(assertDateRange('2026-01-01', '2026-02-01'), { start: '2026-01-01', end: '2026-02-01' });
  assert.throws(() => assertDateRange('2026-02-01', '2026-01-01'), (error) => error.code === 'INVALID_DATE');
  assert.throws(() => assertDateRange('2026-02-01', '2026-02-01'), (error) => error.code === 'INVALID_DATE');
});

function metadata() {
  return {
    accounts: {
      truncated: false,
      items: [
        { id: '10', name: '储蓄卡 A', type: 'asset' },
        { id: '20', name: '示例商户', type: 'expense' },
      ],
    },
    categories: { truncated: false, items: [{ id: '30', name: '示例分类' }] },
    budgets: { truncated: false, items: [{ id: '40', name: '示例预算' }] },
    tags: { truncated: false, items: [{ id: '50', name: '示例标签' }] },
  };
}

test('autoCreate=false resolves exact names and rejects unknown names/ids', () => {
  const cfg = config();
  const warnings = [];
  const split = {
    type: 'withdrawal',
    date: '2026-11-17T18:02:00+08:00',
    amount: '20.00',
    description: '饮料',
    source_name: '储蓄卡 A',
    destination_name: '示例商户',
    category_name: '示例分类',
    budget_name: '示例预算',
    tags: ['示例标签'],
  };
  normalizeSplit(split, 0, { config: cfg, metadata: metadata(), timeZone: cfg.timeZone, warnings });
  assert.equal(split.source_id, '10');
  assert.equal(split.destination_id, '20');
  assert.equal(split.category_id, '30');
  assert.equal(split.budget_id, '40');
  assert.equal(split.source_name, undefined);

  const unknown = structuredClone(split);
  delete unknown.category_id;
  unknown.category_name = '宠物';
  assert.throws(
    () => normalizeSplit(unknown, 0, { config: cfg, metadata: metadata(), timeZone: cfg.timeZone, warnings }),
    (error) => error.code === 'AUTO_CREATE_DISABLED' && error.details?.candidates?.some((candidate) => candidate.name === '示例分类'),
  );

  const guessed = structuredClone(split);
  guessed.category_id = '999';
  guessed.category_name = undefined;
  assert.throws(
    () => normalizeSplit(guessed, 0, { config: cfg, metadata: metadata(), timeZone: cfg.timeZone, warnings }),
    (error) => error.code === 'INVALID_ID',
  );
});

test('autoCreate=true keeps unknown names and warns', () => {
  const cfg = config({ autoCreate: { accounts: true, categories: true, tags: true, budgets: true, piggyBanks: true } });
  const warnings = [];
  const split = {
    type: 'withdrawal',
    date: '2026-11-17T18:02:00+08:00',
    amount: '20.00',
    description: '饮料',
    source_name: '新储蓄卡',
    destination_name: '新商户',
    category_name: '新分类',
    tags: ['新标签'],
  };
  normalizeSplit(split, 0, { config: cfg, metadata: metadata(), timeZone: cfg.timeZone, warnings });
  assert.equal(split.source_name, '新储蓄卡');
  assert.equal(split.category_name, '新分类');
  assert.ok(warnings.length >= 3);
});

test('format compacts transaction groups and sums cents exactly', () => {
  const payload = {
    data: {
      id: '900',
      attributes: {
        transactions: [
          {
            transaction_journal_id: '901',
            type: 'withdrawal',
            date: '2026-11-17T08:00:00+08:00',
            amount: '0.10',
            description: 'a',
            source_name: '钱包',
            destination_name: '店',
            tags: ['t'],
            notes: 'n',
          },
        ],
      },
    },
  };
  const group = compactTransactionGroup(payload.data, { includeNotes: true });
  assert.equal(group.id, '900');
  assert.equal(group.splits[0].journalId, '901');
  assert.equal(group.splits[0].notes, 'n');
  assert.equal(formatCents(parseAmountToCents('0.10') + parseAmountToCents('0.20')), '0.30');
});

test('losslessJson removes values the host output validator rejects', async () => {
  const { losslessJson, jsonTool } = await import('../src/toolkit.js');
  const sanitized = losslessJson({
    ok: true,
    hint: undefined,
    counts: { returned: 1, total: undefined },
    items: [{ id: '1', nested: { maybe: undefined } }],
    sparse: [1, undefined, 3],
    negativeZero: -0,
  });
  assert.deepEqual(sanitized, {
    ok: true,
    counts: { returned: 1 },
    items: [{ id: '1', nested: {} }],
    sparse: [1, null, 3],
    negativeZero: 0,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(sanitized)), sanitized);

  const tool = jsonTool({
    name: 'firefly_regression',
    description: 'regression fixture',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { ok: true, summary: 'one page', truncated: false, hint: undefined };
    },
  });
  const result = await tool.execute({}, {});
  assert.equal(Object.hasOwn(result, 'hint'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});
