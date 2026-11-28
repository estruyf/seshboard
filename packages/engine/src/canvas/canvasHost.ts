import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { readCanvasInfo, readFromCanvas, type CanvasActionInfo, type CanvasChip, type CanvasContext, type CanvasHostContext, type CanvasInfo, type ToCanvas } from '@seshboard/canvas/wire';
import { canvasPartition, CompanionContextItem, localPreviewUrl, type CanvasListed, type CanvasLogLine, type CanvasState, type CompanionContextItem as ContextChip } from '@seshboard/protocol';

/*
 * A project's canvases (docs/canvases.md): web apps in `.seshboard/canvases/<id>/canvas.mjs` that Seshboard shows in a
 * session's rail panel. This lists them without running anything, asks before the first run of each (and again when
 * its file changed), and runs one process per canvas and folder, which every session in that folder shares.
 */

/** How Seshboard starts a canvas: the app's own binary as Node, with the runner and the SDK. The canvas's file goes last. */
export interface CanvasRunner {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface CanvasHostDeps {
  /** Null until main said how to start one. */
  runner(): CanvasRunner | null;
  /** The project a folder belongs to (worktrees fold into it): what a canvas is trusted for. */
  projectRoot(folder: string): string;
  isTrusted(projectRoot: string, hash: string): boolean;
  trust(projectRoot: string, hash: string): void;
  /** A canvas of this folder started, stopped, failed or was trusted. */
  changed(folder: string): void;
  /** A canvas asked for text and chips in the message box of the session that shows it (`host.compose`). */
  compose?(folder: string, id: string, message: { text: string; items: ContextChip[] }): void;
  /** The folder's git branch, for `host.context()`. */
  branch?(folder: string): string | null;
  /** A canvas's log has new lines (told at most a few times a second). */
  logged?(folder: string, id: string): void;
  /** How long a canvas has to register and to answer a call, and how long it runs with no window showing it. */
  timeouts?: { ready: number; call: number; idle?: number };
  home?: string;
}

/** The folders of a project's canvases, from the checkout's top. */
export const CANVASES_DIR = join('.seshboard', 'canvases');
const ENTRY = 'canvas.mjs';
const CANVAS_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LOG_LINES = 200;
/** A canvas no session has open stops after this long: opening it again within it is instant. */
export const CANVAS_IDLE_MS = 5 * 60_000;
const DEFAULT_TIMEOUTS = { ready: 15_000, call: 30_000, idle: CANVAS_IDLE_MS };
const LOG_TOLD_MS = 250;

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** What approving a canvas covers: this canvas of the project, with this exact `canvas.mjs`. */
export const canvasTrustKey = (id: string, entryHash: string): string => sha(`canvas\0${id}\0${entryHash}`);

/**
 * The folder whose `.seshboard/canvases` a session in `cwd` uses: the nearest one up from it, so a worktree has its
 * own and the canvas follows the branch. Null with none. It never looks in the home folder or above it.
 */
export function canvasFolder(cwd: string, home = homedir()): string | null {
  for (let dir = cwd, depth = 0; depth < 32; dir = dirname(dir), depth++) {
    if (dir === home && cwd !== home) return null;
    try {
      if (statSync(join(dir, CANVASES_DIR)).isDirectory()) return dir;
    } catch {
      // Not here: look one up.
    }
    if (dirname(dir) === dir) return null;
  }
  return null;
}

/** The canvases in a folder, by name, with each one's file hash. Nothing is run. */
export function findCanvases(folder: string): Array<{ id: string; dir: string; entry: string; hash: string }> {
  const root = join(folder, CANVASES_DIR);
  let names: string[];
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && CANVAS_ID.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
  const found: Array<{ id: string; dir: string; entry: string; hash: string }> = [];
  for (const id of names.sort().slice(0, 20)) {
    const entry = join(root, id, ENTRY);
    try {
      found.push({ id, dir: join(root, id), entry, hash: sha(readFileSync(entry)) });
    } catch {
      // A folder without a canvas.mjs is not a canvas.
    }
  }
  return found;
}

/** "post-workbench" as "Post workbench": a canvas's name until its process says its own. */
export const canvasNameFromId = (id: string): string => {
  const words = id.replace(/-+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * A canvas's chips as the message box takes them: a file by reference (with lines), or text under a title. Paths count
 * from the canvas's folder. A chip that isn't one of the two is left out, and at most 10 are kept.
 */
export function composeItems(folder: string, chips: readonly CanvasChip[] | undefined): ContextChip[] {
  const items: ContextChip[] = [];
  for (const raw of chips ?? []) {
    const chip = (raw ?? {}) as { file?: unknown; lines?: unknown; title?: unknown; text?: unknown; language?: unknown };
    const path = typeof chip.file === 'string' && chip.file ? (isAbsolute(chip.file) ? chip.file : resolvePath(folder, chip.file)) : undefined;
    const lines = Array.isArray(chip.lines) && chip.lines.length === 2 ? { start: chip.lines[0] as number, end: chip.lines[1] as number } : undefined;
    const item =
      typeof chip.text === 'string'
        ? { kind: 'text', source: 'selection', label: typeof chip.title === 'string' && chip.title.trim() ? chip.title : 'From a canvas', text: chip.text, ...(path ? { path } : {}), ...(lines ? { range: lines } : {}), ...(typeof chip.language === 'string' ? { language: chip.language } : {}) }
        : path
          ? { kind: 'file', path, ...(lines ? { range: lines } : {}) }
          : null;
    const parsed = item ? CompanionContextItem.safeParse(item) : null;
    if (parsed?.success && items.length < 10) items.push(parsed.data);
  }
  return items;
}

/** The longest text a canvas puts in the message box. */
const COMPOSE_TEXT = 20_000;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Running {
  child: ChildProcess;
  /** The file's hash it was started from: a changed file is another canvas, and asks again. */
  hash: string;
  info: CanvasInfo | null;
  ready: Promise<CanvasInfo>;
  opened: { url: string; title: string | null } | null;
  opening: Promise<{ url: string; title: string | null }> | null;
  pending: Map<number, Pending>;
  nextId: number;
  log: CanvasLogLine[];
  /** Writes a line to the log. */
  note(text: string, level?: CanvasLogLine['level'], from?: CanvasLogLine['from']): void;
  stopped: boolean;
  /** Stops it once no window has had it open for a while. */
  idle: ReturnType<typeof setTimeout> | null;
  /** Where it shows, as the window that shows it said last. */
  context: CanvasHostContext | null;
}

export class CanvasError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'UNTRUSTED' | 'CHANGED' | 'UNAVAILABLE' | 'FAILED',
    message: string,
  ) {
    super(message);
  }
}

export class CanvasHost {
  private readonly running = new Map<string, Running>();
  /** Why a canvas's last run ended, until it runs again. */
  private readonly failed = new Map<string, { error: string; log: CanvasLogLine[] }>();
  /** What a stopped canvas wrote, until it runs again. */
  private readonly lastLog = new Map<string, CanvasLogLine[]>();
  /** The canvases you stopped: no panel starts one by itself. */
  private readonly held = new Set<string>();
  /** Who has each canvas open: a window's connection, by the engine's own key for it. */
  private readonly viewers = new Map<string, Set<unknown>>();
  private readonly timeouts: { ready: number; call: number; idle: number };

