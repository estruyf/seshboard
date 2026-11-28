import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCanvasPartition } from '@seshboard/protocol';
import { CanvasHost, canvasFolder, canvasNameFromId, canvasTrustKey, composeItems, findCanvases, type CanvasRunner } from './canvasHost.ts';

const sdk = resolve(import.meta.dirname, '../../../canvas/src');
// As the app starts one, with plain Node in place of its own binary.
const runner: CanvasRunner = { command: process.execPath, args: [join(sdk, 'runner.ts'), join(sdk, 'index.ts')], env: {} };

/** A canvas that serves one page and counts its opens. */
const PAGE = `
import { createServer } from 'node:http';
import { canvas, serve } from '@seshboard/canvas';
let server = null;
let opens = 0;
const host = serve(canvas({
  api: 1,
  name: 'Notes',
  description: 'The notes of this project',
  async open(ctx) {
    opens++;
    console.log('opening in ' + ctx.folder);
    ctx.host.log('instance ' + ctx.instance);
    if (!server) {
      server = createServer((req, res) => res.end('<h1>Notes</h1>'));
      await new Promise((done) => server.listen(0, '127.0.0.1', done));
    }
    return { url: 'http://127.0.0.1:' + server.address().port + '/', title: 'Notes of ' + opens };
  },
  close() { server?.close(); },
  actions: {
    count: { description: 'How often it was opened', run: (input) => ({ opens, input }) },
    fail: { description: 'Always fails', run: () => { throw new Error('No luck'); } },
  },
}));
`;

let home: string;
let project: string;
let host: CanvasHost;
let trusted: Set<string>;
let changes: string[];
let composed: Array<{ folder: string; id: string; text: string; items: unknown[] }>;

const write = (id: string, source: string, root = project) => {
  mkdirSync(join(root, '.seshboard', 'canvases', id), { recursive: true });
  writeFileSync(join(root, '.seshboard', 'canvases', id, 'canvas.mjs'), source);
};
/** The canvas's own lines, as `[level] text`. */
const lines = (id: string) => host.log(project, id).filter((l) => l.from === 'canvas').map((l) => `[${l.level}] ${l.text}`);
const trust = (id: string) => host.trust(project, id, findCanvases(project).find((c) => c.id === id)!.hash);

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-canvas-')));
  project = join(home, 'project');
  mkdirSync(project);
  trusted = new Set();
  changes = [];
  composed = [];
  host = new CanvasHost({
    runner: () => runner,
    projectRoot: () => project,
    isTrusted: (root, hash) => trusted.has(`${root}:${hash}`),
    trust: (root, hash) => void trusted.add(`${root}:${hash}`),
    changed: (folder) => void changes.push(folder),
    compose: (folder, id, message) => void composed.push({ folder, id, ...message }),
    branch: () => 'main',
    timeouts: { ready: 5_000, call: 5_000 },
    home,
  });
});

afterEach(() => {
  host.dispose();
  rmSync(home, { recursive: true, force: true });
});

describe('finding canvases', () => {
  it('lists the folders with a canvas.mjs, and runs nothing', () => {
    write('notes', 'throw new Error("never run")');
    write('post-workbench', '// empty');
    mkdirSync(join(project, '.seshboard', 'canvases', 'no-entry'));
    write('Bad Name', '// not an id');
    expect(findCanvases(project).map((c) => c.id)).toEqual(['notes', 'post-workbench']);
    const listed = host.list(project);
    expect(listed.folder).toBe(project);
    expect(listed.canvases.map((c) => [c.name, c.state, c.trusted])).toEqual([['Notes', 'stopped', false], ['Post workbench', 'stopped', false]]);
    expect(listed.canvases.every((c) => isCanvasPartition(c.partition))).toBe(true);
    expect(listed.canvases[0]!.partition).not.toBe(listed.canvases[1]!.partition);
  });

  it('uses the nearest folder up from the session, never the home folder', () => {
    write('notes', '// here');
    mkdirSync(join(project, 'src', 'deep'), { recursive: true });
    expect(canvasFolder(join(project, 'src', 'deep'), home)).toBe(project);
    write('mine', '// in home', home);
    const other = join(home, 'other');
    mkdirSync(other);
    expect(canvasFolder(other, home)).toBeNull();
    expect(host.list(other)).toEqual({ folder: null, canvases: [] });
  });

  it('names a canvas by its folder until it runs', () => {
    expect(canvasNameFromId('post-workbench')).toBe('Post workbench');
    expect(canvasTrustKey('a', 'x')).not.toBe(canvasTrustKey('a', 'y'));
  });
});

