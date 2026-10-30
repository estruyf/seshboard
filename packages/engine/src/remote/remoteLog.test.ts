import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteLog } from './remoteLog.ts';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-log-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('RemoteLog', () => {
  it('appends one line per entry, with the time and the level, in a folder it makes', () => {
    const file = join(tempDir(), 'nested', 'remote.log');
    const log = new RemoteLog(file, { now: () => Date.UTC(2026, 9, 30, 6, 49, 4) });
    log.write('info', 'Remote: iPhone connected');
    log.write('warn', 'two\nlines');
    expect(readFileSync(file, 'utf8')).toBe('2026-10-30T06:49:04.000Z info Remote: iPhone connected\n2026-10-30T06:49:04.000Z warn two lines\n');
  });

  it('moves a full log to .1 and starts again, keeping one old file', () => {
    const file = join(tempDir(), 'remote.log');
    const log = new RemoteLog(file, { maxBytes: 100, now: () => 0 });
    for (let i = 0; i < 3; i++) log.write('info', `entry ${i} ${'x'.repeat(40)}`);
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('entry 1');
    expect(readFileSync(file, 'utf8')).toContain('entry 2');
    expect(readFileSync(file, 'utf8')).not.toContain('entry 1');
    expect(readFileSync(`${file}.1`, 'utf8')).not.toContain('entry 0');
  });

  it('counts what an earlier run wrote before it rotates', () => {
    const file = join(tempDir(), 'remote.log');
    new RemoteLog(file, { maxBytes: 100, now: () => 0 }).write('info', 'x'.repeat(60));
    new RemoteLog(file, { maxBytes: 100, now: () => 0 }).write('info', 'y'.repeat(60));
    expect(existsSync(`${file}.1`)).toBe(true);
  });

  it("doesn't throw when it can't write", () => {
    const dir = tempDir();
    // A file where its folder should be: mkdir fails.
    writeFileSync(join(dir, 'taken'), '');
    const log = new RemoteLog(join(dir, 'taken', 'remote.log'));
    expect(() => log.write('info', 'nope')).not.toThrow();
    rmSync(join(dir, 'taken'));
    log.write('info', 'the folder can be made now');
    expect(readFileSync(join(dir, 'taken', 'remote.log'), 'utf8')).toContain('the folder can be made now');
  });
});
