/**
 * The chaos harness (docs/chaos-testing.md): launches the built app driven (SESHBOARD_DRIVEN=1) in a sandbox world,
 * watches every failure signal, keeps a JSONL action log, and takes a screenshot with the last 50 actions on every
 * signal.
 *
 * Safety: HOME, USERPROFILE, CLAUDE_CONFIG_DIR, TMPDIR and the app profile all point inside the sandbox, the
 * environment is a whitelist (no API keys, tokens or Claude Code session variables), `claude`, `gh` and editors are
 * fakes, and native dialogs, URLs, Finder and the Trash are stubbed in the main process.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { Rng } from './rng.ts';
import { type ChaosWorld, createChaosWorld, insideSandbox, isSandboxRoot } from './world.ts';

export const repoRoot = join(import.meta.dirname, '..', '..', '..');
const appDir = join(repoRoot, 'apps', 'desktop');
export const realHome = homedir();

/** Where runs go by default: tests/chaos-hunt-<today>/runs, which git ignores (the report goes next to it). */
export function defaultOutDir(): string {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return join(repoRoot, 'tests', `chaos-hunt-${day}`, 'runs');
}
export const realUser = userInfo().username;

export interface Signal {
  at: string;
  kind: string;
  detail: string;
  seed: number;
  phase: string;
  action: number;
  screenshot?: string;
}

/** Runs in the page before the app's scripts: watches the engine port, alerts, toasts and focus. */
const PAGE_INIT = `(() => {
  if (window.__chaos) return;
  const c = window.__chaos = { calls: [], pending: new Map(), rpcErrors: [], alerts: [], events: [], rejections: [], ports: 0, lastFocusLoss: null };
  const wrapPort = (port) => {
    if (!port || port.__chaosWrapped) return;
    port.__chaosWrapped = true;
    c.ports++;
    c.port = port;
    // A new port means the engine restarted: the app's client rejects the old port's calls (DISCONNECTED).
    const portNo = c.ports;
    for (const [id, p] of c.pending) if (p.port !== portNo) c.pending.delete(id);
    const send = port.postMessage.bind(port);
    port.postMessage = (msg, ...rest) => {
      try {
        if (msg && msg.kind === 'request' && /^(session\.create|session\.send|later\.(add|start)|session\.setPermissionMode)$/.test(msg.method)) c.calls.push({ at: Date.now(), method: msg.method, params: msg.params });
        if (msg && msg.kind === 'request') c.pending.set(msg.id, { port: portNo, method: msg.method, at: Date.now(), params: JSON.stringify(msg.params ?? null).slice(0, 300) });
      } catch {}
      return send(msg, ...rest);
    };
    port.addEventListener('message', (e) => {
      const m = e.data;
      try {
        if (m && m.kind === 'response') {
          const p = c.pending.get(m.id);
          c.pending.delete(m.id);
          if (m.ok === false) c.rpcErrors.push({ at: Date.now(), method: p ? p.method : '?', params: p ? p.params : '', ms: p ? Date.now() - p.at : -1, error: JSON.stringify(m.error).slice(0, 500) });
        }
      } catch {}
    });
  };
  window.addEventListener('message', (e) => { for (const p of e.ports || []) wrapPort(p); }, true);
  // Checked after the app's own listeners, which may mark expected rejections handled (DISCONNECTED).
  window.addEventListener('unhandledrejection', (e) => setTimeout(() => { if (!e.defaultPrevented) c.rejections.push({ at: Date.now(), reason: String(e.reason && (e.reason.stack || e.reason.message) || e.reason).slice(0, 800) }); }, 0));
  const seen = new WeakSet();
  const scan = () => {
    for (const el of document.querySelectorAll('[role="alert"], [data-toast], [data-notice-tone="error"], [data-tone="error"]')) {
      if (seen.has(el)) continue;
      seen.add(el);
      const text = (el.innerText || el.textContent || '').trim().slice(0, 300);
      if (!text) continue;
      c.alerts.push({ at: Date.now(), kind: el.getAttribute('role') === 'alert' ? 'alert' : el.hasAttribute('data-toast') ? 'toast' : 'error-notice', text, hooks: [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).join(' ') });
    }
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true });
})();`;

