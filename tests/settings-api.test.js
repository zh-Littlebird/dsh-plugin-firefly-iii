import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { createSettingsHandler, ROUTE_PREFIX } from '../src/settings-api.js';
import { createSettingsService } from '../src/settings.js';

function config() {
  const result = normalizeConfig({ baseUrl: 'https://firefly.example.com/', confirmWrites: false });
  assert.ok(result.value, JSON.stringify(result.issues));
  return result.value;
}

function fakeEditor() {
  const calls = [];
  return {
    calls,
    entries() {
      return [{ id: 'firefly-iii', name: 'dsh-plugin-firefly-iii' }];
    },
    async edit(entry, change) {
      calls.push(entry);
      calls.config = change(
        {
          baseUrl: 'https://firefly.example.com/',
          currency: 'CNY',
          confirmWrites: false,
          autoCreate: { accounts: false, categories: false, tags: false, budgets: false, piggyBanks: false },
        },
        {},
      );
    },
  };
}

function context(editor) {
  return {
    get(name) {
      if (name === 'configEditor') return editor;
      if (name === 'credentials') return { readRecord: async () => undefined };
      return undefined;
    },
  };
}

function request(method, path, options = {}) {
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const chunks = body === null ? [] : [Buffer.from(body)];
  const req = {
    method,
    url: path,
    headers: options.headers ?? {},
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
  let status = 0;
  let text = '';
  const res = {
    writeHead(value) {
      status = value;
    },
    end(value) {
      text = value;
    },
  };
  return { req, res, done: () => ({ status, body: text === '' ? null : JSON.parse(text) }) };
}

function call(handler, method, path, options) {
  const pending = request(method, path, options);
  return handler(pending.req, pending.res).then(pending.done);
}

test('settings endpoint reads the effective view over loopback', async () => {
  const cfg = config();
  const handler = createSettingsHandler({
    ctx: context(fakeEditor()),
    config: cfg,
    settings: createSettingsService(context(fakeEditor()), cfg),
  });
  const result = await call(handler, 'GET', `${ROUTE_PREFIX}/settings`);
  assert.equal(result.status, 200);
  assert.equal(result.body.editable, true);
  assert.equal(result.body.autoCreate.accounts, false);
  assert.equal(result.body.token.configured, false);
});

test('settings writes require the page header, loopback Origin, and valid switches', async () => {
  const cfg = config();
  const editor = fakeEditor();
  const handler = createSettingsHandler({ ctx: context(editor), config: cfg, settings: createSettingsService(context(editor), cfg) });

  const noHeader = await call(handler, 'PUT', `${ROUTE_PREFIX}/settings`, {
    body: { autoCreate: { accounts: true } },
    headers: { origin: 'http://127.0.0.1:51076' },
  });
  assert.equal(noHeader.status, 403);

  const foreign = await call(handler, 'PUT', `${ROUTE_PREFIX}/settings`, {
    body: { autoCreate: { accounts: true } },
    headers: { origin: 'https://evil.example', 'x-firefly-iii-ui': '1' },
  });
  assert.equal(foreign.status, 403);

  const invalid = await call(handler, 'PUT', `${ROUTE_PREFIX}/settings`, {
    body: { autoCreate: { unknown: true } },
    headers: { origin: 'http://127.0.0.1:51076', 'x-firefly-iii-ui': '1' },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_SETTINGS');
  assert.equal(editor.calls.length, 0);

  const ok = await call(handler, 'PUT', `${ROUTE_PREFIX}/settings`, {
    body: { autoCreate: { accounts: true } },
    headers: { origin: 'http://127.0.0.1:51076', 'x-firefly-iii-ui': '1' },
  });
  assert.equal(ok.status, 200);
  assert.equal(editor.calls.length, 1);
  assert.equal(editor.calls.config.autoCreate.accounts, true);
  assert.equal(editor.calls.config.baseUrl, 'https://firefly.example.com/');
});

test('desktop shells write with an opaque, file, or absent Origin plus the page header', async () => {
  const cfg = config();
  const editor = fakeEditor();
  const handler = createSettingsHandler({ ctx: context(editor), config: cfg, settings: createSettingsService(context(editor), cfg) });

  for (const origin of [undefined, 'null', 'file://', 'app://dsh']) {
    const headers = { 'x-firefly-iii-ui': '1' };
    if (origin !== undefined) headers.origin = origin;
    const result = await call(handler, 'PUT', `${ROUTE_PREFIX}/settings`, {
      body: { autoCreate: { tags: true } },
      headers,
    });
    assert.equal(result.status, 200, `origin=${origin}`);
  }
  assert.equal(editor.calls.length, 4);
});

test('settings endpoint refuses non-loopback peers and unknown paths', async () => {
  const cfg = config();
  const handler = createSettingsHandler({ ctx: context(fakeEditor()), config: cfg, settings: createSettingsService(context(fakeEditor()), cfg) });
  const remote = await call(handler, 'GET', `${ROUTE_PREFIX}/settings`, { remoteAddress: '192.168.1.9' });
  assert.equal(remote.status, 403);
  const missing = await call(handler, 'GET', `${ROUTE_PREFIX}/nope`);
  assert.equal(missing.status, 404);
});
