import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { RpcError, type ModPaneRoster, type ModsSurfaceState, type ModStatus, type ModToast } from '@seshboard/protocol';
import { modsBridge, type ModsBridge, type UiHost } from './modsBridge.ts';
import { isModFolder, listMods, pluginDirs } from './modsCatalog.ts';
import { ModsSurface, readModCapabilities, type ModsEvents } from './modsSurface.ts';
import { SessionHost, type HostConfig, type HostEvents } from './sessionHost.ts';

/** A bridge that records what was sent and answers from `replies` (a function per subtype, or an error). */
function fakeBridge(replies: Record<string, (request: Record<string, unknown>) => unknown> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const order: string[] = [];
  let host: UiHost | null = null;
  const bridge: ModsBridge = {
    setUiHost: (h) => {
      host = h;
      order.push(h ? 'setUiHost' : 'clearUiHost');
    },
    request: async (request) => {
      sent.push(request);
      order.push(request.subtype);
      const reply = replies[request.subtype]?.(request);
      if (reply instanceof Error) throw reply;
      return (reply as Record<string, unknown>) ?? {};
    },
  };
  return { bridge, sent, order, host: () => host };
}

function recorder() {
  const seen = { states: [] as ModsSurfaceState[], toasts: [] as ModToast[], statuses: [] as ModStatus[][], panes: [] as ModPaneRoster[], logs: 0, asks: [] as unknown[] };
  const events: ModsEvents = {
    state: (s) => seen.states.push(s),
    toast: (t) => seen.toasts.push(t),
    statuses: (_id, s) => seen.statuses.push(s),
    log: () => seen.logs++,
    invalidate: () => {},
    panes: (_id, r) => seen.panes.push(r),
    scroll: () => {},
    focus: () => {},
    ask: async (ask) => {
      seen.asks.push(ask);
      return ask.kind === 'read' ? { text: 'draft', cursor: 3 } : { done: true };
    },
    diagnostics: () => {},
  };
  return { events, seen };
}

const SURFACE = ['ui_surface_v1'];

async function attached(caps = SURFACE, replies = {}) {
  const fake = fakeBridge(replies);
  const { events, seen } = recorder();
  const surface = new ModsSurface(() => 'sess-1', events, true);
  surface.setBridge(fake.bridge);
  surface.setCapabilities(caps);
  await surface.idle();
  return { surface, fake, seen };
}

describe('readModCapabilities', () => {
  it('reads support, hooked components and prompt screening', () => {
    expect(readModCapabilities(['ui_surface_v1', 'ui_hooked_v1', 'ui_hooked_v1:ToolUse', 'ui_hooked_v1:Nope', 'prompts_screened_v1'])).toEqual({
      supported: true,
      hooked: ['ToolUse'],
      promptsScreened: true,
    });
    // Hooked components only count with the `ui_hooked_v1` flag itself.
    expect(readModCapabilities(['ui_hooked_v1:ToolUse']).hooked).toEqual([]);
    expect(readModCapabilities([])).toEqual({ supported: false, hooked: [], promptsScreened: false });
  });
});

