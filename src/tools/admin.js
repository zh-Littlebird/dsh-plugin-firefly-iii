/** firefly_admin: currencies, exchange rates, rules, rule groups, links and webhooks. */
import { jsonTool } from '../toolkit.js';
import { compactFor } from './lookup.js';
import { compactGeneric, compactWebhook } from '../format.js';
import { assertNotForbiddenAction, confirmRoutineWrite, requireApproval, requireFields } from '../policy.js';
import { fail } from '../errors.js';

const RESOURCES = {
  currencies: { path: 'currencies', compact: 'currencies', label: 'currency', idName: 'code' },
  'exchange-rates': { path: 'exchange-rates', compact: 'exchange-rates', label: 'exchange rate', idName: 'rate id' },
  rules: { path: 'rules', compact: 'rules', label: 'rule', createFields: ['title', 'rule_group_id', 'trigger', 'triggers', 'actions'] },
  'rule-groups': { path: 'rule-groups', compact: 'rule-groups', label: 'rule group', createFields: ['title'] },
  'link-types': { path: 'link-types', compact: 'link-types', label: 'link type', createFields: ['name', 'inward', 'outward'] },
  'transaction-links': { path: 'transaction-links', compact: 'transaction-links', label: 'transaction link', createFields: ['link_type_id', 'source_id', 'destination_id'] },
  webhooks: { path: 'webhooks', compact: 'webhooks', label: 'webhook', createFields: ['title', 'trigger', 'response', 'delivery', 'url'] },
};

const CURRENCY_MUTATIONS = ['enable', 'disable', 'primary'];

/** Capabilities worth probing after a Firefly III upgrade. */
const CAPABILITY_PROBES = [
  { capability: 'webhooks', path: 'webhooks' },
  { capability: 'subscriptions', path: 'subscriptions', query: { limit: 1 } },
  { capability: 'preferences', path: 'preferences', query: { limit: 1 } },
  { capability: 'release-notes', path: 'release-notes' },
  { capability: 'autocomplete-transactions-with-meta', path: 'autocomplete/transactions-with-meta', query: { query: 'a', limit: 1 } },
];

function probeFailure(error) {
  if (error?.code === 'ENDPOINT_UNAVAILABLE') return 'endpoint not available (404)';
  if (error?.code === 'AUTH_FAILED') return 'token rejected (401)';
  return String(error?.message ?? error).slice(0, 160);
}

/** Firefly release notes are HTML; keep the readable text and drop the markup. */
function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|ul|ol)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function specFor(resource) {
  const spec = RESOURCES[resource];
  if (!spec) fail('INVALID_PARAMETER', `resource must be one of ${Object.keys(RESOURCES).join(', ')}.`);
  return spec;
}

function compact(resourceNoun, json) {
  if (resourceNoun === 'webhooks') return compactWebhook(json);
  return compactFor(resourceNoun, json);
}