export interface LaunchOptions {
  seed: number;
  phase: string;
  /** Where the run's artefacts go (action log, screenshots, logs). */
  outDir: string;
  /** Reuse a world (for restarts); otherwise a new one is made. */
  world?: ChaosWorld;
  /** The app profile (SESHBOARD_DRIVEN_PROFILE); kept across restarts of one run. */
  profileDir?: string;
  size?: { width: number; height: number };
  extraEnv?: Record<string, string>;
  /** Extra arguments for the app (a seshboard:// link at launch). */
  extraArgs?: string[];
}

export class Chaos {
  readonly rng: Rng;
  readonly signals: Signal[] = [];
  readonly actions: Array<Record<string, unknown>> = [];
  actionCount = 0;
  app!: ElectronApplication;
  page!: Page;
  world!: ChaosWorld;
  profileDir!: string;
  enginePid: number | null = null;
  engineRestarts = 0;
  private shotKeys = new Set<string>();
  private seenSignals = new Map<string, number>();
  private timers: NodeJS.Timeout[] = [];
  private closing = false;
  readonly memory: Array<{ at: number; heap: number; engineRss: number; actions: number }> = [];

  readonly options: LaunchOptions;
  constructor(options: LaunchOptions) {
    this.options = options;
    this.rng = new Rng(options.seed);
    mkdirSync(join(options.outDir, 'shots'), { recursive: true });
  }

  get tag(): string {
    return `${this.options.phase}-${this.options.seed}`;
  }

  logFile(name: string): string {
    return join(this.options.outDir, `${this.tag}.${name}`);
  }

  // -------------------------------------------------------------------------------------------------------
  // Launch and teardown.

