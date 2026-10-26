import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonFile, writeFileAtomic } from './jsonFile.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-json-'));
  dirs.push(dir);
  return dir;
};

describe('readJsonFile', () => {
  it('reads JSON, and nothing when the file is missing', () => {
    const file = join(tempDir(), 'preferences.json');
    expect(readJsonFile(file)).toBeUndefined();
    writeFileSync(file, '{"colorScheme":"dark"}');
    expect(readJsonFile(file)).toEqual({ colorScheme: 'dark' });
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it('keeps a copy of a file it cannot parse', () => {
    const file = join(tempDir(), 'preferences.json');
    writeFileSync(file, '{"colorScheme":"da');
    expect(readJsonFile(file)).toBeUndefined();
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe('{"colorScheme":"da');
  });
});

describe('writeFileAtomic', () => {
  it('replaces the file and leaves no temporary file', () => {
    const dir = tempDir();
    const file = join(dir, 'preferences.json');
    writeFileSync(file, 'old');
    writeFileAtomic(file, 'new');
    expect(readFileSync(file, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['preferences.json']);
  });

  it('leaves the old file when the write fails', () => {
    const dir = tempDir();
    // A folder in the way of the rename.
    const file = join(dir, 'preferences.json');
    mkdirSync(file);
    writeFileSync(join(file, 'keep'), '');
    expect(() => writeFileAtomic(file, 'new')).toThrow();
    expect(readdirSync(dir)).toEqual(['preferences.json']);
    expect(existsSync(join(file, 'keep'))).toBe(true);
  });
});
