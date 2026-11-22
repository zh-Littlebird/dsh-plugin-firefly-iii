import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { FireflyError } from '../src/errors.js';
import { lookupTool } from '../src/tools/lookup.js';
import { masterdataTool } from '../src/tools/masterdata.js';
import { reportsTool } from '../src/tools/reports.js';
import { adminTool } from '../src/tools/admin.js';

function config(overrides = {}) {
  const result = normalizeConfig({ baseUrl: 'https://firefly.example.com/', confirmWrites: false, ...overrides });
  assert.ok(result.value, JSON.stringify(result.issues));
  return result.value;
}

function fakeClient(handler) {
  const calls = [];
  const client = {
    calls,
    async get(path, query, options) {
      calls.push({ method: 'GET', path, query });
      return handler(path, query, options);
    },
    async post(path, body) {
      calls.push({ method: 'POST', path, body });
      return undefined;
    },
    async put(path, body) {
      calls.push({ method: 'PUT', path, body });
      return undefined;
    },
    async delete(path) {
      calls.push({ method: 'DELETE', path });
      return undefined;
    },
  };
  return client;
}

function exec(client, cfg = config()) {
  return {
    client,
    config: cfg,
    signal: new AbortController().signal,
    agent: { id: 'agent-1' },
    name: 'firefly_test',
    callId: 'call-1',
    ctx: { get: () => undefined },
  };
}

function account(attributes) {
  return { id: '1', type: 'accounts', attributes };
}

test('account list forwards the new 6.7 active/date filters and card fields', async () => {
  const client = fakeClient(() => ({
    data: [
      account({
        name: '示例信用卡',
        type: 'asset',
        account_role: 'ccAsset',
        currency_code: 'CNY',
        current_balance: '-120.00',
        active: true,
        credit_card_type: 'monthlyFull',
        monthly_payment_date: '2026-11-25',
      }),
    ],
    meta: { pagination: { current_page: 1, total_pages: 1, total: 1, per_page: 25 } },
  }));
  const result = await lookupTool.execute(
    { action: 'list', resource: 'accounts', active: true, date: '2026-11-01' },
    exec(client),
  );
  assert.equal(client.calls[0].path, 'accounts');
  assert.equal(client.calls[0].query.active, true);
  assert.equal(client.calls[0].query.date, '2026-11-01');
  assert.equal(result.items[0].creditCardType, 'monthlyFull');
  assert.equal(result.items[0].monthlyPaymentDate, '2026-11-25');
});

test('category output exposes the 6.7.8 color field', async () => {
  const client = fakeClient(() => ({
    data: [{ id: '7', type: 'categories', attributes: { name: '示例分类', color: 'ff8800' } }],
    meta: { pagination: { current_page: 1, total_pages: 1, total: 1, per_page: 25 } },
  }));
  const result = await lookupTool.execute({ action: 'list', resource: 'categories' }, exec(client));
  assert.equal(result.items[0].color, 'ff8800');
});

test('autocomplete reads the bare JSON array Firefly returns', async () => {
  const client = fakeClient(() => [
    { id: '3', name: '示例分类', transaction_group_id: '1306', description: '示例消费', date: '2026-11-20T12:00:00+08:00', currency_code: 'CNY', amount: '88.00' },
  ]);
  const result = await lookupTool.execute(
    { action: 'autocomplete', resource: 'transactions-with-meta', query: '餐' },
    exec(client),
  );
  assert.equal(client.calls[0].path, 'autocomplete/transactions-with-meta');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].description, '示例消费');
});

test('category update forwards the 6.7.8 color field', async () => {
  const client = fakeClient(() => ({}));
  client.put = async (path, body) => {
    client.calls.push({ method: 'PUT', path, body });
    return { data: { id: '7', type: 'categories', attributes: { name: '示例分类', color: 'ff8800' } } };
  };
  const result = await masterdataTool.execute(
    { action: 'update', resource: 'category', id: '7', data: { color: 'ff8800' } },
    exec(client),
  );
  assert.equal(client.calls[0].method, 'PUT');
  assert.equal(client.calls[0].path, 'categories/7');
  assert.equal(client.calls[0].body.color, 'ff8800');
  assert.equal(result.items[0].color, 'ff8800');
});

