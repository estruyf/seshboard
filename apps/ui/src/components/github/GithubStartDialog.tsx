import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { GithubItemType, GithubListItem, GithubSearchResult } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { startFromGithub } from '../../state/githubStartStore.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { cachedSearch, forgetGithub, githubStatus, rememberSearch } from './githubCache.ts';
import { rowsOf, SEARCH_DEBOUNCE_MS } from './githubList.ts';
import { GithubHint, GithubList } from './GithubList.tsx';
import { reasonLine } from './githubText.ts';

/**
 * The palette's "New session from issue…" and "New session from pull request…": the # list on its own, with only
 * that kind, for the project on screen. ↩ (or a click) opens New session filled in from the one picked; nothing runs
 * until Start there.
 */
export function GithubStartDialog({ type, root, onClose }: { type: GithubItemType; root: string; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const ids = useId();
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<GithubSearchResult | null>(() => cachedSearch(root, ''));
  const [loading, setLoading] = useState(true);
  /** gh isn't there or signed in (the hint), or the project isn't on GitHub (a line). */
  const [unavailable, setUnavailable] = useState<'hint' | 'not-github' | null>(null);
  const [refresh, setRefresh] = useState(0);
  const word = type === 'pr' ? 'pull request' : 'issue';

  useEffect(() => {
    if (!client) return;
    let stale = false;
    const known = refresh ? null : cachedSearch(root, query);
    if (known) setResult(known);
    setLoading(true);
    const timer = setTimeout(
      () => {
        void githubStatus(client, root).then(
          async (status) => {
            if (stale) return;
            if (!status.available) {
              setUnavailable(status.reason === 'not-github' ? 'not-github' : 'hint');
              setLoading(false);
              return;
            }
            setUnavailable(null);
            const found = await client.call('github.search', { root, query, refresh: refresh > 0 }).catch(() => null);
            if (stale) return;
            if (found) {
              rememberSearch(root, query, found);
              setResult(found);
            }
            setLoading(false);
          },
          () => !stale && setLoading(false),
        );
      },
      known || !query ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [client, root, query, refresh]);

  const rows = result ? rowsOf(result, type) : [];
  useEffect(() => setActive(0), [query, rows.length]);
  useEffect(() => {
    document.getElementById(`${ids}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, ids]);

  const pick = (row: GithubListItem | undefined) => {
    if (!row) return;
    onClose();
    startFromGithub({ root, type: row.type, ref: row.url, item: row, link: null });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length) setActive((i) => (i + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      pick(rows[active]);
    }
  };
  const reason = result ? reasonLine(result.reason, result.message) : null;

  return (
    <Dialog bare flush placement="top" width="palette" title={`New session from ${word}`} onClose={onClose} data-github-start-dialog={type}>
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <span className="shrink-0 rounded-md bg-border/50 px-1.5 py-0.5 text-ui text-muted">New session from {word}</span>
        <input
          ref={field}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Search, type a number, or paste a link to a ${word}`}
          aria-label={`Search ${word === 'issue' ? 'issues' : 'pull requests'}`}
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={`${ids}-list`}
          aria-activedescendant={rows.length ? `${ids}-option-${active}` : undefined}
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-faint"
          data-github-start-field
        />
      </div>
      <div className="p-2">
        {unavailable === 'hint' ? (
          <GithubHint className="shadow-none" />
        ) : unavailable === 'not-github' ? (
          <p className="px-2 py-3 text-ui text-muted" role="status">
            This project has no remote on GitHub.
          </p>
        ) : (
          <GithubList
            id={`${ids}-list`}
            optionId={(i) => `${ids}-option-${i}`}
            rows={rows}
            active={active}
            repo={result?.repo ?? null}
            loading={loading}
            notice={result?.stale && reason ? `${reason} Showing the last list.` : null}
            empty={reason ?? (query ? `No open ${word} matches.` : `No open ${word === 'issue' ? 'issues' : 'pull requests'}.`)}
            onPick={(i) => pick(rows[i])}
            onRefresh={() => {
              forgetGithub(root);
              setRefresh((n) => n + 1);
            }}
            footer={false}
            className="max-h-[60vh] border-0 shadow-none"
          />
        )}
      </div>
    </Dialog>
  );
}
