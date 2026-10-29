import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoFile } from './repoFile.ts';

describe('readRepoFile', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'sb-repo-file-'));
  const posix = process.platform !== 'win32';

  it('reads a small regular file, and throws ENOENT for a missing one', () => {
    const root = dir();
    writeFileSync(join(root, 'package.json'), '{"scripts":{}}');
    expect(readRepoFile(join(root, 'package.json'))).toBe('{"scripts":{}}');
    expect(() => readRepoFile(join(root, 'nope.json'))).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });

  it('refuses a file over the limit', () => {
    const root = dir();
    writeFileSync(join(root, 'big.json'), 'x'.repeat(2048));
    expect(() => readRepoFile(join(root, 'big.json'), 1024)).toThrow('is larger than 1 KB');
    expect(readRepoFile(join(root, 'big.json'), 2048)).toHaveLength(2048);
  });

  it.runIf(posix)('never follows a link: to /dev/zero (which never ends) or to a private file elsewhere', () => {
    const root = dir();
    const secret = join(dir(), 'private.json');
    writeFileSync(secret, '{"token":"x"}');
    symlinkSync('/dev/zero', join(root, 'package.json'));
    symlinkSync(secret, join(root, '.seshboard.json'));
    expect(() => readRepoFile(join(root, 'package.json'))).toThrow('is a link');
    expect(() => readRepoFile(join(root, '.seshboard.json'))).toThrow('is a link');
  });

  it.runIf(posix)('refuses a device or a FIFO without waiting on it', () => {
    const root = dir();
    execFileSync('mkfifo', [join(root, 'fifo.json')]);
    expect(() => readRepoFile(join(root, 'fifo.json'))).toThrow('is not a regular file');
    expect(() => readRepoFile('/dev/zero')).toThrow('is not a regular file');
  });
});
