import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSharedFileName, readSharedFile, sharedFilePath, writeSharedFile } from './sharedFile.ts';

describe('the shared file by its name before the rename', () => {
  const project = () => mkdtempSync(join(tmpdir(), 'seshboard-shared-'));

  it('creates .seshboard.json in a project without one', () => {
    const root = project();
    writeSharedFile(root, () => ({ actions: [] }));
    expect(existsSync(join(root, '.seshboard.json'))).toBe(true);
    expect(existsSync(join(root, '.switchboard.json'))).toBe(false);
  });

  it('reads and writes .switchboard.json where a project has only that one, and names it in errors', () => {
    const root = project();
    writeFileSync(join(root, '.switchboard.json'), '{\n    "actions": []\n}\n');
    expect(readSharedFile(root)).toMatchObject({ file: join(root, '.switchboard.json'), data: { actions: [] } });
    writeSharedFile(root, (data) => ({ ...data, prompts: [] }));
    expect(readFileSync(join(root, '.switchboard.json'), 'utf8')).toBe('{\n    "actions": [],\n    "prompts": []\n}\n');
    expect(existsSync(join(root, '.seshboard.json'))).toBe(false);
    writeFileSync(join(root, '.switchboard.json'), 'not json');
    expect(readSharedFile(root).error).toMatch(/^\.switchboard\.json: /);
  });

  it('prefers .seshboard.json when a project has both, and the watcher knows both names', () => {
    const root = project();
    writeFileSync(join(root, '.switchboard.json'), '{}');
    writeFileSync(join(root, '.seshboard.json'), '{}');
    expect(sharedFilePath(root)).toBe(join(root, '.seshboard.json'));
    expect(['.seshboard.json', '.switchboard.json', 'package.json'].map(isSharedFileName)).toEqual([true, true, false]);
  });
});
