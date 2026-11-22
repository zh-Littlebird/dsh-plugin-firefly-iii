import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { recordTool } from '../src/tools/record.js';
import { transactionsTool } from '../src/tools/transactions.js';
import { lookupTool } from '../src/tools/lookup.js';

function config(overrides = {}) {
  const result = normalizeConfig({ baseUrl: 'https://firefly.example.com/', confirmWrites: false, ...overrides });
  assert.ok(result.value, JSON.stringify(result.issues));
  return result.value;
}

function resource(id, attributes) {
  return { id: String(id), attributes };
}

function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    async listAll(path) {
      const catalogues = {
        accounts: [resource(10, { name: '储蓄卡 A', type: 'asset' }), resource(20, { name: '示例商户', type: 'expense' })],
        categories: [resource(30, { name: '示例分类' })],
        budgets: [resource(40, { name: '示例预算' })],
        tags: [resource(50, { tag: '示例标签' })],
      };
      return { data: catalogues[path] ?? [], total: (catalogues[path] ?? []).length, totalPages: 1, truncated: false };
    },
    async get(path, query) {
      calls.push({ method: 'GET', path, query });
      if (path.startsWith('transactions/')) {
        return {
          data: resource(query ?? path.split('/')[1], {
            transactions: [
              {
                transaction_journal_id: '901',
                type: 'withdrawal',
                date: '2026-11-17T08:00:00+08:00',
                amount: '20.00',
                description: '饮料',
                source_id: '10',
                source_name: '储蓄卡 A',
                destination_id: '20',
                destination_name: '示例商户',
                category_id: '30',
                tags: [],
                notes: 'old',
              },
            ],
          }),
        };
      }
      return { data: [], meta: { pagination: { current_page: 1, total_pages: 1, total: 0, per_page: 25 } } };
    },
    async post(path, body, options = {}) {
      calls.push({ method: 'POST', path, body, options });
      if (path === 'transactions') {
        return { data: resource(`tx-${calls.length}`, { transactions: body.transactions }) };
      }
      return undefined;
    },
    async put(path, body) {
      calls.push({ method: 'PUT', path, body });
      return { data: resource(path.split('/')[1], { transactions: body.transactions }) };
    },
    async delete(path) {
      calls.push({ method: 'DELETE', path });
      return undefined;
    },
    ...overrides,
  };
  return client;
}

function exec(client, cfg, extra = {}) {
  const approval = extra.approval;
  return {
    client,
    config: cfg,
    signal: new AbortController().signal,
    agent: { id: 'agent-1' },
    name: 'firefly_test',
    callId: 'call-1',
    ctx: { get: (service) => (service === 'approval' ? approval : undefined) },
    ...extra,
  };
}

function split() {
  return {
    type: 'withdrawal',
    date: '2026-11-17T18:02:00+08:00',
    amount: '20.00',
    description: '饮料',
    source_name: '储蓄卡 A',
    destination_name: '示例商户',
    category_name: '示例分类',
    tags: ['示例标签'],
    notes: 'Auto-synced by DSH from text\nItems: 饮料',
  };
}

test('record preview writes nothing and resolves ids against live metadata', async () => {
  const client = fakeClient();
  const result = await recordTool.execute({ transactions: [split()], confirm: false }, exec(client, config()));
  assert.equal(result.preview, true);
  assert.deepEqual(client.calls.filter((call) => call.method === 'POST'), []);
  assert.equal(result.items[0].payload.transactions[0].destination_id, '20');
  assert.ok(result.summary.includes('Nothing was written'));
});

test('record confirm submits independent transactions separately', async () => {
  const client = fakeClient();
  const result = await recordTool.execute({ transactions: [split(), split()], confirm: true }, exec(client, config()));
  const posts = client.calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((item) => item.status === 'created'));
});

test('record split submits one group with both splits', async () => {
  const client = fakeClient();
  await recordTool.execute({ transactions: [split(), split()], split: true, confirm: true, groupTitle: '超市' }, exec(client, config()));
  const posts = client.calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.transactions.length, 2);
  assert.equal(posts[0].body.group_title, '超市');
});

test('record refuses multi-split group title without split=true', async () => {
  await assert.rejects(
    () => recordTool.execute({ transactions: [split()], groupTitle: 'x', confirm: false }, exec(fakeClient(), config())),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
});

test('transaction delete fails closed without an approval service', async () => {
  await assert.rejects(
    () => transactionsTool.execute({ action: 'delete', id: '900' }, exec(fakeClient(), config())),
    (error) => error.code === 'APPROVAL_UNAVAILABLE',
  );
  const client = fakeClient();
  await assert.rejects(() => transactionsTool.execute({ action: 'delete', id: '900' }, exec(client, config())));
  assert.equal(client.calls.some((call) => call.method === 'DELETE'), false);
});

test('transaction delete proceeds only after allowed-once approval', async () => {
  const client = fakeClient();
  const approval = { request: async () => 'allowed-once' };
  const result = await transactionsTool.execute({ action: 'delete', id: '900' }, exec(client, config(), { approval }));
  assert.equal(result.ok, true);
  assert.ok(client.calls.some((call) => call.method === 'DELETE' && call.path === 'transactions/900'));
});

test('bulk move sends the JSON query string and requires approval', async () => {
  const client = fakeClient({
    async get(path) {
      client.calls.push({ method: 'GET', path });
      return { data: resource(path.split('/')[1], { name: path.includes('10') ? 'A' : 'B' }) };
    },
  });
  const approval = { request: async () => 'allowed-once' };
  await transactionsTool.execute({ action: 'bulk-move', fromAccountId: '10', toAccountId: '20' }, exec(client, config(), { approval }));
  const post = client.calls.find((call) => call.method === 'POST');
  assert.equal(post.path, 'data/bulk/transactions');
  const parsed = JSON.parse(post.options.query.query);
  assert.deepEqual(parsed, { where: { account_id: '10' }, update: { account_id: '20' } });
});

test('lookup all reads four metadata tables', async () => {
  const client = fakeClient({
    async get(path, query) {
      client.calls.push({ path, query });
      const map = {
        accounts: [resource(10, { name: 'A', type: 'asset' })],
        categories: [resource(30, { name: '示例分类' })],
        budgets: [resource(40, { name: '示例预算' })],
        tags: [resource(50, { tag: '示例标签' })],
      };
      return { data: map[path] ?? [], meta: { pagination: { current_page: 1, total_pages: 1, total: (map[path] ?? []).length, per_page: 25 } } };
    },
  });
  const result = await lookupTool.execute({ action: 'list', resource: 'all' }, exec(client, config()));
  assert.equal(result.items.length, 4);
  assert.deepEqual(client.calls.map((call) => call.path).sort(), ['accounts', 'budgets', 'categories', 'tags']);
});

test('transactions list on a single page emits no undefined hint', async () => {
  const client = fakeClient({
    async get(path, query) {
      client.calls.push({ path, query });
      return {
        data: [resource(1306, {
          transactions: [
            {
              transaction_journal_id: '1343',
              type: 'withdrawal',
              date: '2026-09-08T12:07:00+08:00',
              amount: '1234.56',
              description: '示例支出',
              source_id: '1',
              destination_id: '23',
              tags: ['t-个人'],
            },
          ],
        })],
        meta: { pagination: { current_page: 1, total_pages: 1, total: 1, per_page: 20 } },
      };
    },
  });
  const result = await transactionsTool.execute({ action: 'list', accountId: '23', limit: 20, page: 1 }, exec(client, config()));
  assert.equal(result.counts.total, 1);
  assert.equal(Object.hasOwn(result, 'hint'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});
