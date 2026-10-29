import { randomUUID } from 'node:crypto';
import {
  ABOVE_PROMPT_INSTANCE,
  HOOKABLE_COMPONENTS,
  MOD_CAPABILITY,
  MOD_LIMITS,
  RpcError,
  type HookableComponent,
  type LogLevel,
  type ModFocusParams,
  type ModFocusResult,
  type ModInputParams,
  type ModInstance,
  type ModLog,
  type ModPane,
  type ModPaneRoster,
  type ModPressParams,
  type ModPromptAsk,
  type ModRenderParams,
  type ModRenderResult,
  type ModScrollParams,
  type ModScrollResult,
  type ModSelectParams,
  type ModSite,
  type ModsSnapshot,
  type ModsSurfaceState,
  type ModStatus,
  type ModToast,
} from '@seshboard/protocol';
import { isUnsupported, ModsTimeout, UI_HOST_ANSWERS, type ModsBridge, type UiHost } from './modsBridge.ts';

/** What a session's mods tell the windows (each becomes a `mods.*` event). */
export interface ModsEvents {
  state(state: ModsSurfaceState): void;
  toast(toast: ModToast): void;
  statuses(sessionId: string, statuses: ModStatus[]): void;
  log(entry: ModLog): void;
  invalidate(sessionId: string, instances: ModInstance[] | null): void;
  panes(sessionId: string, roster: ModPaneRoster): void;
  scroll(event: { sessionId: string; component: ModSite; instanceId: string; offset: number; followEnd: boolean }): void;
  focus(event: { sessionId: string; component: ModSite; instanceId: string; plugin: string; key: string }): void;
  /** Asks the window showing the session; resolves with its answer, or null when no window answered. */
  ask(ask: ModPromptAsk): Promise<{ text?: string; cursor?: number; done?: boolean } | null>;
  diagnostics(level: LogLevel, message: string): void;
}

/** Seshboard draws mods as Claude Code's `desktop` surface does: a remote surface drawn as HTML. */
export const MODS_SURFACE = 'desktop';

/** Requests whose schema has no `surface` (the client id says it). */
const NO_SURFACE = new Set(['ui_panes', 'ui_close', 'ui_detach']);
const EMPTY_ROSTER: ModPaneRoster = { panes: [], shownId: null, focusedId: null, focusRequestedId: null };
const HOOKABLE = new Set<string>(HOOKABLE_COMPONENTS);

