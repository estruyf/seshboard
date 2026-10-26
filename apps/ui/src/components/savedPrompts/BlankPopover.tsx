import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import type { GithubListItem, PromptBlank } from '@seshboard/protocol/client';
import { reasonLine } from '../github/githubText.ts';
import { fuzzyScore } from '../../lib/fuzzy.ts';
import { Kbd } from '../ui/Kbd.tsx';
import { engineClient } from './savedPromptsStore.ts';
import { chipLabel } from './fillModel.ts';
import { BLANK_ICONS } from './ScopeTag.tsx';

/** One thing to pick in a blank's list. */
export interface BlankOption {
  /** What the blank is filled with (what is sent). */
  value: string;
  /** What the chip shows, when that isn't the value. */
  display?: string;
  label: string;
  /** In bold before the label: a pull request's or an issue's number. */
  number?: string;
  /** Quiet text after the label (a file's folder). */
  detail?: string;
  /** A small tag on the right: "2 reviews", "draft", "current". */
  tag?: string;
  /** A draft pull request: its icon is quiet. */
  draft?: boolean;
  /** The one the blank holds now, or the checked-out branch. */
  current?: boolean;
}

export interface BlankPopoverProps {
  blank: PromptBlank;
  /** The chip it opens from. */
  anchor: HTMLElement;
  /** What the blank holds now. */
  value: string;
  /** The key typed on the chip that opened it, as the start of the search. */
  initialQuery: string;
  /** The project's root, for GitHub; the session's folder, for branches and files. */
  root: string | null;
  cwd: string | null;
  onPick(value: string, display?: string): void;
  /** Esc gives the focus back to the chip; a click elsewhere leaves it where it went. */
  onClose(refocus: boolean): void;
  /** Tab and Shift+Tab: on to the next or previous blank. */
  onTab(back: boolean): void;
}

const POPOVER_WIDTH = 420;
const POPOVER_HEIGHT = 340;

