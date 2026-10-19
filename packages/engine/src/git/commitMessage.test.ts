import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitContext, commitMessageInput, parseCommitMessage, stubCommitMessage, trimPatch } from './commitMessage.ts';
import { git } from './gitChanges.ts';

let repo: string;
const write = (path: string, text: string) => writeFileSync(join(repo, path), text);
const run = (...args: string[]) => git(repo, args);

beforeEach(async () => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-commit-msg-')));
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.email', 'test@example.com');
  await run('config', 'user.name', 'Test');
  await run('config', 'core.autocrlf', 'false');
  write('a.txt', 'one\n');
  await run('add', '.');
  await run('commit', '-qm', 'feat(core): first');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('commitContext', () => {
  it('is null on a clean checkout', async () => {
    expect(await commitContext(repo)).toBeNull();
  });

  it('takes every change, new files too, when nothing is staged, and leaves the index alone', async () => {
    write('a.txt', 'one\ntwo\n');
    write('new.txt', 'hello\n');
    const context = await commitContext(repo);
    expect(context?.branch).toBe('main');
    expect(context?.recent).toEqual(['feat(core): first']);
    expect(context?.files.split('\n').sort()).toEqual(['A\tnew.txt', 'M\ta.txt']);
    expect(context?.patch).toContain('+hello');
    expect(context?.patch).toContain('+two');
    expect((await run('diff', '--cached', '--name-only')).trim()).toBe('');
    expect(await run('status', '--porcelain')).toContain('?? new.txt');
  });

  it('takes only what is staged when something is', async () => {
    write('a.txt', 'one\ntwo\n');
    write('new.txt', 'hello\n');
    await run('add', 'new.txt');
    const context = await commitContext(repo);
    expect(context?.files).toBe('A\tnew.txt');
    expect(context?.patch).not.toContain('+two');
  });
});

describe('trimPatch', () => {
  const file = (path: string, body: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}\n`;

  it('leaves lock files out and names them', () => {
    const out = trimPatch(file('src/a.ts', '+code') + file('package-lock.json', '+lots'));
    expect(out).toContain('+code');
    expect(out).not.toContain('+lots');
    expect(out).toContain('[patch left out for: package-lock.json]');
  });

  it('caps each file and the whole patch', () => {
    const out = trimPatch(file('big.ts', `+${'x'.repeat(500)}`) + file('next.ts', '+y') + file('last.ts', `+${'z'.repeat(200)}`), 300, 100);
    expect(out).toContain('[rest of this file left out]');
    expect(out).toContain('+y');
    expect(out).toContain('[patch left out for: last.ts]');
    expect(out.length).toBeLessThan(400);
  });
});

describe('commitMessageInput', () => {
  it('stays small for a huge change', () => {
    const patch = Array.from({ length: 200 }, (_, i) => `diff --git a/f${i}.ts b/f${i}.ts\n+${'x'.repeat(2_000)}\n`).join('');
    const input = commitMessageInput({ branch: 'main', recent: [], files: 'M\tf0.ts', stat: '', patch });
    expect(input.length).toBeLessThan(50_000);
  });
});

describe('parseCommitMessage', () => {
  it('takes fences, quotes, a lead and a trailing period off', () => {
    expect(parseCommitMessage('```\nfix(ui): keep the scroll.\n\n- one\n```')).toBe('fix(ui): keep the scroll\n\n- one');
    expect(parseCommitMessage('Commit message: "Add a thing"')).toBe('Add a thing');
  });

  it('is null without an answer', () => {
    expect(parseCommitMessage(null)).toBeNull();
    expect(parseCommitMessage('  \n')).toBeNull();
  });
});

describe('stubCommitMessage', () => {
  it('counts the files', () => {
    expect(stubCommitMessage(commitMessageInput({ branch: null, recent: [], files: 'M\ta\nA\tb', stat: '', patch: '' }))).toBe('Update 2 files');
  });
});
