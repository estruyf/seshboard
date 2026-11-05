import { Check, ChevronRight, Mail, MailOpen, Pin, PinOff, RotateCcw, Square } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import type { QuickAction, QuickActionMethod } from './quickActions.ts';

const ICON: Record<QuickActionMethod, ReactNode> = {
  markRead: <MailOpen size={13} aria-hidden />,
  markUnread: <Mail size={13} aria-hidden />,
  pin: <Pin size={13} aria-hidden />,
  unpin: <PinOff size={13} aria-hidden />,
  archive: <Check size={13} aria-hidden />,
  unarchive: <RotateCcw size={13} aria-hidden />,
  stop: <Square size={11} aria-hidden />,
};

/** Each button is 24px, with 2px between them, inside a pill with 2px of padding and a 1px border. */
export const rowActionsWidth = (count: number) => count * 24 + (count - 1) * 2 + 2 * 2 + 2;

/** A pipeline's parent in the toolbar: whether its steps show, and how many it has. */
export interface RowActionsTree {
  open: boolean;
  count: number;
  onToggle(): void;
}

/**
 * The buttons a session row shows under the pointer, or once Tab moves into them from the row (`group/row` on the row's
 * wrapper). Never on touch: Tailwind's hover only applies where there is a pointer that hovers. Esc goes back to the row.
 * A pipeline's parent gets its steps toggle first: the row's own chevron moves aside for the toolbar, so it would be
 * hard to hit.
 */
export function RowActions({ id, title, actions, tree, tabbable, onAction }: { id: string; title: string; actions: readonly QuickAction[]; tree?: RowActionsTree; tabbable: boolean; onAction(action: QuickAction): void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
      return;
    }
    // ← → move between the buttons, as in any toolbar.
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  return (
    <div
      role="toolbar"
      aria-label={`Actions for ${title}`}
      onKeyDown={onKeyDown}
      className="pointer-events-none absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-edge bg-popover p-0.5 opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-has-[:focus-visible]/row:pointer-events-auto group-has-[:focus-visible]/row:opacity-100"
      data-row-actions={id}
    >
      {tree && (
        <button
          type="button"
          tabIndex={tabbable ? 0 : -1}
          aria-label={`${tree.open ? 'Hide steps of' : 'Show steps of'} ${title}`}
          aria-expanded={tree.open}
          data-tooltip={tree.open ? 'Hide steps' : `Show ${tree.count} ${tree.count === 1 ? 'step' : 'steps'}`}
          data-row-tree-toggle={tree.open}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            tree.onToggle();
          }}
          className="flex size-6 items-center justify-center rounded text-muted hover:bg-border/50 hover:text-text"
        >
          <ChevronRight size={13} aria-hidden className={`transition-transform duration-100 motion-reduce:transition-none ${tree.open ? 'rotate-90' : ''}`} />
        </button>
      )}
      {actions.map((action) => (
        <button
          key={action.kind}
          type="button"
          tabIndex={tabbable ? 0 : -1}
          aria-label={`${action.label} ${title}`}
          data-tooltip={action.shortcut ? `${action.label} (${formatKeys(keysFor(action.shortcut))})` : action.label}
          data-row-action={action.kind}
          // The row never opens or changes the selection from here.
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAction(action);
          }}
          className="flex size-6 items-center justify-center rounded text-muted hover:bg-border/50 hover:text-text"
        >
          {ICON[action.method]}
        </button>
      ))}
    </div>
  );
}
