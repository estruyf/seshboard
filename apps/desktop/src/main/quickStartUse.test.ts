import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PREWARM_WITHIN_MS, QuickStartUse, shouldPrewarm } from './quickStartUse.ts';

const DAY = 24 * 60 * 60_000;
const now = Date.UTC(2026, 10, 20, 12);

describe('shouldPrewarm', () => {
  it('prewarms for someone who used Quick start in the last 14 days', () => {
    expect(shouldPrewarm({ lastUsedAt: now - DAY, now, registered: true })).toBe(true);
    expect(shouldPrewarm({ lastUsedAt: now - 13 * DAY, now, registered: true })).toBe(true);
    expect(shouldPrewarm({ lastUsedAt: now, now, registered: true })).toBe(true);
  });

  it('does not for someone who used it long ago', () => {
    expect(PREWARM_WITHIN_MS).toBe(14 * DAY);
    expect(shouldPrewarm({ lastUsedAt: now - 14 * DAY, now, registered: true })).toBe(false);
    expect(shouldPrewarm({ lastUsedAt: now - 90 * DAY, now, registered: true })).toBe(false);
  });

  it('does not for someone who never used it', () => {
    expect(shouldPrewarm({ lastUsedAt: null, now, registered: true })).toBe(false);
  });

  it('does not without a shortcut that works, however recently it was used', () => {
    expect(shouldPrewarm({ lastUsedAt: now - DAY, now, registered: false })).toBe(false);
  });
});

describe('QuickStartUse', () => {
  const dirs: string[] = [];
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), 'seshboard-qs-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('starts empty, remembers a use, and the next launch reads it', () => {
    const file = join(folder(), 'quick-start-use.json');
    const first = new QuickStartUse(file);
    expect(first.lastUsedAt).toBeNull();
    first.markUsed(now);
    expect(first.lastUsedAt).toBe(now);
    expect(new QuickStartUse(file).lastUsedAt).toBe(now);
  });

  it('writes at most once an hour', () => {
    const file = join(folder(), 'quick-start-use.json');
    const use = new QuickStartUse(file);
    use.markUsed(now);
    use.markUsed(now + 10 * 60_000);
    expect(use.lastUsedAt).toBe(now + 10 * 60_000);
    expect(JSON.parse(readFileSync(file, 'utf8')).lastUsedAt).toBe(now);
    use.markUsed(now + 61 * 60_000);
    expect(JSON.parse(readFileSync(file, 'utf8')).lastUsedAt).toBe(now + 61 * 60_000);
  });

  it('treats a missing, broken or odd file as never used', () => {
    const dir = folder();
    expect(new QuickStartUse(join(dir, 'nothing.json')).lastUsedAt).toBeNull();
    writeFileSync(join(dir, 'broken.json'), '{ nope');
    expect(new QuickStartUse(join(dir, 'broken.json')).lastUsedAt).toBeNull();
    writeFileSync(join(dir, 'odd.json'), JSON.stringify({ lastUsedAt: 'yesterday' }));
    expect(new QuickStartUse(join(dir, 'odd.json')).lastUsedAt).toBeNull();
  });

  it('takes an initial value instead of the file (the smoke test), and writes nothing without a file', () => {
    const use = new QuickStartUse(null, now - DAY);
    expect(use.lastUsedAt).toBe(now - DAY);
    expect(() => use.markUsed(now)).not.toThrow();
  });
});
