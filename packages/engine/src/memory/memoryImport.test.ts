import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { candidatesFromPaste, candidatesOf, importedFileText, memoryFilesOf, similar, suggestionFor, textForClaudeApp } from './claudeExport.ts';
import { encodeProjectPath } from './folders.ts';
import { readExport } from './memoryImport.ts';
import { MemoryService } from './memoryService.ts';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const PROJECT = '99999999-8888-4777-8666-555555555555';
const md = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\nsources:\n  - https://claude.ai/chat/x\naliases:\n  - ${name} alias\n---\n\n${body}\n`;
const MEMORIES = {
  account_uuid: ACCOUNT,
  memory_files: [
    { path: '/profile.md', content: md('Profile', 'Belgian dev on a Mac', 'Writes TypeScript.'), updated_at: '2026-10-01T10:00:00Z' },
    { path: '/topics/writing.md', content: md('Writing', 'Short sentences, no em dashes', 'Plain words.'), updated_at: '2026-10-01T10:00:00Z' },
    { path: '/areas/switchboard.md', content: md('Switchboard', 'An Electron app for Claude Code', 'Sessions.'), updated_at: '2026-10-01T10:00:00Z' },
    { path: '/areas/tideline.md', content: md('Tideline', 'A tide app', 'Tides.'), updated_at: '2026-10-01T10:00:00Z' },
    { path: `/projects/${PROJECT}/overview.md`, content: md('Overview', 'The website project', 'Astro.'), updated_at: '2026-10-01T10:00:00Z' },
    { path: `/projects/${PROJECT}/index.md`, content: md('Index', 'Website index', 'Pages.'), updated_at: '2026-10-01T10:00:00Z' },
    { path: '/topics/deploy.md', content: md('Deploy', 'How to deploy', 'Token: ghp_abcdefghijklmnopqrstuvwxyz0123456789AB'), updated_at: '2026-10-01T10:00:00Z' },
  ],
  project_memories: { [PROJECT]: 'A summary that repeats the files.' },
  conversations_memory: '**Work** Things.',
};

let base: string;
let root: string;
let personal: string;
let service: MemoryService;
const write = (path: string, text: string | Uint8Array) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
const projects = () => [{ root, name: 'switchboard' }];

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-import-')));
  root = join(base, 'code', 'switchboard');
  personal = join(base, 'personal');
  mkdirSync(root, { recursive: true });
  const configDir = join(base, 'config');
  service = new MemoryService({ profiles: () => [{ id: 'default', configDir }], personalDir: () => personal, home: base, trash: async () => {} });
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('reading an export', () => {
  it('reads the memories and projects zips, and never the conversations', () => {
    write(join(base, 'memories-000.zip'), zip({ [`memories/${ACCOUNT}.json`]: JSON.stringify(MEMORIES) }));
    write(join(base, 'projects-000.zip'), zip({ [`projects/${PROJECT}.json`]: JSON.stringify({ uuid: PROJECT, name: 'Website', prompt_template: 'x' }) }));
    write(join(base, 'conversations-000.zip'), zip({ 'conversations/a.json': JSON.stringify({ memory_files: [{ path: '/leak.md', content: 'secret chat' }] }) }));
    const parsed = readExport([join(base, 'memories-000.zip'), join(base, 'projects-000.zip')]);
    expect(parsed.files.map((f) => f.path)).toEqual(MEMORIES.memory_files.map((f) => f.path));
    expect(parsed.projects.get(PROJECT)).toBe('Website');
    // A folder with every zip in it: conversations stay unread.
    expect(readExport([base]).files.some((f) => f.path === '/leak.md')).toBe(false);
  });

  it('reads an unzipped folder, the json itself, the older single array, and the manifest’s zips next to it', () => {
    write(join(base, 'unzipped', 'memories', `${ACCOUNT}.json`), JSON.stringify(MEMORIES));
    write(join(base, 'unzipped', 'conversations', 'x.json'), '{ not json');
    expect(readExport([join(base, 'unzipped')]).files).toHaveLength(7);
    expect(readExport([join(base, 'unzipped', 'memories', `${ACCOUNT}.json`)]).files).toHaveLength(7);
    write(join(base, 'old.json'), JSON.stringify([{ content: 'I like tea.' }, 'Plain string memory.', { nope: 1 }]));
    expect(readExport([join(base, 'old.json')]).files.map((f) => f.content)).toEqual(['I like tea.', 'Plain string memory.']);

    const manifest = { data_files: [{ category: 'memories', filename: 'memories-000.zip' }, { category: 'conversations', filename: 'conversations-000.zip' }] };
    write(join(base, 'm', 'manifest.json'), JSON.stringify(manifest));
    expect(() => readExport([join(base, 'm', 'manifest.json')])).toThrow(/Download memories-000.zip/);
    write(join(base, 'm', 'memories-000.zip'), zip({ [`memories/${ACCOUNT}.json`]: JSON.stringify(MEMORIES) }));
    expect(readExport([join(base, 'm', 'manifest.json')]).files).toHaveLength(7);
  });

  it('is lenient about shapes and says when there is nothing', () => {
    expect(memoryFilesOf({ memory_files: [{ path: 'a.md', content: 'x' }, { path: '/b.md' }, 5] })).toEqual([{ path: '/a.md', content: 'x', updatedAt: null }]);
    expect(memoryFilesOf(null)).toEqual([]);
    write(join(base, 'empty.json'), JSON.stringify({ conversations_memory: 'only this' }));
    expect(() => readExport([join(base, 'empty.json')])).toThrow(/No memories/);
  });
});