describe('ModsSurface', () => {
  it('registers the host answers, then attaches once the capability is there', async () => {
    const { surface, fake } = await attached();
    expect(fake.order.slice(0, 2)).toEqual(['setUiHost', 'ui_attach']);
    expect(fake.sent[0]).toMatchObject({ subtype: 'ui_attach', surface: 'desktop', client_id: 'switchboard-sess-1', answers: ['ui_copy', 'ui_prompt_read', 'ui_prompt_fill', 'ui_prompt_suggest'] });
    expect(surface.state.attached).toBe(true);
  });

  it('never attaches without the capability', async () => {
    const { surface, fake } = await attached([]);
    expect(fake.order).toEqual([]);
    expect(surface.state).toMatchObject({ supported: false, attached: false });
  });

  it('treats an unsupported subtype on ui_attach as no mods, quietly', async () => {
    const { surface, fake } = await attached(SURFACE, { ui_attach: () => new Error('Unsupported control request subtype: ui_attach') });
    expect(surface.state).toMatchObject({ supported: false, attached: false });
    expect(fake.host()).toBeNull();
  });

  it('turns an unsupported subtype on ui_render into MODS_OFF and stops drawing', async () => {
    const { surface } = await attached(SURFACE, { ui_render: () => new Error('Unsupported control request subtype: ui_render') });
    await expect(surface.render({ sessionId: 'sess-1', component: 'AbovePrompt', instanceId: 'above-prompt', props: {} })).rejects.toMatchObject({ code: 'MODS_OFF' });
    await surface.idle();
    expect(surface.state.supported).toBe(false);
  });

  it('keeps one status per mod, and null clears it', async () => {
    const { surface, seen } = await attached();
    surface.handleSystem({ type: 'system', subtype: 'ui_status', plugin: 'pr-status', text: 'PR #142' });
    surface.handleSystem({ type: 'system', subtype: 'ui_status', plugin: 'pr-status', text: 'PR #143' });
    surface.handleSystem({ type: 'system', subtype: 'ui_status', plugin: 'agent-watch', text: '3/3' });
    expect(seen.statuses.at(-1)).toEqual([{ plugin: 'pr-status', text: 'PR #143' }, { plugin: 'agent-watch', text: '3/3' }]);
    surface.handleSystem({ type: 'system', subtype: 'ui_status', plugin: 'pr-status', text: null });
    expect(seen.statuses.at(-1)).toEqual([{ plugin: 'agent-watch', text: '3/3' }]);
    expect(surface.state.plugins).toEqual(['pr-status', 'agent-watch']);
  });

  it('keeps the last 20 toasts, 4 seconds unless the mod says otherwise', async () => {
    const { surface, seen } = await attached();
    for (let i = 0; i < 25; i++) surface.handleSystem({ type: 'system', subtype: 'ui_toast', plugin: 'pr-status', text: `t${i}`, ...(i === 24 ? { timeout_ms: 9000 } : {}) });
    expect(seen.toasts).toHaveLength(25);
    expect(seen.toasts[0]!.timeoutMs).toBe(4000);
    expect(seen.toasts.at(-1)!.timeoutMs).toBe(9000);
    expect(surface.snapshot().toasts.map((t) => t.text)).toEqual(Array.from({ length: 20 }, (_, i) => `t${i + 5}`));
  });

  it('clears statuses, toasts and panes when the capability goes away', async () => {
    const { surface, fake, seen } = await attached();
    surface.handleSystem({ type: 'system', subtype: 'ui_status', plugin: 'pr-status', text: 'PR' });
    surface.handleSystem({ type: 'system', subtype: 'ui_toast', plugin: 'pr-status', text: 'CI passed' });
    surface.handleSystem({ type: 'system', subtype: 'ui_panes', panes: [{ id: 'agents', plugin: 'agent-watch', title: 'Agents', close_on_escape: true }], shown_id: 'agents', focused_id: null, focus_requested_id: null });
    expect(surface.snapshot().panes.panes[0]).toMatchObject({ id: 'agents', closeOnEscape: true, holdToasts: false });
    surface.setCapabilities([]);
    await surface.idle();
    expect(surface.snapshot()).toMatchObject({ statuses: [], toasts: [], panes: { panes: [] } });
    expect(seen.statuses.at(-1)).toEqual([]);
    expect(seen.panes.at(-1)!.panes).toEqual([]);
    expect(fake.order).toContain('ui_detach');
    expect(surface.state.attached).toBe(false);
  });

  it('detaches when Show mods goes off and attaches again when it comes back', async () => {
    const { surface, fake } = await attached();
    surface.setEnabled(false);
    await surface.idle();
    expect(surface.state.attached).toBe(false);
    expect(fake.order.slice(-2)).toEqual(['clearUiHost', 'ui_detach']);
    // No toast while detached; a status is the session's, kept for when it attaches again.
    surface.handleSystem({ type: 'system', subtype: 'ui_toast', plugin: 'pr-status', text: 'CI passed' });
    surface.handleSystem({ type: 'system', subtype: 'ui_status', plugin: 'pr-status', text: 'PR' });
    expect(surface.snapshot().toasts).toEqual([]);
    expect(surface.snapshot().statuses).toEqual([{ plugin: 'pr-status', text: 'PR' }]);
    surface.setEnabled(true);
    await surface.idle();
    expect(surface.state.attached).toBe(true);
    expect(fake.order.filter((s) => s === 'ui_attach')).toHaveLength(2);
  });

  it('keeps the status and panes Claude Code sends before the attach', async () => {
    // Claude Code answers ui_panes with the roster it holds (as a real session did).
    const fake = fakeBridge({ ui_panes: () => ({ panes: [{ id: 'smoke-pane', title: 'Smoke pane', plugin: 'smoke-mod' }], shown_id: 'smoke-pane', focused_id: null, focus_requested_id: null }) });
    const surface = new ModsSurface(() => 'sess-1', recorder().events, true);
    surface.handleSystem({ type: 'system', subtype: 'ui_status', plugin: 'smoke-mod', text: 'ready' });
    surface.handleSystem({ type: 'system', subtype: 'ui_panes', panes: [{ id: 'smoke-pane', title: 'Smoke pane', plugin: 'smoke-mod' }], shown_id: 'smoke-pane', focused_id: null, focus_requested_id: null });
    surface.setBridge(fake.bridge);
    surface.setCapabilities(SURFACE);
    await surface.idle();
    expect(surface.snapshot()).toMatchObject({ state: { attached: true, plugins: ['smoke-mod'] }, statuses: [{ plugin: 'smoke-mod', text: 'ready' }], panes: { shownId: 'smoke-pane' } });
  });

  it('starts off without attaching when Show mods is off', async () => {
    const fake = fakeBridge();
    const surface = new ModsSurface(() => 'sess-1', recorder().events, false);
    surface.setBridge(fake.bridge);
    surface.setCapabilities(['ui_surface_v1', 'prompts_screened_v1']);
    await surface.idle();
    expect(fake.order).toEqual([]);
    // Screening happens in Claude Code, so it still shows.
    expect(surface.state).toMatchObject({ supported: true, attached: false, promptsScreened: true });
  });

  it('answers Claude Code through the window, and fill never sends', async () => {
    const { fake, seen } = await attached();
    const host = fake.host()!;
    const signal = new AbortController().signal;
    expect(await host.promptRead({}, { signal })).toEqual({ text: 'draft', cursor: 3 });
    expect(await host.promptFill({ text: 'hi', mode: 'replace' }, { signal })).toEqual({ filled: true });
    expect(await host.copy({ plugin: 'pr-status', text: 'x' }, { signal })).toEqual({ copied: true });
    expect(seen.asks.map((a) => (a as { kind: string }).kind)).toEqual(['read', 'fill', 'copy']);
  });

  it('relays a render and maps its reply', async () => {
    const { surface, fake } = await attached(SURFACE, {
      ui_render: () => ({ tree: { type: 'Box', children: ['hi'] }, props: { a: 1 }, rewritten: true, hooked: true, drawn_by: ['agent-watch'] }),
    });
    const result = await surface.render({ sessionId: 'sess-1', component: 'AbovePrompt', instanceId: 'above-prompt', props: { maxRows: 8 } });
    expect(result).toEqual({ tree: { type: 'Box', children: ['hi'] }, props: { a: 1 }, rewritten: true, hooked: true, drawnBy: ['agent-watch'] });
    expect(fake.sent.at(-1)).toMatchObject({ subtype: 'ui_render', surface: 'desktop', client_id: 'switchboard-sess-1', instance_id: 'above-prompt', props: { maxRows: 8 } });
    expect(surface.state.plugins).toEqual(['agent-watch']);
  });

  it('refuses requests while detached', async () => {
    const surface = new ModsSurface(() => 's', recorder().events, true);
    await expect(surface.press({ sessionId: 's', plugin: 'p', handle: 1 })).rejects.toBeInstanceOf(RpcError);
  });
});

