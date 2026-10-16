import { useEffect } from 'react';
import type { ModPromptAsk, ModToast, RpcClient } from '@switchboard/protocol/client';
import type { Contract } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { modComposer } from '../components/mods/modComposer.ts';
import { modShown } from '../components/mods/modVisibility.ts';
import { useHosts } from './hostsStore.ts';
import { useProfiles } from './profilesStore.ts';
import { useMods } from './modsStore.ts';
import { usePreferences } from './preferencesStore.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';

/** Toasts held while a pane with `hold_toasts` has the keyboard (by session); they show once it lets go. */
const held = new Map<string, ModToast[]>();
const holding = new Set<string>();

function showToast(t: ModToast): void {
  toast(t.text, { source: t.plugin, durationMs: t.timeoutMs, data: { 'data-mod-toast': t.plugin } });
}

/** A pane that holds toasts took (true) or let go of (false) the keyboard. */
export function holdModToasts(sessionId: string, hold: boolean): void {
  if (hold) {
    holding.add(sessionId);
    return;
  }
  holding.delete(sessionId);
  const waiting = held.get(sessionId) ?? [];
  held.delete(sessionId);
  for (const t of waiting) showToast(t);
}

function onToast(t: ModToast): void {
  useMods.getState().noteDraw(t.sessionId, t.plugin, 'toasts');
  const prefs = usePreferences.getState().prefs;
  const profileId = useHosts.getState().hosts.get(t.sessionId)?.profileId;
  if (!modShown(prefs, profileId, t.plugin)) return;
  // News about a session this window doesn't show belongs to the window that does.
  if (!useSessions.getState().paneIds.includes(t.sessionId)) return;
  if (holding.has(t.sessionId)) held.set(t.sessionId, [...(held.get(t.sessionId) ?? []), t].slice(-20));
  else showToast(t);
}

/** Answers Claude Code's question about a session's message box, when this window shows that box. */
async function answer(client: RpcClient<Contract>, ask: ModPromptAsk): Promise<void> {
  if (ask.kind === 'copy') {
    // Only one window writes the clipboard: the one showing the session.
    if (!useSessions.getState().paneIds.includes(ask.sessionId)) return;
    const done = await navigator.clipboard.writeText(ask.text).then(
      () => true,
      () => false,
    );
    await client.call('mods.promptAnswer', { requestId: ask.requestId, done });
    return;
  }
  const box = modComposer(ask.sessionId);
  if (!box) return;
  if (ask.kind === 'read') {
    const { text, cursor } = box.read();
    await client.call('mods.promptAnswer', { requestId: ask.requestId, text, cursor });
  } else if (ask.kind === 'fill') {
    await client.call('mods.promptAnswer', { requestId: ask.requestId, done: box.fill(ask.text, ask.mode) });
  } else {
    await client.call('mods.promptAnswer', { requestId: ask.requestId, done: box.suggest(ask.text) });
  }
}

/** Follows every session's mods: attached or not, statuses, panes, invalidations, toasts and Claude Code's questions. */
export function useModsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const store = () => useMods.getState();
    const offs = [
      client.on('mods.state', (state) => store().setState(state)),
      client.on('mods.statuses', ({ sessionId, statuses }) => store().setStatuses(sessionId, statuses)),
      client.on('mods.panes', ({ sessionId, roster }) => store().setPanes(sessionId, roster)),
      client.on('mods.invalidate', ({ sessionId, instances }) => store().invalidate(sessionId, instances)),
      client.on('mods.toast', onToast),
      client.on('mods.promptAsk', (ask) => void answer(client, ask).catch(() => {})),
    ];
    void client.call('mods.snapshot', {}).then(({ sessions }) => store().replace(sessions), () => {});
    return () => offs.forEach((off) => off());
  }, [client]);
  // What mods replaced last time in each profile, so a session that is starting doesn't flash the built-in views.
  const profileIds = useProfiles((s) => s.profiles.map((p) => p.id).join('\n'));
  useEffect(() => {
    if (!client) return;
    for (const profileId of profileIds ? profileIds.split('\n') : []) {
      void client.call('mods.hooked', { profileId }).then(({ hooked }) => useMods.getState().setExpected(profileId, hooked), () => {});
    }
  }, [client, profileIds]);
}