describe('mapping', () => {
  it('maps paths to types and places as the issue describes', () => {
    expect(suggestionFor('/profile.md')).toEqual({ type: 'user', suggestion: { kind: 'personal' } });
    expect(suggestionFor('/people/ann.md').type).toBe('reference');
    expect(suggestionFor('/areas/switchboard.md')).toEqual({ type: 'project', suggestion: { kind: 'area', name: 'switchboard' } });
    expect(suggestionFor(`/projects/${PROJECT}/overview.md`).suggestion).toEqual({ kind: 'claude-project', uuid: PROJECT });
  });

  it('keeps name, description and aliases, drops sources, and adds the type and where it came from under metadata', () => {
    const [profile] = candidatesOf({ files: MEMORIES.memory_files.map((f) => ({ path: f.path, content: f.content, updatedAt: f.updated_at })), projects: new Map() });
    expect(importedFileText(profile!, 'user')).toBe(
      '---\nname: Profile\ndescription: Belgian dev on a Mac\naliases:\n  - Profile alias\nmetadata:\n  type: user\n  source: claude-app\n  path: /profile.md\n  updated_at: 2026-10-01T10:00:00Z\n---\n\nWrites TypeScript.\n',
    );
  });

  it('names files after the last part of the path, with the folders in front when two collide', () => {
    const files = [
      { path: '/topics/overview.md', content: 'a', updatedAt: null },
      { path: `/projects/${PROJECT}/overview.md`, content: 'b', updatedAt: null },
      { path: '/profile.md', content: 'c', updatedAt: null },
    ];
    expect(candidatesOf({ files, projects: new Map([[PROJECT, 'Website']]) }).map((c) => c.fileName)).toEqual(['topics-overview.md', 'projects-website-overview.md', 'profile.md']);
  });

  it('splits pasted text into one memory per bullet or heading', () => {
    expect(candidatesFromPaste('Here is what I remember:\n- I write TypeScript.\n- I prefer short answers.\n  Even shorter on Fridays.\n').map((c) => [c.name, c.body])).toEqual([
      ['i-write-typescript', 'I write TypeScript.'],
      ['i-prefer-short-answers', 'I prefer short answers.\nEven shorter on Fridays.'],
    ]);
    expect(candidatesFromPaste('## Work\nDemo Time.\n## Sport\nCycling.').map((c) => [c.name, c.body])).toEqual([
      ['work', 'Demo Time.'],
      ['sport', 'Cycling.'],
    ]);
  });

  it('sees near-duplicate descriptions, not loose ones', () => {
    expect(similar('Short sentences, no em dashes', 'No em dashes, short sentences please')).toBe(true);
    expect(similar('Short sentences', 'Long sentences')).toBe(false);
  });

  it('copies memories as one plain block for the Claude app', () => {
    expect(textForClaudeApp([{ name: 'a', description: 'd', body: '## H\nLine one\nsee [[b|the b]]' }])).toBe('Please remember these things about me and how I like to work:\n\n- H Line one see the b\n');
  });
});