describe('modsBridge', () => {
  afterEach(() => vi.useRealTimers());

  it('is null when the SDK has no mods calls', () => {
    expect(modsBridge({} as Query)).toBeNull();
  });

  it('gives up after 30 seconds with MOD_TIMEOUT', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const query = {
      setUiHost() {},
      request: (_r: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal = options.signal;
          options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    } as unknown as Query;
    const bridge = modsBridge(query)!;
    const { events } = recorder();
    const surface = new ModsSurface(() => 'sess-1', events, true);
    // Attach goes through a bridge that answers; renders through the one that never does.
    const answering = fakeBridge();
    surface.setBridge({ setUiHost: () => {}, request: (r, ms) => (r.subtype === 'ui_render' ? bridge.request(r, ms) : answering.bridge.request(r, ms)) });
    surface.setCapabilities(SURFACE);
    await vi.waitFor(() => expect(surface.state.attached).toBe(true));
    const render = surface.render({ sessionId: 'sess-1', component: 'Pane', instanceId: 'agents', props: {} });
    const caught = render.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await caught).toMatchObject({ code: 'MOD_TIMEOUT' });
  });

  it('hands back the response of a control request', async () => {
    const query = { setUiHost() {}, request: async () => ({ subtype: 'success', response: { handled: true } }) } as unknown as Query;
    expect(await modsBridge(query)!.request({ subtype: 'ui_press' }, 1000)).toEqual({ handled: true });
  });
});

