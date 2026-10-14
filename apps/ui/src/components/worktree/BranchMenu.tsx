import { Check, ChevronDown, GitBranch } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useCheckoutBranches } from '../../state/checkoutBranchesStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Popover } from '../ui/Popover.tsx';
import { branchButton, FILTER_FROM, filterBranches, sharedWarning } from './branchMenu.ts';
import { useSharingCheckout } from './useSharingCheckout.ts';

/**
 * The branch checked out in a session's folder (not a worktree), read live from git, as a small text
 * button in the session header's meta line, with a menu to switch to another local branch.
 * `busy`: Claude is working in this session, so switching waits. A new `openRequest` (the git menu's
 * "Switch branch…") opens the menu as if the button was clicked.
 */
export function BranchMenu({ sessionId, cwd, root, busy, onSwitched, openRequest = 0 }: { sessionId: string; cwd: string; root: string; busy: boolean; onSwitched(): void; openRequest?: number }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const current = useCheckoutBranches((s) => s.byCwd.get(cwd));
  const switches = useCheckoutBranches((s) => s.switches);
  const [branches, setBranches] = useState<string[] | null>(null);
  // Branches checked out in another worktree (Claude Code's, say): git won't switch to them here.
  const [elsewhere, setElsewhere] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    client?.call('git.branches', { cwd }).then(
      (result) => {
        setBranches(result.current === null && result.branches.length === 0 ? [] : result.branches);
        setElsewhere(new Set(result.checkedOutElsewhere ?? []));
        useCheckoutBranches.getState().set([cwd], result.current);
      },
      () => setBranches([]),
    );
  }, [client, cwd]);

  // Claude can switch branches itself, and so can you in a terminal: read it again when the session
  // opens, after each turn, when the window gets focus, and after any switch in this app.
  useEffect(load, [load, busy, switches]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  // Other live sessions (in this app or anywhere else) working in the same checkout.
  const others = useSharingCheckout(root, sessionId);

  const close = (refocus: boolean) => {
    setOpen(null);
    setQuery('');
    if (refocus) trigger.current?.focus();
  };

  // Escape (or anything else that closes the menu) hands focus back to the button, unless it moved on.
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body) trigger.current?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const switchTo = async (branch: string) => {
    if (!client) throw new Error('Not connected to the engine');
    setSwitching(true);
    try {
      const result = await client.call('git.switch', { cwd, branch });
      // The sidebar rows of every session in this checkout show the new branch too.
      useCheckoutBranches.getState().set([cwd, ...others.cwds], result.current);
      useCheckoutBranches.getState().switched();
      onSwitched();
    } finally {
      setSwitching(false);
    }
  };

  const pick = (branch: string) => {
    if (branch === current) return close(true);
    if (elsewhere.has(branch)) return;
    setError(null);
    if (others.ids.length > 0) {
      close(false);
      setConfirm(branch);
      return;
    }
    // On failure the menu stays open with git's message, on the current branch.
    switchTo(branch).then(() => close(true), (e: Error) => setError(`Couldn't switch to ${branch}. ${e.message}`));
  };

  useEffect(() => {
    if (!open) return;
    const filter = panel.current?.querySelector<HTMLInputElement>('[data-branch-filter]');
    (filter ?? panel.current?.querySelector<HTMLButtonElement>('[aria-checked=true]') ?? panel.current?.querySelector<HTMLButtonElement>('[role=menuitemradio]'))?.focus();
  }, [open]);

  const toggle = () => {
    if (busy) return;
    if (open) return close(false);
    setError(null);
    load();
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setOpen({ x: rect.left, y: rect.bottom + 4 });
  };
  const lastRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === lastRequest.current) return;
    lastRequest.current = openRequest;
    if (!open) toggle();
  }, [openRequest]);

  const onKeyDown = (event: KeyboardEvent) => {
    // Keys that confirm an IME composition (Enter picking a candidate) belong to the input method.
    if (event.nativeEvent.isComposing) return;
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') (event.preventDefault(), focus(index + 1));
    else if (event.key === 'ArrowUp') (event.preventDefault(), focus(index < 0 ? items.length - 1 : index - 1));
    else if (event.key === 'Home' && index >= 0) (event.preventDefault(), focus(0));
    else if (event.key === 'End' && index >= 0) (event.preventDefault(), focus(items.length - 1));
    else if (event.key === 'Enter' && index < 0 && items[0]) (event.preventDefault(), items[0].click());
  };

  // Not a git repository (or nothing read yet): no button.
  if (current === undefined || branches === null || (branches.length === 0 && current === null)) return null;
  const { label, tooltip } = branchButton(current, busy);
  const listed = filterBranches(branches, current, query);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-branch-menu
        data-branch={current ?? ''}
        data-cwd={cwd}
        aria-disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        // The tooltip alone drops the branch name while Claude works; screen readers get both.
        aria-label={busy ? `On ${label}. ${tooltip}` : tooltip}
        data-tooltip={tooltip}
        onClick={toggle}
        className={`no-drag inline-flex max-w-56 min-w-0 items-center gap-1 rounded px-0.5 text-muted ${busy ? 'cursor-default' : 'hover:text-text'} ${open ? 'text-text' : ''}`}
      >
        <GitBranch size={11} className="shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={11} className="shrink-0 @max-[860px]:hidden" aria-hidden />
      </button>
      {open && (
        <Popover x={open.x} y={open.y} width={280} anchor={trigger} onClose={() => close(false)} role="menu" aria-label="Switch branch" data-menu="branch" onKeyDown={onKeyDown}>
          <div ref={panel}>
            <p aria-hidden className="px-3 pt-1.5 pb-1 text-[10px] tracking-wide text-faint uppercase">
              Branch
            </p>
            {branches.length > FILTER_FROM && (
              <input
                data-branch-filter
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter branches"
                spellCheck={false}
                aria-label="Filter branches"
                className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11.5px] text-text outline-none placeholder:text-faint focus:border-accent-ink"
              />
            )}
            {listed.map((branch) => {
              // Still focusable (not `disabled`), so the tooltip says why on hover and from the keyboard.
              const taken = elsewhere.has(branch);
              return (
                <button
                  key={branch}
                  type="button"
                  role="menuitemradio"
                  aria-checked={branch === current}
                  aria-disabled={taken || undefined}
                  data-branch-option={branch}
                  data-branch-elsewhere={taken || undefined}
                  data-tooltip={taken ? 'Checked out in another worktree' : undefined}
                  disabled={switching}
                  onClick={() => pick(branch)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none focus-visible:bg-accent/15 disabled:opacity-50 ${taken ? 'cursor-default opacity-50' : 'hover:bg-accent/15'}`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-ui text-text">{branch}</span>
                  <Check size={13} className={`shrink-0 text-accent-ink ${branch === current ? '' : 'invisible'}`} />
                </button>
              );
            })}
            {listed.length === 0 && <p className="px-3 py-1.5 text-ui text-muted">{query ? 'No matching branch' : 'No local branches'}</p>}
            {switching && (
              <p role="status" className="border-t border-border px-3 pt-1.5 pb-1 text-meta text-muted">
                Switching…
              </p>
            )}
            {error && (
              <p className="mt-1 border-t border-border px-3 pt-1.5 pb-1 text-meta break-words whitespace-pre-wrap text-error" role="alert" data-branch-error>
                {error}
              </p>
            )}
          </div>
        </Popover>
      )}
      {confirm && (
        <ConfirmDialog
          title={`Switch to ${confirm}?`}
          confirmLabel="Switch"
          body={<p>{sharedWarning(others.ids.length)}</p>}
          onConfirm={() => switchTo(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}
