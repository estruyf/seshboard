import { Check, ChevronDown, ExternalLink, FileText, GitPullRequest, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { PrDraft, PrError } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { openTerminal } from '../../state/terminalsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Popover } from '../ui/Popover.tsx';
import { filterBranches } from '../worktree/branchMenu.ts';
import {
  counterText,
  defaultSource,
  defaultTitle,
  draftProblem,
  noticeFor,
  overLimit,
  pushLine,
  sameSource,
  saveDraft,
  savedDraft,
  sourceLabel,
  sourceText,
  statsText,
  type DescriptionSource,
  type NoticeAction,
} from './pullRequest.ts';

/** Where the GitHub CLI's install instructions are. */
const GH_INSTALL_URL = 'https://cli.github.com';
const FIELD = 'block w-full rounded-md border border-edge bg-bg px-2.5 py-2 text-text outline-none placeholder:text-faint focus:border-accent-ink disabled:opacity-60';
const spinner = (onAccent: boolean) => (
  <span className={`size-3 shrink-0 animate-spin rounded-full border-[1.5px] ${onAccent ? 'border-on-accent/25 border-t-on-accent' : 'border-accent-ink/25 border-t-accent-ink'}`} aria-hidden />
);

export interface CreatedPr {
  number: number;
  url: string;
  draft: boolean;
}

/**
 * Create a pull request without leaving Switchboard: a title, a description from a template or the commits, the base
 * branch and Draft. Create pushes the branch and runs `gh pr create` in the engine, with no terminal or browser.
 * Everything typed is kept when it closes without creating, and comes back the next time for the same branch.
 */
export function PullRequestDialog({
  sessionId,
  cwd,
  projectBase,
  onClose,
  onCreated,
  onPullFirst,
}: {
  sessionId: string;
  cwd: string;
  /** The project's default branch (Project › Settings), which the base starts on when the remote has it. */
  projectBase: string | null;
  onClose(): void;
  onCreated(pr: CreatedPr): void;
  /** The push was turned down: pull in a terminal tab, then come back. The dialog has closed and kept its text. */
  onPullFirst(): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [draft, setDraft] = useState<PrDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState<DescriptionSource>({ kind: 'commits' });
  const [base, setBase] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  /** What the fields were filled in with, to tell your edits from it. */
  const prefill = useRef({ title: '', body: '' });
  const [phase, setPhase] = useState<'idle' | 'push' | 'create'>('idle');
  const [error, setError] = useState<PrError | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const [baseMenu, setBaseMenu] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [confirmSource, setConfirmSource] = useState<DescriptionSource | null>(null);
  const sourceMenu = useMenu();
  const titleRef = useRef<HTMLInputElement>(null);
  const baseButton = useRef<HTMLButtonElement>(null);
  const sourceButton = useRef<HTMLButtonElement>(null);
  const basePanel = useRef<HTMLDivElement>(null);
  /** Stops listening for the running job's progress. */
  const unlisten = useRef<(() => void) | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const busy = phase !== 'idle';

  useEffect(() => () => unlisten.current?.(), []);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.call('git.prDraft', { cwd, projectBase }).then(
      async (read) => {
        if (cancelled) return;
        const kept = savedDraft(cwd, read.branch);
        let loaded = read;
        // A base picked last time: read the commits and diff against it.
        if (kept && kept.base !== read.base) loaded = await client.call('git.prDraft', { cwd, base: kept.base, projectBase }).catch(() => read);
        if (cancelled) return;
        const start = defaultSource(loaded.templates);
        const fresh = { title: defaultTitle(loaded.commits, loaded.branch), body: sourceText(start, loaded.templates, loaded.commits) };
        prefill.current = fresh;
        setDraft(loaded);
        setBase(loaded.base);
        setTitle(kept?.title ?? fresh.title);
        setBody(kept?.body ?? fresh.body);
        setSource(kept?.source ?? start);
        setIsDraft(kept?.draft ?? false);
      },
      (e: Error) => !cancelled && setLoadError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, projectBase]);

  // Ready to type: the title, all selected, so typing replaces it.
  const ready = draft !== null;
  useEffect(() => {
    if (!ready) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [ready]);

  const edited = title !== prefill.current.title || body !== prefill.current.body;
  const keep = () => {
    if (draft) saveDraft(cwd, draft.branch, edited || base !== draft.base || isDraft ? { title, body, source, base, draft: isDraft } : null);
  };
  const close = () => {
    // Nothing stops gh halfway: the dialog stays until it has finished.
    if (busy) return;
    keep();
    onClose();
  };

  const over = overLimit(body);
  const problem = draft ? draftProblem(draft) : null;
  const shown = error ?? problem;
  const blocked = shown?.code === 'GH_MISSING' || shown?.code === 'PR_EXISTS';
  const canCreate = !!client && !!draft && !busy && title.trim() !== '' && over === 0 && !blocked;

  const create = async (web = false) => {
    if (!client || !draft || busy || !title.trim() || over > 0 || (!web && blocked)) return;
    const jobId = crypto.randomUUID();
    setError(null);
    setShowOutput(false);
    setPhase('push');
    unlisten.current?.();
    const off = client.on('git.pr', (progress) => {
      if (progress.jobId !== jobId) return;
      if (progress.step === 'push' || progress.step === 'create') return setPhase(progress.step);
      off();
      unlisten.current = null;
      setPhase('idle');
      if (progress.step === 'failed') return setError(progress.error);
      saveDraft(cwd, draft.branch, null);
      if (progress.compareUrl) {
        window.open(progress.compareUrl, '_blank');
        onClose();
      } else if (progress.pr) onCreated(progress.pr);
    });
    unlisten.current = off;
    try {
      await client.call('git.prCreate', { jobId, cwd, title: title.trim(), body, base, draft: isDraft, web });
    } catch (e) {
      off();
      unlisten.current = null;
      setPhase('idle');
      setError({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e), output: null, pr: null });
    }
  };

  const pickBase = (next: string) => {
    setBaseMenu(null);
    setQuery('');
    baseButton.current?.focus();
    if (!client || !draft || next === base) return;
    setBase(next);
    // The commits and the diff are against the base: read them again, and follow them where you haven't typed.
    client.call('git.prDraft', { cwd, base: next, projectBase }).then(
      (read) => {
        setDraft(read);
        const fresh = { title: defaultTitle(read.commits, read.branch), body: sourceText(source, read.templates, read.commits) };
        if (title === prefill.current.title) setTitle(fresh.title);
        if (body === prefill.current.body) setBody(fresh.body);
        prefill.current = fresh;
      },
      () => {},
    );
  };

  const applySource = (next: DescriptionSource) => {
    if (!draft) return;
    const text = sourceText(next, draft.templates, draft.commits);
    setSource(next);
    setBody(text);
    prefill.current = { ...prefill.current, body: text };
  };
  const chooseSource = (next: DescriptionSource) => {
    if (sameSource(next, source) && body === prefill.current.body) return;
    // Your edits stay until you say they can go.
    if (body !== prefill.current.body && body.trim()) setConfirmSource(next);
    else applySource(next);
  };

  const signIn = async () => {
    if (!client) return;
    keep();
    onClose();
    const id = await openTerminal(client, sessionId, cwd, 'shell');
    // Typed, not run: you press Return when you're ready. Only once the new shell has started, or its config can drop it.
    if (id) await client.call('terminal.write', { id, data: 'gh auth login', whenReady: true });
  };
  const pullFirst = () => {
    keep();
    onClose();
    onPullFirst();
  };

  const onBaseKeys = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    const items = [...(basePanel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') (event.preventDefault(), focus(index + 1));
    else if (event.key === 'ArrowUp') (event.preventDefault(), focus(index < 0 ? items.length - 1 : index - 1));
    else if (event.key === 'Enter' && index < 0 && items[0]) (event.preventDefault(), items[0].click());
  };

  const sourceEntries: MenuEntry[] = draft
    ? [
        { heading: 'Description from' },
        ...draft.templates.map((t): MenuEntry => ({ label: t.path, checked: sameSource(source, { kind: 'template', path: t.path }), onSelect: () => chooseSource({ kind: 'template', path: t.path }), data: { 'data-pr-source-option': t.path } })),
        { label: 'Commit list', checked: source.kind === 'commits', onSelect: () => chooseSource({ kind: 'commits' }), data: { 'data-pr-source-option': 'commits' } },
        { label: 'Empty', checked: source.kind === 'empty', onSelect: () => chooseSource({ kind: 'empty' }), data: { 'data-pr-source-option': 'empty' } },
        { note: 'Switching keeps your edits until you confirm.' },
      ]
    : [];

  const notice = shown && draft ? noticeFor(shown, draft.branch) : null;
  const action = (kind: NoticeAction) => {
    switch (kind) {
      case 'install':
        return (
          <Button key={kind} size="sm" icon={<ExternalLink size={12} aria-hidden />} onClick={() => window.open(GH_INSTALL_URL, '_blank')} data-pr-action={kind}>
            How to install
          </Button>
        );
      case 'web':
        return (
          <Button key={kind} size="sm" variant="quiet" disabled={busy} onClick={() => void create(true)} data-pr-action={kind}>
            Open on GitHub instead
          </Button>
        );
      case 'sign-in':
        return (
          <Button key={kind} size="sm" onClick={() => void signIn()} data-pr-action={kind}>
            Run gh auth login
          </Button>
        );
      case 'pull':
        return (
          <Button key={kind} size="sm" onClick={pullFirst} data-pr-action={kind}>
            Pull and try again
          </Button>
        );
      case 'output':
        return (
          <Button key={kind} size="sm" variant="quiet" aria-expanded={showOutput} onClick={() => setShowOutput((v) => !v)} data-pr-action={kind}>
            {showOutput ? 'Hide output' : 'Show output'}
          </Button>
        );
      case 'view':
        return (
          <Button key={kind} size="sm" onClick={() => shown?.pr && window.open(shown.pr.url, '_blank')} data-pr-action={kind}>
            View PR #{shown?.pr?.number}
          </Button>
        );
    }
  };

  const status = !draft ? null : busy ? (
    <span role="status" className="flex min-w-0 items-center gap-2 text-ui text-muted" data-pr-progress={phase}>
      {phase === 'push' ? (
        <>
          {spinner(false)}
          <span className="min-w-0 truncate">
            Pushing <span className="font-mono">{draft.branch}</span>…
          </span>
        </>
      ) : (
        <>
          <Check size={13} className="shrink-0 text-ok" aria-hidden />
          <span>Pushed</span>
          <span aria-hidden className="text-faint">
            ·
          </span>
          {spinner(false)}
          <span>Creating…</span>
        </>
      )}
    </span>
  ) : (
    <span className="min-w-0 truncate text-ui text-muted" data-pr-push-line>
      {pushLine(draft)}
    </span>
  );

  return (
    <>
    <Dialog
      width="palette"
      title="Create pull request"
      icon={<GitPullRequest size={16} className="text-muted" aria-hidden />}
      headerActions={
        draft?.repo ? (
          <span className="mr-1 font-mono text-meta text-muted" data-pr-repo>
            {draft.repo}
          </span>
        ) : undefined
      }
      onClose={close}
      onSubmit={() => void create()}
      dismissable={!busy}
      data-pr-dialog
      footerStart={status}
      footer={
        <>
          {over > 0 && !busy && (
            <Button variant="quiet" onClick={() => applySource({ kind: 'commits' })} data-pr-trim>
              Use commit titles only
            </Button>
          )}
          <Button onClick={close} disabled={busy} kbd={busy ? undefined : 'Esc'}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canCreate} onClick={() => void create()} shortcut={busy ? undefined : 'pr.create'} icon={busy ? spinner(true) : <GitPullRequest size={13} aria-hidden />} data-pr-submit>
            {busy ? 'Creating…' : 'Create pull request'}
          </Button>
        </>
      }
    >
      {loadError ? (
        <Notice tone="error" icon={<TriangleAlert size={14} aria-hidden />} data-pr-load-error>
          {loadError}
        </Notice>
      ) : !draft ? (
        <p role="status" className="flex items-center gap-2 py-6 text-ui text-muted">
          {spinner(false)} Reading the branch…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="max-w-[45%] truncate rounded-md border border-edge px-2 py-1 font-mono text-ui text-text" data-pr-head data-tooltip={draft.branch}>
              {draft.branch}
            </span>
            <span className="text-ui text-muted">into</span>
            <button
              ref={baseButton}
              type="button"
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={baseMenu !== null}
              aria-label={`Base branch: ${base}`}
              data-pr-base={base}
              onClick={() => {
                if (baseMenu) return setBaseMenu(null);
                const rect = baseButton.current?.getBoundingClientRect();
                if (rect) setBaseMenu({ x: rect.left, y: rect.bottom + 4 });
              }}
              className="inline-flex max-w-[40%] min-w-0 items-center gap-1.5 rounded-md border border-edge px-2 py-1 font-mono text-ui text-text hover:bg-border/45 disabled:opacity-60"
            >
              <span className="min-w-0 truncate">{base}</span>
              <ChevronDown size={12} className="shrink-0 text-muted" aria-hidden />
            </button>
            <span className="ml-auto text-meta whitespace-nowrap text-muted tabular-nums" data-pr-stats>
              {statsText(draft)} · <span className="text-ok">+{draft.additions.toLocaleString('en-US')}</span> <span className="text-error">−{draft.deletions.toLocaleString('en-US')}</span>
            </span>
          </div>

          <label htmlFor={titleId} className="mt-4 mb-1.5 block text-ui text-muted">
            Title
          </label>
          <input ref={titleRef} id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} spellCheck data-pr-title className={`${FIELD} text-body`} />

          <div className="mt-4 mb-1.5 flex min-w-0 items-center gap-2">
            <label htmlFor={bodyId} className="text-ui text-muted">
              Description
            </label>
            <button
              ref={sourceButton}
              type="button"
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={sourceMenu.at !== null}
              data-pr-source={source.kind === 'template' ? source.path : source.kind}
              onClick={() => {
                const rect = sourceButton.current?.getBoundingClientRect();
                if (sourceMenu.at || !rect) sourceMenu.close();
                else sourceMenu.openAt(rect.right - 300, rect.bottom + 4);
              }}
              className="ml-auto inline-flex min-w-0 items-center gap-1 rounded px-1 text-meta text-muted hover:text-text disabled:opacity-60"
            >
              <FileText size={12} className="shrink-0" aria-hidden />
              <span>From</span>
              <span className="min-w-0 truncate font-mono">{sourceLabel(source)}</span>
              <ChevronDown size={11} className="shrink-0" aria-hidden />
            </button>
          </div>
          <textarea
            id={bodyId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy}
            rows={11}
            spellCheck
            placeholder="Describe what changed and how to test it"
            data-pr-body
            aria-invalid={over > 0}
            aria-describedby={`${bodyId}-count`}
            className={`${FIELD} resize-none font-mono text-ui leading-relaxed ${over > 0 ? 'border-error focus:border-error' : ''}`}
          />
          <div className="mt-2 flex min-w-0 items-center gap-3">
            <Checkbox checked={isDraft} onChange={setIsDraft} disabled={busy} dataAttrs={{ 'data-pr-draft': true }}>
              <span className="text-ui text-text">Draft</span>
            </Checkbox>
            {over > 0 && (
              <span className="min-w-0 truncate text-meta text-error" data-pr-over>
                {over.toLocaleString('en-US')} {over === 1 ? 'character' : 'characters'} over GitHub's limit
              </span>
            )}
            <span id={`${bodyId}-count`} className={`ml-auto text-meta tabular-nums ${over > 0 ? 'text-error' : 'text-faint'}`} data-pr-counter>
              {counterText(body)}
            </span>
          </div>

          {notice && shown && (
            <Notice
              className="mt-4"
              tone={notice.tone}
              icon={notice.tone === 'info' ? <Info size={14} aria-hidden /> : <TriangleAlert size={14} aria-hidden />}
              data-pr-notice={shown.code}
            >
              <p>
                <strong className="font-semibold">{notice.title}</strong> <span className={notice.tone === 'error' ? 'text-text' : ''}>{notice.detail}</span>
              </p>
              {notice.actions.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5">{notice.actions.map(action)}</div>}
              {showOutput && shown.output && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-code p-2 font-mono text-meta whitespace-pre-wrap text-text select-text" data-pr-output>
                  {shown.output}
                </pre>
              )}
            </Notice>
          )}
        </>
      )}

      {baseMenu && draft && (
        <Popover x={baseMenu.x} y={baseMenu.y} width={280} anchor={baseButton} onClose={() => (setBaseMenu(null), setQuery(''))} role="menu" aria-label="Base branch" data-menu="pr-base" onKeyDown={onBaseKeys}>
          <div ref={basePanel}>
            <input
              autoFocus
              data-pr-base-filter
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter branches"
              spellCheck={false}
              aria-label="Filter branches"
              className="mx-2 mt-1 mb-1 w-[calc(100%-1rem)] rounded-md border border-edge bg-bg px-2 py-1 font-mono text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink"
            />
            {filterBranches(draft.branches, base, query).map((branch) => {
              const mark = branch === projectBase ? 'project default' : !projectBase && branch === draft.remoteDefault ? 'default branch' : null;
              return (
                <button
                  key={branch}
                  type="button"
                  role="menuitemradio"
                  aria-checked={branch === base}
                  data-pr-base-option={branch}
                  onClick={() => pickBase(branch)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none hover:bg-border/45 focus-visible:bg-accent/15"
                >
                  <Check size={13} className={`shrink-0 text-accent-ink ${branch === base ? '' : 'invisible'}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-ui text-text">{branch}</span>
                  {mark && <span className="shrink-0 text-meta text-faint">{mark}</span>}
                </button>
              );
            })}
            {filterBranches(draft.branches, base, query).length === 0 && <p className="px-3 py-1.5 text-ui text-muted">{query ? 'No matching branch' : `No branches on ${draft.remote} yet`}</p>}
          </div>
        </Popover>
      )}
      {sourceMenu.at && <Menu x={sourceMenu.at.x} y={sourceMenu.at.y} width={300} entries={sourceEntries} onClose={sourceMenu.close} label="Description from" anchor={sourceButton} />}
    </Dialog>
    {confirmSource && (
      <ConfirmDialog
        title="Replace the description?"
        body={<p>What you wrote is replaced with {confirmSource.kind === 'empty' ? 'an empty description' : <span className="font-mono">{sourceLabel(confirmSource)}</span>}.</p>}
        confirmLabel="Replace"
        data={{ 'data-pr-replace': true }}
        onConfirm={async () => applySource(confirmSource)}
        onClose={() => setConfirmSource(null)}
      />
    )}
    </>
  );
}
