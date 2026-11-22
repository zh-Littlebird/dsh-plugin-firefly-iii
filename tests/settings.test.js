import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import {
  AUTO_CREATE_DEFAULTS,
  createSettingsService,
  FireflySettingsError,
  normalizeAutoCreatePatch,
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

function ctxWith(editor) {
  return {
    get(name) {
      if (name === 'configEditor') return editor;
      if (name === 'credentials') {
        return {
          async readRecord() {
            return { kind: 'api-key', key: 'x'.repeat(40) };
          },
        };
      }
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

test('settings view reports effective switches and token presence', async () => {
  const service = createSettingsService(ctxWith(fakeEditor()), config({ autoCreate: { budgets: true } }));
  const view = await service.view();
  assert.equal(view.editable, true);
  assert.equal(view.autoCreate.budgets, true);
  assert.equal(view.autoCreate.accounts, false);
  assert.equal(view.token.configured, true);
  assert.equal(view.token.stored, true);
  assert.equal('key' in view.token, false);
  assert.equal(view.connection.baseUrl, 'https://firefly.example.com/');
});

test('save restates the complete config and merges the requested patch', async () => {
  const editor = fakeEditor();
  const service = createSettingsService(ctxWith(editor), config());
  await service.save({ piggyBanks: true });
  assert.equal(editor.calls.length, 1);
  const saved = editor.calls.result;
  assert.equal(saved.baseUrl, 'https://firefly.example.com/');
  assert.equal(saved.currency, 'CNY');
  assert.equal(saved.confirmWrites, false);
  assert.equal(saved.autoCreate.categories, true);
  assert.equal(saved.autoCreate.piggyBanks, true);
  assert.equal(saved.autoCreate.accounts, false);
});

test('save fails closed when the config editor or its entry is unavailable', async () => {
  const missingEditor = createSettingsService(ctxWith(undefined), config());
  await assert.rejects(() => missingEditor.save({ tags: true }), FireflySettingsError);

  const missingEntry = createSettingsService(ctxWith(fakeEditor({ id: 'other', name: 'other' })), config());
  await assert.rejects(() => missingEntry.save({ tags: true }), FireflySettingsError);
});
