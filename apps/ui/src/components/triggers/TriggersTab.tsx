import { Plus, ShieldCheck, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { loadRepoInfo, openTriggerEditor, useTriggers } from '../../state/triggersStore.ts';
import { Button } from '../ui/Button.tsx';
import { TriggerCard } from './TriggerCard.tsx';

/** The time it is, again every 30 seconds: "checked 2m ago" moves on. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * A project's Triggers tab: its triggers as cards, oldest first, with their events, and New trigger. Under the list,
 * the line that says what triggers never do. Without triggers, "No triggers yet".
 */
export function TriggersTab({ root }: { root: string }) {
  const now = useNow();
  const all = useTriggers((s) => s.triggers);
  const events = useTriggers((s) => s.events);
  const triggers = useMemo(() => all.filter((t) => t.projectRoot === root), [all, root]);
  const byTrigger = useMemo(() => {
    const map = new Map<string, typeof events>();
    for (const event of events) map.set(event.triggerId, [...(map.get(event.triggerId) ?? []), event]);
    return map;
  }, [events]);
  const create = () => openTriggerEditor({ root, trigger: null });
  // Who gh is signed in as, for the cards' `@login`.
  useEffect(() => {
    if (triggers.some((t) => t.source.kind === 'issues')) void loadRepoInfo(root).catch(() => {});
  }, [root, triggers]);

  return (
    <div className="grid gap-4" data-triggers-tab={root}>
      <div className="flex items-start gap-4">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="text-title font-semibold">Triggers</h2>
          <p className="text-ui text-muted">Start a session when something happens. Seshboard checks GitHub every 5 minutes through gh, on this computer only.</p>
        </div>
        <Button variant="primary" size="lg" icon={<Plus size={14} aria-hidden />} onClick={create} className="shrink-0" data-trigger-new>
          New trigger
        </Button>
      </div>
      {triggers.length === 0 ? (
        <div className="grid justify-items-center gap-1.5 rounded-xl border border-dashed border-edge px-6 py-10 text-center" data-triggers-empty>
          <Zap size={24} className="text-trigger" aria-hidden />
          <h3 className="mt-1 text-title font-semibold">No triggers yet</h3>
          <p className="max-w-md text-ui text-muted">Start a session when CI fails on a branch, or when an issue gets a label or is assigned to you.</p>
          <Button icon={<Plus size={13} aria-hidden />} onClick={create} className="mt-2">
            New trigger
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {triggers.map((trigger) => (
            <TriggerCard key={trigger.id} trigger={trigger} events={byTrigger.get(trigger.id) ?? []} now={now} />
          ))}
        </div>
      )}
      <p className="flex items-start gap-2 text-ui text-muted" data-triggers-shield>
        <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
        Triggered sessions never bypass permissions. Seshboard only writes state labels to GitHub, and only when they're on.
      </p>
    </div>
  );
}