export const adminTool = jsonTool({
  name: 'firefly_admin',
  description:
    'Administer Firefly III automation and money metadata: currencies, exchange rates, rules, rule groups, link types, transaction links and webhooks. Also test/trigger rules, inspect or trigger webhook deliveries, and inspect the running instance (version, release notes, capability probes). Currency-wide changes, triggering rules/webhooks and deletions require approval. Purge and destroy are permanently blocked.',
  parameters: {
    type: 'object',
    properties: {
      resource: {
        type: 'string',
        enum: ['currencies', 'exchange-rates', 'rules', 'rule-groups', 'link-types', 'transaction-links', 'webhooks', 'instance'],
        description: 'Object family to inspect or change. instance is read-only diagnostics.',
      },
      action: {
        type: 'string',
        enum: ['list', 'get', 'create', 'update', 'delete', 'pair', 'enable', 'disable', 'primary', 'test', 'trigger', 'submit', 'trigger-transaction', 'messages', 'message', 'attempts', 'attempt', 'about', 'release-notes', 'capabilities'],
        description: 'CRUD plus currency enable/disable/primary, exchange-rate pair lookup, rule test/trigger, webhook diagnostics/trigger, and instance about/release-notes/capabilities diagnostics.',
      },
      id: { type: 'string', description: 'Object id for get/update/delete/test/trigger/diagnostics.' },
      code: { type: 'string', description: 'Currency code for currency actions.' },
      from: { type: 'string', description: 'Exchange-rate pair base currency code.' },
      to: { type: 'string', description: 'Exchange-rate pair quote currency code.' },
      date: { type: 'string', description: 'YYYY-MM-DD for a specific exchange-rate pair lookup.' },
      data: { type: 'object', description: 'Create/update body matching the Firefly III schema for the chosen resource.' },
      transactionId: { type: 'string', description: 'Transaction id for webhook action=trigger-transaction.' },
      messageId: { type: 'string', description: 'Webhook message id for message/attempts/attempt.' },
      attemptId: { type: 'string', description: 'Webhook attempt id for attempt.' },
    },
    required: ['resource', 'action'],
  },
  async execute(args, exec) {
    const { client, config } = exec;
    const signal = exec.signal;
    assertNotForbiddenAction(args.action);
    const action = args.action;

    // Read-only instance diagnostics: version, release notes and capability probes.
    if (args.resource === 'instance') {
      if (action === 'about') {
        const payload = await client.get('about', undefined, { signal });
        const about = payload?.data ?? payload ?? {};
        const version = String(about.version ?? 'unknown');
        const apiVersion = String(about.api_version ?? version);
        const expected = String(config.expectedApiPrefix ?? '');
        const compatible = expected === '' || apiVersion.startsWith(expected);
        return {
          ok: true,
          summary: `Firefly III ${version} (API ${apiVersion})${compatible ? '' : ` — outside the supported ${expected} series`}.`,
          items: [
            {
              version,
              apiVersion,
              phpVersion: about.php_version,
              os: about.os,
              driver: about.driver,
              expectedPrefix: expected,
              compatible,
            },
          ],
          counts: { compatible: compatible ? 1 : 0 },
          ...(compatible
            ? {}
            : { warnings: [`API ${apiVersion} does not start with ${expected}; update the plugin before relying on new fields.`] }),
        };
      }
      if (action === 'release-notes') {
        const suffix = args.id ? `/${encodeURIComponent(args.id)}` : '';
        const payload = await client.get(`release-notes${suffix}`, undefined, { signal });
        const data = payload?.data ?? payload ?? {};
        const markdown = String(data.release_notes_markdown ?? '').trim();
        const notes = markdown || stripHtml(data.release_notes ?? '');
        return {
          ok: true,
          summary: `Release notes for Firefly III ${data.version ?? args.id ?? 'current version'}.`,
          items: [{ version: data.version ?? args.id, notes: notes.slice(0, 4000) }],
          truncated: notes.length > 4000,
          hint: 'Markdown is preferred when the instance provides it; HTML is reduced to plain text.',
        };
      }
      if (action === 'capabilities') {
        const results = [];
        for (const probe of CAPABILITY_PROBES) {
          try {
            await client.get(probe.path, probe.query, { signal });
            results.push({ capability: probe.capability, available: true });
          } catch (error) {
            results.push({
              capability: probe.capability,
              available: false,
              code: error?.code,
              message: probeFailure(error),
            });
          }
        }
        const available = results.filter((entry) => entry.available).length;
        return {
          ok: true,
          summary: `${available}/${results.length} probed capabilities are available on this instance.`,
          items: results,
          counts: { available, total: results.length },
          hint: '404 means the instance does not expose the capability; 401 means the token is unusable.',
        };
      }
      return fail('INVALID_PARAMETER', 'instance supports action=about, release-notes or capabilities.');
    }

    const spec = specFor(args.resource);
    const idSegment = encodeURIComponent(String(args.id ?? args.code ?? ''));

    if (action === 'list') {
      let payload;
      try {
        payload = await client.get(spec.path, { limit: config.pageSize }, { signal });
      } catch (error) {
        if (args.resource === 'webhooks' && error?.code === 'ENDPOINT_UNAVAILABLE') {
          return {
            ok: true,
            summary: 'Webhook endpoints are not available on this Firefly III instance (GET /v1/webhooks returned 404).',
            items: [],
            warnings: ['webhook capability unavailable on this instance'],
          };
        }
        throw error;
      }
      const data = Array.isArray(payload?.data) ? payload.data : [];
      return {
        ok: true,
        summary: `${data.length} ${spec.label}(s).`,
        items: data.map((entry) => compact(spec.compact, entry)),
        counts: { returned: data.length },
      };
    }

    if (action === 'pair') {
      if (args.resource !== 'exchange-rates') fail('INVALID_PARAMETER', 'pair is only valid for exchange-rates.');
      if (!args.from || !args.to) fail('MISSING_FIELD', 'from and to are required.');
      let path = `exchange-rates/${encodeURIComponent(args.from)}/${encodeURIComponent(args.to)}`;
      if (args.date) path += `/${encodeURIComponent(args.date)}`;
      const payload = await client.get(path, undefined, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
      return {
        ok: true,
        summary: `Exchange rate ${args.from}→${args.to}${args.date ? ` on ${args.date}` : ''}.`,
        items: data.map((entry) => compact('exchange-rates', entry)),
        counts: { returned: data.length },
        hint: 'Direction matters: USD→CNY and CNY→USD are separate records.',
      };
    }

    if (action === 'get' || action === 'test' || action === 'messages' || action === 'message' || action === 'attempts' || action === 'attempt') {
      if (!args.id) fail('MISSING_FIELD', 'id is required.');
      let path;
      if (action === 'get') path = `${spec.path}/${idSegment}`;
      else if (action === 'test') {
        if (args.resource !== 'rules' && args.resource !== 'rule-groups') fail('INVALID_PARAMETER', 'test is only valid for rules and rule-groups.');
        path = `${spec.path}/${idSegment}/test`;
      } else {
        if (args.resource !== 'webhooks') fail('INVALID_PARAMETER', `${action} is only valid for webhooks.`);
        if (action !== 'messages' && !args.messageId) fail('MISSING_FIELD', 'messageId is required.');
        if (action === 'messages') {
          path = `webhooks/${idSegment}/messages`;
        } else if (action === 'message') {
          path = `webhooks/${idSegment}/messages/${encodeURIComponent(args.messageId)}`;
        } else if (action === 'attempts') {
          path = `webhooks/${idSegment}/messages/${encodeURIComponent(args.messageId)}/attempts`;
        } else {
          if (!args.attemptId) fail('MISSING_FIELD', 'attemptId is required for attempt.');
          path = `webhooks/${idSegment}/messages/${encodeURIComponent(args.messageId)}/attempts/${encodeURIComponent(args.attemptId)}`;
        }
      }
      const payload = await client.get(path, undefined, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
      const items = data.map((entry) => compactGeneric(entry));
      return {
        ok: true,
        summary: `${data.length} record(s) from ${spec.label} ${args.id ?? ''} ${action}.`,
        items,
        counts: { returned: data.length },
        ...(action === 'test'
          ? { hint: 'Rule test is a preview; nothing was changed. Use action=trigger only after reviewing it.' }
          : {}),
      };
    }

    if (action === 'create') {
      const fields = spec.createFields ?? [];
      const data = fields.length > 0 ? requireFields(args.data, fields, `${spec.label} create`) : args.data;
      if (!data || typeof data !== 'object') fail('INVALID_PAYLOAD', 'data is required.');
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Create ${spec.label} ${data.title ?? data.name ?? data.code ?? ''}`,
        displayReason: { en: `Create ${spec.label}`, zh: `新建${spec.label}` },
      });
      const payload = await client.post(spec.path, data, { signal });
      return { ok: true, summary: `Created ${spec.label}.`, items: [compact(spec.compact, payload?.data)] };
    }

    if (action === 'update') {
      if (!args.id && !args.code) fail('MISSING_FIELD', 'id is required.');
      const data = args.data;
      if (!data || typeof data !== 'object') fail('INVALID_PAYLOAD', 'data is required.');
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Update ${spec.label} ${args.id ?? args.code}`,
        displayReason: { en: `Update ${spec.label} ${args.id ?? args.code}`, zh: `修改${spec.label} ${args.id ?? args.code}` },
      });
      const payload = await client.put(`${spec.path}/${idSegment}`, data, { signal });
      return { ok: true, summary: `Updated ${spec.label} ${args.id ?? args.code}.`, items: [compact(spec.compact, payload?.data)] };
    }

    if (CURRENCY_MUTATIONS.includes(action)) {
      if (args.resource !== 'currencies') fail('INVALID_PARAMETER', `${action} is only valid for currencies.`);
      const code = args.code ?? args.id;
      if (!code) fail('MISSING_FIELD', 'code is required.');
      const endpoint = action === 'primary' ? 'primary' : action;
      await requireApproval(exec.ctx, exec, {
        reason: `${action === 'primary' ? 'Set primary currency' : action === 'disable' ? 'Disable currency' : 'Enable currency'} ${code}; this changes the whole ledger view.`,
        displayReason: {
          en: `${action === 'primary' ? 'Set primary currency' : action === 'disable' ? 'Disable currency' : 'Enable currency'} ${code}`,
          zh: `${action === 'primary' ? '设置主币种' : action === 'disable' ? '禁用币种' : '启用币种'} ${code}`,
        },
      });
      await client.post(`currencies/${encodeURIComponent(code)}/${endpoint}`, undefined, { signal });
      return { ok: true, summary: `Currency ${code}: ${action} applied.`, items: [{ code, action }] };
    }

    if (action === 'trigger') {
      if (args.resource !== 'rules' && args.resource !== 'rule-groups') {
        fail('INVALID_PARAMETER', 'trigger is only valid for rules and rule-groups.');
      }
      if (!args.id) fail('MISSING_FIELD', 'id is required.');
      const testPayload = await client.get(`${spec.path}/${idSegment}/test`, undefined, { signal });
      const testData = Array.isArray(testPayload?.data) ? testPayload.data : testPayload?.data ? [testPayload.data] : [];
      const affected = testData.length;
      await requireApproval(exec.ctx, exec, {
        reason: `Trigger ${spec.label} ${args.id}; the test preview matched ${affected} transaction(s) and triggering will modify matching transactions.`,
        displayReason: {
          en: `Trigger ${spec.label} ${args.id} (test matched ${affected} transaction(s))`,
          zh: `触发${spec.label} ${args.id}（测试命中 ${affected} 笔交易）`,
        },
      });
      await client.post(`${spec.path}/${idSegment}/trigger`, undefined, { signal });
      return {
        ok: true,
        summary: `Triggered ${spec.label} ${args.id}.`,
        items: testData.slice(0, 50).map((entry) => compactGeneric(entry)),
        counts: { testMatched: affected },
      };
    }

    if (action === 'submit' || action === 'trigger-transaction') {
      if (args.resource !== 'webhooks') fail('INVALID_PARAMETER', `${action} is only valid for webhooks.`);
      if (!args.id) fail('MISSING_FIELD', 'id is required.');
      if (action === 'trigger-transaction' && !args.transactionId) fail('MISSING_FIELD', 'transactionId is required.');
      const suffix = action === 'submit' ? 'submit' : `trigger-transaction/${encodeURIComponent(args.transactionId)}`;
      await requireApproval(exec.ctx, exec, {
        reason: `Send webhook ${args.id}${action === 'submit' ? ' test payload' : ` for transaction ${args.transactionId}`}; this contacts an external endpoint.`,
        displayReason: {
          en: `Trigger webhook ${args.id}`,
          zh: `触发 Webhook ${args.id}`,
        },
      });
      await client.post(`webhooks/${idSegment}/${suffix}`, undefined, { signal });
      return { ok: true, summary: `Webhook ${args.id} ${action} accepted.`, items: [{ webhookId: args.id, action, transactionId: args.transactionId }] };
    }

    if (action === 'delete') {
      if (!args.id && !args.code) fail('MISSING_FIELD', 'id is required.');
      const payload = await client.get(`${spec.path}/${idSegment}`, undefined, { signal });
      const compacted = compact(spec.compact, payload?.data);
      await requireApproval(exec.ctx, exec, {
        reason: `Delete ${spec.label} ${args.id ?? args.code} (${compacted.name ?? compacted.title ?? compacted.code ?? compacted.id}).`,
        displayReason: { en: `Delete ${spec.label} ${args.id ?? args.code}`, zh: `删除${spec.label} ${args.id ?? args.code}` },
      });
      await client.delete(`${spec.path}/${idSegment}`, { signal });
      return { ok: true, summary: `Deleted ${spec.label} ${args.id ?? args.code}.`, items: [{ deleted: compacted }], counts: { deleted: 1 } };
    }

    return fail('INVALID_PARAMETER', `Action "${action}" is not supported for ${args.resource}.`);
  },
});
