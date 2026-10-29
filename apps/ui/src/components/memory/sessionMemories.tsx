import { Brain } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MemoryHit } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { openMemoryFile } from '../../state/memoryStore.ts';
import type { MenuEntry } from '../Menu.tsx';

/** At most this many of a session's memories are listed in its menu. */
const LISTED = 6;

/**
 * "Memories from this session (N)" for a session's menu: a heading and the memories it wrote, each opening in its editor.
 * Nothing when it wrote none.
 */
export function sessionMemoryEntries(memories: readonly MemoryHit[]): MenuEntry[] {
  if (memories.length === 0) return [];
  return [
    { heading: `Memories from this session (${memories.length})` },
    ...memories.slice(0, LISTED).map(
      (m): MenuEntry => ({ label: m.name, hint: m.type ?? undefined, icon: <Brain size={13} aria-hidden />, onSelect: () => openMemoryFile(m.root, m.path), data: { 'data-session-memory': m.path } }),
    ),
    'separator',
  ];
}

/** "Memories" for a session's menu in the sidebar: the same list in a submenu. Null when it wrote none. */
export function sessionMemorySubmenu(memories: readonly MemoryHit[]): MenuEntry | null {
  const [heading, ...items] = sessionMemoryEntries(memories).slice(0, -1);
  if (!heading) return null;
  return { label: 'Memories', hint: String(memories.length), submenu: [heading, ...items], data: { 'data-session-memories-menu': true } };
}

/** The memories a session wrote, read while `enabled` (its menu is open). */
export function useSessionMemories(sessionId: string | null, enabled: boolean): MemoryHit[] {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [memories, setMemories] = useState<MemoryHit[]>([]);
  useEffect(() => {
    if (!client || !sessionId || !enabled) return;
    let cancelled = false;
    void client.call('memory.bySession', { sessionId }).then((r) => !cancelled && setMemories(r.memories), () => {});
    return () => {
      cancelled = true;
    };
  }, [client, sessionId, enabled]);
  return memories;
}