/** Just enough of a Claude Code process: an init message with capabilities, and the mods calls. */
class ModsQuery {
  readonly calls: string[] = [];
  private wake: (() => void) | undefined;
  private queue: unknown[] = [];
  constructor(private readonly capabilities: string[]) {
    this.queue.push({ type: 'system', subtype: 'init', session_id: 'sess-1', cwd: '/tmp', model: 'm', permissionMode: 'default', capabilities });
  }
  push(message: unknown) {
    this.queue.push(message);
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.queue.length) yield this.queue.shift();
      await new Promise<void>((r) => (this.wake = r));
    }
  }
  setUiHost(host: unknown) {
    this.calls.push(host ? 'setUiHost' : 'clearUiHost');
  }
  async request(request: { subtype: string }) {
    this.calls.push(request.subtype);
    return { subtype: 'success', response: request.subtype === 'ui_panes' ? { panes: [] } : {} };
  }
  async initializationResult() {
    return { capabilities: this.capabilities };
  }
  async supportedCommands() {
    return [];
  }
  async supportedModels() {
    return [];
  }
  async getContextUsage() {
    throw new Error('no');
  }
  close() {}
  async interrupt() {}
}

function hostWith(query: ModsQuery, showMods: boolean) {
  const { events: mods, seen } = recorder();
  const events: HostEvents = { info: () => {}, stream: () => {}, messages: () => {}, log: () => {}, mods };
  const config: HostConfig = {
    sessionId: 'sess-1',
    cwd: '/tmp',
    profileId: 'p',
    mode: 'new',
    model: null,
    permissionMode: 'default',
    effort: null,
    worktree: null,
    env: {},
    claudePath: undefined,
    canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
    showMods,
  };
  const host = new SessionHost(config, events, (_args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => query as unknown as Query);
  host.start();
  return { host, seen };
}

describe('SessionHost mods', () => {
  it('attaches when Claude Code reports ui_surface_v1, and keeps mods messages out of the transcript', async () => {
    const query = new ModsQuery(['ui_surface_v1']);
    const { host, seen } = hostWith(query, true);
    await vi.waitFor(() => expect(host.mods.state.attached).toBe(true));
    expect(query.calls.slice(0, 2)).toEqual(['setUiHost', 'ui_attach']);
    query.push({ type: 'system', subtype: 'ui_status', plugin: 'pr-status', text: 'PR #142', session_id: 'sess-1' });
    await vi.waitFor(() => expect(seen.statuses.at(-1)).toEqual([{ plugin: 'pr-status', text: 'PR #142' }]));
    host.close();
  });

  it('with Show mods off, never calls setUiHost or ui_attach', async () => {
    const query = new ModsQuery(['ui_surface_v1']);
    const { host } = hostWith(query, false);
    await host.initialized;
    await host.mods.idle();
    expect(query.calls).toEqual([]);
    host.mods.setEnabled(true);
    await vi.waitFor(() => expect(host.mods.state.attached).toBe(true));
    host.close();
  });

  it('a Claude Code without mods works as before', async () => {
    const query = new ModsQuery([]);
    const { host } = hostWith(query, true);
    await host.initialized;
    await host.mods.idle();
    expect(query.calls).toEqual([]);
    expect(host.info.state).toBe('idle');
    host.close();
  });
});

describe('modsCatalog', () => {
  it('lists plugin folders whose hooks.json names a module, per profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-mods-'));
    try {
      const plugin = (name: string, hooks: unknown) => {
        const dir = join(root, name);
        mkdirSync(join(dir, 'hooks'), { recursive: true });
        mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
        writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify(hooks));
        writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
        return dir;
      };
      const watch = plugin('agent-watch', { modules: ['./register.js'] });
      const plain = plugin('plain', { hooks: {} });
      const market = plugin('pr-status', { modules: ['./index.js'] });
      const config = join(root, 'config');
      mkdirSync(join(config, 'plugins'), { recursive: true });
      writeFileSync(join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'pr-status@market': true, 'off@market': false } }));
      writeFileSync(join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'pr-status@market': [{ installPath: market }] } }));
      expect(isModFolder(plain)).toBe(false);
      const mods = listMods([{ profileId: 'p', configDir: config, env: { CLAUDE_CODE_PLUGIN_DIRS: [watch, plain].join(delimiter) } }], join(root, 'missing.json'));
      expect(mods).toEqual([
        { name: 'agent-watch', profileId: 'p', source: 'dir', path: watch },
        { name: 'pr-status', profileId: 'p', source: 'marketplace', path: market },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('splits plugin folders on the platform separator and expands ~', () => {
    expect(pluginDirs('~/mods/a:/b', '/home/me', ':')).toEqual([join('/home/me', 'mods/a'), '/b']);
    expect(pluginDirs('C:\\mods\\a;~\\b', 'C:\\Users\\me', ';')).toHaveLength(2);
  });
});

describe('hookedCacheKey', () => {
  it('changes when the plugins or managed settings change', async () => {
    const { hookedCacheKey } = await import('./modsCatalog.ts');
    const root = mkdtempSync(join(tmpdir(), 'sb-hooked-'));
    try {
      const config = join(root, 'config');
      mkdirSync(config, { recursive: true });
      const managed = join(root, 'managed.json');
      const profile = { profileId: 'p', configDir: config, env: {} };
      writeFileSync(join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'a@m': true } }));
      const first = hookedCacheKey(profile, managed);
      expect(hookedCacheKey(profile, managed)).toBe(first);
      writeFileSync(join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'a@m': true, 'b@m': true } }));
      const second = hookedCacheKey(profile, managed);
      expect(second).not.toBe(first);
      expect(hookedCacheKey({ ...profile, env: { CLAUDE_CODE_PLUGIN_DIRS: '/mods' } }, managed)).not.toBe(second);
      writeFileSync(managed, JSON.stringify({ enabledPlugins: {} }));
      expect(hookedCacheKey(profile, managed)).not.toBe(second);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
