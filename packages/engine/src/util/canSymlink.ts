import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let result: boolean | undefined;

/**
 * Whether this process may make symbolic links. Always on macOS and Linux; on Windows only with Developer
 * Mode or as an administrator. Tests that need a link check this instead of failing for lack of rights.
 */
export function canSymlink(): boolean {
  if (result !== undefined) return result;
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-symlink-'));
  try {
    writeFileSync(join(dir, 'target'), '');
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    result = true;
  } catch {
    result = false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return result;
}
