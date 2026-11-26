import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RpcError } from '@seshboard/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { lineEnding, writeFileContent } from './fileWrite.ts';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-write-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const mtime = (path: string) => Math.floor(statSync(path).mtimeMs);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof RpcError ? error.code : `other: ${String(error)}`;
  }
  return null;
};

describe('lineEnding', () => {
  it('finds the ending most lines use', () => {
    expect(lineEnding('a\nb\n')).toBe('\n');
    expect(lineEnding('a\r\nb\r\n')).toBe('\r\n');
    expect(lineEnding('a\r\nb\r\nc\n')).toBe('\r\n');
    expect(lineEnding('one line')).toBeNull();
  });
});

describe('writeFileContent', () => {
  it('saves a file inside a known folder and returns its new mtime', async () => {
    const root = temp();
    const file = join(root, 'src', 'a.ts');
    mkdirSync(join(root, 'src'));
    writeFileSync(file, 'const a = 1;\n');
    const result = await writeFileContent({ path: file, content: 'const a = 2;\n', expectedModified: mtime(file) }, [root]);
    expect(readFileSync(file, 'utf8')).toBe('const a = 2;\n');
    expect(result.modified).toBe(mtime(file));
    // No temporary file is left behind.
    expect(readdirSync(join(root, 'src'))).toEqual(['a.ts']);
  });

  it('refuses a file changed since it was read, and leaves it as it is', async () => {
    const root = temp();
    const file = join(root, 'a.txt');
    writeFileSync(file, 'old');
    const read = mtime(file);
    writeFileSync(file, 'Claude wrote this');
    utimesSync(file, new Date(), new Date(read + 5_000));
    expect(await code(writeFileContent({ path: file, content: 'mine', expectedModified: read }, [root]))).toBe('CONFLICT');
    expect(readFileSync(file, 'utf8')).toBe('Claude wrote this');
  });

  it('refuses a file outside the known folders, through a link, or in .git', async () => {
    const root = temp();
    const outside = temp();
    const secret = join(outside, 'secret.txt');
    writeFileSync(secret, 'keep');
    expect(await code(writeFileContent({ path: secret, content: 'x', expectedModified: mtime(secret) }, [root]))).toBe('NOT_FOUND');
    symlinkSync(secret, join(root, 'link.txt'));
    expect(await code(writeFileContent({ path: join(root, 'link.txt'), content: 'x', expectedModified: mtime(secret) }, [root]))).toBe('NOT_FOUND');
    expect(readFileSync(secret, 'utf8')).toBe('keep');
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'config'), '[core]');
    expect(await code(writeFileContent({ path: join(root, '.git', 'config'), content: 'x', expectedModified: mtime(join(root, '.git', 'config')) }, [root]))).toBe('UNSUPPORTED');
    expect(await code(writeFileContent({ path: join(root, 'missing.txt'), content: 'x', expectedModified: 0 }, [root]))).toBe('NOT_FOUND');
    expect(await code(writeFileContent({ path: root, content: 'x', expectedModified: mtime(root) }, [root]))).toBe('NOT_FOUND');
  });

  it("keeps the file's line endings, byte order mark and permissions", async () => {
    const root = temp();
    const file = join(root, 'win.txt');
    writeFileSync(file, '﻿one\r\ntwo\r\n');
    chmodSync(file, 0o755);
    await writeFileContent({ path: file, content: 'one\ntwo\nthree\n', expectedModified: mtime(file) }, [root]);
    expect(readFileSync(file, 'utf8')).toBe('﻿one\r\ntwo\r\nthree\r\n');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o755);
    const unix = join(root, 'unix.txt');
    writeFileSync(unix, 'a\nb\n');
    await writeFileContent({ path: unix, content: 'a\r\nb\r\nc\r\n', expectedModified: mtime(unix) }, [root]);
    expect(readFileSync(unix, 'utf8')).toBe('a\nb\nc\n');
  });
});