/** The surface state Claude Code's capabilities describe (before attaching). */
export function readModCapabilities(capabilities: readonly string[]): { supported: boolean; hooked: HookableComponent[]; promptsScreened: boolean } {
  const prefix = `${MOD_CAPABILITY.hooked}:`;
  return {
    supported: capabilities.includes(MOD_CAPABILITY.surface),
    hooked: capabilities.includes(MOD_CAPABILITY.hooked)
      ? capabilities.flatMap((c) => (c.startsWith(prefix) && HOOKABLE.has(c.slice(prefix.length)) ? [c.slice(prefix.length) as HookableComponent] : []))
      : [],
    promptsScreened: capabilities.includes(MOD_CAPABILITY.promptsScreened),
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** A pane as Claude Code lists it, or null when it isn't one. */
export function toPane(raw: unknown): ModPane | null {
  const p = raw as Record<string, unknown> | null;
  const id = str(p?.id);
  if (!p || !id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return {
    id,
    plugin: str(p.plugin) ?? '',
    title: str(p.title) || id,
    closeOnEscape: p.close_on_escape === true,
    holdToasts: p.hold_toasts === true,
    rows: int(p.rows),
    columns: int(p.columns),
  };
}

export function toRoster(raw: Record<string, unknown>): ModPaneRoster {
  return {
    panes: Array.isArray(raw.panes) ? raw.panes.flatMap((p) => toPane(p) ?? []) : [],
    shownId: str(raw.shown_id),
    focusedId: str(raw.focused_id),
    focusRequestedId: str(raw.focus_requested_id),
  };
}

/**
 * One session's mods surface. It attaches when Claude Code reports `ui_surface_v1` and Show mods is on, relays the
 * window's requests, and keeps what the mods' system messages say (toasts, statuses, panes) for windows that open the
 * session later. It never reads or runs a mod's files: Claude Code does.
 */
export class ModsSurface {
  private bridge: ModsBridge | null = null;
  private enabled: boolean;
  private supported = false;
  private hooked: HookableComponent[] = [];
  private promptsScreened = false;
  private attached = false;
  /** The attach or detach under way, so they never overlap. */
  private busy: Promise<void> = Promise.resolve();
  private readonly plugins: string[] = [];
  private readonly statuses = new Map<string, string>();
  private toasts: ModToast[] = [];
  private roster: ModPaneRoster = EMPTY_ROSTER;
  private readonly logs: ModLog[] = [];
  private closed = false;

  constructor(
    private readonly sessionId: () => string,
    private readonly events: ModsEvents,
    enabled: boolean,
  ) {
    this.enabled = enabled;
  }

  /** The client id this window attaches under (Claude Code allows 64 letters, digits, `.`, `_` and `-`). */
  get clientId(): string {
    return `switchboard-${this.sessionId()}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  }

  get state(): ModsSurfaceState {
    return {
      sessionId: this.sessionId(),
      supported: this.supported,
      attached: this.attached,
      hooked: [...this.hooked],
      promptsScreened: this.promptsScreened,
      plugins: [...this.plugins],
    };
  }

  snapshot(): ModsSnapshot {
    return {
      state: this.state,
      statuses: [...this.statuses].map(([plugin, text]) => ({ plugin, text })),
      toasts: [...this.toasts],
      panes: this.roster,
    };
  }

  /** Resolves once an attach or detach under way has finished. */
  idle(): Promise<void> {
    return this.busy;
  }

  logLines(): ModLog[] {
    return [...this.logs];
  }

  /** The process is up: its SDK calls (null when this SDK has none, so mods never attach). */
  setBridge(bridge: ModsBridge | null): void {
    this.bridge = bridge;
    this.reconcile();
  }

  /** Claude Code's capabilities, from its initialize result or a turn's init message. */
  setCapabilities(capabilities: readonly string[]): void {
    const next = readModCapabilities(capabilities);
    const changed =
      next.supported !== this.supported || next.promptsScreened !== this.promptsScreened || next.hooked.join() !== this.hooked.join();
    const lost = this.supported && !next.supported;
    this.supported = next.supported;
    this.hooked = next.hooked;
    this.promptsScreened = next.promptsScreened;
    if (lost) this.clear();
    if (changed) this.publishState();
    this.reconcile();
  }

  /** Show mods turned on or off: attach or detach, without a restart. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.reconcile();
  }

  /** The process ended: nothing is attached any more. */
  close(): void {
    this.closed = true;
    this.bridge = null;
    const was = this.attached;
    this.attached = false;
    this.clear();
    if (was) this.publishState();
  }

  private reconcile(): void {
    this.busy = this.busy.then(() => this.step()).catch((error: unknown) => this.events.diagnostics('warn', `Mods: ${(error as Error).message}`));
  }

  private async step(): Promise<void> {
    if (this.closed) return;
    const want = this.enabled && this.supported && this.bridge !== null;
    if (want && !this.attached) await this.attach();
    else if (!want && this.attached) await this.detach();
  }

  private async attach(): Promise<void> {
    const bridge = this.bridge!;
    // The answers go in first, so a request Claude Code sends right after the attach finds them.
    bridge.setUiHost(this.uiHost());
    try {
      await bridge.request({ subtype: 'ui_attach', surface: MODS_SURFACE, client_id: this.clientId, answers: [...UI_HOST_ANSWERS] }, MOD_LIMITS.requestMs);
    } catch (error) {
      bridge.setUiHost(null);
      if (isUnsupported(error)) return this.unsupported();
      throw error;
    }
    if (this.closed) return;
    this.attached = true;
    this.publishState();
    // A pane opened before the attach pushes nothing: read the roster once.
    try {
      this.setRoster(toRoster(await bridge.request({ subtype: 'ui_panes', client_id: this.clientId }, MOD_LIMITS.requestMs)));
    } catch (error) {
      this.events.diagnostics('debug', `Mods: reading panes failed: ${(error as Error).message}`);
    }
  }

  private async detach(): Promise<void> {
    const bridge = this.bridge;
    this.attached = false;
    // Statuses and panes stay: they are the session's, and show again when Show mods comes back on. Toasts don't.
    this.toasts = [];
    this.publishState();
    if (!bridge) return;
    bridge.setUiHost(null);
    try {
      await bridge.request({ subtype: 'ui_detach', client_id: this.clientId }, MOD_LIMITS.requestMs);
    } catch (error) {
      this.events.diagnostics('debug', `Mods: detach failed: ${(error as Error).message}`);
    }
  }

  /** Claude Code doesn't know the requests after all: no mods in this session, quietly. */
  private unsupported(): void {
    this.events.diagnostics('debug', `Mods: session ${this.sessionId()} doesn't support mods`);
    this.supported = false;
    this.attached = false;
    this.bridge?.setUiHost(null);
    this.clear();
    this.publishState();
  }

  /** Drops what the mods showed: statuses, toasts and panes. */
  private clear(): void {
    const hadStatuses = this.statuses.size > 0;
    const hadPanes = this.roster.panes.length > 0;
    this.statuses.clear();
    this.toasts = [];
    this.roster = EMPTY_ROSTER;
    if (hadStatuses) this.events.statuses(this.sessionId(), []);
    if (hadPanes) this.events.panes(this.sessionId(), EMPTY_ROSTER);
  }

  private publishState(): void {
    this.events.state(this.state);
  }

  private seen(plugin: string): void {
    if (!plugin || this.plugins.includes(plugin)) return;
    this.plugins.push(plugin);
    this.publishState();
  }

  private setRoster(roster: ModPaneRoster): void {
    this.roster = roster;
    for (const pane of roster.panes) this.seen(pane.plugin);
    this.events.panes(this.sessionId(), roster);
  }

  private uiHost(): UiHost {
    type Body = ModPromptAsk extends infer A ? (A extends ModPromptAsk ? Omit<A, 'requestId' | 'sessionId'> : never) : never;
    const ask = async (body: Body) =>
      this.events.ask({ ...body, requestId: randomUUID(), sessionId: this.sessionId() } as ModPromptAsk);
    return {
      copy: async ({ plugin, text }) => ({ copied: (await ask({ kind: 'copy', plugin: plugin ?? '', text }))?.done === true }),
      promptRead: async () => {
        const answer = await ask({ kind: 'read' });
        const text = answer?.text ?? '';
        return { text, cursor: Math.min(answer?.cursor ?? text.length, text.length) };
      },
      promptFill: async ({ text, mode }) => ({ filled: (await ask({ kind: 'fill', text, mode }))?.done === true }),
      promptSuggest: async ({ text }) => ({ shown: (await ask({ kind: 'suggest', text }))?.done === true }),
    };
  }

  /**
   * A `system` message from Claude Code's stream. True when it was a mods message (handled here, never part of the
   * transcript). Statuses and panes are the session's state, kept whether or not this window is attached (Claude Code
   * sends them as the session starts, before the attach); the windows show them only while attached. Toasts, scrolls,
   * focus moves and invalidations need an attached surface.
   */
  handleSystem(message: { subtype?: unknown } & Record<string, unknown>): boolean {
    const subtype = str(message.subtype);
    if (!subtype?.startsWith('ui_')) return false;
    const sessionId = this.sessionId();
    const plugin = str(message.plugin) ?? '';
    if (subtype === 'ui_log') {
      // Logs go to diagnostics whatever the switch says: they explain a mod that misbehaves.
      const entry = { sessionId, plugin, text: str(message.text) ?? '', at: Date.now() };
      this.logs.push(entry);
      if (this.logs.length > MOD_LIMITS.logs) this.logs.splice(0, this.logs.length - MOD_LIMITS.logs);
      this.events.log(entry);
      return true;
    }
    if (subtype === 'ui_invalidate' && message.prompts_screened === true && !this.promptsScreened) {
      this.promptsScreened = true;
      this.publishState();
    }
    switch (subtype) {
      case 'ui_toast': {
        // News, not state: only an attached surface shows it.
        if (!this.attached) return true;
        const timeout = int(message.timeout_ms);
        const toast: ModToast = { id: randomUUID(), sessionId, plugin, text: str(message.text) ?? '', timeoutMs: timeout && timeout > 0 ? timeout : MOD_LIMITS.toastMs, at: Date.now() };
        this.seen(plugin);
        this.toasts = [...this.toasts, toast].slice(-MOD_LIMITS.toasts);
        this.events.toast(toast);
        return true;
      }
      case 'ui_status': {
        const text = str(message.text);
        if (text === null) {
          if (!this.statuses.delete(plugin)) return true;
        } else {
          this.seen(plugin);
          this.statuses.set(plugin, text);
        }
        this.events.statuses(sessionId, [...this.statuses].map(([p, t]) => ({ plugin: p, text: t })));
        return true;
      }
      case 'ui_invalidate': {
        if (!this.attached) return true;
        const instances = Array.isArray(message.instances)
          ? message.instances.flatMap((i) => {
              const raw = i as Record<string, unknown>;
              return str(raw.component) && str(raw.instance_id) ? [{ component: str(raw.component)!, instanceId: str(raw.instance_id)! }] : [];
            })
          : null;
        this.events.invalidate(sessionId, instances);
        return true;
      }
      case 'ui_panes':
        this.setRoster(toRoster(message));
        return true;
      case 'ui_scroll': {
        if (!this.attached) return true;
        const component = message.component === 'Pane' || message.component === 'AbovePrompt' ? message.component : null;
        if (!component || !this.mine(message)) return true;
        this.events.scroll({ sessionId, component, instanceId: str(message.instance_id) ?? ABOVE_PROMPT_INSTANCE, offset: int(message.offset) ?? 0, followEnd: message.follow_end === true });
        return true;
      }
      case 'ui_focus': {
        if (!this.attached) return true;
        const component = message.component === 'Pane' || message.component === 'AbovePrompt' ? message.component : null;
        if (!component || !this.mine(message)) return true;
        this.events.focus({ sessionId, component, instanceId: str(message.instance_id) ?? ABOVE_PROMPT_INSTANCE, plugin, key: str(message.key) ?? '' });
        return true;
      }
      default:
        return true;
    }
  }

  /** A scroll or focus push names the client it is for. */
  private mine(message: Record<string, unknown>): boolean {
    const client = str(message.client_id);
    return client === null || client === this.clientId;
  }

  /** Sends a request for the window. Fails with MODS_OFF when not attached, MOD_TIMEOUT after 30 s. */
  private async request(body: { subtype: string } & Record<string, unknown>): Promise<Record<string, unknown>> {
    const bridge = this.bridge;
    if (!bridge || !this.attached) throw new RpcError('MODS_OFF', 'Mods are off in this session.');
    try {
      const surface = NO_SURFACE.has(body.subtype) ? {} : { surface: MODS_SURFACE };
      return await bridge.request({ ...body, ...surface, client_id: this.clientId }, MOD_LIMITS.requestMs);
    } catch (error) {
      if (error instanceof ModsTimeout) throw new RpcError('MOD_TIMEOUT', `Claude Code didn't answer in ${MOD_LIMITS.requestMs / 1000}s.`);
      if (isUnsupported(error) && body.subtype === 'ui_render') {
        this.reconcileAfter(() => this.unsupported());
        throw new RpcError('MODS_OFF', 'This session doesn’t draw mods.');
      }
      throw error;
    }
  }

  private reconcileAfter(fn: () => void): void {
    this.busy = this.busy.then(fn);
  }

  async render(params: ModRenderParams): Promise<ModRenderResult> {
    const reply = await this.request({
      subtype: 'ui_render',
      component: params.component,
      instance_id: params.instanceId,
      props: params.props,
      ...(params.viewport ? { viewport: params.viewport } : {}),
      ...(params.contentRows !== undefined ? { content_rows: params.contentRows } : {}),
      ...(params.keyed ? { keyed: params.keyed } : {}),
    });
    const drawnBy = Array.isArray(reply.drawn_by) ? reply.drawn_by.filter((p): p is string => typeof p === 'string') : [];
    for (const plugin of drawnBy) this.seen(plugin);
    return {
      tree: reply.tree ?? { type: 'engine', ref: 0 },
      props: reply.props && typeof reply.props === 'object' ? (reply.props as Record<string, unknown>) : params.props,
      rewritten: reply.rewritten === true,
      hooked: reply.hooked !== false,
      drawnBy,
    };
  }

  async press(params: ModPressParams): Promise<{ handled: boolean }> {
    const reply = await this.request({
      subtype: 'ui_press',
      plugin: params.plugin,
      handle: params.handle,
      ...(params.key !== undefined ? { key: params.key } : {}),
      ...(params.href !== undefined ? { href: params.href } : {}),
    });
    return { handled: reply.handled === true };
  }

  async input(params: ModInputParams): Promise<{ handled: boolean }> {
    const reply = await this.request({
      subtype: 'ui_input',
      plugin: params.plugin,
      handle: params.handle,
      kind: params.kind,
      value: params.value,
      ...(params.key !== undefined ? { key: params.key } : {}),
      ...(params.component ? { component: params.component } : {}),
      ...(params.instanceId !== undefined ? { instance_id: params.instanceId } : {}),
    });
    return { handled: reply.handled === true };
  }

  async select(params: ModSelectParams): Promise<{ handled: boolean }> {
    const reply = await this.request({
      subtype: 'ui_select',
      plugin: params.plugin,
      handle: params.handle,
      value: params.value,
      ...(params.key !== undefined ? { key: params.key } : {}),
      ...(params.component ? { component: params.component } : {}),
      ...(params.instanceId !== undefined ? { instance_id: params.instanceId } : {}),
    });
    return { handled: reply.handled === true };
  }

  async scroll(params: ModScrollParams): Promise<ModScrollResult> {
    const reply = await this.request({
      subtype: 'ui_scroll',
      component: params.component,
      instance_id: params.instanceId,
      offset: params.offset,
      by: params.by,
      body_rows: params.bodyRows,
      content_rows: params.contentRows,
      ...(params.pointer ? { pointer: params.pointer } : {}),
      ...(params.keyed ? { keyed: params.keyed } : {}),
    });
    return { moved: reply.moved === true, offset: int(reply.offset) ?? params.offset, deny: str(reply.deny), followEnd: reply.follow_end === true };
  }

  async focus(params: ModFocusParams): Promise<ModFocusResult> {
    const reply = await this.request({
      subtype: 'ui_focus',
      component: params.component,
      instance_id: params.instanceId,
      is_held: params.isHeld,
      ...(params.element !== undefined ? { element: params.element } : {}),
      ...(params.by ? { by: params.by } : {}),
    });
    const element = reply.element as { plugin?: unknown; key?: unknown } | null | undefined;
    return {
      moved: reply.moved === true,
      element: element && typeof element.plugin === 'string' && typeof element.key === 'string' ? { plugin: element.plugin, key: element.key } : null,
      deny: str(reply.deny),
    };
  }

  async panes(): Promise<ModPaneRoster> {
    const roster = toRoster(await this.request({ subtype: 'ui_panes' }));
    this.setRoster(roster);
    return roster;
  }

  /** You picked a pane's tab, it took (or let go of) the keyboard, or you closed it. */
  async pane(action: 'show' | 'focus' | 'close', id: string | null): Promise<void> {
    if (action === 'show' && id) await this.request({ subtype: 'ui_pane_show', id });
    else if (action === 'focus') await this.request({ subtype: 'ui_pane_focus', id });
    else if (action === 'close' && id) await this.request({ subtype: 'ui_close', id });
  }
}
