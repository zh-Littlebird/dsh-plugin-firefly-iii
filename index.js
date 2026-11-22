/**
 * Host half of the Firefly III bundle: registers nine domain tools, one bundled
 * skill and the token/status commands. All registrations are owned by ctx.effect
 * so hot replacement removes them cleanly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FireflyClient } from './src/client.js';
import { Config } from './src/config.js';
import { FireflyError } from './src/errors.js';
import { resolveToken, saveToken, tokenStatus, clearToken } from './src/credentials.js';
import { lookupTool } from './src/tools/lookup.js';
import { recordTool } from './src/tools/record.js';
import { transactionsTool } from './src/tools/transactions.js';
import { masterdataTool } from './src/tools/masterdata.js';
import { reportsTool } from './src/tools/reports.js';
import { recurringTool } from './src/tools/recurring.js';
import { attachmentsTool } from './src/tools/attachments.js';
import { adminTool } from './src/tools/admin.js';
import { exportTool } from './src/tools/export.js';
import { createSettingsService } from './src/settings.js';
import { createSettingsHandler, registerSettingsRoute } from './src/settings-api.js';

export const name = 'firefly-iii';
export const inject = ['tools', 'skills'];
export { Config };

const TOOLS = [
  lookupTool,
  recordTool,
  transactionsTool,
  masterdataTool,
  reportsTool,
  recurringTool,
  attachmentsTool,
  adminTool,
  exportTool,
];

const SKILL_DESCRIPTION =
  'Use when the user wants to record, query, correct or delete Firefly III transactions; maintain accounts, categories, budgets or tags; analyze spending, budgets or net worth; or work with subscriptions, recurring transactions, piggy banks, attachments, rules, currencies, exchange rates or CSV exports. Not for generic financial advice unrelated to Firefly III data.';

function registerTools(ctx, config) {
  for (const definition of TOOLS) {
    const wrapped = {
      ...definition,
      async execute(args, exec) {
        const { token } = await resolveToken(ctx);
        const client = new FireflyClient(config, token);
        const facade = Object.create(exec);
        Object.defineProperties(facade, {
          client: { value: client, enumerable: true },
          config: { value: config, enumerable: true },
          ctx: { value: ctx, enumerable: true },
          fireflyCtx: { value: ctx, enumerable: true },
        });
        return definition.execute(args, facade);
      },
    };
    ctx.effect(() => ctx.tools.register(wrapped));
  }
}

function registerSkill(ctx) {
  const skillDirectory = fileURLToPath(new URL('./skills/firefly-iii/', import.meta.url));
  const raw = readFileSync(new URL('./skills/firefly-iii/SKILL.md', import.meta.url), 'utf8');
  const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  ctx.effect(() =>
    ctx.skills.register({
      name: 'firefly-iii',
      description: SKILL_DESCRIPTION,
      source: 'custom',
      content:
        `${content}\n\n## Bundled references\n\n- \`references/record-rules.md\` — transaction field and split rules.\n- \`references/api-shapes.md\` — payload shapes and enum values.\n\nResolve relative links against ${skillDirectory}.`,
      resourceBase: { kind: 'directory', path: skillDirectory },
    }),
  );
}

function registerCommands(ctx, config) {
  const commands = ctx.get('commands');
  if (!commands) return;

  ctx.effect(() =>
    commands.register({
      name: 'firefly-token',
      description: 'Save a Firefly III personal access token into credentials without logging its value.',
      input: { hint: '<personal access token>' },
      recordInput: false,
      async handler(invocation) {
        try {
          await saveToken(ctx, invocation.rawInput);
          return {
            kind: 'success',
            text: 'Firefly III token saved to credentials. Run /firefly-status to verify the connection.',
          };
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  );

  ctx.effect(() =>
    commands.register({
      name: 'firefly-token-clear',
      description: 'Remove the stored Firefly III token from credentials.',
      async handler() {
        try {
          await clearToken(ctx);
          return { kind: 'success', text: 'Stored Firefly III token removed.' };
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  );

  ctx.effect(() =>
    commands.register({
      name: 'firefly-status',
      description: 'Check the Firefly III connection, token source and API version.',
      async handler(invocation) {
        try {
          const status = await tokenStatus(ctx);
          if (!status.configured) {
            return {
              kind: 'error',
              text: 'No Firefly III token configured. Run /firefly-token <token> or set FIREFLY_III_ACCESS_TOKEN.',
            };
          }
          const { token, source } = await resolveToken(ctx);
          const client = new FireflyClient(config, token);
          const about = await client.about(invocation.signal);
          const version = String(about?.version ?? 'unknown');
          const apiVersion = String(about?.api_version ?? version);
          const prefix = String(config.expectedApiPrefix ?? '');
          const mismatch = prefix !== '' && !apiVersion.startsWith(prefix);
          return {
            kind: mismatch ? 'error' : 'success',
            text:
              `Firefly III ${version} (API ${apiVersion}) at ${config.baseUrl}; token source: ${source}.` +
              (mismatch ? ` API version does not start with expected "${prefix}".` : ''),
          };
        } catch (error) {
          const message = error instanceof FireflyError ? error.message : error instanceof Error ? error.message : String(error);
          return { kind: 'error', text: message };
        }
      },
    }),
  );
}

export function apply(ctx, config) {
  registerTools(ctx, config);
  registerSkill(ctx);
  registerCommands(ctx, config);
  // Web settings page: loopback-only route behind the Client settings section.
  const settings = createSettingsService(ctx, config);
  registerSettingsRoute(ctx, createSettingsHandler({ ctx, config, settings }));
}
