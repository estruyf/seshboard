import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { Fragment, useState, type MouseEvent } from 'react';
import type { GithubListItem } from '@seshboard/protocol/client';
import { shortAge } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { branchLine } from './githubList.ts';
import { itemLabel, openedLine, unresolvedText } from './githubText.ts';
import { ForkFlag, GithubLabels, GithubStateIcon } from './GithubParts.tsx';

export interface GithubListProps {
  /** The listbox's id (the message box's `aria-controls`). */
  id: string;
  /** Each option's id (the message box's `aria-activedescendant`). */
  optionId(index: number): string;
  rows: readonly GithubListItem[];
  active: number;
  /** The project's repository, for the header ("open · estruyf/switchboard"). */
  repo: string | null;
  loading: boolean;
  /** Why the list may be old or empty (a rate limit, offline); shown above the rows. */
  notice: string | null;
  /** What an empty list says. */
  empty: string;
  /** A row was clicked: add it, or (⌥-click) start a new session from it. */
  onPick(index: number, newSession: boolean): void;
  onRefresh?(): void;
  /** The keys under the list (left out where another control says them). */
  footer?: boolean;
  className?: string;
}

/**
 * The `#` list: the project's open issues, then its open pull requests, as a listbox with a group for each. Focus
 * stays in the message box (or the picker's field), which points at the highlighted row; nothing here takes it.
 */
export function GithubList(props: GithubListProps) {
  const { rows, active } = props;
  const issues = rows.filter((r) => r.type === 'issue').length;
  const groups = [
    { key: 'issue', heading: 'Issues', from: 0, to: issues },
    { key: 'pr', heading: 'Pull requests', from: issues, to: rows.length },
  ].filter((g) => g.to > g.from);
  const keep = (e: MouseEvent) => e.preventDefault();
  return (
    <div className={`overlay flex max-h-96 flex-col overflow-hidden rounded-lg border ${props.className ?? ''}`} data-github-list>
      {props.notice && (
        <p className="border-b border-edge px-3 py-1.5 text-meta text-caution" role="status" data-github-notice>
          {props.notice}
        </p>
      )}
      <div id={props.id} role="listbox" aria-label="Issues and pull requests" className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.map((group, g) => (
          <div key={group.key} role="group" aria-labelledby={`${props.id}-${group.key}`}>
            <div className="flex items-center gap-2 px-3 pt-1.5 pb-1" role="presentation">
              <span id={`${props.id}-${group.key}`} className="text-meta font-semibold tracking-wide text-faint uppercase">
                {group.heading}
              </span>
              {g === 0 && props.repo && (
                <span className="ml-auto min-w-0 truncate text-meta text-faint" data-github-list-repo>
                  open · {props.repo}
                </span>
              )}
              {g === 0 && props.onRefresh && (
                <Button variant="quiet" size="sm" iconOnly icon={<RefreshCw size={11} aria-hidden className={props.loading ? 'animate-spin' : ''} />} aria-label="Refresh" onMouseDown={keep} onClick={props.onRefresh} className={props.repo ? '' : 'ml-auto'} data-github-refresh />
              )}
            </div>
            {rows.slice(group.from, group.to).map((row, j) => {
              const i = group.from + j;
              return (
                <Fragment key={`${row.type}:${row.repo}#${row.number}`}>
                  <div
                    id={props.optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    aria-label={itemLabel(row)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      props.onPick(i, e.altKey);
                    }}
                    className={`mx-1 flex cursor-default items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-border/45 ${i === active ? 'bg-selected' : ''}`}
                    data-github-option={`${row.type}:${row.number}`}
                  >
                    <span className="mt-0.5">
                      <GithubStateIcon type={row.type} state={row.state} draft={row.isDraft} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 font-mono text-ui text-muted">#{row.number}</span>
                        <span className={`min-w-0 truncate text-ui font-semibold ${row.state === 'open' ? 'text-text' : 'text-muted'}`}>{row.title}</span>
                        {row.isDraft && <span className="shrink-0 rounded-full border border-edge px-1.5 text-meta leading-4 text-muted">draft</span>}
                        {row.isCrossRepository && <ForkFlag readOnly={false} />}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-muted">
                        {row.type === 'pr' ? (
                          <>
                            <span className="min-w-0 truncate font-mono">{branchLine(row)}</span>
                            {!!row.unresolved && <span className="shrink-0">· {unresolvedText(row.unresolved)}</span>}
                          </>
                        ) : (
                          <>
                            <span className="shrink-0">{openedLine(row)}</span>
                            <GithubLabels labels={row.labels} />
                          </>
                        )}
                      </span>
                    </span>
                    <span className="mt-0.5 shrink-0 text-meta text-faint tabular-nums">{row.updatedAt ? shortAge(row.updatedAt) : ''}</span>
                  </div>
                </Fragment>
              );
            })}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="px-3 py-2 text-ui text-muted" role="status" data-github-empty>
            {props.loading ? 'Loading…' : props.empty}
          </p>
        )}
      </div>
      {props.footer !== false && (
        <p className="flex flex-wrap items-center gap-x-1 border-t border-edge px-3 py-1.5 text-meta text-faint" aria-hidden>
          <Kbd keys="↑↓" tone="plain" /> move · <Kbd keys="↵" tone="plain" /> add · <Kbd shortcut="composer.github-new-session" tone="plain" /> new session from it · <Kbd keys="Esc" tone="plain" /> keeps typing
        </p>
      )}
    </div>
  );
}

/** The GitHub CLI's page, for installing it. */
export const GH_INSTALL_URL = 'https://cli.github.com/';

/**
 * The one hint the `#` list shows in a project when the GitHub CLI isn't there or signed in: how to sign in, with a
 * copy button, and where to install it. Pasted links to issues still work without it.
 */
export function GithubHint({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const keep = (e: MouseEvent) => e.preventDefault();
  return (
    <div className={`overlay rounded-lg border p-3.5 ${className}`} role="note" aria-label="Search issues with the GitHub CLI" data-github-hint>
      <p className="text-ui font-semibold text-text">Search issues with the GitHub CLI</p>
      <p className="mt-0.5 text-ui text-muted">Install it, then sign in once. You can still paste an issue link.</p>
      <div className="mt-2.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-edge bg-code px-2.5 py-1.5 font-mono text-ui text-text" data-github-hint-command>
          gh auth login
        </code>
        <Button
          size="md"
          icon={<Copy size={13} aria-hidden />}
          onMouseDown={keep}
          onClick={() => void navigator.clipboard?.writeText('gh auth login').then(() => setCopied(true), () => {})}
          data-github-hint-copy
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <button type="button" onMouseDown={keep} onClick={() => void window.open(GH_INSTALL_URL, '_blank')} className="mt-2 flex items-center gap-1 text-ui text-link hover:underline" data-github-hint-install>
        How to install gh
        <ExternalLink size={11} aria-hidden />
      </button>
    </div>
  );
}