describe('trust', () => {
  it('refuses to run a canvas before you trusted it', async () => {
    write('notes', PAGE);
    await expect(host.open(project, 'notes')).rejects.toMatchObject({ code: 'UNTRUSTED' });
    expect(host.list(project).canvases[0]!.state).toBe('stopped');
  });

  it('trusts only the file you saw, and asks again when it changes', async () => {
    write('notes', PAGE);
    expect(() => host.trust(project, 'notes', 'another hash')).toThrowError(/changed/);
    trust('notes');
    expect(host.list(project).canvases[0]!.trusted).toBe(true);
    write('notes', `${PAGE}\n// edited`);
    expect(host.list(project).canvases[0]!.trusted).toBe(false);
    await expect(host.open(project, 'notes')).rejects.toMatchObject({ code: 'UNTRUSTED' });
  });
});

describe('running a canvas', () => {
  it('starts it, opens its page once for the folder, and stops it', async () => {
    write('notes', PAGE);
    trust('notes');
    const [first, second] = await Promise.all([host.open(project, 'notes'), host.open(join(project), 'notes')]);
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(first.title).toBe('Notes of 1');
    expect(second).toEqual(first);
    expect(await (await fetch(first.url)).text()).toBe('<h1>Notes</h1>');
    // The same page again: open() is not called a second time.
    expect(await host.open(project, 'notes')).toEqual(first);
    const listed = host.list(project).canvases[0]!;
    expect(listed).toMatchObject({ state: 'running', name: 'Notes', description: 'The notes of this project', url: first.url, error: null });
    expect(lines('notes')).toContain(`[info] opening in ${project}`);
    expect(lines('notes').some((line) => /^\[info\] instance notes:[0-9a-f]{12}$/.test(line))).toBe(true);
    expect(host.log(project, 'notes').filter((l) => l.from === 'seshboard').map((l) => l.text)).toEqual(['Started notes', `Opened ${first.url}`]);
    expect(changes).toContain(project);

    await host.stop(project, 'notes');
    expect(host.list(project).canvases[0]).toMatchObject({ state: 'stopped', held: false, url: null, error: null });
    // What it wrote stays readable after it stopped.
    expect(host.log(project, 'notes').at(-1)).toMatchObject({ from: 'seshboard', text: 'Stopped, to start again' });
    await expect(fetch(first.url)).rejects.toThrow();
  });

  it('runs an action and passes its error on', async () => {
    write('notes', PAGE);
    trust('notes');
    await expect(host.action(project, 'notes', 'count', {})).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await host.open(project, 'notes');
    expect(await host.action(project, 'notes', 'count', { a: 1 })).toEqual({ opens: 1, input: { a: 1 } });
    await expect(host.action(project, 'notes', 'fail', null)).rejects.toThrowError('No luck');
    await expect(host.action(project, 'notes', 'missing', null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a page that is not on this computer', async () => {
    write('away', `import { canvas, serve } from '@seshboard/canvas';\nserve(canvas({ api: 1, name: 'Away', description: 'Elsewhere', open: () => ({ url: 'https://example.com/' }) }));`);
    trust('away');
    await expect(host.open(project, 'away')).rejects.toThrowError(/on this computer/);
    expect(host.list(project).canvases[0]).toMatchObject({ state: 'failed' });
    expect(host.list(project).canvases[0]!.error).toMatch(/on this computer/);
  });

  it('says why a canvas that throws, or is written for another API, failed', async () => {
    write('broken', `throw new Error('Broken on purpose');`);
    write('future', `import { canvas, serve } from '@seshboard/canvas';\nserve(canvas({ api: 2, name: 'Future', description: 'Too new', open: () => ({ url: 'http://127.0.0.1:1/' }) }));`);
    trust('broken');
    trust('future');
    await expect(host.open(project, 'broken')).rejects.toThrowError(/stopped by itself \(exit code 1\)/);
    const broken = host.list(project).canvases.find((c) => c.id === 'broken')!;
    expect(broken.state).toBe('failed');
    expect(host.log(project, 'broken').map((l) => l.text).join('\n')).toContain('Broken on purpose');
    await expect(host.open(project, 'future')).rejects.toThrowError(/API 2/);
    // Stop clears the failure, so the panel can try again.
    await host.stop(project, 'broken');
    expect(host.list(project).canvases.find((c) => c.id === 'broken')!.state).toBe('stopped');
  });

  it('starts a fresh process once a changed file is trusted again', async () => {
    write('notes', PAGE);
    trust('notes');
    const first = await host.open(project, 'notes');
    write('notes', PAGE.replace("'Notes of '", "'Second notes of '"));
    trust('notes');
    const second = await host.open(project, 'notes');
    expect(second.title).toBe('Second notes of 1');
    expect(second.url).not.toBe(first.url);
  });
});

/** A canvas that says what it hears and asks for the message box. */
const TALKS = `
import { canvas, serve } from '@seshboard/canvas';
const host = serve(canvas({
  api: 1,
  name: 'Talks',
  description: 'Says what it hears',
  open: () => ({ url: 'http://127.0.0.1:9/' }),
  actions: {
    context: { description: 'What Seshboard said', run: () => host.context() },
    ask: { description: 'Fills the message box', run: () => (host.compose({ text: 'Tighten this.', chips: [{ file: 'notes/a.md', lines: [2, 4] }, { title: 'Selection', text: 'some words' }, { nonsense: true }] }), 'asked') },
  },
}));
host.onContext((context) => host.log('theme ' + context.theme));
`;

describe('a canvas and the session beside it', () => {
  const settled = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  };

  it('hears where it shows, and when that changes', async () => {
    write('talks', TALKS);
    trust('talks');
    await host.open(project, 'talks');
    expect(await host.action(project, 'talks', 'context', null)).toBeNull();
    host.shown(project, 'talks', { id: 's1', title: 'Write the post' }, 'dark');
    await settled(() => lines('talks').includes('[info] theme dark'));
    expect(await host.action(project, 'talks', 'context', null)).toEqual({ folder: project, branch: 'main', theme: 'dark', session: { id: 's1', title: 'Write the post' } });
    host.shown(project, 'talks', { id: 's1', title: 'Write the post' }, 'dark');
    host.shown(project, 'talks', { id: 's1', title: 'Write the post' }, 'light');
    await settled(() => lines('talks').includes('[info] theme light'));
    expect(lines('talks').filter((line) => line.startsWith('[info] theme'))).toEqual(['[info] theme dark', '[info] theme light']);
  });

  it('fills the message box with text and chips, and never sends', async () => {
    write('talks', TALKS);
    trust('talks');
    expect(host.actions(project, 'talks')).toBeNull();
    await host.open(project, 'talks');
    expect(host.actions(project, 'talks')!.map((a) => a.name)).toEqual(['context', 'ask']);
    expect(await host.action(project, 'talks', 'ask', null)).toBe('asked');
    await settled(() => composed.length > 0);
    expect(composed).toEqual([
      {
        folder: project,
        id: 'talks',
        text: 'Tighten this.',
        items: [
          { kind: 'file', path: join(project, 'notes', 'a.md'), directory: false, range: { start: 2, end: 4 } },
          { kind: 'text', source: 'selection', label: 'Selection', text: 'some words' },
        ],
      },
    ]);
  });

  it('keeps only chips that are a file or text', () => {
    expect(composeItems(project, undefined)).toEqual([]);
    expect(composeItems(project, [{ file: '' }, { file: 'a.md', lines: [4, 2] }, { title: '', text: 'x' }] as never)).toEqual([{ kind: 'text', source: 'selection', label: 'From a canvas', text: 'x' }]);
    expect(composeItems(project, Array.from({ length: 30 }, () => ({ file: 'a.md' })))).toHaveLength(10);
  });
});

describe('stopping a canvas', () => {
  const idleHost = (idle: number) =>
    new CanvasHost({
      runner: () => runner,
      projectRoot: () => project,
      isTrusted: () => true,
      trust: () => {},
      changed: (folder) => void changes.push(folder),
      timeouts: { ready: 5_000, call: 5_000, idle },
      home,
    });
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    return check();
  };

  it('stays stopped when you stopped it, until it is opened again', async () => {
    write('notes', PAGE);
    trust('notes');
    await host.open(project, 'notes');
    await host.stop(project, 'notes', true);
    expect(host.list(project).canvases[0]).toMatchObject({ state: 'stopped', held: true });
    expect(host.log(project, 'notes').some((l) => l.text === 'Stopped by you')).toBe(true);
    await host.open(project, 'notes');
    expect(host.list(project).canvases[0]).toMatchObject({ state: 'running', held: false });
  });

  it('stops by itself once no window has it open, and not while one has', async () => {
    host.dispose();
    host = idleHost(150);
    write('notes', PAGE);
    const window = {};
    host.view(project, 'notes', window, true);
    await host.open(project, 'notes');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(host.list(project).canvases[0]!.state).toBe('running');
    // The window closes the canvas (or goes away): the wait starts.
    host.dropViewer(window);
    expect(await until(() => host.list(project).canvases[0]!.state === 'stopped')).toBe(true);
    expect(host.list(project).canvases[0]!.held).toBe(false);
    expect(host.log(project, 'notes').some((l) => l.text === 'Stopped: no session has it open')).toBe(true);
  });

  it('counts an agent\'s use: an action starts the wait over', async () => {
    host.dispose();
    host = idleHost(300);
    write('notes', PAGE);
    await host.open(project, 'notes');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await host.action(project, 'notes', 'count', null);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(host.list(project).canvases[0]!.state).toBe('running');
    expect(await until(() => host.list(project).canvases[0]!.state === 'stopped')).toBe(true);
  });

  it('tells when the log has new lines', async () => {
    host.dispose();
    const logged: string[] = [];
    host = new CanvasHost({ runner: () => runner, projectRoot: () => project, isTrusted: () => true, trust: () => {}, changed: () => {}, logged: (_folder, id) => void logged.push(id), home });
    write('notes', PAGE);
    await host.open(project, 'notes');
    expect(await until(() => logged.includes('notes'))).toBe(true);
  });
});
