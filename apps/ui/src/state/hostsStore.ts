import { create } from 'zustand';
import { HOST_TO_LIVE } from '@switchboard/protocol/client';
import type {
  EditorInfo,
  LiveSession,
  ModelOption,
  PermissionRequest,
  SessionHostInfo,
  StreamDelta,
} from '@switchboard/protocol/client';
import type { Wait } from '../components/transcript/turns.ts';

export interface StreamingBlock {
  kind: 'text' | 'thinking' | 'tool';
  text: string;
}

interface HostsState {
  hosts: Map<string, SessionHostInfo>;
  /** The engine has listed its hosts (once per connection). */
  loaded: boolean;
  /** Open permission prompts, oldest first. */
  permissions: Map<string, PermissionRequest>;
  /**
   * Permission prompts answered while this window was open, per session: when each asked and when it was answered,
   * for the time a turn waited on you. Kept in memory only; a turn without a record shows no waiting.
   */
  waits: Map<string, readonly Wait[]>;
  /** The block Claude is writing right now, per session. */
  streaming: Map<string, StreamingBlock>;
  models: ModelOption[];
  editors: EditorInfo[];
  defaultEditorId: string | null;
  /** Goes up when skills were reloaded, so views that show slash commands ask for them again. */
  commandsVersion: number;

  reset(hosts: SessionHostInfo[], permissions: PermissionRequest[]): void;
  upsertHost(info: SessionHostInfo): void;
  applyStream(delta: StreamDelta): void;
  addPermission(request: PermissionRequest): void;
  removePermission(requestId: string): void;
  setModels(models: ModelOption[]): void;
  setEditors(editors: EditorInfo[], defaultId: string | null): void;
  bumpCommands(): void;
}

/** The most answered prompts kept per session: enough for its recent turns. */
const MAX_WAITS = 200;

export const useHosts = create<HostsState>()((set) => ({
  hosts: new Map(),
  loaded: false,
  permissions: new Map(),
  waits: new Map(),
  streaming: new Map(),
  models: [],
  editors: [],
  defaultEditorId: null,
  commandsVersion: 0,

  reset: (hosts, permissions) =>
    set({
      hosts: new Map(hosts.map((h) => [h.sessionId, h])),
      loaded: true,
      permissions: new Map(permissions.map((p) => [p.requestId, p])),
      streaming: new Map(),
    }),
  upsertHost: (info) =>
    set((state) => {
      const hosts = new Map(state.hosts).set(info.sessionId, info);
      if (info.state === 'idle' || info.state === 'closed' || info.state === 'error') {
        const streaming = new Map(state.streaming);
        streaming.delete(info.sessionId);
        return { hosts, streaming };
      }
      return { hosts };
    }),
  applyStream: (delta) =>
    set((state) => {
      const streaming = new Map(state.streaming);
      const current = streaming.get(delta.sessionId);
      if (delta.kind === 'clear') streaming.delete(delta.sessionId);
      else if (delta.kind === 'tool') streaming.set(delta.sessionId, { kind: 'tool', text: delta.text });
      else if (current?.kind === delta.kind) streaming.set(delta.sessionId, { kind: delta.kind, text: current.text + delta.text });
      else streaming.set(delta.sessionId, { kind: delta.kind, text: delta.text });
      return { streaming };
    }),
  addPermission: (request) => set((state) => ({ permissions: new Map(state.permissions).set(request.requestId, request) })),
  removePermission: (requestId) =>
    set((state) => {
      const request = state.permissions.get(requestId);
      const permissions = new Map(state.permissions);
      permissions.delete(requestId);
      if (!request) return { permissions };
      const wait: Wait = { toolUseId: request.toolUseId, from: request.createdAt, to: Date.now() };
      const waits = new Map(state.waits).set(request.sessionId, [...(state.waits.get(request.sessionId) ?? []), wait].slice(-MAX_WAITS));
      return { permissions, waits };
    }),
  setModels: (models) => set({ models }),
  setEditors: (editors, defaultEditorId) => set({ editors, defaultEditorId }),
  bumpCommands: () => set((state) => ({ commandsVersion: state.commandsVersion + 1 })),
}));

// How a host's state reads as a status dot, and whether it is still going: shared with the engine's focus count.
export { HOST_TO_LIVE, isActiveHost } from '@switchboard/protocol/client';

/** Shapes a running host like a registry entry, so the sidebar and dots treat both the same. */
export function hostAsLive(host: SessionHostInfo): LiveSession | null {
  const status = HOST_TO_LIVE[host.state];
  if (!status) return null;
  return {
    sessionId: host.sessionId,
    pid: 0,
    cwd: host.cwd,
    projectRoot: host.cwd.replace(/\/\.claude\/worktrees\/[^/]+.*$/, ''),
    status,
    rawStatus: host.state,
    name: null,
    origin: 'app',
    startedAt: host.startedAt,
    // When you last sent it a message, not `Date.now()`: the Working list orders by this, and a time
    // that moved with every update would make sessions trade places. Later activity comes from the transcript.
    updatedAt: host.promptedAt ?? host.startedAt,
    profileId: host.profileId,
    background: host.backgroundTasks.map((t) => t.description),
  };
}
