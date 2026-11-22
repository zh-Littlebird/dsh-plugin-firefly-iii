/** firefly_attachments: attachment metadata, workspace-bounded upload/download and deletion. */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { jsonTool } from '../toolkit.js';
import { compactAttachment } from '../format.js';
import { confirmRoutineWrite, requireApproval, requireFields } from '../policy.js';
import { resolveWorkspacePath } from '../workspace.js';
import { fail } from '../errors.js';

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

export const attachmentsTool = jsonTool({
  name: 'firefly_attachments',
  description:
    'Work with Firefly III attachments: list, get, create metadata, upload a file from the session workspace, download to a new workspace file without overwriting, update title/notes/filename, or delete. Uploads are capped by maxAttachmentMb and a MIME whitelist; deletion requires approval.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'create', 'upload', 'download', 'update', 'delete'],
        description: 'create stores metadata only; upload sends the file bytes for an existing attachment id.',
      },
      id: { type: 'string', description: 'Attachment id for get/upload/download/update/delete.' },
      data: {
        type: 'object',
        description: 'For create: filename, attachable_type, attachable_id plus optional title/notes. For update: filename/title/notes.',
      },
      path: { type: 'string', description: 'Workspace-relative file path for upload or download target.' },
      attachableType: {
        type: 'string',
        enum: ['Account', 'Budget', 'Bill', 'TransactionJournal', 'PiggyBank', 'Tag'],
        description: 'Convenience for create when data.attachable_type is omitted.',
      },
      attachableId: { type: 'string', description: 'Convenience for create when data.attachable_id is omitted.' },
      filename: { type: 'string', description: 'Convenience for create when data.filename is omitted.' },
    },
    required: ['action'],
  },
  async execute(args, exec) {
    const { client, config } = exec;
    const signal = exec.signal;

    if (args.action === 'list') {
      const payload = await client.get('attachments', { limit: config.pageSize }, { signal });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      return {
        ok: true,
        summary: `${data.length} attachment(s).`,
        items: data.map((entry) => compactAttachment(entry)),
        counts: { returned: data.length },
      };
    }

    if (!args.id && args.action !== 'create') fail('MISSING_FIELD', 'id is required.');

    if (args.action === 'get') {
      const payload = await client.get(`attachments/${encodeURIComponent(args.id)}`, undefined, { signal });
      return { ok: true, summary: `Attachment ${args.id}.`, items: [compactAttachment(payload?.data)] };
    }

    if (args.action === 'create') {
      const data = { ...(args.data ?? {}) };
      if (data.filename === undefined) data.filename = args.filename;
      if (data.attachable_type === undefined) data.attachable_type = args.attachableType;
      if (data.attachable_id === undefined) data.attachable_id = args.attachableId;
      requireFields(data, ['filename', 'attachable_type', 'attachable_id'], 'attachment create');
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Create attachment metadata ${data.filename} for ${data.attachable_type} ${data.attachable_id}`,
        displayReason: { en: `Create attachment ${data.filename}`, zh: `创建附件「${data.filename}」` },
      });
      const payload = await client.post('attachments', data, { signal });
      const compact = compactAttachment(payload?.data);
      return {
        ok: true,
        summary: `Created attachment metadata ${data.filename}.`,
        items: [compact],
        hint: `Upload the bytes next with action=upload, id=${compact.id}, and a workspace path.`,
      };
    }

    if (args.action === 'upload') {
      const filePath = await resolveWorkspacePath(exec, args.path, 'path');
      const extension = extname(filePath).toLowerCase();
      const mime = MIME_BY_EXTENSION[extension];
      if (!mime) fail('UNSUPPORTED_FILE_TYPE', `Allowed upload extensions: ${Object.keys(MIME_BY_EXTENSION).join(', ')}.`);
      const info = await stat(filePath);
      if (!info.isFile()) fail('INVALID_FILE', `${filePath} is not a regular file.`);
      const maxBytes = config.maxAttachmentMb * 1024 * 1024;
      if (info.size > maxBytes) fail('FILE_TOO_LARGE', `File is ${info.size} bytes; the configured limit is ${maxBytes} bytes.`);
      const buffer = await readFile(filePath);
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Upload ${basename(filePath)} (${info.size} bytes) to attachment ${args.id}`,
        displayReason: { en: `Upload ${basename(filePath)} to Firefly III`, zh: `上传文件「${basename(filePath)}」到 Firefly III` },
      });
      const result = await client.requestRaw('POST', `attachments/${encodeURIComponent(args.id)}/upload`, {
        body: buffer,
        headers: { 'Content-Type': mime },
        signal,
      });
      return {
        ok: true,
        summary: `Uploaded ${basename(filePath)} (${info.size} bytes) to attachment ${args.id}.`,
        items: [{ attachmentId: args.id, filename: basename(filePath), bytes: info.size, mime, status: result.status }],
      };
    }

    if (args.action === 'download') {
      const payload = await client.get(`attachments/${encodeURIComponent(args.id)}`, undefined, { signal });
      const attachment = compactAttachment(payload?.data);
      const requested = args.path ?? `attachment-${args.id}-${basename(attachment.filename ?? 'download.bin').replace(/[^\w.-]/g, '_')}`;
      const target = await resolveWorkspacePath(exec, requested, 'path');
      const result = await client.requestRaw('GET', `attachments/${encodeURIComponent(args.id)}/download`, { signal });
      try {
        await writeFile(target, result.buffer, { flag: 'wx' });
      } catch (error) {
        if (error?.code === 'EEXIST') fail('FILE_EXISTS', `Refusing to overwrite existing file ${target}.`);
        throw error;
      }
      return {
        ok: true,
        summary: `Downloaded attachment ${args.id} to ${target}.`,
        path: target,
        bytes: result.buffer.length,
        items: [{ attachment: attachment.filename, path: target, bytes: result.buffer.length }],
      };
    }

    if (args.action === 'update') {
      const data = requireFields(args.data, [], 'attachment update');
      await confirmRoutineWrite(exec.ctx, exec, config, {
        reason: `Update attachment ${args.id}`,
        displayReason: { en: `Update attachment ${args.id}`, zh: `修改附件 ${args.id}` },
      });
      const payload = await client.put(`attachments/${encodeURIComponent(args.id)}`, data, { signal });
      return { ok: true, summary: `Updated attachment ${args.id}.`, items: [compactAttachment(payload?.data)] };
    }

    if (args.action === 'delete') {
      const payload = await client.get(`attachments/${encodeURIComponent(args.id)}`, undefined, { signal });
      const attachment = compactAttachment(payload?.data);
      await requireApproval(exec.ctx, exec, {
        reason: `Delete attachment ${args.id} (${attachment.filename}, attached to ${attachment.attachableType} ${attachment.attachableId}).`,
        displayReason: {
          en: `Delete attachment ${attachment.filename}`,
          zh: `删除附件「${attachment.filename}」`,
        },
      });
      await client.delete(`attachments/${encodeURIComponent(args.id)}`, { signal });
      return { ok: true, summary: `Deleted attachment ${args.id}.`, items: [{ deleted: attachment }], counts: { deleted: 1 } };
    }

    return fail('INVALID_PARAMETER', `Unknown action "${args.action}".`);
  },
});
