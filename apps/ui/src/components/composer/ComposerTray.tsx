import { Blocks } from 'lucide-react';
import { createContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CHOICE_PILL } from '../newSession/ChoiceMenu.tsx';
import { trayFolds } from './trayFold.ts';

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
}

/** Read by `ComposerChipRow`: inside a folded tray, model, effort and mode become one chip. */
export const TrayContext = createContext<TrayState>({ folded: false });

/** The smallest level of the chip row, which the row keeps rendered out of sight for measuring. */
const SMALLEST_ROW = '[data-composer-chips] > [aria-hidden] > div:last-child';

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
}

/**
 * The tray that hangs under the message box: how the next message runs. The options on the left, then Tools, usage
 * and the context ring on the right. When the chips at their smallest level and the right side don't fit, it folds:
 * model, effort and mode become one chip (`TrayContext`), Tools and usage move into its menu, and the ring stays.
 */
export function ComposerTray({ controls, tools, info, usage, meter }: ComposerTrayProps) {
  const trayRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const foldableRef = useRef<HTMLSpanElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const [folded, setFolded] = useState(false);

  useLayoutEffect(() => {
    const tray = trayRef.current;
    const start = startRef.current;
    if (!tray || !start) return;
    const width = (el: Element | null | undefined) => el?.getBoundingClientRect().width ?? 0;
    const measure = () => {
      const style = getComputedStyle(tray);
      const available = tray.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // What folds is measured whether it shows or not: folded, it stays laid out out of sight.
      setFolded(trayFolds(available, { chips: width(start.querySelector(SMALLEST_ROW)), info: width(foldableRef.current), ring: width(meterRef.current) }));
    };
    measure();
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect();
      for (const el of [tray, start.querySelector(SMALLEST_ROW), foldableRef.current, meterRef.current]) if (el) resize.observe(el);
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
    <TrayContext.Provider value={{ folded, tools, usage }}>
      <div
        ref={trayRef}
        role="group"
        aria-label="Options for the next message"
        // One step darker than the box: the card's surface half over what is behind it.
        className="relative mx-4 flex min-h-9 items-center gap-1 rounded-b-xl border border-t-0 border-border bg-card/55 px-1.5 py-1 text-ui text-muted"
        data-composer-tray
        data-composer-tray-folded={folded || undefined}
      >
        <div ref={startRef} className="flex min-w-0 flex-1 items-center">
          {controls}
        </div>
        <div className="flex shrink-0 items-center gap-1" data-composer-tray-info>
          {hasFoldable && (
            // Folded, it stays laid out (so it is still measured) but out of sight, out of the tab order and unread.
            <span ref={foldableRef} aria-hidden={folded || undefined} className={folded ? 'pointer-events-none invisible absolute top-0 right-0 flex w-max items-center gap-1' : 'flex items-center gap-1'}>
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
