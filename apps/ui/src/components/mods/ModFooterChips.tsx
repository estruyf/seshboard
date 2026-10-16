import { Puzzle, ShieldCheck } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ModStatus } from '@switchboard/protocol/client';
import { useSessionMods } from '../../state/modsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Popover } from '../ui/Popover.tsx';
import { fitStatuses, plusLabel, screenedBy } from './modFooter.ts';
import { shownMods } from './modVisibility.ts';

const CHIP = 'flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-ui whitespace-nowrap';

function StatusFace({ status }: { status: ModStatus }) {
  return (
    <>
      <Puzzle size={11} className="shrink-0 text-muted" aria-hidden />
      <span className="text-muted">{status.plugin}</span>
      <span className="max-w-48 truncate font-medium text-text">{status.text}</span>
    </>
  );
}

/**
 * The footer's mod chips, before Send: the shield when a mod checks prompts (it stays with Show mods off, because the
 * checking happens in Claude Code), then the mods' statuses, folding into "+N" before anything else in the footer moves.
 */
export function ModFooterChips({ sessionId, profileId }: { sessionId: string; profileId: string | null }) {
  const mods = useSessionMods(sessionId);
  const prefs = usePreferences((s) => s.prefs);
  const statuses = mods.state.attached ? shownMods(prefs, profileId, mods.statuses) : [];
  const [shown, setShown] = useState(statuses.length);
  const [list, setList] = useState<{ x: number; y: number } | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const key = statuses.map((s) => `${s.plugin}\0${s.text}`).join('\n');

  useLayoutEffect(() => {
    const group = groupRef.current;
    const copies = measureRef.current;
    const footer = group?.closest<HTMLElement>('[data-composer-footer]');
    if (!group || !copies || !footer) return;
    const measure = () => {
      const start = footer.querySelector<HTMLElement>('[data-composer-footer-start]');
      const end = footer.querySelector<HTMLElement>('[data-composer-footer-end]');
      // The chip row at its full size (its first measuring copy), so the statuses fold before it steps down.
      const rowFull = start?.querySelector<HTMLElement>('[data-composer-chips] > [aria-hidden] > div')?.getBoundingClientRect().width ?? 0;
      const attach = start ? [...start.children].filter((c) => !(c as HTMLElement).matches('[data-composer-chips]')).reduce((w, c) => w + c.getBoundingClientRect().width, 0) : 0;
      const others = end ? end.getBoundingClientRect().width - group.getBoundingClientRect().width : 0;
      const available = footer.clientWidth - attach - rowFull - others - 16;
      const chips = [...copies.children] as HTMLElement[];
      const widths = chips.slice(0, -1).map((c) => c.getBoundingClientRect().width);
      const plus = chips.at(-1)?.getBoundingClientRect().width ?? 28;
      setShown(fitStatuses(widths, available, () => plus));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    for (const copy of copies.children) observer.observe(copy);
    return () => observer.disconnect();
  }, [key]);

  const hidden = statuses.length - shown;
  const screened = mods.state.promptsScreened;
  if (!screened && statuses.length === 0) return null;
  const checker = screenedBy(mods.state.plugins);
  return (
    <div ref={groupRef} className="relative flex shrink-0 items-center gap-1" data-mod-status-group>
      {screened && (
        <span className={`${CHIP} bg-ok/12 text-ok`} data-tooltip={`Prompts checked by ${checker} before Claude reads them`} data-mod-shield>
          <ShieldCheck size={12} className="shrink-0" aria-hidden />
          checked
        </span>
      )}
      {statuses.slice(0, shown).map((status) => (
        <span key={status.plugin} className={`${CHIP} bg-border/40`} data-tooltip={`${status.plugin}: ${status.text}`} data-mod-status={status.plugin}>
          <StatusFace status={status} />
        </span>
      ))}
      {hidden > 0 && (
        <button
          ref={plusRef}
          type="button"
          className={`${CHIP} bg-border/40 text-muted hover:bg-border/70 hover:text-text`}
          aria-label={`${hidden} more mod ${hidden === 1 ? 'status' : 'statuses'}`}
          aria-expanded={list !== null}
          onClick={() => {
            const rect = plusRef.current!.getBoundingClientRect();
            setList(list ? null : { x: rect.left, y: rect.top - 6 });
          }}
          data-mod-status-more
        >
          {plusLabel(hidden)}
        </button>
      )}
      {list && (
        <Popover x={list.x} y={list.y} above width={280} anchor={plusRef} onClose={() => setList(null)} className="overlay grid gap-0.5 rounded-lg p-1.5" role="dialog" aria-label="Mod statuses" data-mod-status-list>
          {statuses.map((status) => (
            <div key={status.plugin} className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-ui">
              <StatusFace status={status} />
            </div>
          ))}
        </Popover>
      )}
      {/* Every chip and the "+N" chip, measured out of sight. */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
        {statuses.map((status) => (
          <span key={status.plugin} className={CHIP}>
            <StatusFace status={status} />
          </span>
        ))}
        <span className={CHIP}>{plusLabel(Math.max(1, statuses.length))}</span>
      </div>
    </div>
  );
}
