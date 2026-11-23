import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import {
  AUTO_CREATE_DEFAULTS,
  createSettingsService,
  FireflySettingsError,
  normalizeAutoCreatePatch,
  normalizeSettingsPatch,
  TOKEN_MIN_LENGTH,
} from '../src/settings.js';

function config(overrides = {}) {
  const result = normalizeConfig({ baseUrl: 'https://firefly.example.com/', ...overrides });
  assert.ok(result.value, JSON.stringify(result.issues));
  return result.value;
}

function fakeEditor(entry = { id: 'firefly-iii', name: 'dsh-plugin-firefly-iii' }) {
  const calls = [];
  return {
    calls,
    entries() {
      return [entry];
    },
    async edit(target, change) {
      calls.push(target);
      calls.result = change(
        {
          baseUrl: 'https://firefly.example.com/',
          currency: 'CNY',
          confirmWrites: false,
          autoCreate: { ...AUTO_CREATE_DEFAULTS, categories: true },
        },
        { baseUrl: 'https://firefly.example.com/' },
      );
    },
  };
}

function fakeCredentials(initial) {
  const state = { record: initial, order: [] };
  return {
    state,
    async readRecord() {
      return state.record;
    },
    async modifyRecord(key, mutate) {
      state.order.push('token-write');
      state.record = await mutate(state.record);
      return state.record;
    },
    async deleteRecord() {
      state.order.push('token-delete');
      state.record = undefined;
    },
  };
}

const STORED_TOKEN = { kind: 'api-key', key: 'x'.repeat(40) };

function ctxWith(editor, credentials = fakeCredentials(undefined)) {
  return {
    get(name) {
      if (name === 'configEditor') return editor;
      if (name === 'credentials') return credentials;
      return undefined;
    },
  };
}

test('autoCreate patch rejects unknown keys and non-booleans', () => {
  assert.deepEqual(normalizeAutoCreatePatch({ tags: true }), { tags: true });
  assert.throws(() => normalizeAutoCreatePatch({ nope: true }), FireflySettingsError);
  assert.throws(() => normalizeAutoCreatePatch({ tags: 'yes' }), FireflySettingsError);
  assert.throws(() => normalizeAutoCreatePatch(null), FireflySettingsError);
});

test('settings patch normalizes the instance URL and strips pasted API suffixes', () => {
  assert.equal(normalizeSettingsPatch({ baseUrl: 'https://firefly.example.com' }).baseUrl, 'https://firefly.example.com/');
  assert.equal(
    normalizeSettingsPatch({ baseUrl: 'https://firefly.example.com/api/v1/' }).baseUrl,
    'https://firefly.example.com/',
  );
  assert.equal(normalizeSettingsPatch({ baseUrl: 'http://localhost:8080/' }).baseUrl, 'http://localhost:8080/');
  // An empty URL is how the page clears the instance.
  assert.equal(normalizeSettingsPatch({ baseUrl: '  ' }).baseUrl, '');
  assert.throws(() => normalizeSettingsPatch({ baseUrl: 'http://remote.example/' }), FireflySettingsError);
  assert.throws(() => normalizeSettingsPatch({ baseUrl: 'ftp://firefly.example.com/' }), FireflySettingsError);
  assert.throws(() => normalizeSettingsPatch({ baseUrl: 42 }), FireflySettingsError);
});

test('settings patch validates the token and refuses contradictory writes', () => {
  const token = '  ' + 'y'.repeat(40) + '  ';
  assert.equal(normalizeSettingsPatch({ token }).token, 'y'.repeat(40));
  assert.throws(() => normalizeSettingsPatch({ token: 'short' }), (error) => {
    assert.equal(error.code, 'INVALID_TOKEN');
    assert.ok(error.message.length > 0);
    return true;
  });
  assert.throws(() => normalizeSettingsPatch({ token: 'z'.repeat(TOKEN_MIN_LENGTH), clearToken: true }), FireflySettingsError);
  assert.throws(() => normalizeSettingsPatch({ clearToken: 'yes' }), FireflySettingsError);
  assert.throws(() => normalizeSettingsPatch({}), FireflySettingsError);
  assert.throws(() => normalizeSettingsPatch(null), FireflySettingsError);
});