test('masterdata account list forwards active state', async () => {
  const client = fakeClient(() => ({
    data: [account({ name: '停用现金', type: 'cash', active: false })],
    meta: { pagination: { current_page: 1, total_pages: 1, total: 1, per_page: 25 } },
  }));
  await masterdataTool.execute({ action: 'list', resource: 'account', active: false }, exec(client));
  assert.equal(client.calls[0].query.active, false);
});

test('chart-budget includeLimits uses the 6.7 overview-with-limits endpoint', async () => {
  const client = fakeClient(() => [
    { label: '示例预算', currency_code: 'CNY', period: '1M', type: 'bar', entries: { '2026-01-01': '10.00' }, limits: [{ amount: '100.00' }] },
  ]);
  const result = await reportsTool.execute(
    { action: 'chart-budget', start: '2026-01-01', end: '2026-02-01', includeLimits: true },
    exec(client),
  );
  assert.equal(client.calls[0].path, 'chart/budget/overview-with-limits');
  assert.equal(result.items[0].label, '示例预算');
  assert.equal(result.items[0].pointCount, 1);
});

test('insight reads bare arrays and accepts the subscription groups', async () => {
  const client = fakeClient(() => [{ id: '9', name: 'Netflix', difference: '68.00', difference_float: 68, currency_code: 'CNY' }]);
  const result = await reportsTool.execute(
    { action: 'insight', scope: 'expense', group: 'subscription', start: '2026-01-01', end: '2026-02-01' },
    exec(client),
  );
  assert.equal(client.calls[0].path, 'insight/expense/subscription');
  assert.equal(result.items[0].amount, '68.00');
  assert.equal(result.items[0].differenceFloat, 68);
});

test('instance about reports the deployed version and compatibility', async () => {
  const client = fakeClient(() => ({
    version: '6.7.9',
    api_version: '6.7.9',
    php_version: '8.5.12',
    os: 'Linux',
    driver: 'mysql',
  }));
  const result = await adminTool.execute({ resource: 'instance', action: 'about' }, exec(client));
  assert.equal(client.calls[0].path, 'about');
  assert.equal(result.items[0].version, '6.7.9');
  assert.equal(result.items[0].compatible, true);
  assert.equal(Object.hasOwn(result, 'warnings'), false);
});

test('instance release-notes prefers markdown and strips HTML fallback', async () => {
  const markdown = '#### Fixed\n\n- Cache & auth';
  const client = fakeClient(() => ({ version: '6.7.9', release_notes: '<h4>Fixed</h4><ul><li>Cache &amp; auth</li></ul>', release_notes_markdown: markdown }));
  const result = await adminTool.execute({ resource: 'instance', action: 'release-notes' }, exec(client));
  assert.equal(result.items[0].notes, markdown);

  const htmlOnly = fakeClient(() => ({ version: '6.7.9', release_notes: '<h4>Fixed</h4><ul><li>Cache &amp; auth</li></ul>' }));
  const fallback = await adminTool.execute({ resource: 'instance', action: 'release-notes' }, exec(htmlOnly));
  assert.match(fallback.items[0].notes, /Fixed/);
  assert.match(fallback.items[0].notes, /Cache & auth/);
  assert.equal(fallback.items[0].notes.includes('<'), false);
});

test('instance capabilities reports unavailable probes without throwing', async () => {
  const client = fakeClient((path) => {
    if (path === 'webhooks') {
      throw new FireflyError('ENDPOINT_UNAVAILABLE', '[ENDPOINT_UNAVAILABLE] Resource not found');
    }
    return { data: [] };
  });
  const result = await adminTool.execute({ resource: 'instance', action: 'capabilities' }, exec(client));
  const webhooks = result.items.find((entry) => entry.capability === 'webhooks');
  assert.equal(webhooks.available, false);
  assert.equal(webhooks.code, 'ENDPOINT_UNAVAILABLE');
  assert.ok(result.counts.available >= 1);
});
