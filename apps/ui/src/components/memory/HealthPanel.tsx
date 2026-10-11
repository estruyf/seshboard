import { AlertTriangle, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { memoryMeta, splitFrontmatter, type HealthFinding } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { openMemoryFile } from '../../state/memoryStore.ts';
import { useLinks } from '../../state/linksStore.ts';
import { toast } from '../../state/toastStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { DiffRows } from './DiffRows.tsx';
import { findingTone, mergedBody, tidyPrompt } from './healthView.ts';
import { useMemoryFile } from './useMemoryList.ts';

const TONE = { error: 'text-error', caution: 'text-caution', faint: 'text-faint' } as const;

/** Health of a project's memory and the personal folder, read in the background and again a moment after changes. */
export function useMemoryHealth(root: string | null): HealthFinding[] | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [findings, setFindings] = useState<HealthFinding[] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.call('memory.health', { root }).then((r) => !cancelled && setFindings(r.findings), () => {});
    return () => {
      cancelled = true;
    };
  }, [client, root, version]);
  useEffect(() => {
    if (!client) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = client.on('memory.changed', (change) => {
      if (change.root !== root && change.root !== null) return;
      clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 600);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [client, root]);
  return findings;
}

const nameOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '');

/** Two memories side by side, read-only, with Keep left, Keep right and Merge into left…, each confirmed and undoable. */
function CompareDialog({ root, left, right, onClose }: { root: string | null; left: string; right: string; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const a = useMemoryFile(root, left, 0);
  const b = useMemoryFile(root, right, 0);
  const [confirm, setConfirm] = useState<'left' | 'right' | 'merge' | null>(null);
  const body = (text: string | null) => (text === null ? '' : splitFrontmatter(text).body);
  const restore = (token: string) => () => void client?.call('memory.restore', { undoToken: token }).catch((e: Error) => toast(`Couldn't undo: ${e.message}`));

  const keep = async (side: 'left' | 'right') => {
    if (!client) throw new Error('Not connected to the engine');
    const gone = side === 'left' ? right : left;
    const { undoToken } = await client.call('memory.remove', { root, path: gone });
    onClose();
    toast(`Kept ${nameOf(side === 'left' ? left : right)}; ${nameOf(gone)} went to the Trash`, { undo: restore(undoToken) });
  };
  const merge = async () => {
    if (!client || a.content === null || b.content === null) throw new Error('Not read yet');
    const meta = memoryMeta(splitFrontmatter(a.content).data);
    const before = body(a.content);
    await client.call('memory.write', { root, path: left, description: meta.description ?? '', type: meta.type ?? 'project', body: mergedBody(before, body(b.content)), expectedModified: a.modified, force: false });
    const { undoToken } = await client.call('memory.remove', { root, path: right });
    onClose();
    toast(`Merged ${nameOf(right)} into ${nameOf(left)}`, {
      undo: () =>
        void client
          .call('memory.write', { root, path: left, description: meta.description ?? '', type: meta.type ?? 'project', body: before, expectedModified: null, force: true })
          .then(restore(undoToken), (e: Error) => toast(`Couldn't undo: ${e.message}`)),
    });
  };

  return (
    <Dialog
      title="Compare"
      subtitle="Two memories that look the same. Keep one, or merge the other into it."
      width="lg"
      onClose={onClose}
      data-memory-compare
      footer={
        <>
          <Button onClick={() => setConfirm('left')} data-memory-keep-left>
            Keep left
          </Button>
          <Button onClick={() => setConfirm('right')} data-memory-keep-right>
            Keep right
          </Button>
          <Button variant="primary" onClick={() => setConfirm('merge')} data-memory-merge>
            Merge into left…
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {[
          { path: left, file: a },
          { path: right, file: b },
        ].map(({ path, file }) => (
          <div key={path} className="grid min-w-0 content-start gap-1.5">
            <p className="truncate font-mono text-meta text-muted" data-tooltip={path}>
              {path.split('/').slice(-3).join('/')}
            </p>
            <pre className="max-h-[50vh] overflow-auto rounded-lg border border-edge bg-code p-3 font-mono text-ui break-words whitespace-pre-wrap select-text">{file.content ?? 'Reading…'}</pre>
          </div>
        ))}
      </div>
      {confirm && (
        <ConfirmDialog
          title={confirm === 'merge' ? `Merge ${nameOf(right)} into ${nameOf(left)}?` : `Keep ${nameOf(confirm === 'left' ? left : right)}?`}
          danger={confirm !== 'merge'}
          confirmLabel={confirm === 'merge' ? 'Merge' : 'Keep it'}
          body={
            confirm === 'merge'
              ? `${nameOf(right)}'s text is added under ${nameOf(left)}'s, and ${nameOf(right)} goes to the Trash with its MEMORY.md line. You can undo it right after.`
              : `${nameOf(confirm === 'left' ? right : left)} goes to the Trash with its MEMORY.md line. You can undo it right after.`
          }
          onConfirm={() => (confirm === 'merge' ? merge() : keep(confirm))}
          onClose={() => setConfirm(null)}
        />
      )}
    </Dialog>
  );
}

/** Fix index: the change to MEMORY.md (only the wrong lines), then Fix. */
function FixIndexDialog({ root, indexPath, onClose }: { root: string | null; indexPath: string; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void client?.call('memory.fixIndexPreview', { root, indexPath }).then((r) => setDiff(r.diff), (e: Error) => setError(e.message));
  }, [client, root, indexPath]);
  const fix = async () => {
    if (!client) return;
    try {
      await client.call('memory.fixIndex', { root, indexPath });
      onClose();
      toast('MEMORY.md fixed');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      title="Fix MEMORY.md"
      subtitle="Adds a line for each memory it doesn't list and takes out lines for files that are gone. Nothing else changes."
      width="lg"
      onClose={onClose}
      onSubmit={() => void fix()}
      data-memory-fix-index
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={!diff} onClick={() => void fix()} data-memory-fix-index-confirm>
            Fix index
          </Button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <div className="overflow-auto rounded-lg border border-edge bg-code font-mono text-ui select-text">{diff === null ? <p className="p-3 text-muted">Reading…</p> : diff ? <DiffRows diff={diff} /> : <p className="p-3 text-muted">Nothing to fix.</p>}</div>
    </Dialog>
  );
}

/**
 * Health: what to look at in this project's memory and the personal folder, each with what you can do about it.
 * Switchboard never changes memory on its own: every fix is a button you press, and Tidy with Claude… only fills in
 * New session.
 */
export function HealthPanel({ root, findings, onClose }: { root: string; findings: readonly HealthFinding[]; onClose(): void }) {
  const [dialog, setDialog] = useState<{ kind: 'compare'; left: string; right: string } | { kind: 'fix'; indexPath: string } | null>(null);
  const action = (f: HealthFinding) => {
    switch (f.kind) {
      case 'staleReference':
        return (
          <Button size="sm" variant="quiet" onClick={() => openMemoryFile(root, f.memoryPaths[0]!, f.refs)} data-memory-health-open>
            Open
          </Button>
        );
      case 'duplicate':
        return (
          <Button size="sm" variant="quiet" onClick={() => setDialog({ kind: 'compare', left: f.memoryPaths[0]!, right: f.memoryPaths[1]! })} data-memory-health-compare>
            Compare
          </Button>
        );
      case 'indexMismatch':
        return (
          <Button size="sm" variant="quiet" onClick={() => setDialog({ kind: 'fix', indexPath: f.indexPath! })} data-memory-health-fix>
            Fix index
          </Button>
        );
      case 'overLimit':
        return (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => void useLinks.getState().open({ action: 'new-session', cwd: root, prompt: tidyPrompt(f.indexPath ?? 'MEMORY.md'), project: null, repo: null, autostart: false, question: false })}
            data-memory-health-tidy
          >
            Tidy with Claude…
          </Button>
        );
      case 'old':
        return null;
    }
  };
  return (
    <section className="grid gap-1 rounded-xl border border-border bg-card px-4 py-3" aria-labelledby="memory-health-heading" data-memory-health>
      <div className="flex items-baseline gap-2">
        <h3 id="memory-health-heading" className="text-ui font-semibold">
          Health
        </h3>
        <span className="text-meta text-muted">this project's memory and Personal</span>
        <span className="flex-1" />
        <Button size="sm" variant="quiet" onClick={onClose}>
          Hide
        </Button>
      </div>
      {findings.length === 0 && <p className="text-ui text-muted">Nothing to look at.</p>}
      <ul className="divide-y divide-border">
        {findings.map((f, i) => (
          <li key={`${f.kind}:${f.memoryPaths.join('|')}:${f.indexPath ?? ''}:${i}`} className="flex min-w-0 items-center gap-2.5 py-1.5" data-memory-health-finding={f.kind}>
            {f.kind === 'old' ? <Clock size={14} className={`shrink-0 ${TONE.faint}`} aria-hidden /> : <AlertTriangle size={14} className={`shrink-0 ${TONE[findingTone(f)]}`} aria-hidden />}
            <span className={`min-w-0 flex-1 text-ui ${f.kind === 'old' ? 'text-muted' : ''}`}>{f.detail}</span>
            {action(f)}
          </li>
        ))}
      </ul>
      {dialog?.kind === 'compare' && <CompareDialog root={root} left={dialog.left} right={dialog.right} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'fix' && <FixIndexDialog root={root} indexPath={dialog.indexPath} onClose={() => setDialog(null)} />}
    </section>
  );
}
