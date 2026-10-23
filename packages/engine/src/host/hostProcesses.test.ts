import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LiveSession } from '@switchboard/protocol';
import { HostProcesses } from './hostProcesses.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const file = () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-hostprocs-'));
  dirs.push(dir);
  return join(dir, 'host-processes.json');
};

const live = (sessionId: string, pid: number, startedAt: number | null = pid * 10): LiveSession => ({
  sessionId,
  pid,
  cwd: '/repo',
  projectRoot: '/repo',
  status: 'idle',
  rawStatus: 'idle',
  name: null,
  origin: 'sdk',
  startedAt,
  updatedAt: null,
  profileId: 'default',
});

describe('HostProcesses', () => {
  it('knows the processes an earlier engine left running, and no others', () => {
    const path = file();
    const running = new Set([1, 2, 3]);
    const alive = (pid: number) => running.has(pid);
    const before = new HostProcesses(path, alive);
    // Its own hosts run 'a' and 'b'; 'c' is a terminal's.
    before.record([live('a', 1), live('b', 2), live('c', 3)], (id) => id !== 'c');
    expect(before.isLeftover(live('a', 1))).toBe(false);

    // The engine dies; 'b' ends on its own, 'a' keeps running.
    running.delete(2);
    const after = new HostProcesses(path, alive);
    expect(after.isLeftover(live('a', 1))).toBe(true);
    expect(after.isLeftover(live('b', 2))).toBe(false);
    expect(after.isLeftover(live('c', 3))).toBe(false);
    // The same pid, started later: another process the system gave the number to.
    expect(after.isLeftover(live('a', 1, 999))).toBe(false);
  });

  it('keeps leftovers across another restart until they end, alongside its own', () => {
    const path = file();
    const running = new Set([1, 4]);
    const alive = (pid: number) => running.has(pid);
    new HostProcesses(path, alive).record([live('a', 1)], () => true);
    const second = new HostProcesses(path, alive);
    second.record([live('a', 1), live('d', 4)], (id) => id === 'd');
    expect(JSON.parse(readFileSync(path, 'utf8')).map((p: { sessionId: string }) => p.sessionId)).toEqual(['a', 'd']);
    expect(new HostProcesses(path, alive).isLeftover(live('a', 1))).toBe(true);

    running.delete(1);
    second.record([live('d', 4)], (id) => id === 'd');
    expect(JSON.parse(readFileSync(path, 'utf8')).map((p: { sessionId: string }) => p.sessionId)).toEqual(['d']);
  });

  it('starts empty from a missing or broken file', () => {
    const path = file();
    expect(new HostProcesses(path, () => true).isLeftover(live('a', 1))).toBe(false);
  });
});
