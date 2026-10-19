import { CircleCheck, CircleDot, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ContextItem, GithubIssueDetail, GithubItemType, GithubLabel, GithubPrDetail } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { liftContrast } from '../mods/modColor.ts';
import { useCardColor } from '../mods/useModRender.ts';

/**
 * An issue's or pull request's state, as GitHub draws it: an open one in `ok`, a draft, closed or merged one muted
 * (closed things are quiet everywhere in Switchboard; no state takes a colour of its own here).
 */
export function GithubStateIcon({ type, state, draft = false, size = 14 }: { type: GithubItemType; state: string | null; draft?: boolean; size?: number }) {
  const Icon = type === 'pr' ? (state === 'merged' ? GitMerge : state === 'closed' ? GitPullRequestClosed : draft ? GitPullRequestDraft : GitPullRequest) : state === 'closed' ? CircleCheck : CircleDot;
  const open = state !== 'closed' && state !== 'merged' && !draft;
  return <Icon size={size} className={`shrink-0 ${open ? 'text-ok' : 'text-muted'}`} aria-hidden data-github-state={state ?? 'open'} />;
}

/** Labels as small pills in their GitHub colours, lifted to 4.5:1 on the theme's surface so each one reads. */
export function GithubLabels({ labels, max = 3 }: { labels: readonly GithubLabel[]; max?: number }) {
  const surface = useCardColor();
  return (
    <>
      {labels.slice(0, max).map((label) => {
        const color = label.color ? liftContrast(`#${label.color}`, surface) : null;
        return (
          <span
            key={label.name}
            className="max-w-32 shrink-0 truncate rounded-full border border-edge px-1.5 text-meta leading-4 text-muted"
            style={color ? { color, borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined}
            data-github-label
          >
            {label.name}
          </span>
        );
      })}
    </>
  );
}

/** "fork · read-only" on a pull request from a fork you can't push to. */
export function ForkFlag({ readOnly }: { readOnly: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-caution/12 px-1.5 text-meta leading-4 font-medium text-caution" data-github-fork>
      {readOnly && <Lock size={9} aria-hidden />}
      {readOnly ? 'fork · read-only' : 'fork'}
    </span>
  );
}

type Detail = GithubIssueDetail | GithubPrDetail;
/** Details read for chips while the app runs: a chip added again shows them at once. */
const known = new Map<string, Detail | null>();
const keyOf = (item: { type: GithubItemType; repo: string; number: number }) => `${item.type}:${item.repo.toLowerCase()}#${item.number}`;

/**
 * An attached item's details (labels, comments, a pull request's branch and review comments), read through gh by the
 * engine. Reading them also readies what Claude gets: the engine keeps them, so sending doesn't wait for gh.
 */
export function useGithubDetail(item: Extract<ContextItem, { kind: 'github' }>, root: string | null): Detail | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const key = keyOf(item);
  const [detail, setDetail] = useState<Detail | null>(() => known.get(key) ?? null);
  useEffect(() => {
    if (!client || !root) return;
    let current = true;
    const done = (found: Detail | null) => {
      if (found) known.set(key, found);
      if (current && found) setDetail(found);
    };
    if (item.type === 'pr') client.call('github.pr', { root, ref: item.url }).then(({ pr }) => done(pr), () => {});
    else client.call('github.issue', { root, ref: item.url }).then(({ issue }) => done(issue), () => {});
    return () => {
      current = false;
    };
  }, [client, root, key]);
  return detail;
}