describe('importing', () => {
  const parsed = () => ({ files: MEMORIES.memory_files.map((f) => ({ path: f.path, content: f.content, updatedAt: f.updated_at })), projects: new Map([[PROJECT, 'Website']]) });

  it('previews without writing, and flags what to look at', () => {
    write(join(personal, 'writing-style.md'), '---\nname: writing-style\ndescription: Short sentences and no em dashes\n---\nx\n');
    const preview = service.planImport(candidatesOf(parsed()), projects(), parsed().projects);
    const by = (id: string) => preview.entries.find((e) => e.id === id)!;
    expect(by('/profile.md')).toMatchObject({ target: 'personal', type: 'user', status: 'new', checked: true });
    expect(by('/areas/switchboard.md')).toMatchObject({ target: root, noProject: false });
    expect(by('/areas/tideline.md')).toMatchObject({ target: 'personal', noProject: true });
    expect(by(`/projects/${PROJECT}/overview.md`)).toMatchObject({ target: 'skip', claudeProject: 'Website', checked: false });
    expect(by('/topics/deploy.md')).toMatchObject({ secret: true, checked: false });
    expect(by('/topics/writing.md')).toMatchObject({ duplicateOf: 'writing-style', checked: false });
    expect(readFileSync(join(personal, 'writing-style.md'), 'utf8')).toContain('writing-style');
    expect(() => readFileSync(join(personal, 'profile.md'))).toThrow();
  });

  it('imports the picks with index lines, then updates by updated_at instead of duplicating', () => {
    const first = service.planImport(candidatesOf(parsed()), projects(), parsed().projects);
    const picks = first.entries.filter((e) => e.checked).map((e) => ({ id: e.id, target: e.target, type: e.type }));
    expect(service.applyImport(first.token, picks, [root])).toEqual({ created: picks.length, updated: 0 });
    const memoryDir = join(base, 'config', 'projects', encodeProjectPath(root), 'memory');
    expect(readFileSync(join(memoryDir, 'MEMORY.md'), 'utf8')).toBe('- [Switchboard](switchboard.md) — An Electron app for Claude Code\n');
    expect(readFileSync(join(personal, 'MEMORY.md'), 'utf8')).toContain('- [Profile](~/personal/profile.md) — Belgian dev on a Mac\n');

    // The same export again: nothing new. A newer copy of one file: that one updates in place.
    const again = service.planImport(candidatesOf(parsed()), projects());
    expect(again.entries.find((e) => e.id === '/profile.md')).toMatchObject({ status: 'same', checked: false });
    const newer = parsed();
    newer.files[0] = { ...newer.files[0]!, content: md('Profile', 'Belgian dev, cyclist', 'Rides too.'), updatedAt: '2026-10-09T10:00:00Z' };
    const third = service.planImport(candidatesOf(newer), projects());
    expect(third.entries.find((e) => e.id === '/profile.md')).toMatchObject({ status: 'newer', checked: true });
    expect(service.applyImport(third.token, [{ id: '/profile.md', target: 'personal', type: 'user' }], [root])).toEqual({ created: 0, updated: 1 });
    expect(readFileSync(join(personal, 'profile.md'), 'utf8')).toContain('Rides too.');
    expect(readFileSync(join(personal, 'MEMORY.md'), 'utf8').match(/profile\.md/g)).toHaveLength(1);
    expect(readFileSync(join(personal, 'MEMORY.md'), 'utf8')).toContain('— Belgian dev, cyclist');
  });

  it('refuses an expired token and targets outside your projects', () => {
    const preview = service.planImport(candidatesOf(parsed()), projects());
    expect(() => service.applyImport('nope', [], [root])).toThrow(/again/);
    expect(() => service.applyImport(preview.token, [{ id: '/profile.md', target: '/elsewhere', type: 'user' }], [root])).toThrow(/projects/);
  });
});
