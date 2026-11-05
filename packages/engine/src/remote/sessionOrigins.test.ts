import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { SESSION_ORIGINS_MAX, SessionOrigins } from './sessionOrigins.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-origins-'));
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  cleanups.push(() => {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return cache.db;
}

describe('SessionOrigins', () => {
  it('names who started a session by the device’s name now, else the one it had', () => {
    const origins = new SessionOrigins(tempDb());
    origins.add('s1', { id: 'phone', name: 'iPhone' });
    origins.add('s2', { id: 'revoked', name: 'Old laptop' });
    expect(origins.starters(new Map([['phone', 'Dmitriy’s iPhone']]))).toEqual(new Map([['s1', 'Dmitriy’s iPhone'], ['s2', 'Old laptop']]));
  });

  it('keeps only the most recent', () => {
    let now = 0;
    const origins = new SessionOrigins(tempDb(), () => ++now);
    for (let i = 1; i <= SESSION_ORIGINS_MAX + 3; i++) origins.add(`s${i}`, { id: 'd', name: 'Mac' });
    const kept = origins.starters(new Map());
    expect(kept.size).toBe(SESSION_ORIGINS_MAX);
    expect(kept.has('s3')).toBe(false);
    expect(kept.has('s4')).toBe(true);
  });
});
