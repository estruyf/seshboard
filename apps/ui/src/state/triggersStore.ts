import { useEffect } from 'react';
import { create } from 'zustand';
import type { Trigger, TriggerEvent, TriggerRepoInfo, TriggerSave, TriggerSession } from '@switchboard/protocol/client';
import { engineConnection } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { openProject } from './projectPageStore.ts';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';
import { checkedNowLine, type TriggerForm } from './triggers.ts';

// Event triggers (#180). The engine keeps and checks them; every window shows the same list.

/**
 * What the editor opens on: a project, a trigger to change, or New session's prompt and choices (Start when…), with the
 * pipeline picked in Run as.
 */
export interface TriggerEditorRequest {
  root: string;
  trigger: Trigger | null;
  from?: Partial<Pick<TriggerForm, 'prompt' | 'profileId' | 'model' | 'effort' | 'permissionMode' | 'workspace' | 'baseRef' | 'start' | 'pipelineId'>>;
  /** Saved: what the opener does next (New session empties its box). */
  onSaved?(trigger: Trigger): void;
}

interface TriggersState {
  triggers: Trigger[];
  events: TriggerEvent[];
  /** The trigger each session came from, for the bolt on its row and the line in its header. */
  bySession: Map<string, TriggerSession>;
  loaded: boolean;
  /** The editor, open on this. */
  editor: TriggerEditorRequest | null;
  /** What each project's repository is, for the editor, read once per window. */
  repoInfo: Map<string, TriggerRepoInfo>;
  /** Triggers this window is checking now (Check now), for the button's state. */
  checking: ReadonlySet<string>;
  replace(state: { triggers: Trigger[]; events: TriggerEvent[]; sessions: TriggerSession[] }): void;
}

export const useTriggers = create<TriggersState>()((set) => ({
  triggers: [],
  events: [],
  bySession: new Map(),
  loaded: false,
  editor: null,
  repoInfo: new Map(),
  checking: new Set(),
  replace: ({ triggers, events, sessions }) => set({ triggers, events, bySession: new Map(sessions.map((s) => [s.sessionId, s])), loaded: true }),
}));

/** Loads the triggers once per connection and follows changes from every window and every check. */
export function useTriggersSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('triggers.changed', (state) => useTriggers.getState().replace(state));
    void client.call('triggers.list', {}).then((state) => useTriggers.getState().replace(state), () => {});
    return off;
  }, [client]);
}

const clientNow = () => {
  const state = engineConnection.getSnapshot();
  if (state.status !== 'connected') throw new Error('Not connected to the engine');
  return state.client;
};

/** Opens the editor: New trigger on a project, Edit… on a trigger, or Start when… with New session's prompt. */
export function openTriggerEditor(request: TriggerEditorRequest): void {
  useTriggers.setState({ editor: request });
}

export function closeTriggerEditor(): void {
  useTriggers.setState({ editor: null });
}

/** A project's Triggers tab (the project's ⋯ menu, a notification). */
export function openTriggersTab(root: string): void {
  openProject(root, 'triggers');
}

/** What the editor shows about a project's repository; read again after a minute, or when `fresh`. */
export async function loadRepoInfo(root: string, fresh = false): Promise<TriggerRepoInfo> {
  const kept = useTriggers.getState().repoInfo.get(root);
  if (kept && !fresh) return kept;
  const info = await clientNow().call('triggers.repoInfo', { root });
  useTriggers.setState((s) => ({ repoInfo: new Map(s.repoInfo).set(root, info) }));
  return info;
}

/** Creates or changes a trigger. A new one says what its first check does. */
export async function saveTrigger(trigger: TriggerSave): Promise<Trigger> {
  const { trigger: saved } = await clientNow().call('triggers.save', { trigger });
  // A folder that wasn't a project became one, for its Triggers tab.
  if (!trigger.id && !useProjects.getState().listed.some((p) => p.root === saved.projectRoot)) useProjects.getState().reload();
  return saved;
}

/** Deletes without asking; Undo puts it back with its events. */
export async function deleteTrigger(trigger: Trigger): Promise<void> {
  const client = clientNow();
  const { events } = await client.call('triggers.delete', { id: trigger.id });
  toast(`Deleted ${trigger.name}`, { undo: () => void client.call('triggers.restore', { trigger, events }).catch(() => {}), data: { 'data-trigger-deleted-toast': true } });
}

export async function setTriggerPaused(trigger: Pick<Trigger, 'id'>, paused: boolean): Promise<void> {
  await clientNow().call('triggers.setPaused', { id: trigger.id, paused });
}

/** Checks a trigger now, and says in a toast what the check found (the card shows the events). */
export async function checkTriggerNow(trigger: Pick<Trigger, 'id' | 'name'>): Promise<void> {
  if (useTriggers.getState().checking.has(trigger.id)) return;
  const mark = (on: boolean) =>
    useTriggers.setState((s) => {
      const checking = new Set(s.checking);
      if (on) checking.add(trigger.id);
      else checking.delete(trigger.id);
      return { checking };
    });
  mark(true);
  try {
    const { trigger: after, found } = await clientNow().call('triggers.checkNow', { id: trigger.id });
    const line = checkedNowLine(after, typeof found === 'number' ? found : null, Date.now());
    toast(line.text, { tone: line.ok ? 'ok' : undefined, data: { 'data-trigger-checked-toast': true } });
  } catch (error) {
    toast(`Couldn't check ${trigger.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    mark(false);
  }
}

/** Start now (waiting) or Start anyway (skipped): a session that started opens. */
export async function startTriggerEvent(event: Pick<TriggerEvent, 'id'>): Promise<void> {
  try {
    const { event: after } = await clientNow().call('triggers.startEvent', { eventId: event.id });
    if (after?.status === 'started' && after.sessionId) useSessions.getState().select(after.sessionId);
    else if (after?.status === 'queued') toast(`It's in the queue: ${after.reason ?? 'a limit holds it'}.`);
    else if (after?.status === 'skipped') toast(`It didn't start: ${after.reason ?? 'unknown reason'}.`);
  } catch (error) {
    toast(`Couldn't start it: ${error instanceof Error ? error.message : String(error)}`);
  }
}
