import { describe, expect, it } from 'vitest';
import type { ClonePlan } from '@switchboard/protocol/client';
import { canClone, planLine, progressLine, remoteCloneProblem, trustGroups, trustText } from './cloneModel.ts';

const plan = (state: ClonePlan['state']): ClonePlan => ({ state, repo: { owner: 'acme', name: 'payments', branch: null }, name: 'payments', where: state === 'off' ? '' : '~/Developer/payments' });
const none = { hooks: [], mcpServers: [], allow: [], plugins: [], settings: [] };

describe('cloneModel', () => {
  it('says where a clone goes, or why it cannot', () => {
    expect(planLine(plan('free'), null)).toEqual({ text: 'Clones into ~/Developer/payments', tone: 'muted' });
    expect(planLine(plan('cloned'), null)).toEqual({ text: 'Already cloned in ~/Developer/payments', tone: 'ok' });
    expect(planLine(plan('taken'), null)).toEqual({ text: '~/Developer/payments already exists. Choose another name.', tone: 'warn' });
    expect(planLine(plan('off'), 'mystic').text).toBe('Turn on Clone from GitHub in Settings on mystic to clone there.');
    expect(planLine(plan('off'), null).text).toBe('Turn on Clone from GitHub in Settings › Projects.');
    expect(canClone(plan('free'))).toBe(true);
    expect(canClone(plan('cloned'))).toBe(true);
    expect(canClone(plan('taken'))).toBe(false);
    expect(canClone(null)).toBe(false);
  });

  it('asks an older computer to update', () => {
    expect(remoteCloneProblem({ name: 'mystic', features: ['branches'] })).toBe('Update Switchboard on mystic to clone there.');
    expect(remoteCloneProblem({ name: 'mystic', features: ['projects.clone'] })).toBeNull();
    expect(remoteCloneProblem(null)).toBeNull();
  });

  it('words the progress', () => {
    expect(progressLine({ phase: 'starting', percent: 0 })).toBe('Connecting to GitHub…');
    expect(progressLine({ phase: 'receiving', percent: 42 })).toBe('Downloading 42%');
    expect(progressLine({ phase: 'checkout', percent: null })).toBe('Checking out files');
  });

  it('groups what a repository brings, and names it', () => {
    const brings = { ...none, hooks: [{ event: 'SessionStart', command: './setup.sh' }], allow: ['Bash(npm test)'] };
    expect(trustGroups(brings)).toEqual([
      { title: 'Hooks', items: ['SessionStart: ./setup.sh'] },
      { title: 'Allowed without asking', items: ['Bash(npm test)'] },
    ]);
    expect(trustText(brings)).toMatch(/^This repository runs these hooks when the session starts\./);
    expect(trustText({ ...none, mcpServers: ['db: serve'], hooks: brings.hooks })).toMatch(/hooks and MCP servers/);
    expect(trustText({ ...none, allow: ['WebFetch'] })).toMatch(/^This repository changes what Claude may do in it\./);
  });
});
