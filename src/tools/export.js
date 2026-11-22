/** firefly_export: CSV export into the session workspace without overwriting files. */
import { writeFile } from 'node:fs/promises';
import { jsonTool } from '../toolkit.js';
import { assertDateRange } from '../policy.js';
import { resolveWorkspacePath } from '../workspace.js';
import { fail } from '../errors.js';

const EXPORTS = {
  accounts: 'accounts',
  bills: 'bills',
  budgets: 'budgets',
  categories: 'categories',
  'piggy-banks': 'piggy-banks',
  recurring: 'recurring',
  rules: 'rules',
  subscriptions: 'subscriptions',
  tags: 'tags',
  transactions: 'transactions',
};

function stamp() {
  const now = new Date();
  return now.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');
}

export const exportTool = jsonTool({
  name: 'firefly_export',
  description:
    'Export Firefly III data as the official CSV to a new file in the session workspace. Transaction exports require start and end dates. Refuses to overwrite an existing file and returns the written path.',
  parameters: {
    type: 'object',
    properties: {
      resource: {
        type: 'string',
        enum: Object.keys(EXPORTS),
        description: 'Which Firefly III export to request.',
      },
      start: { type: 'string', description: 'YYYY-MM-DD start; required for transactions.' },
      end: { type: 'string', description: 'YYYY-MM-DD end; required for transactions.' },
      path: { type: 'string', description: 'Optional workspace-relative output path. Defaults to firefly-export-<resource>-<timestamp>.csv.' },
    },
    required: ['resource'],
  },
  async execute(args, exec) {
    const { client } = exec;
    const signal = exec.signal;
    const endpoint = EXPORTS[args.resource];
    if (!endpoint) fail('INVALID_PARAMETER', `resource must be one of ${Object.keys(EXPORTS).join(', ')}.`);
    const query = {};
    if (args.resource === 'transactions' || args.start || args.end) {
      const range = assertDateRange(args.start, args.end);
      query.start = range.start;
      query.end = range.end;
    }
    const requested = args.path ?? `firefly-export-${args.resource}-${stamp()}.csv`;
    const target = await resolveWorkspacePath(exec, requested, 'path');
    const result = await client.requestRaw('GET', `data/export/${endpoint}`, { query, signal });
    const disposition = result.headers.get('content-disposition') ?? '';
    const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? requested;
    try {
      await writeFile(target, result.buffer, { flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') fail('FILE_EXISTS', `Refusing to overwrite existing file ${target}.`);
      throw error;
    }
    return {
      ok: true,
      summary: `Exported ${args.resource} CSV (${result.buffer.length} bytes) to ${target}.`,
      path: target,
      bytes: result.buffer.length,
      items: [{ resource: args.resource, path: target, bytes: result.buffer.length, serverFilename: filename.replace(/"/g, '') }],
    };
  },
});