  async launch(): Promise<void> {
    this.world ??= this.options.world ?? createChaosWorld();
    this.profileDir ??= this.options.profileDir ?? join(this.world.root, `profile-${this.options.seed}`);
    mkdirSync(this.profileDir, { recursive: true });
    const tmp = join(this.world.root, 'tmp');
    mkdirSync(tmp, { recursive: true });
    if (this.profileDir.includes(realHome) || this.world.home.includes(realHome)) throw new Error('sandbox inside the real home: refusing to run');
    const electronPath = createRequire(join(appDir, 'package.json'))('electron') as unknown as string;
    // A whitelist: no API keys, tokens or Claude Code session variables reach the app.
    const env: Record<string, string> = {
      PATH: `${join(this.world.home, '.chaos', 'bin')}:${join(this.world.home, '.local', 'bin')}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: this.world.home,
      USERPROFILE: this.world.home,
      CLAUDE_CONFIG_DIR: join(this.world.home, '.claude'),
      TMPDIR: `${tmp}/`,
      SHELL: '/bin/zsh',
      LANG: 'en_US.UTF-8',
      USER: 'you',
      LOGNAME: 'you',
      TERM: 'xterm-256color',
      SESHBOARD_DRIVEN: '1',
      SESHBOARD_GH: this.world.ghPath,
      SESHBOARD_CLAUDE_REGISTRY: `data:application/json,${encodeURIComponent(JSON.stringify({ latest: '2.1.287', stable: '2.1.287' }))}`,
      SESHBOARD_DISABLE_AUTO_UPDATE: '1',
      // A fixed throwaway profile, so a restart in the same run finds the same choices.
      SESHBOARD_DRIVEN_PROFILE: this.profileDir,
      ELECTRON_ENABLE_LOGGING: '0',
      ...this.options.extraEnv,
    };
    this.closing = false;
    this.cdp = null;
    this.app = await _electron.launch({ executablePath: electronPath, args: [appDir, ...(this.options.extraArgs ?? [])], env, timeout: 60_000 });
    const proc = this.app.process();
    const onLine = (stream: string) => (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        appendFileSync(this.logFile('stderr.log'), `${new Date().toISOString()} ${stream} ${line}\n`);
        this.classifyStderr(line);
      }
    };
    proc.stderr?.on('data', onLine('err'));
    proc.stdout?.on('data', onLine('out'));
    this.app.on('close', () => {
      if (!this.closing) this.signal('app-exit', 'the app closed without being asked');
    });
    this.page = await this.app.firstWindow();
    await this.page.addInitScript(PAGE_INIT);
    // The first window may already have run its scripts; reload so the watcher is in before the engine port arrives.
    await this.page.reload();
    this.page.setDefaultTimeout(8_000);
    this.page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') this.signal(`console-${type}`, msg.text().slice(0, 1500));
    });
    this.page.on('pageerror', (error) => this.signal('pageerror', `${error.message}\n${(error.stack ?? '').slice(0, 1200)}`));
    // <input type=file> would open a native panel; answer it with nothing (or a queued sandbox file).
    this.page.on('filechooser', (chooser) => {
      this.log('filechooser', chooser.isMultiple() ? 'multiple' : 'single');
      void chooser.setFiles([]).catch(() => {});
    });
    this.page.on('close', () => {
      if (!this.closing) this.signal('window-closed', `the window closed by itself (last action: ${JSON.stringify(this.actions.at(-1) ?? null)})`);
    });
    this.page.on('crash', () => this.signal('renderer-crash', 'page crashed'));
    await this.app.evaluate(({ app, BrowserWindow }, size) => {
      const g = globalThis as unknown as { __chaosMain?: Array<{ at: number; kind: string; detail: string }> };
      g.__chaosMain = [];
      app.on('render-process-gone', (_e, _w, details) => g.__chaosMain!.push({ at: Date.now(), kind: 'render-process-gone', detail: JSON.stringify(details) }));
      app.on('child-process-gone', (_e, details) => g.__chaosMain!.push({ at: Date.now(), kind: 'child-process-gone', detail: JSON.stringify(details) }));
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setContentSize(size.width, size.height);
      win.center();
    }, this.options.size ?? { width: 1440, height: 900 });
    await this.stubNative();
    const userData = await this.app.evaluate(({ app }) => app.getPath('userData'));
    if (userData !== this.profileDir) throw new Error(`the app profile is ${userData}, not ${this.profileDir}: this build ignores SESHBOARD_DRIVEN_PROFILE (rebuild it)`);
    await this.waitReady();
    this.enginePid = this.findEnginePid();
    await this.safetyCheck();
    this.startWatchers();
  }

  /**
   * Native side effects stay in the sandbox: open dialogs answer from a queue (or cancel), save dialogs write into
   * <root>/exports, URLs, Finder and editors only log, and the Trash is <root>/trash.
   */
  async stubNative(): Promise<void> {
    await this.app.evaluate(({ dialog, shell }, root) => {
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      const g = globalThis as unknown as { __chaosOpen: string[][]; __chaosOpened: string[] };
      g.__chaosOpen = [];
      g.__chaosOpened = [];
      fs.mkdirSync(path.join(root, 'exports'), { recursive: true });
      fs.mkdirSync(path.join(root, 'trash'), { recursive: true });
      const set = (obj: object, key: string, fn: unknown) => Object.defineProperty(obj, key, { value: fn, configurable: true, writable: true });
      set(dialog, 'showOpenDialog', async () => {
        const next = g.__chaosOpen.shift();
        return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] };
      });
      set(dialog, 'showOpenDialogSync', () => g.__chaosOpen.shift());
      set(dialog, 'showSaveDialog', async (...args: unknown[]) => {
        const options = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string } | undefined;
        return { canceled: false, filePath: path.join(root, 'exports', `${Date.now()}-${path.basename(options?.defaultPath ?? 'export.json')}`) };
      });
      set(dialog, 'showMessageBox', async () => ({ response: 0, checkboxChecked: false }));
      set(shell, 'openExternal', async (url: string) => void g.__chaosOpened.push(`external ${url}`));
      set(shell, 'openPath', async (p: string) => (g.__chaosOpened.push(`path ${p}`), ''));
      set(shell, 'showItemInFolder', (p: string) => void g.__chaosOpened.push(`folder ${p}`));
      set(shell, 'trashItem', async (p: string) => {
        if (!path.resolve(p).startsWith(root + path.sep)) throw new Error(`chaos: refused to trash ${p} outside the sandbox`);
        fs.renameSync(p, path.join(root, 'trash', `${Date.now()}-${path.basename(p)}`));
      });
    }, this.world.root);
  }

  /** Sends one engine request on the window's own port, as the UI would, and returns its response. */
  async rpc(method: string, params: unknown, timeout = 30_000): Promise<{ ok: boolean; result?: unknown; error?: unknown }> {
    return this.page.evaluate(
      ({ method, params, timeout }) =>
        new Promise((resolve) => {
          const c = (window as unknown as { __chaos: { port: MessagePort } }).__chaos;
          const id = `chaos-${Math.random().toString(36).slice(2)}`;
          const done = (value: unknown) => {
            c.port.removeEventListener('message', listener);
            resolve(value as { ok: boolean });
          };
          const listener = (e: MessageEvent) => {
            if (e.data?.kind === 'response' && e.data.id === id) done(e.data);
          };
          c.port.addEventListener('message', listener);
          c.port.postMessage({ kind: 'request', id, method, params });
          setTimeout(() => done({ ok: false, error: 'chaos: no response' }), timeout);
        }),
      { method, params, timeout },
    );
  }

  /** The engine requests the window sent that start or change sessions (session.create, session.send, later.*), oldest first; `clear` empties the list. */
  async calls(clear = false): Promise<Array<{ method: string; params: Record<string, unknown> }>> {
    return this.page
      .evaluate((clear) => {
        const c = (window as unknown as { __chaos: { calls: Array<{ method: string; params: Record<string, unknown> }> } }).__chaos;
        return clear ? c.calls.splice(0) : [...c.calls];
      }, clear)
      .catch(() => []);
  }

  /** The next native open dialog answers with these paths. */
  async queueOpenDialog(paths: string[]): Promise<void> {
    await this.app.evaluate((_e, paths) => void (globalThis as unknown as { __chaosOpen: string[][] }).__chaosOpen.push(paths), paths);
  }

  async waitReady(timeout = 30_000): Promise<void> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const ok = await this.page.evaluate(() => document.querySelectorAll('[data-session-id]').length > 0 && !!document.querySelector('[data-sidebar-state], [data-session-list]')).catch(() => false);
      if (ok) return;
      await sleep(200);
    }
    this.signal('startup', 'the app did not show any sessions within 30 s of starting');
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await this.app.close().catch(() => {});
    this.killStrays();
  }

  /**
   * Quits the way a person does (app.quit, answering the quit prompt if it asks), so storage is flushed. Falls back
   * to app.exit after 15 s and says so.
   */
  async quit(): Promise<void> {
    this.closing = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    const closed = new Promise<void>((resolve) => this.app.once('close', () => resolve()));
    await this.app.evaluate(({ app }) => setTimeout(() => app.quit(), 10)).catch(() => {});
    const end = Date.now() + 15_000;
    let done = false;
    void closed.then(() => (done = true));
    while (!done && Date.now() < end) {
      // The quit prompt (running sessions, unsent messages): confirm it.
      await this.page.locator('[role="alertdialog"] [data-confirm], [data-quit-unsent] [data-confirm]').first().click({ timeout: 500 }).catch(() => {});
      await sleep(300);
    }
    if (!done) {
      this.closing = false;
      this.signal('quit-hang', 'app.quit() did not close the app within 15 s');
      this.closing = true;
      await this.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
    await this.app.close().catch(() => {});
    this.killStrays();
  }

  /** Quits and starts the app again on the same profile and world. */
  async restart(): Promise<void> {
    await this.quit();
    await sleep(500);
    await this.launch();
  }

  /** Stops the world's stand-in processes and removes it. Only inside the sandbox. */
  destroyWorld(): void {
    this.world.stop();
    if (isSandboxRoot(this.world.root)) rmSync(this.world.root, { recursive: true, force: true, maxRetries: 3 });
  }

  /** Processes started by our app that outlived it (terminals, project actions). Only ones whose command mentions the sandbox. */
  killStrays(): void {
    try {
      const out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (!m) continue;
        const [, pid, cmd] = m;
        if (Number(pid) === process.pid) continue;
        if (this.world.sandboxes.some((s) => cmd!.includes(s)) && !cmd!.includes('setTimeout(() => {}, 600_000)')) {
          try {
            process.kill(Number(pid), 'SIGKILL');
          } catch {}
        }
      }
    } catch {}
  }

  // -------------------------------------------------------------------------------------------------------
  // Signals.

  private classifyStderr(line: string): void {
    if (this.closing) return;
    if (/\[engine\] error:|Uncaught|Unhandled rejection|UnhandledPromiseRejection/i.test(line)) this.signal('engine-error', line.slice(0, 1500));
    else if (/\[engine\] warn:/.test(line)) this.signal('engine-warn', line.slice(0, 1500));
    else if (/engine exited with code/.test(line)) this.signal('engine-exit', line);
    else if (/\[main\].*(fail|error)|Error:|TypeError|ReferenceError/i.test(line) && !/link: refused/.test(line)) this.signal('main-error', line.slice(0, 1500));
  }

  /** Records a failure signal (deduplicated by kind and text), with a screenshot and the last 50 actions. */
  signal(kind: string, detail: string): void {
    const key = `${kind}:${normalise(detail)}`;
    const count = (this.seenSignals.get(key) ?? 0) + 1;
    this.seenSignals.set(key, count);
    if (count > 1) {
      if (count === 5 || count === 50) appendFileSync(this.logFile('signals.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), kind, detail: detail.slice(0, 300), repeated: count })}\n`);
      return;
    }
    const s: Signal = { at: new Date().toISOString(), kind, detail, seed: this.options.seed, phase: this.options.phase, action: this.actionCount };
    this.signals.push(s);
    console.log(`  ! [${kind}] ${detail.split('\n')[0]!.slice(0, 200)}`);
    if (!this.shotKeys.has(key) && this.page && !this.closing) {
      this.shotKeys.add(key);
      const name = `${this.tag}-${this.signals.length}-${kind}`;
      s.screenshot = `shots/${name}.png`;
      void this.page.screenshot({ path: join(this.options.outDir, s.screenshot), timeout: 5_000 }).catch(() => (s.screenshot = undefined));
      writeFileSync(join(this.options.outDir, 'shots', `${name}.actions.jsonl`), this.actions.slice(-50).map((a) => JSON.stringify(a)).join('\n') + '\n');
    }
    appendFileSync(this.logFile('signals.jsonl'), `${JSON.stringify(s)}\n`);
  }

  /** One action, logged before it runs. */
  log(action: string, target?: string, input?: unknown): void {
    this.actionCount++;
    const entry = { t: new Date().toISOString(), n: this.actionCount, action, target, input: typeof input === 'string' && input.length > 200 ? `${input.slice(0, 200)}…(${input.length})` : input };
    this.actions.push(entry);
    if (this.actions.length > 500) this.actions.shift();
    appendFileSync(this.logFile('actions.jsonl'), `${JSON.stringify(entry)}\n`);
  }

  // -------------------------------------------------------------------------------------------------------
  // Watchers that run on their own.

  private startWatchers(): void {
    // Responsiveness: a trivial evaluate every 3 s.
    this.timers.push(
      setInterval(async () => {
        if (this.closing) return;
        const start = performance.now();
        const ok = await Promise.race([this.page.evaluate(() => 1).then(() => true), sleep(10_000).then(() => false)]).catch(() => null);
        const ms = performance.now() - start;
        if (ok === false) this.signal('unresponsive', 'the renderer did not answer a trivial evaluate within 10 s');
        else if (ok && ms > 1_000) this.signal('slow-evaluate', `a trivial evaluate took ${Math.round(ms)} ms`);
      }, 3_000),
    );
    // Page-side watchers, main-process events, the engine's pid.
    this.timers.push(setInterval(() => void this.pollPage(), 1_000));
  }

  private stuckSince = new Map<string, number>();

  async pollPage(): Promise<void> {
    if (this.closing) return;
    const data = await this.page
      .evaluate(() => {
        const c = (window as unknown as { __chaos?: any }).__chaos;
        if (!c) return null;
        const now = Date.now();
        const slow = [...c.pending.entries()].filter(([, p]: any) => now - p.at > 15_000).map(([id, p]: any) => ({ id, ...p, ms: now - p.at }));
        for (const s of slow) c.pending.delete(s.id);
        const out = { rpcErrors: c.rpcErrors.splice(0), alerts: c.alerts.splice(0), rejections: c.rejections.splice(0), slow, ports: c.ports };
        // Busy things on screen: spinners and aria-busy.
        const busy = [...document.querySelectorAll('[aria-busy="true"], [data-spinner], .animate-spin')]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => {
            const host = el.closest('[data-session-id], [data-current-session], [role="dialog"], [data-settings-section], button') as HTMLElement | null;
            // A session that is working says so with a spinner: that is not stuck.
            const status = el.closest('[data-session-status]')?.getAttribute('data-session-status') ?? host?.querySelector('[data-session-status]')?.getAttribute('data-session-status') ?? '';
            if (/work|busy|run|background|start/.test(status)) return null;
            return `${el.tagName.toLowerCase()}${(el as HTMLElement).dataset ? Object.keys((el as HTMLElement).dataset).slice(0, 2).join(',') : ''}@${host ? (host.getAttribute('data-session-id') ?? host.getAttribute('aria-label') ?? host.innerText.slice(0, 40)) : ''}`;
          })
          .filter((k): k is string => k !== null);
        const blank = (document.body?.innerText ?? '').trim().length < 10;
        const boundary = /Something went wrong|crashed|Reload the window/i.test(document.body?.innerText ?? '') && !!document.querySelector('[data-error-boundary]');
        return { ...out, busy, blank, boundary };
      })
      .catch(() => null);
    if (!data) return;
    for (const e of data.rpcErrors) this.signal('rpc-error', `${e.method} → ${e.error} (params ${e.params})`);
    for (const e of data.slow) this.signal('rpc-timeout', `${e.method} pending for ${Math.round(e.ms / 1000)} s (params ${e.params})`);
    for (const e of data.rejections) this.signal('unhandledrejection', e.reason);
    // A toast is news, not a failure, unless it says something went wrong.
    for (const a of data.alerts) {
      if (a.kind === 'toast' && !/couldn|can.t|cannot|fail|error|unable|wrong|not found|denied|refused|invalid/i.test(a.text)) appendFileSync(this.logFile('toasts.log'), `${a.text}\n`);
      else this.signal(a.kind, `${a.text} [${a.hooks}]`);
    }
    if (data.blank) this.signal('blank-window', 'the window shows no text');
    if (data.boundary) this.signal('error-boundary', 'an error boundary is showing');
    const now = Date.now();
    const busyNow = new Set<string>(data.busy);
    for (const key of busyNow) {
      if (!this.stuckSince.has(key)) this.stuckSince.set(key, now);
      else if (now - this.stuckSince.get(key)! > 15_000) {
        this.signal('stuck-spinner', `${key} busy for more than 15 s`);
        this.stuckSince.set(key, now + 10 * 60_000);
      }
    }
    for (const key of [...this.stuckSince.keys()]) if (!busyNow.has(key)) this.stuckSince.delete(key);
    const main = (await this.app.evaluate(() => ((globalThis as unknown as { __chaosMain?: unknown[] }).__chaosMain ?? []).splice(0)).catch(() => [])) as Array<{ kind: string; detail: string }>;
    for (const m of main) this.signal(m.kind, m.detail);
    const pid = this.findEnginePid();
    if (pid && this.enginePid && pid !== this.enginePid) {
      this.engineRestarts++;
      if (!this.expectEngineRestart) this.signal('engine-restart', `engine pid changed ${this.enginePid} → ${pid}`);
      this.expectEngineRestart = false;
    }
    if (pid) this.enginePid = pid;
  }

  expectEngineRestart = false;
  private cdp: import('playwright-core').CDPSession | null = null;

  /** The engine utilityProcess: a child of the app's main process. */
  findEnginePid(): number | null {
    const mainPid = this.app.process().pid;
    if (!mainPid) return null;
    try {
      const out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m && Number(m[2]) === mainPid && /--type=utility/.test(m[3]!) && /node\.mojom\.NodeService/.test(m[3]!)) return Number(m[1]);
      }
    } catch {}
    return null;
  }

  rss(pid: number | null): number {
    if (!pid) return 0;
    try {
      return Number(execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) * 1024;
    } catch {
      return 0;
    }
  }

  async sampleMemory(): Promise<void> {
    // performance.memory is bucketed; the DevTools protocol's JSHeapUsedSize is exact.
    let heap = 0;
    try {
      this.cdp ??= await this.page.context().newCDPSession(this.page);
      await this.cdp.send('Performance.enable');
      const { metrics } = (await this.cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
      heap = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
    } catch {
      this.cdp = null;
    }
    this.memory.push({ at: Date.now(), heap, engineRss: this.rss(this.enginePid), actions: this.actionCount });
    writeFileSync(this.logFile('memory.json'), JSON.stringify(this.memory, null, 1));
  }

  // -------------------------------------------------------------------------------------------------------
  // Safety.

  /** Stops the run if the real home folder or user name shows anywhere in the window or the profile. */
  async safetyCheck(): Promise<void> {
    const raw = (await this.page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('[data-tooltip],[title]')].map((e) => e.getAttribute('data-tooltip') ?? e.getAttribute('title')).join('\n')).catch(() => '')) as string;
    // The app's own code lives in this checkout (under the real home); its path is not user data.
    const text = raw.split(repoRoot).join('<repo>');
    const leaks = [realHome, `${realHome.replace(/^\/Users/, '')}`, realUser.length >= 3 ? realUser : null, 'Library/Application Support/Seshboard'].filter((s): s is string => !!s && text.includes(s));
    const fileLeak = this.grepProfile([realHome, 'Application Support/Seshboard']);
    if (leaks.length || fileLeak) {
      await this.page.screenshot({ path: join(this.options.outDir, `${this.tag}-SAFETY.png`) }).catch(() => {});
      await this.close();
      throw new Error(`SAFETY: real data showed up (${[...leaks, fileLeak].filter(Boolean).join(', ')}); run stopped`);
    }
  }

  /** The first profile file (text, under 5 MB) that contains one of the needles. */
  private grepProfile(needles: string[]): string | null {
    const walk = (dir: string): string | null => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary', 'blob_storage'].includes(entry.name)) continue;
          const found = walk(p);
          if (found) return found;
        } else if (entry.isFile() && statSync(p).size < 5_000_000) {
          const text = readFileSync(p).toString('latin1').split(repoRoot).join('<repo>');
          if (needles.some((n) => text.includes(n))) return p;
        }
      }
      return null;
    };
    try {
      return walk(this.profileDir);
    } catch {
      return null;
    }
  }

  assertInSandbox(path: string): void {
    if (!insideSandbox(path, this.world.sandboxes)) throw new Error(`refusing to touch ${path}: outside the sandbox`);
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Signals that differ only in ids, numbers or paths count as one. */
export function normalise(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\S*\/sbc-\w+\S*|\/var\/folders\/\S+/g, '<path>')
    .replace(/\d+/g, 'N')
    .slice(0, 160);
}

/**
 * Real places the app must never write to: any file there that mentions the sandbox root was written by our app
 * (the real user's own processes never see the sandbox). Returns the offending files.
 */
export function writesOutsideSandbox(root: string): string[] {
  const places = [
    join(realHome, 'Library', 'Application Support', 'Seshboard'),
    join(realHome, 'Library', 'Application Support', 'Seshboard Dev'),
    join(realHome, '.claude', 'sessions'),
    join(realHome, '.claude', 'ide'),
    join(realHome, '.claude.json'),
    join(realHome, '.claude', 'settings.json'),
    join(realHome, '.gitconfig'),
    join(realHome, '.zsh_history'),
  ];
  try {
    const out = execFileSync('/usr/bin/grep', ['-rlsF', '--exclude=*.sqlite*', '--exclude=*.ldb', root, ...places.filter((p) => existsSync(p))], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return []; // grep exits 1 when nothing matched
  }
}
