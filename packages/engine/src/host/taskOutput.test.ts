import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isTaskOutputPath, readTaskOutput } from './taskOutput.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A tasks folder laid out as Claude Code does: `claude/<project>/<session>/tasks`. */
const tasksDir = () => {
  const root = mkdtempSync(join(tmpdir(), 'switchboard-tasks-'));
  dirs.push(root);
  const dir = join(root, 'claude', 'E--repos-demo', '5305d406-06de-45f9-92a6-a348df95aeb7', 'tasks');
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('task output paths', () => {
  it('takes the paths Claude Code writes on macOS and Windows', () => {
    expect(isTaskOutputPath('/private/tmp/claude-501/-Users-me-demo/5305d406/tasks/bml4i76rh.output')).toBe(true);
    expect(isTaskOutputPath('/tmp/claude/-Users-me-demo/tasks/b8sf15r6u.output')).toBe(true);
    expect(isTaskOutputPath('C:\\Users\\me\\AppData\\Local\\Temp\\claude\\E--repos-demo\\5305d406\\tasks\\bml4i76rh.output')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isTaskOutputPath('/Users/me/.ssh/id_rsa')).toBe(false);
    expect(isTaskOutputPath('/tmp/claude/demo/tasks/../../../etc/passwd')).toBe(false);
    expect(isTaskOutputPath('/tmp/claude/demo/tasks/notes.txt')).toBe(false);
    expect(isTaskOutputPath('/tmp/other/demo/tasks/b1.output')).toBe(false);
    expect(() => readTaskOutput('/etc/passwd')).toThrow(/output file/);
  });
});

describe('reading task output', () => {
  it('reads a short file whole', () => {
    const file = join(tasksDir(), 'b1.output');
    writeFileSync(file, 'building…\ndone\n');
    expect(readTaskOutput(file)).toEqual({ text: 'building…\ndone\n', size: Buffer.byteLength('building…\ndone\n'), truncated: false, missing: false });
  });

  it('keeps only the end of a long file, from the first whole line', () => {
    const file = join(tasksDir(), 'b2.output');
    writeFileSync(file, 'line one\nline two\nline three\n');
    const out = readTaskOutput(file, 15);
    expect(out.truncated).toBe(true);
    expect(out.size).toBe(29);
    expect(out.text).toBe('line three\n');
  });

  it('says a file is missing rather than failing', () => {
    expect(readTaskOutput(join(tasksDir(), 'gone.output'))).toMatchObject({ missing: true, text: '' });
  });
});
