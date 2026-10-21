import { Check, ChevronDown, CloudDownload, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { Notice } from '../ui/Notice.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { catchUpStep, gitSummary, planGit } from './gitPlan.ts';

const MENU_WIDTH = 280;
const plural = (n: number) => `${n} ${n === 1 ? 'commit' : 'commits'}`;

/**
 * New session's git button, next to Open in editor: brings the checkout up to date before a session
 * starts in it. Its face pulls when the upstream is ahead and fetches otherwise; the menu shows the
 * branch and has both. There is no session (or terminal) yet, so the engine runs git itself and a pull
 * only fast-forwards. `onStatus` gets where the checkout stands afterwards.
 */
export function CatchUpButton({
  cwd,
  status,
  target,
  onStatus,
  request,
}: {
  cwd: string;
  status: WorktreeStatus;
  /** The branch the session will check out first, when it isn't the one the folder is on: `status` is about the other one. */
  target: string | null;
  onStatus(status: WorktreeStatus): void;
  /** Counts up when the palette's Update from remote asks the face's step to run. */
  request: number;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const menu = useMenu();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState<'fetch' | 'pull' | null>(null);
  const [error, setError] = useState<{ cwd: string; message: string } | null>(null);
  const [done, flash] = useFlash();
  /** The folder on screen now: a result for one picked before is dropped. */
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  const plan = planGit(status, false);
  // Pull only fast-forwards the branch the folder is on, so another branch can only be fetched until it is checked out.
  const switching = target !== null && target !== status.branch;
  const face = switching ? 'fetch' : catchUpStep(status);
  const behind = switching ? 0 : (status.behindUpstream ?? 0);
  const failed = error?.cwd === cwd ? error.message : null;
  const run = async (step: 'fetch' | 'pull') => {
    if (!client || running) return;
    setError(null);
    setRunning(step);
    try {
      const next = await client.call('git.update', { cwd, action: step });
      if (cwdRef.current !== cwd) return;
      onStatus(next);
      // After a fetch that found new commits, the face turning into Pull ↓N says so.
      if (step === 'pull') flash(`Pulled ${plural(behind)}`);
      else if ((next.behindUpstream ?? 0) === 0) flash('Up to date');
    } catch (e) {
      setError({ cwd, message: `Couldn't ${step}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setRunning(null);
    }
  };

  const runRef = useRef(run);
  runRef.current = run;
  const seenRequest = useRef(request);
  useEffect(() => {
    if (request === seenRequest.current) return;
    seenRequest.current = request;
    void runRef.current(switching ? 'fetch' : catchUpStep(status));
  }, [request]);

  // A local-only repository has nothing to catch up with.
  if (!status.hasRemote) return null;

  const primary = face === 'pull';
  const FaceIcon = primary ? CloudDownload : RefreshCw;
  const label = running === 'pull' ? 'Pulling…' : running === 'fetch' ? 'Fetching…' : primary ? 'Pull' : 'Fetch';
  const tooltip = failed ?? (primary ? `Pull ${plural(behind)} from ${status.upstream}` : `Fetch from ${status.pushRemote ?? 'the remote'}, to see whether ${switching ? target : (status.upstream ?? 'it')} moved on`);
  const entries: MenuEntry[] = [
    { title: switching ? target : (status.branch ?? 'Detached HEAD'), detail: switching ? `The folder is on ${status.branch ?? 'a detached HEAD'}` : gitSummary(status) },
    'separator',
    { label: 'Pull', icon: <CloudDownload size={13} />, hint: behind > 0 ? `↓${behind}` : undefined, disabled: switching || plan.blocked.pull !== null || running !== null, onSelect: () => void run('pull'), data: { 'data-catch-up-step': 'pull' } },
    { label: 'Fetch', icon: <RefreshCw size={13} />, disabled: running !== null, onSelect: () => void run('fetch'), data: { 'data-catch-up-step': 'fetch' } },
  ];
  if (switching) entries.push({ note: `Pull works on ${status.branch ?? 'the current branch'}. Start the session first, then pull.` });
  else if (plan.blocked.pull && behind === 0) entries.push({ note: plan.blocked.pull });

  return (
    <div className="no-drag flex shrink-0 items-center gap-2">
      {done && (
        <Notice inline tone="success" icon={<Check size={13} aria-hidden />} className="text-meta" data-catch-up-done>
          {done}
        </Notice>
      )}
      {/* The tooltip only shows on hover; say it out loud too. */}
      {failed && (
        <span role="alert" className="sr-only">
          {failed}
        </span>
      )}
      <div ref={wrapperRef} className="relative flex" data-catch-up={face}>
        <button
          type="button"
          // Not `disabled` while it runs: it keeps focus, and its tooltip.
          onClick={() => void run(face)}
          aria-busy={running !== null}
          data-tooltip={tooltip}
          aria-label={primary ? `Pull ${behind}` : 'Fetch'}
          className={`flex h-7 items-center gap-1.5 rounded-l-md px-2.5 text-ui ${primary ? 'bg-accent font-semibold text-on-accent hover:bg-accent/85' : 'border border-border text-text hover:bg-border/50'} ${failed ? 'ring-1 ring-error ring-inset' : ''} ${running ? 'cursor-default' : ''}`}
        >
          {running ? (
            <span className={`size-3 shrink-0 animate-spin rounded-full border-[1.5px] ${primary ? 'border-on-accent/25 border-t-on-accent' : 'border-accent-ink/25 border-t-accent-ink'}`} aria-hidden />
          ) : (
            <FaceIcon size={13} className={primary ? '' : 'text-muted'} aria-hidden />
          )}
          <span>{label}</span>
          {primary && !running && (
            <span className="tabular-nums" aria-hidden>
              ↓{behind}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (menu.at || !rect) menu.close();
            else menu.openAt(rect.right - MENU_WIDTH, rect.bottom + 4);
          }}
          className={`flex h-7 items-center rounded-r-md px-1.5 ${primary ? 'border-l border-on-accent/20 bg-accent text-on-accent hover:bg-accent/85' : 'border border-l-0 border-border text-muted hover:bg-border/50 hover:text-text'}`}
          aria-label="Git: pull, fetch"
          data-tooltip="Git"
          aria-haspopup="menu"
          aria-expanded={menu.at !== null}
          data-catch-up-menu
        >
          <ChevronDown size={13} aria-hidden />
        </button>
        {menu.at && <Menu x={menu.at.x} y={menu.at.y} width={MENU_WIDTH} entries={entries} onClose={menu.close} label="Git" />}
      </div>
    </div>
  );
}
