import { useEffect, useMemo, useState } from 'react';
import type { ExportCandidate } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { copiedByDefault } from './importView.ts';
import { typeTone } from './memoryUi.ts';


/**
 * Copy for Claude app: pick memories and copy them as one plain-text block, to paste in the app's memory import. The
 * Claude app has no API, so this is the way in.
 */
export function CopyForAppDialog({ onClose }: { onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [memories, setMemories] = useState<ExportCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    void client.call('memory.exportCandidates', {}).then(
      ({ memories: list }) => (setMemories(list), setPicked(new Set(list.filter(copiedByDefault).map((m) => m.path)))),
      (e: Error) => setError(e.message),
    );
  }, [client]);
  const groups = useMemo(() => {
    const by = new Map<string, ExportCandidate[]>();
    for (const m of memories ?? []) by.set(m.where, [...(by.get(m.where) ?? []), m]);
    return [...by];
  }, [memories]);

  const copy = async () => {
    if (!client || picked.size === 0) return;
    try {
      const { text } = await client.call('memory.exportText', { paths: [...picked] });
      await navigator.clipboard.writeText(text);
      onClose();
      toast(`Copied ${picked.size} ${picked.size === 1 ? 'memory' : 'memories'}`, { body: "Paste it in the Claude app's memory import (Settings › Memory)." });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const toggle = (path: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });

  return (
    <Dialog
      title="Copy for the Claude app"
      subtitle="One plain-text block of the memories you tick, to paste in the app's memory import. About you and how you work are ticked."
      width="md"
      placement="top"
      onClose={onClose}
      onSubmit={() => void copy()}
      data-memory-copy-app
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={picked.size === 0} onClick={() => void copy()} data-memory-copy-app-confirm>
            Copy {picked.size}
          </Button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!memories && !error && <p className="text-ui text-muted">Reading…</p>}
      {memories?.length === 0 && <p className="text-ui text-muted">There is no memory to copy yet.</p>}
      <div className="grid gap-3">
        {groups.map(([where, list]) => (
          <section key={where} className="grid gap-1">
            <SectionHeader count={list.length}>{where}</SectionHeader>
            {list.map((m) => (
              <Checkbox key={m.path} checked={picked.has(m.path)} onChange={(on) => toggle(m.path, on)} className="py-0.5" dataAttrs={{ 'data-memory-copy-app-item': m.path }}>
                <span className="flex min-w-0 items-center gap-2 text-ui">
                  <span className="truncate font-semibold">{m.name}</span>
                  {m.type && <Pill tone={typeTone(m.type)}>{m.type}</Pill>}
                  {m.description && <span className="truncate text-muted">{m.description}</span>}
                </span>
              </Checkbox>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
