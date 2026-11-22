/** Resolve plugin file paths inside the exact Agent Session workspace. */
import { isAbsolute, resolve, relative } from 'node:path';
import { fail } from './errors.js';

export async function workspaceDirectory(exec) {
  const service = exec.fireflyCtx?.get('workingDirectory');
  if (service && exec.agent) {
    try {
      return await service.ensure(exec.agent, exec.signal);
    } catch {
      // fall through to process cwd
    }
  }
  return process.cwd();
}

export async function resolveWorkspacePath(exec, requested, label = 'path') {
  const directory = await workspaceDirectory(exec);
  if (!requested) fail('MISSING_FIELD', `${label} is required.`);
  const candidate = isAbsolute(requested) ? resolve(requested) : resolve(directory, requested);
  const rel = relative(resolve(directory), candidate);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    fail('PATH_OUTSIDE_WORKSPACE', `${label} must stay inside the session workspace (${directory}).`);
  }
  return candidate;
}
