import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoadEntry } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { tildify } from '../../lib/format.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { Select } from '../ui/Select.tsx';
import { barSegments, formatSize, KIND_FILL, legendItems, loadSummary, loadedBytes } from './loadOrderView.ts';

const OPEN_KEY = 'ui.memoryLoadOrderOpen';
/** Past what loads: the error colour in stripes, so it reads as "not there" rather than as another file. */
const STRIPES = { backgroundImage: 'repeating-linear-gradient(135deg, var(--sb-error) 0 3px, transparent 3px 6px)' };

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};

/**
 * What loads in a session here: every file Claude Code reads at launch for this project, in order, as a bar by size
 * and a legend. MEMORY.md shows how much of it loads, and what doesn't in striped red. Clicking an entry selects that
 * file. It folds to one line (open the first time, then as you left it).
 */
export function LoadOrderCard({ root, home, onSelect, extra }: { root: string; home: string | null; onSelect(path: string): void; extra?: ReactNode }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const profiles = useProfiles((s) => s.profiles);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LoadEntry[] | null>(null);
  const [open, setOpen] = useState(readOpen);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.call('memory.loadOrder', { root, profileId }).then(
      (result) => !cancelled && (setEntries(result.entries), setProfileId(result.profileId)),
      () => !cancelled && setEntries([]),
    );
    return () => {
      cancelled = true;
    };
  }, [client, root, profileId, version]);
  useEffect(() => {
    if (!client) return;
    return client.on('memory.changed', (change) => (change.root === root || change.root === null) && setVersion((v) => v + 1));
  }, [client, root]);

  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1');
      } catch {
        // Remembering is a convenience.
      }
      return !o;
    });
  };
  // Inside the project: relative to it. Elsewhere: `~/…`, or the last two parts of a path outside your home folder.
  const label = (path: string) => {
    if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
    const short = tildify(path, home);
    return short.startsWith('~') ? short : `…/${path.split('/').slice(-2).join('/')}`;
  };
  const segments = useMemo(() => barSegments(entries ?? []), [entries]);
  const legend = useMemo(() => legendItems(entries ?? [], label), [entries, root, home]);
  const total = segments.reduce((n, s) => n + s.bytes, 0) || 1;

  return (
    <section className="grid gap-2.5 rounded-xl border border-border bg-card px-4 py-3" aria-labelledby="memory-load-heading" data-memory-load-order data-open={open}>
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex min-w-0 items-center gap-1.5 text-left" data-memory-load-toggle>
          <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
          <h3 id="memory-load-heading" className="text-ui font-semibold">
            What loads in a session here
          </h3>
          <span className="truncate text-meta text-muted">{open ? 'at launch' : entries ? loadSummary(entries) : ''}</span>
        </button>
        <span className="flex-1" />
        {extra}
        {profiles.length > 1 && profileId && (
          <Select
            label="Claude profile"
            value={profileId}
            onChange={setProfileId}
            options={profiles.map((p) => ({ value: p.id, label: p.name }))}
            className="flex h-6 items-center gap-1 rounded-md border border-edge bg-bg px-2 text-meta text-text"
            dataAttrs={{ 'data-memory-load-profile': true }}
          />
        )}
      </div>
      {open && entries && (
        <>
          {segments.length === 0 ? (
            <p className="text-meta text-muted">Nothing loads here yet: no CLAUDE.md, rules or memory.</p>
          ) : (
            <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-selected" role="img" aria-label={loadSummary(entries)}>
              {segments.map((s) => (
                <span key={s.key} className={s.overflow ? '' : KIND_FILL[s.kind]} style={{ width: `${(s.bytes / total) * 100}%`, minWidth: 3, ...(s.overflow ? STRIPES : {}) }} />
              ))}
            </div>
          )}
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
            {legend.map((item) => (
              <li key={item.key}>
                <button type="button" onClick={() => onSelect(item.paths[0]!)} className={`flex items-center gap-1.5 hover:underline ${item.overflow ? 'text-error' : item.onDemand ? 'text-faint' : 'text-muted'}`} data-memory-load-item={item.paths[0]}>
                  <span className={`size-2 shrink-0 rounded-[2px] ${item.overflow ? '' : KIND_FILL[item.kind]}`} style={item.overflow ? STRIPES : undefined} aria-hidden />
                  <span className={item.kind === 'memory' || item.label.includes('/') || item.label.endsWith('.md') ? 'font-mono' : ''}>{item.label}</span>
                  {item.detail && <span className="text-faint">· {item.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="sr-only">{`${formatSize(entries.reduce((n, e) => n + loadedBytes(e), 0))} in total at launch.`}</p>
        </>
      )}
    </section>
  );
}
