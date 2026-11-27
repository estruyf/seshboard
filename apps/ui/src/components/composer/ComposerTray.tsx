import { Blocks } from 'lucide-react';
import { createContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CHOICE_PILL } from '../newSession/ChoiceMenu.tsx';
import { trayLevel, type TrayLevel } from './trayFold.ts';

/** Usage in one line, for the folded chip's menu ("5h 17% · Week 19%"); `onOpen` opens the Usage view. */
export interface TrayUsage {
  text: string;
  onOpen?(): void;
}

/** What the chip row inside the tray needs to fold: whether it is folded, and what moves into its menu. */
export interface TrayState {
  folded: boolean;
  tools?: (() => void) | null;
  usage?: TrayUsage | null;
  /** Minimal mode: the chip row says what it shows in one line, for the box (`composerSummary`). */
  onSummary?(summary: string): void;
}

/** Read by `ComposerChipRow`: inside a folded tray, model, effort and mode become one chip. */
export const TrayContext = createContext<TrayState>({ folded: false });

/** The smallest level of the chip row, which the row keeps rendered out of sight for measuring. */
const SMALLEST_ROW = '[data-composer-chips] > [aria-hidden] > div:last-child';
/** What the chip row keeps before its chips (`lead`), which doesn't fold. */
const ROW_LEAD = '[data-composer-chips-lead]';
/** An estimated cost on the right (a window's, extra usage, the session's): the first thing to go when room runs out. */
const TRAY_COST = '[data-tray-cost]';

/** The room the costs take on the right: each one's width plus the gap before it, which goes with it. */
function costsWidth(root: Element | null): number {
  if (!root) return 0;
  let total = 0;
  for (const el of root.querySelectorAll(TRAY_COST)) {
    const width = el.getBoundingClientRect().width;
    if (width <= 0) continue;
    const gap = el.parentElement ? parseFloat(getComputedStyle(el.parentElement).columnGap) || 0 : 0;
    total += width + gap;
  }
  return total;
}

export interface ComposerTrayProps {
  /** The options: the chip row (profile, model, effort, mode), or a line saying why there are none. */
  controls?: ReactNode;
  /** Opens Tools (the MCP servers, skills, agents and plugins), for a session that has them. */
  tools?: (() => void) | null;
  /** Usage on the right: plan usage and cost, or another provider's premium requests. */
  info?: ReactNode;
  /** The same usage in one line, for the folded chip's menu. */
  usage?: TrayUsage | null;
  /** The context ring, last on the right. It stays when the tray folds. */
  meter?: ReactNode;
  /**
   * Minimal mode: the tray is a popover over the box, opened from the box's one-line summary, and hidden (but kept, so
   * the chips can say their summary) while closed.
   */
  minimal?: { open: boolean; onSummary(summary: string): void; onClose(): void };
}

/**
 * The tray that hangs under the message box: how the next message runs. The options on the left, then Tools, usage
 * and the context ring on the right. When the chips at their smallest level and the right side don't fit, the costs go
 * first (`lean`). When it still doesn't fit, it folds: model, effort and mode become one chip (`TrayContext`), Tools
 * and usage move into its menu, and the ring stays.
 */
export function ComposerTray({ controls, tools, info, usage, meter, minimal }: ComposerTrayProps) {
  const trayRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const foldableRef = useRef<HTMLSpanElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const [level, setLevel] = useState<TrayLevel>('full');
  // The costs' width, from the last time they showed: while the tray is lean they are hidden and measure nothing.
  const costsRef = useRef(0);
  const folded = level === 'folded';

  useLayoutEffect(() => {
    const tray = trayRef.current;
    const start = startRef.current;
    if (!tray || !start) return;
    const width = (el: Element | null | undefined) => el?.getBoundingClientRect().width ?? 0;
    const measure = () => {
      const style = getComputedStyle(tray);
      const available = tray.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // What folds is measured whether it shows or not: folded, it stays laid out out of sight.
      const lead = start.querySelector(ROW_LEAD);
      // Lean, the costs are hidden: the line with them is what shows now plus what they took the last time they showed.
      // Read from the DOM, so it is the level on screen, not one set but not rendered yet.
      const lean = tray.hasAttribute('data-composer-tray-lean');
      if (!lean) costsRef.current = costsWidth(foldableRef.current);
      const info = width(foldableRef.current) + (lean ? costsRef.current : 0);
      const next = trayLevel(available, { chips: width(start.querySelector(SMALLEST_ROW)) + (lead ? width(lead) + 2 : 0), info, ring: width(meterRef.current), costs: costsRef.current });
      setLevel(next);
    };
    measure();
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect();
      for (const el of [tray, start.querySelector(SMALLEST_ROW), start.querySelector(ROW_LEAD), foldableRef.current, meterRef.current]) if (el) resize.observe(el);
    };
    observe();
    // A chip row, Tools or a ring that mounts or changes after this runs (a session that starts, another model).
    const mutation = new MutationObserver(() => {
      observe();
      measure();
    });
    mutation.observe(tray, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, []);

  const hasFoldable = !!tools || !!info;
  return (
    <TrayContext.Provider value={{ folded, tools, usage, onSummary: minimal?.onSummary }}>
      <div
        ref={trayRef}
        role="group"
        aria-label="Options for the next message"
        // Tinted, not outlined, so it hangs under the box: a grey from the text colour shows on white (light) as on dark.
        // In Minimal mode it floats over the box, as a popover, while its summary is open.
        className={
          minimal
            ? `${minimal.open ? 'flex' : 'hidden'} overlay absolute right-4 bottom-full left-4 z-30 mb-2 min-h-9 items-center gap-1 rounded-xl border px-1.5 py-1 text-ui text-muted`
            : 'relative mx-4 flex min-h-9 items-center gap-1 rounded-b-xl bg-text/6 px-1.5 py-1 text-ui text-muted forced-colors:border forced-colors:border-t-0'
        }
        onKeyDown={
          minimal
            ? (event) => {
                if (event.key !== 'Escape' || event.defaultPrevented) return;
                event.preventDefault();
                event.stopPropagation();
                minimal.onClose();
              }
            : undefined
        }
        data-composer-tray-popover={minimal ? (minimal.open ? 'open' : 'closed') : undefined}
        data-composer-tray
        data-composer-tray-folded={folded || undefined}
        data-composer-tray-lean={level === 'lean' || undefined}
      >
        <div ref={startRef} className="flex min-w-0 flex-1 items-center">
          {controls}
        </div>
        <div className="flex shrink-0 items-center gap-1" data-composer-tray-info>
          {hasFoldable && (
            // Folded, it stays laid out (so it is still measured) but out of sight, out of the tab order and unread.
            <span
              ref={foldableRef}
              aria-hidden={folded || undefined}
              className={`${folded ? 'pointer-events-none invisible absolute top-0 right-0 flex w-max items-center gap-1' : 'flex items-center gap-1'} ${level === 'lean' ? '[&_[data-tray-cost]]:hidden' : ''}`}
            >
              {tools && (
                <button
                  type="button"
                  onClick={tools}
                  className={CHOICE_PILL}
                  data-open-tools
                  data-tooltip="Tools: the MCP servers, skills, agents and plugins this session can use"
                  aria-label="Tools: MCP servers, skills, agents and plugins"
                  aria-haspopup="dialog"
                >
                  <Blocks size={13} className="shrink-0" aria-hidden />
                  Tools
                </button>
              )}
              {info}
            </span>
          )}
          {meter && (
            <span ref={meterRef} className="flex items-center">
              {meter}
            </span>
          )}
        </div>
      </div>
    </TrayContext.Provider>
  );
}
