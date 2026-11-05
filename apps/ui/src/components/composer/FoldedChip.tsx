import { Blocks, Check, ChevronDown, ChevronLeft, ChevronRight, Gauge } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { scrollMovesAnchor } from '../../lib/menuScroll.ts';
import { CHOICE_PILL, type Choice, type ChoiceAction } from '../newSession/ChoiceMenu.tsx';
import type { TrayUsage } from './ComposerTray.tsx';

/** One of the folded chip's rows (Model, Effort, Mode): it opens the same choices as its own chip would. */
export interface FoldedSection {
  key: 'model' | 'effort' | 'mode';
  heading: string;
  /** The value as the chip names it ("Opus 5.5", "High", "Ask first"). */
  shown: string;
  value: string;
  choices: Array<Choice<string>>;
  onChange(value: string): void;
  actions?: ChoiceAction[];
  /** `data-<name>-select` on the row, like the chip it stands in for. */
  name: string;
}

const ITEMS = '[role=menuitemradio]:not(:disabled),[role=menuitem]:not(:disabled)';
const ROW = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui text-text outline-none hover:bg-accent/15 focus-visible:bg-accent/15 disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * Model, effort and mode in one chip, for a tray too narrow for three ("Opus 5.5 · High · Ask first ▾"). Its menu has
 * a row for each, which opens that one's choices in place, then Tools and usage, which the tray put away.
 */
export function FoldedChip({ sections, face, label, disabled, tools, usage }: { sections: FoldedSection[]; face: string; label: string; disabled?: boolean; tools?: (() => void) | null; usage?: TrayUsage | null }) {
  const [open, setOpen] = useState(false);
  /** The section whose choices show, or null for the rows. */
  const [view, setView] = useState<FoldedSection['key'] | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; bottom: number; upward: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const section = sections.find((s) => s.key === view) ?? null;

  // Focus the checked choice, or the first row, each time the menu opens or changes view.
  useEffect(() => {
    if (!open) return;
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? [])];
    (items.find((b) => b.getAttribute('aria-checked') === 'true') ?? items.find((b) => !b.hasAttribute('data-folded-back')) ?? items[0])?.focus();
  }, [open, view]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onBlur = () => setOpen(false);
    const onScroll = (e: Event) => scrollMovesAnchor(e.target as Node | null, trigger.current) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onBlur);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setView(null);
    if (refocus) trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    // Escape in a list goes back to the rows; at the rows it closes. It never reaches the message box (Stop).
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), view ? setView(null) : close(true));
    else if (e.key === 'ArrowLeft' && view) (e.preventDefault(), setView(null));
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown') (e.preventDefault(), focus(index + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), focus(index < 0 ? items.length - 1 : index - 1));
    else if (e.key === 'Home') (e.preventDefault(), focus(0));
    else if (e.key === 'End') (e.preventDefault(), focus(items.length - 1));
  };

  const width = section?.key === 'model' ? 300 : 260;
  return (
    <div ref={ref} className="relative min-w-0" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        data-tooltip={label}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          // The same flip as every chip's menu: down with room below (New session), up at the bottom of a session.
          setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom, upward: window.innerHeight - rect.bottom < 300 });
          setView(null);
          setOpen((o) => !o);
        }}
        className={`${CHOICE_PILL} ${open ? 'bg-border/50 text-text' : ''}`}
        data-folded-chip
      >
        <span className="min-w-0 truncate text-text">{face}</span>
        <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />
      </button>
      {open && anchor && (
        <div
          ref={panel}
          role="menu"
          aria-label={section ? section.heading : 'Options'}
          data-menu="folded"
          data-folded-view={view ?? 'rows'}
          style={{
            width,
            left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
            ...(anchor.upward ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 }),
          }}
          className="fixed z-80 max-h-80 overflow-y-auto rounded-lg border overlay py-1"
        >
          {section ? (
            <>
              <button type="button" role="menuitem" className={`${ROW} text-meta tracking-wide text-faint uppercase`} onClick={() => setView(null)} data-folded-back>
                <ChevronLeft size={13} className="shrink-0" aria-hidden />
                {section.heading}
              </button>
              {section.choices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.value === section.value}
                  data-choice={choice.value}
                  disabled={choice.disabled}
                  onClick={() => {
                    section.onChange(choice.value);
                    close(true);
                  }}
                  className={`${ROW} items-start`}
                >
                  {choice.icon ? <span aria-hidden className="mt-[2px] flex shrink-0">{choice.icon}</span> : choice.dot && <span aria-hidden className={`mt-[5px] size-2 shrink-0 rounded-full ${choice.dot}`} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{choice.label}</span>
                    {choice.description && <span className="block truncate text-meta text-muted">{choice.description}</span>}
                  </span>
                  <Check size={13} aria-hidden className={`mt-[3px] shrink-0 text-accent-ink ${choice.value === section.value ? '' : 'invisible'}`} />
                </button>
              ))}
              {section.actions?.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  {...action.data}
                  onClick={() => {
                    close(true);
                    action.onSelect();
                  }}
                  className={`${ROW} border-t border-edge`}
                >
                  {action.label}
                </button>
              ))}
            </>
          ) : (
            <>
              {sections.map((s) => (
                <button key={s.key} type="button" role="menuitem" aria-haspopup="menu" className={ROW} onClick={() => setView(s.key)} {...{ [`data-${s.name}-select`]: '' }} data-folded-row={s.key}>
                  <span className="w-14 shrink-0 text-muted">{s.heading}</span>
                  <span className="min-w-0 flex-1 truncate">{s.shown}</span>
                  <ChevronRight size={13} className="shrink-0 text-faint" aria-hidden />
                </button>
              ))}
              {(tools || usage) && <div role="separator" className="mx-2 my-1 border-t border-edge" />}
              {tools && (
                <button
                  type="button"
                  role="menuitem"
                  className={ROW}
                  onClick={() => {
                    close(false);
                    tools();
                  }}
                  data-folded-tools
                >
                  <Blocks size={13} className="shrink-0 text-muted" aria-hidden />
                  Tools
                </button>
              )}
              {usage && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={!usage.onOpen}
                  className={ROW}
                  onClick={() => {
                    close(false);
                    usage.onOpen?.();
                  }}
                  data-folded-usage
                >
                  <Gauge size={13} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{usage.text}</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