/** A number, `#123`, or a link to an issue or pull request on github.com. */
export function readRef(text: string, kind: 'issues' | 'pull'): { number: number; url: string | null } | null {
  const value = text.trim();
  const link = new RegExp(`^https?://github\\.com/[\\w.-]+/[\\w.-]+/${kind}/(\\d+)`, 'i').exec(value);
  if (link) return { number: Number(link[1]), url: value.replace(/[?#].*$/, '').replace(/\/(files|commits|checks)?\/?$/, '') };
  const number = /^#?(\d{1,9})$/.exec(value);
  return number ? { number: Number(number[1]), url: null } : null;
}

/** The tag on a pull request's row: "draft", "2 unresolved comments"; null with nothing to say. */
export function prDetail(pr: Pick<GithubListItem, 'isDraft' | 'unresolved'>): string | null {
  if (pr.isDraft) return 'draft';
  if (pr.unresolved) return pr.unresolved === 1 ? '1 unresolved comment' : `${pr.unresolved} unresolved comments`;
  return null;
}

/** Keeps the options that match what was typed, best first; all of them in their own order for an empty search. */
export function filterOptions(options: readonly BlankOption[], query: string): BlankOption[] {
  const q = query.trim().replace(/^#/, '');
  if (!q) return [...options];
  return options
    .map((option) => ({ option, score: fuzzyScore(q, `${option.number ?? ''} ${option.label} ${option.detail ?? ''}`) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score! - a.score!)
    .map((entry) => entry.option);
}

/**
 * The editor a blank opens: a list of its options (a choice), or a field and what it finds (a pull request, an issue,
 * a branch, a file). It sits under the chip, or over it when there's no room below, and never holds the focus.
 */
export function BlankPopover(props: BlankPopoverProps) {
  const { blank, anchor } = props;
  const ids = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(props.initialQuery);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ options: BlankOption[]; reason: string | null; loading: boolean }>({ options: [], reason: null, loading: blank.type !== 'choice' });
  const [repo, setRepo] = useState<string | null>(null);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const withField = blank.type !== 'choice';

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
      const room = window.innerHeight - rect.bottom;
      setPosition(room < POPOVER_HEIGHT && rect.top > room ? { left, bottom: window.innerHeight - rect.top + 4 } : { left, top: rect.bottom + 4 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  // The field (or the list of a choice) takes the keys; Esc gives them back to the chip.
  useEffect(() => {
    (withField ? fieldRef.current : listRef.current)?.focus();
  }, [withField]);

  // A click outside closes it, and leaves the focus where the click put it.
  useEffect(() => {
    const down = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
      props.onClose(false);
    };
    document.addEventListener('mousedown', down, true);
    return () => document.removeEventListener('mousedown', down, true);
  }, [anchor, props.onClose]);

  // What there is to pick: read once (pull requests, branches), or as you type (files, an issue).
  useEffect(() => {
    if (blank.type === 'choice') return;
    const client = engineClient();
    if (!client) return setFound({ options: [], reason: 'Not connected.', loading: false });
    let stale = false;
    const done = (options: BlankOption[], reason: string | null = null) => !stale && setFound({ options, reason, loading: false });
    if (blank.type === 'pr') {
      if (!props.root) done([], 'Open a project to list its pull requests.');
      else
        // The same list (and cache) as the # list in the message box.
        client.call('github.search', { root: props.root, query: '' }).then(
          ({ pullRequests, repo, reason, message }) => {
            setRepo(repo);
            done(
              pullRequests.map((pr) => ({ value: pr.url, display: `#${pr.number} ${pr.title}`, number: `#${pr.number}`, label: pr.title, tag: prDetail(pr) ?? undefined, draft: pr.isDraft, current: pr.url === props.value })),
              pullRequests.length ? null : (reasonLine(reason, message) ?? 'No open pull requests.'),
            );
          },
          () => done([], "Couldn't list the pull requests."),
        );
    } else if (blank.type === 'branch') {
      if (!props.cwd) done([], 'Open a project to list its branches.');
      else
        client.call('git.branches', { cwd: props.cwd }).then(
          ({ current, branches }) => {
            const ordered = current ? [current, ...branches.filter((b) => b !== current)] : branches;
            done(
              ordered.map((branch) => ({ value: branch, label: branch, tag: branch === current ? 'current' : undefined, current: branch === props.value })),
              ordered.length ? null : 'No local branches.',
            );
          },
          () => done([], "Couldn't list the branches."),
        );
    }
    return () => {
      stale = true;
    };
  }, [blank.type, props.root, props.cwd]);

  useEffect(() => {
    if (blank.type !== 'file' && blank.type !== 'issue') return;
    const client = engineClient();
    if (!client) return;
    let stale = false;
    const done = (options: BlankOption[], reason: string | null = null) => !stale && setFound({ options, reason, loading: false });
    const timer = setTimeout(
      () => {
        if (blank.type === 'file') {
          if (!props.cwd) return done([], 'Open a project to pick a file.');
          client.call('files.search', { cwd: props.cwd, query: query.trim(), limit: 8 }).then(
            ({ files }) => done(files.map((file) => ({ value: `@${file}`, display: file, label: file.slice(file.lastIndexOf('/') + 1), detail: file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : undefined })), files.length ? null : 'No files match.'),
            () => done([], "Couldn't search the files."),
          );
          return;
        }
        if (!props.root) return done([], 'Open a project to look up its issues.');
        setFound((f) => ({ ...f, loading: true }));
        // Words search the open issues, a number or a link finds that one: the same search as the # list.
        client.call('github.search', { root: props.root, query: query.trim() }).then(
          ({ issues, repo, reason, message }) => {
            setRepo(repo);
            done(issues.map(issueOption), issues.length ? null : (reasonLine(reason, message) ?? (query.trim() ? 'No open issue matches.' : 'No open issues.')));
          },
          () => done([], "Couldn't look up the issues."),
        );
      },
      blank.type === 'issue' ? 300 : 120,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [blank.type, query, props.root, props.cwd]);

  const options = useMemo(() => {
    if (blank.type === 'choice') return blank.options.map((option): BlankOption => ({ value: option, label: option, current: option === props.value }));
    // Files and issues are already what the search found.
    if (blank.type === 'file' || blank.type === 'issue') return found.options;
    return filterOptions(found.options, query);
  }, [blank, found.options, query, props.value]);

  /** What was typed, taken as it is when it isn't in the list: a pasted link, a number, a branch name. */
  const typed = useMemo((): BlankOption | null => {
    const text = query.trim();
    if (!text) return null;
    if (blank.type === 'pr') {
      const ref = readRef(text, 'pull');
      if (!ref) return null;
      if (options.some((o) => o.value === ref.url || o.number === `#${ref.number}`)) return null;
      const url = ref.url ?? (repo ? `https://github.com/${repo}/pull/${ref.number}` : `#${ref.number}`);
      return { value: url, display: `#${ref.number}`, label: `Use #${ref.number}`, tag: ref.url ? 'from the link' : 'not open' };
    }
    if (blank.type === 'issue') {
      const ref = readRef(text, 'issues');
      if (!ref || options.length) return null;
      return { value: ref.url ?? `#${ref.number}`, display: ref.url ?? `#${ref.number}`, label: `Use ${ref.url ? 'this link' : `#${ref.number}`}`, tag: found.loading ? 'looking it up…' : undefined };
    }
    if (blank.type === 'branch') return options.some((o) => o.value === text) ? null : { value: text, label: `Use “${text}”`, tag: 'not a local branch' };
    return null;
  }, [query, options, blank.type, repo, found.loading]);

  const rows = typed ? [...options, typed] : options;
  useEffect(() => setActive(0), [query, rows.length]);
  useEffect(() => {
    document.getElementById(`${ids}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, ids]);

  const pick = (option: BlankOption | undefined) => {
    if (option) props.onPick(option.value, option.display);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length) setActive((i) => (i + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      pick(rows[active]);
    } else if (event.key === 'Escape') {
      // Only this closes: the message box doesn't stop Claude, and a dialog under it stays.
      event.preventDefault();
      event.stopPropagation();
      props.onClose(true);
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      props.onTab(event.shiftKey);
    } else if (!withField && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      // A letter jumps to the next option that starts with it.
      const letter = event.key.toLowerCase();
      const next = rows.findIndex((row, i) => i > active && row.label.toLowerCase().startsWith(letter));
      const first = rows.findIndex((row) => row.label.toLowerCase().startsWith(letter));
      if (next !== -1 || first !== -1) setActive(next !== -1 ? next : first);
    }
  };

  const Icon = BLANK_ICONS[blank.type];
  const hint = blank.type === 'pr' ? 'number, URL or title' : blank.type === 'issue' ? 'paste a link or type #' : blank.type === 'branch' ? 'filter branches' : 'search files';
  const heading = blank.type === 'pr' ? `Open pull requests${repo ? ` · ${repo}` : ''}` : blank.type === 'issue' ? 'Issue' : blank.type === 'branch' ? 'Local branches' : blank.type === 'file' ? 'Files' : chipLabel(blank);
  const style = { left: position.left, width: POPOVER_WIDTH, ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }) };

  return createPortal(
    <div ref={rootRef} className="fixed z-50 flex max-h-[340px] flex-col overflow-hidden rounded-lg border overlay" style={style} data-blank-popover={blank.name} data-popover>
      {withField && (
        <label className="mx-2 mt-2 flex items-center gap-2 rounded-md border border-edge bg-bg px-2.5 py-1.5 focus-within:border-accent-ink/60">
          <Icon size={13} aria-hidden className="shrink-0 text-muted" />
          <input
            ref={fieldRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={`${chipLabel(blank)}: ${hint}`}
            role="combobox"
            aria-expanded
            aria-controls={`${ids}-list`}
            aria-activedescendant={rows.length ? `${ids}-option-${active}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-ui text-text outline-none"
            data-blank-field
          />
          <span className="shrink-0 text-meta text-faint" aria-hidden>
            {hint}
          </span>
        </label>
      )}
      <p className="px-3 pt-2.5 pb-1 text-meta font-semibold tracking-wide text-faint uppercase" aria-hidden>
        {heading}
        {blank.optional && <span className="font-normal normal-case"> · optional</span>}
      </p>
      <ul
        ref={listRef}
        id={`${ids}-list`}
        role="listbox"
        aria-label={heading}
        tabIndex={withField ? -1 : 0}
        onKeyDown={withField ? undefined : onKeyDown}
        aria-activedescendant={!withField && rows.length ? `${ids}-option-${active}` : undefined}
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-1 outline-none"
      >
        {rows.map((row, i) => {
          const RowIcon = blank.type === 'choice' ? null : Icon;
          return (
            <li
              key={`${row.value}\u0000${i}`}
              id={`${ids}-option-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(row);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-ui ${i === active ? 'bg-border/60' : ''}`}
              data-blank-option={row.value}
            >
              {RowIcon && <RowIcon size={13} aria-hidden className={`shrink-0 ${blank.type === 'pr' && !row.draft ? 'text-ok' : 'text-muted'}`} />}
              {row.number && <span className="shrink-0 font-semibold text-text">{row.number}</span>}
              <span className={`min-w-0 truncate text-text ${blank.type === 'branch' || blank.type === 'file' ? 'font-mono' : ''}`}>{row.label}</span>
              {row.detail && <span className="min-w-0 truncate text-meta text-muted">{row.detail}</span>}
              {row.tag && <span className="ml-auto shrink-0 rounded-md bg-border/60 px-1.5 py-px text-meta text-muted">{row.tag}</span>}
              {row.current && <Check size={12} aria-label="Current" className={`${row.tag ? '' : 'ml-auto'} shrink-0 text-accent-ink`} />}
            </li>
          );
        })}
      </ul>
      {(found.loading && rows.length === 0) || (!found.loading && found.reason && rows.length === 0) ? (
        <p className="px-3 pb-2 text-meta text-muted" role="status">
          {found.loading ? 'Loading…' : found.reason}
        </p>
      ) : null}
      <p className="flex items-center gap-1 border-t border-edge px-3 py-1.5 text-meta text-faint" aria-hidden>
        <Kbd keys="↑↓" tone="plain" /> pick · <Kbd keys="↵" /> fill · <Kbd keys="Esc" tone="plain" /> closes
      </p>
    </div>,
    document.body,
  );
}

const issueOption = (issue: GithubListItem): BlankOption => ({ value: issue.url, display: `#${issue.number} ${issue.title}`, number: `#${issue.number}`, label: issue.title });
