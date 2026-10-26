import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adoptLegacyEnv, legacyDataFolder } from './rename.ts';

describe('adoptLegacyEnv', () => {
  it('copies SWITCHBOARD_ variables to their SESHBOARD_ names, without overriding one that is set', () => {
    const env: Record<string, string | undefined> = { SWITCHBOARD_DATA_DIR: '/data', SWITCHBOARD_GH: 'old', SESHBOARD_GH: 'new', PATH: '/bin' };
    expect(adoptLegacyEnv(env)).toEqual(['SESHBOARD_DATA_DIR']);
    expect(env).toMatchObject({ SESHBOARD_DATA_DIR: '/data', SESHBOARD_GH: 'new', PATH: '/bin' });
  });
});

describe('legacyDataFolder', () => {
  const setup = () => {
    const appData = mkdtempSync(join(tmpdir(), 'seshboard-rename-'));
    return { next: join(appData, 'Seshboard'), legacy: join(appData, 'Switchboard') };
  };
  const used = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'preferences.json'), '{"themeId":"nord"}');
  };

  it('moves the old folder to the new name the first time', () => {
    const { next, legacy } = setup();
    used(legacy);
    expect(legacyDataFolder(next, legacy)).toBe(next);
    expect(existsSync(legacy)).toBe(false);
    expect(readFileSync(join(next, 'preferences.json'), 'utf8')).toContain('nord');
  });

  it('uses the new folder when there is nothing to move, or it has data already', () => {
    const fresh = setup();
    expect(legacyDataFolder(fresh.next, fresh.legacy)).toBe(fresh.next);
    const both = setup();
    used(both.legacy);
    used(both.next);
    expect(legacyDataFolder(both.next, both.legacy)).toBe(both.next);
    expect(existsSync(both.legacy)).toBe(true);
  });

  it('keeps using the old folder where it is when it can not move, or an empty new folder is in the way', () => {
    const locked = setup();
    used(locked.legacy);
    expect(legacyDataFolder(locked.next, locked.legacy, () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); })).toBe(locked.legacy);
    const empty = setup();
    used(empty.legacy);
    mkdirSync(empty.next);
    expect(legacyDataFolder(empty.next, empty.legacy)).toBe(empty.legacy);
    expect(existsSync(join(empty.legacy, 'preferences.json'))).toBe(true);
  });
});
