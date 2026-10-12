import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCleanupPeriod, readProfileCleanup, withCleanupPeriod, writeProfileCleanup } from './cleanupPeriod.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-cleanup-'));
  dirs.push(dir);
  return dir;
};

const SETTINGS = `{
  "model": "opus",
  "permissions": {
    "allow": ["Bash(npm test)"]
  },
  "cleanupPeriodDays": 30,
  "theme": "dark"
}
`;

describe('readCleanupPeriod', () => {
  it('reads the days, or null when the key is missing', () => {
    expect(readCleanupPeriod(SETTINGS)).toBe(30);
    expect(readCleanupPeriod('{"model":"opus"}')).toBeNull();
    expect(readCleanupPeriod(null)).toBeNull();
    expect(readCleanupPeriod('')).toBeNull();
    expect(readCleanupPeriod('{"cleanupPeriodDays":"90"}')).toBeNull();
  });
});

describe('withCleanupPeriod', () => {
  it('changes only the value and keeps every other key and the layout', () => {
    expect(withCleanupPeriod(SETTINGS, 90)).toBe(SETTINGS.replace('"cleanupPeriodDays": 30', '"cleanupPeriodDays": 90'));
  });

  it('adds the key as the first one, in the file’s own indentation', () => {
    const tabs = '{\n\t"model": "opus",\n\t"theme": "dark"\n}\n';
    const out = withCleanupPeriod(tabs, 60);
    expect(out).toBe('{\n\t"cleanupPeriodDays": 60,\n\t"model": "opus",\n\t"theme": "dark"\n}\n');
    expect(JSON.parse(out)).toEqual({ cleanupPeriodDays: 60, model: 'opus', theme: 'dark' });
  });

  it('removes the key for the default, wherever it is', () => {
    const removed = JSON.parse(withCleanupPeriod(SETTINGS, null)) as Record<string, unknown>;
    expect(removed).toEqual({ model: 'opus', permissions: { allow: ['Bash(npm test)'] }, theme: 'dark' });
    const last = withCleanupPeriod('{\n  "model": "opus",\n  "cleanupPeriodDays": 7\n}\n', null);
    expect(last).toBe('{\n  "model": "opus"\n}\n');
    const first = withCleanupPeriod('{\n  "cleanupPeriodDays": 7,\n  "model": "opus"\n}\n', null);
    expect(JSON.parse(first)).toEqual({ model: 'opus' });
  });

  it('starts an empty or missing file', () => {
    expect(JSON.parse(withCleanupPeriod(null, 14))).toEqual({ cleanupPeriodDays: 14 });
    expect(JSON.parse(withCleanupPeriod('{}', 14))).toEqual({ cleanupPeriodDays: 14 });
  });

  it('refuses a file that is not a JSON object', () => {
    expect(() => withCleanupPeriod('[1, 2]', 14)).toThrow();
    expect(() => withCleanupPeriod('{ not json', 14)).toThrow();
  });

  it('writes everything back when the layout is too unusual to edit in place', () => {
    const odd = '{"a":1,"cleanupPeriodDays":5,"b":{"cleanupPeriodDays":9}}';
    expect(JSON.parse(withCleanupPeriod(odd, 45))).toEqual({ a: 1, cleanupPeriodDays: 45, b: { cleanupPeriodDays: 9 } });
  });
});

describe('a profile’s settings file', () => {
  it('writes only the key and keeps the other settings', () => {
    const dir = folder();
    writeFileSync(join(dir, 'settings.json'), SETTINGS);
    expect(readProfileCleanup(dir)).toMatchObject({ days: 30, error: null });
    writeProfileCleanup(dir, 120);
    const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>;
    expect(saved).toEqual({ model: 'opus', permissions: { allow: ['Bash(npm test)'] }, cleanupPeriodDays: 120, theme: 'dark' });
  });

  it('creates no file for the default when there is none', () => {
    const dir = folder();
    writeProfileCleanup(dir, null);
    expect(existsSync(join(dir, 'settings.json'))).toBe(false);
    expect(readProfileCleanup(dir)).toMatchObject({ days: null, error: null });
  });

  it('reports a file it cannot read, and never writes it', () => {
    const dir = folder();
    writeFileSync(join(dir, 'settings.json'), '{ broken');
    expect(readProfileCleanup(dir).error).not.toBeNull();
    expect(() => writeProfileCleanup(dir, 60)).toThrow();
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{ broken');
  });
});