test('settings view reports the instance URL, switches and token presence', async () => {
  const service = createSettingsService(ctxWith(fakeEditor(), fakeCredentials(STORED_TOKEN)), config({ autoCreate: { budgets: true } }));
  const view = await service.view();
  assert.equal(view.editable, true);
  assert.equal(view.connection.editable, true);
  assert.equal(view.autoCreate.budgets, true);
  assert.equal(view.autoCreate.accounts, false);
  assert.equal(view.token.configured, true);
  assert.equal(view.token.stored, true);
  assert.equal(view.token.writable, true);
  assert.equal('key' in view.token, false);
  assert.equal(view.connection.baseUrl, 'https://firefly.example.com/');
  assert.equal(view.connection.configured, true);
});

test('save writes the new URL and switches through the config editor', async () => {
  const editor = fakeEditor();
  const credentials = fakeCredentials(undefined);
  const service = createSettingsService(ctxWith(editor, credentials), config());
  const result = await service.save({
    baseUrl: 'https://ledger.example.com/api/v1',
    autoCreate: { piggyBanks: true },
    token: 't'.repeat(40),
  });

  // The token is written before the config edit, which may restart the plugin.
  assert.deepEqual(credentials.state.order, ['token-write']);
  assert.equal(editor.calls.length, 1);
  const saved = editor.calls.result;
  assert.equal(saved.baseUrl, 'https://ledger.example.com/');
  assert.equal(saved.currency, 'CNY');
  assert.equal(saved.confirmWrites, false);
  assert.equal(saved.autoCreate.categories, true);
  assert.equal(saved.autoCreate.piggyBanks, true);
  assert.equal(saved.autoCreate.accounts, false);

  assert.equal(result.ok, true);
  assert.equal(result.pendingRestart, true);
  assert.equal(result.saved.baseUrl, 'https://ledger.example.com/');
  assert.deepEqual(result.saved.autoCreate, { piggyBanks: true });
  assert.equal(result.saved.token, 'saved');
});

test('save persists a token without touching the config editor', async () => {
  const editor = fakeEditor();
  const credentials = fakeCredentials(undefined);
  const service = createSettingsService(ctxWith(editor, credentials), config());
  const result = await service.save({ token: '  ' + 'k'.repeat(48) + '  ' });
  assert.equal(editor.calls.length, 0);
  assert.equal(credentials.state.record.kind, 'api-key');
  assert.equal(credentials.state.record.key, 'k'.repeat(48));
  assert.equal(result.pendingRestart, false);
  assert.equal(result.saved.token, 'saved');
});

test('save clears the stored token on request', async () => {
  const credentials = fakeCredentials(STORED_TOKEN);
  const service = createSettingsService(ctxWith(fakeEditor(), credentials), config());
  const result = await service.save({ clearToken: true });
  assert.equal(credentials.state.record, undefined);
  assert.deepEqual(credentials.state.order, ['token-delete']);
  assert.equal(result.saved.token, 'cleared');
});

test('saving the current URL is not a restart', async () => {
  const editor = fakeEditor();
  const service = createSettingsService(ctxWith(editor), config());
  const result = await service.save({ baseUrl: 'https://firefly.example.com' });
  assert.equal(editor.calls.length, 0);
  assert.equal(result.pendingRestart, false);
  assert.equal(result.saved.baseUrl, 'https://firefly.example.com/');
});

test('save fails closed when the config editor or its entry is unavailable', async () => {
  const credentials = fakeCredentials(undefined);
  const missingEditor = createSettingsService(ctxWith(undefined, credentials), config());
  await assert.rejects(() => missingEditor.save({ autoCreate: { tags: true } }), FireflySettingsError);
  // A token-only save still works without an editor.
  const result = await missingEditor.save({ token: 'm'.repeat(40) });
  assert.equal(result.pendingRestart, false);

  const missingEntry = createSettingsService(ctxWith(fakeEditor({ id: 'other', name: 'other' })), config());
  await assert.rejects(() => missingEntry.save({ baseUrl: 'https://other.example.com/' }), FireflySettingsError);
});