  constructor(private readonly deps: CanvasHostDeps) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...deps.timeouts };
  }

  private key = (folder: string, id: string) => `${folder}\0${id}`;

  private find(cwd: string, id: string) {
    const folder = canvasFolder(cwd, this.deps.home);
    const canvas = folder ? findCanvases(folder).find((c) => c.id === id) : undefined;
    if (!folder || !canvas) throw new CanvasError('NOT_FOUND', 'No such canvas in this folder.');
    return { folder, canvas, projectRoot: this.deps.projectRoot(folder) };
  }

  /** The canvases a session in `cwd` can open, with what each is doing now. */
  list(cwd: string): { folder: string | null; canvases: CanvasListed[] } {
    const folder = canvasFolder(cwd, this.deps.home);
    if (!folder) return { folder: null, canvases: [] };
    const projectRoot = this.deps.projectRoot(folder);
    const canvases = findCanvases(folder).map((canvas): CanvasListed => {
      const key = this.key(folder, canvas.id);
      const run = this.running.get(key);
      const failure = this.failed.get(key);
      const state: CanvasState = run ? (run.info && run.opened ? 'running' : 'starting') : failure ? 'failed' : 'stopped';
      return {
        id: canvas.id,
        name: run?.info?.name ?? canvasNameFromId(canvas.id),
        description: run?.info?.description ?? null,
        dir: canvas.dir,
        hash: canvas.hash,
        trusted: this.deps.isTrusted(projectRoot, canvasTrustKey(canvas.id, canvas.hash)),
        state,
        held: this.held.has(key),
        url: run?.opened?.url ?? null,
        title: run?.opened?.title ?? null,
        partition: canvasPartition(sha(`${projectRoot}\0${canvas.id}`).slice(0, 32)),
        error: failure?.error ?? null,
      };
    });
    return { folder, canvases };
  }

  /** You read where the canvas comes from and said yes: `seen` is the file's hash the question showed. */
  trust(cwd: string, id: string, seen: string): void {
    const { folder, canvas, projectRoot } = this.find(cwd, id);
    if (canvas.hash !== seen) throw new CanvasError('CHANGED', 'This canvas changed while you were looking at it. Check it again.');
    this.deps.trust(projectRoot, canvasTrustKey(id, canvas.hash));
    this.deps.changed(folder);
  }

  /** Starts the canvas if it isn't running and asks it for its page. Every session in the folder gets the same page. */
  async open(cwd: string, id: string, input?: unknown): Promise<{ url: string; title: string | null }> {
    const { folder, canvas, projectRoot } = this.find(cwd, id);
    if (!this.deps.isTrusted(projectRoot, canvasTrustKey(id, canvas.hash))) throw new CanvasError('UNTRUSTED', 'Trust this canvas before it runs.');
    const key = this.key(folder, id);
    let run = this.running.get(key);
    // The file changed since it started (and was trusted again): the old process is the old canvas.
    if (run && run.hash !== canvas.hash) {
      await this.stopRun(key, run);
      run = undefined;
    }
    this.held.delete(key);
    if (!run) run = this.start(key, folder, canvas);
    this.touch(key, run);
    if (run.opened && input === undefined) return run.opened;
    if (run.opening && input === undefined) return run.opening;
    const current = run;
    const opening = (async () => {
      await current.ready;
      const answer = (await this.call(current, { type: 'open', ctx: this.context(folder, id, input) })) as { url?: unknown; title?: unknown } | null;
      const url = typeof answer?.url === 'string' ? localPreviewUrl(answer.url) : null;
      if (!url) throw new CanvasError('FAILED', 'The canvas answered open() without a page on this computer (http://127.0.0.1 or localhost).');
      current.opened = { url, title: typeof answer?.title === 'string' && answer.title ? answer.title.slice(0, 80) : null };
      current.note(`Opened ${url}`, 'info', 'seshboard');
      return current.opened;
    })();
    current.opening = opening;
    try {
      return await opening;
    } catch (error) {
      // A canvas that can't open is no use running: stop it, and keep why.
      const message = error instanceof Error ? error.message : String(error);
      if (this.running.get(key) === current) {
        current.note(message, 'error', 'seshboard');
        await this.stopRun(key, current, message);
      }
      throw error instanceof CanvasError ? error : new CanvasError('FAILED', message);
    } finally {
      if (current.opening === opening) current.opening = null;
      this.deps.changed(folder);
    }
  }

  /** Runs one of the canvas's actions, for the agent. The canvas must be open. */
  async action(cwd: string, id: string, name: string, input: unknown): Promise<unknown> {
    const { folder } = this.find(cwd, id);
    const run = this.running.get(this.key(folder, id));
    if (!run?.info || !run.opened) throw new CanvasError('UNAVAILABLE', 'Open the canvas first.');
    if (!run.info.actions.some((a) => a.name === name)) throw new CanvasError('NOT_FOUND', `This canvas has no action named ${name}.`);
    this.touch(this.key(folder, id), run);
    const started = Date.now();
    try {
      const result = await this.call(run, { type: 'action', name, input, ctx: this.context(folder, id) });
      run.note(`Action ${name} ran (${Date.now() - started} ms)`, 'info', 'seshboard');
      return result;
    } catch (error) {
      run.note(`Action ${name} failed: ${error instanceof Error ? error.message : String(error)}`, 'error', 'seshboard');
      throw error;
    }
  }

  /**
   * A window has the canvas open in a session's panel, or no longer (`viewer` is that window's connection). A canvas
   * nobody has open stops after a while, so canvases you left don't keep running.
   */
  view(cwd: string, id: string, viewer: unknown, viewing: boolean): void {
    const folder = canvasFolder(cwd, this.deps.home);
    if (!folder) return;
    const key = this.key(folder, id);
    const viewers = this.viewers.get(key) ?? new Set();
    if (viewing) viewers.add(viewer);
    else viewers.delete(viewer);
    if (viewers.size) this.viewers.set(key, viewers);
    else this.viewers.delete(key);
    const run = this.running.get(key);
    if (run) this.touch(key, run);
  }

  /** A window went away: it has nothing open any more. */
  dropViewer(viewer: unknown): void {
    for (const [key, viewers] of this.viewers) {
      if (!viewers.delete(viewer)) continue;
      if (viewers.size === 0) this.viewers.delete(key);
      const run = this.running.get(key);
      if (run) this.touch(key, run);
    }
  }

  /** Starts the wait that stops an unused canvas over, or ends it while a window has the canvas open. */
  private touch(key: string, run: Running): void {
    if (run.idle) clearTimeout(run.idle);
    run.idle = null;
    if (this.viewers.has(key)) return;
    run.idle = setTimeout(() => {
      if (this.running.get(key) !== run || this.viewers.has(key)) return;
      run.note('Stopped: no session has it open', 'info', 'seshboard');
      const [folder] = key.split('\0') as [string, string];
      void this.stopRun(key, run).then(() => this.deps.changed(folder));
    }, this.timeouts.idle);
    run.idle.unref?.();
  }

  /** A running canvas's actions, for the agent; null while it isn't open. */
  actions(cwd: string, id: string): CanvasActionInfo[] | null {
    const folder = canvasFolder(cwd, this.deps.home);
    const run = folder ? this.running.get(this.key(folder, id)) : undefined;
    return run?.info && run.opened ? run.info.actions : null;
  }

  /** A window shows the canvas in this session's panel, in this look: the canvas hears it (`host.context()`). */
  shown(cwd: string, id: string, session: { id: string; title: string }, theme: 'light' | 'dark'): void {
    const folder = canvasFolder(cwd, this.deps.home);
    const run = folder ? this.running.get(this.key(folder, id)) : undefined;
    if (!folder || !run) return;
    const context: CanvasHostContext = { folder, branch: this.deps.branch?.(folder) ?? null, theme, session };
    if (JSON.stringify(context) === JSON.stringify(run.context)) return;
    run.context = context;
    if (run.info && run.child.connected) run.child.send({ type: 'context', context } satisfies ToCanvas);
  }

  /** Stops a canvas's process. Opening it again starts it fresh. */
  async stop(cwd: string, id: string, hold = false): Promise<void> {
    const folder = canvasFolder(cwd, this.deps.home);
    if (!folder) return;
    const key = this.key(folder, id);
    this.failed.delete(key);
    if (hold) this.held.add(key);
    const run = this.running.get(key);
    if (run) {
      run.note(hold ? 'Stopped by you' : 'Stopped, to start again', 'info', 'seshboard');
      await this.stopRun(key, run);
    }
    this.deps.changed(folder);
  }

  /** The end of the canvas's log: its stdout, stderr and `host.log`, and what Seshboard did with it. */
  log(cwd: string, id: string): CanvasLogLine[] {
    const folder = canvasFolder(cwd, this.deps.home);
    if (!folder) return [];
    const key = this.key(folder, id);
    return [...(this.running.get(key)?.log ?? this.failed.get(key)?.log ?? this.lastLog.get(key) ?? [])];
  }

  /** The app is quitting: every canvas goes with it. */
  dispose(): void {
    for (const [key, run] of this.running) {
      run.stopped = true;
      if (run.idle) clearTimeout(run.idle);
      this.settle(run, new CanvasError('UNAVAILABLE', 'Seshboard is quitting.'));
      run.child.kill();
      this.running.delete(key);
    }
  }

  private context = (folder: string, id: string, input?: unknown): CanvasContext => ({ instance: `${id}:${sha(folder).slice(0, 12)}`, folder, ...(input !== undefined ? { input } : {}) });

  private start(key: string, folder: string, canvas: { id: string; entry: string; hash: string }): Running {
    const runner = this.deps.runner();
    if (!runner) throw new CanvasError('UNAVAILABLE', 'Seshboard is still starting. Try again in a moment.');
    this.failed.delete(key);
    this.lastLog.delete(key);
    const child = spawn(runner.command, [...runner.args, canvas.entry], { cwd: folder, env: { ...process.env, ...runner.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    let registered!: (info: CanvasInfo) => void;
    let refused!: (error: Error) => void;
    const ready = new Promise<CanvasInfo>((resolve, reject) => {
      registered = resolve;
      refused = reject;
    });
    // Nobody may be waiting yet (a second open waits on `opening`): a refusal is still handled.
    ready.catch(() => {});
    let told: ReturnType<typeof setTimeout> | null = null;
    const note: Running['note'] = (text, level = 'info', from = 'canvas') => {
      for (const part of text.split(/\r?\n/)) if (part.trim()) run.log.push({ at: Date.now(), level, from, text: part.slice(0, 2000) });
      if (run.log.length > LOG_LINES) run.log.splice(0, run.log.length - LOG_LINES);
      told ??= setTimeout(() => {
        told = null;
        this.deps.logged?.(folder, canvas.id);
      }, LOG_TOLD_MS);
      told.unref?.();
    };
    const run: Running = { child, hash: canvas.hash, info: null, ready, opened: null, opening: null, pending: new Map(), nextId: 1, log: [], note, stopped: false, idle: null, context: null };
    this.running.set(key, run);
    note(`Started ${canvas.id}`, 'info', 'seshboard');
    const late = setTimeout(() => refused(new CanvasError('FAILED', 'The canvas did not call serve() in time.')), this.timeouts.ready);
    child.stdout?.setEncoding('utf8').on('data', (text: string) => note(text, 'info'));
    child.stderr?.setEncoding('utf8').on('data', (text: string) => note(text, 'warn'));
    child.on('message', (raw) => {
      const message = readFromCanvas(raw);
      if (!message) return;
      if (message.type === 'log') return note(message.message, message.level);
      if (message.type === 'compose') {
        const text = (message.compose.text ?? '').slice(0, COMPOSE_TEXT);
        const items = composeItems(folder, message.compose.chips);
        if (text.trim() || items.length) this.deps.compose?.(folder, canvas.id, { text, items });
        return;
      }
      if (message.type === 'ready') {
        const info = readCanvasInfo(message.canvas);
        clearTimeout(late);
        if (typeof info === 'string') return refused(new CanvasError('FAILED', info));
        run.info = info;
        if (run.context && child.connected) child.send({ type: 'context', context: run.context } satisfies ToCanvas);
        return registered(info);
      }
      const waiting = run.pending.get(message.id);
      if (!waiting) return;
      run.pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.ok) waiting.resolve(message.value);
      else waiting.reject(new CanvasError('FAILED', message.error));
    });
    const ended = (why: string) => {
      clearTimeout(late);
      if (run.idle) clearTimeout(run.idle);
      if (this.running.get(key) !== run) return;
      note(why, run.stopped ? 'info' : 'error', 'seshboard');
      this.running.delete(key);
      const error = new CanvasError('FAILED', why);
      refused(error);
      this.settle(run, error);
      if (!run.stopped) this.failed.set(key, { error: why, log: [...run.log] });
      else this.lastLog.set(key, [...run.log]);
      this.deps.changed(folder);
    };
    child.on('error', (error) => ended(`The canvas could not start: ${error.message}`));
    child.on('exit', (code, signal) => ended(run.stopped ? 'The canvas stopped.' : `The canvas stopped by itself${code !== null ? ` (exit code ${code})` : signal ? ` (${signal})` : ''}.`));
    this.deps.changed(folder);
    return run;
  }

  private call(run: Running, message: { type: 'open' | 'close'; ctx: CanvasContext } | { type: 'action'; name: string; input: unknown; ctx: CanvasContext }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = run.nextId++;
      const timer = setTimeout(() => {
        run.pending.delete(id);
        reject(new CanvasError('FAILED', 'The canvas did not answer in time.'));
      }, this.timeouts.call);
      run.pending.set(id, { resolve, reject, timer });
      try {
        run.child.send({ ...message, id } as ToCanvas);
      } catch (error) {
        run.pending.delete(id);
        clearTimeout(timer);
        reject(new CanvasError('FAILED', error instanceof Error ? error.message : String(error)));
      }
    });
  }

  private settle(run: Running, error: Error): void {
    for (const waiting of run.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    run.pending.clear();
  }

  /** close() with a moment to tidy up, then the process: SIGTERM, and SIGKILL when it stays. */
  private async stopRun(key: string, run: Running, failure?: string): Promise<void> {
    run.stopped = true;
    if (run.info && run.opened && run.child.connected) {
      const [folder, id] = key.split('\0') as [string, string];
      await Promise.race([this.call(run, { type: 'close', ctx: this.context(folder, id) }).catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    this.running.delete(key);
    if (run.idle) clearTimeout(run.idle);
    this.settle(run, new CanvasError('UNAVAILABLE', 'The canvas stopped.'));
    if (failure) this.failed.set(key, { error: failure, log: [...run.log] });
    else this.lastLog.set(key, [...run.log]);
    if (run.child.exitCode !== null || run.child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => run.child.kill('SIGKILL'), 5_000);
      run.child.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      run.child.kill();
    });
  }
}
