import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adoptLegacyEnv, cameFromSwitchboard, heldByRunningApp, legacyDataFolder } from './rename.ts';

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
    expect(cameFromSwitchboard(next)).toBe(true);
  });

  it('knows a folder from before the rename by its name or the mark the move left, and a new one as new', () => {
    const { next, legacy } = setup();
    used(legacy);
    used(next);
    expect(cameFromSwitchboard(legacy)).toBe(true);
    expect(cameFromSwitchboard(join(legacy, '..', 'Switchboard Dev'))).toBe(true);
    expect(cameFromSwitchboard(next)).toBe(false);
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

  it('keeps using the old folder where it is when it can not move', () => {
    const locked = setup();
    used(locked.legacy);
    expect(legacyDataFolder(locked.next, locked.legacy, () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); })).toBe(locked.legacy);
    expect(existsSync(join(locked.legacy, 'preferences.json'))).toBe(true);
  });

  it('moves into a new folder without data that is there already, keeping what it holds', () => {
    const { next, legacy } = setup();
    used(legacy);
    writeFileSync(join(legacy, 'cache.sqlite'), 'cache');
    mkdirSync(join(legacy, 'Crashpad'));
    writeFileSync(join(legacy, 'Crashpad', 'old.dmp'), 'old');
    mkdirSync(join(next, 'Crashpad'), { recursive: true });
    writeFileSync(join(next, 'Crashpad', 'settings.dat'), 'new');
    expect(legacyDataFolder(next, legacy)).toBe(next);
    expect(readFileSync(join(next, 'preferences.json'), 'utf8')).toContain('nord');
    expect(readFileSync(join(next, 'cache.sqlite'), 'utf8')).toBe('cache');
    // A name both have stays as the new folder has it; the old one's is left behind, not deleted.
    expect(readFileSync(join(next, 'Crashpad', 'settings.dat'), 'utf8')).toBe('new');
    expect(existsSync(join(legacy, 'Crashpad', 'old.dmp'))).toBe(true);
    expect(cameFromSwitchboard(next)).toBe(true);
    // The next start finds nothing to move and uses the new folder.
    expect(legacyDataFolder(next, legacy)).toBe(next);
  });

  it('puts back what it moved when a move fails halfway, and keeps using the old folder', () => {
    const { next, legacy } = setup();
    used(legacy);
    writeFileSync(join(legacy, 'cache.sqlite'), 'cache');
    mkdirSync(next);
    let moves = 0;
    const flaky = (from: string, to: string) => {
      if (moves++ === 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      renameSync(from, to);
    };
    expect(legacyDataFolder(next, legacy, flaky)).toBe(legacy);
    expect(existsSync(join(legacy, 'preferences.json'))).toBe(true);
    expect(existsSync(join(legacy, 'cache.sqlite'))).toBe(true);
    expect(existsSync(join(next, 'preferences.json')) || existsSync(join(next, 'cache.sqlite'))).toBe(false);
  });

  it.runIf(process.platform !== 'win32')('leaves the old folder alone while a running copy of the app uses it', () => {
    const { next, legacy } = setup();
    used(legacy);
    symlinkSync(`${hostname()}-${process.pid}`, join(legacy, 'SingletonLock'));
    expect(heldByRunningApp(legacy)).toBe(true);
    expect(legacyDataFolder(next, legacy)).toBe(legacy);
    expect(existsSync(next)).toBe(false);
    // A lock left by a copy that is gone, or by another computer, doesn't count.
    const stale = setup();
    used(stale.legacy);
    symlinkSync('other-host-1', join(stale.legacy, 'SingletonLock'));
    expect(heldByRunningApp(stale.legacy)).toBe(false);
    expect(legacyDataFolder(stale.next, stale.legacy)).toBe(stale.next);
  });
});
