import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { ariaKeysFor, ariaShortcut, keysFor, shortcutGlyphs, storedShortcut, type ShortcutId } from '../../lib/shortcuts.ts';
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonStyles.ts';

interface BaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary`: the one yellow action per area. `secondary` (default): Cancel, Close, Choose…. `quiet`: toolbar icons and inline controls. `danger`: deletes or reverts. `side`: Ask about this session, outlined in blue (`filled` for the panel's send button). */
  variant?: ButtonVariant;
  /** `sm` 24px, `md` 28px (toolbars, dialogs), `lg` 32px (cards, the message box, a view's main action). */
  size?: ButtonSize;
  /** Shown before the label. */
  icon?: ReactNode;
  /**
   * The shortcut that does the same (`⌘↵`, `Esc`, or a stored `cmd+enter`): named in the tooltip and announced through
   * `aria-keyshortcuts`. A button never shows it on its face.
   */
  kbd?: string;
  /** A shortcut from the registry (`lib/shortcuts.ts`) that does the same: in the tooltip like `kbd`, and every alternative announced. */
  shortcut?: ShortcutId;
  /** Danger: the solid red button that confirms a destructive dialog. Side: the solid blue send button of the Ask panel. */
  filled?: boolean;
  /** A circle rather than a rounded square (with `iconOnly`). */
  round?: boolean;
  /**
   * Quiet: shown as pressed or current (an open panel, the view you're on); set `aria-pressed` or `aria-current` yourself.
   * Secondary: highlighted from the keyboard, as the last choice under a list (Add project's Choose folder…).
   * Side: pressed, while the Ask panel is open.
   */
  selected?: boolean;
  /** Only for `SplitButton`: which half of it this is. */
  segment?: 'main' | 'menu';
  /** A long label wraps onto more lines in a narrow pane instead of being cut off (the permission card's Always allow). */
  wrap?: boolean;
  'data-tooltip'?: string;
  /** The keys the tooltip shows, when they are not just `kbd` or `shortcut` (the catch-up's primary action: ↩ or its letter). */
  'data-tooltip-kbd'?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** The plain text of a label (strings and numbers, nested in arrays), for a tooltip; elements add nothing. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('').trim();
  return '';
}

/** An icon-only button has no visible label, so it must name itself; the name is its tooltip too. */
type ButtonProps = (BaseProps & { iconOnly: true; 'aria-label': string }) | (BaseProps & { iconOnly?: false });

/**
 * Every button in the app. Variants and sizes follow AGENTS.md (Design system); `className` is for
 * layout around it (`ml-auto`, `w-full`, `min-w-0`), not for changing its look.
 */
export function Button({ variant = 'secondary', size = 'md', icon, iconOnly = false, kbd: keys, shortcut, filled = false, selected = false, round = false, segment, wrap = false, className = '', type = 'button', children, ...rest }: ButtonProps) {
  const kbd = shortcut ? keysFor(shortcut) : keys;
  const glyphs = kbd ? shortcutGlyphs(kbd) : null;
  const label = rest['aria-label'];
  // Esc closes whatever is open, so an icon-only close button's tooltip doesn't spell it out; it is still announced.
  const hint = glyphs && kbd && !(iconOnly && storedShortcut(kbd) === 'escape') ? glyphs : null;
  // The shortcut is only ever in the tooltip, never on the button: the tooltip names the button and adds its keys
  // (`data-tooltip-kbd`), unless the button's own tooltip already spells them out.
  const name = rest['data-tooltip'] ?? (label || textOf(children) || undefined);
  const tooltip = rest['data-tooltip'] ?? (iconOnly || hint ? name : undefined);
  const tooltipKbd = rest['data-tooltip-kbd'] ?? (hint && tooltip && !tooltip.includes(hint) ? hint : undefined);
  return (
    <button
      type={type}
      aria-keyshortcuts={shortcut ? ariaKeysFor(shortcut) : kbd ? ariaShortcut(storedShortcut(kbd)) : undefined}
      {...rest}
      data-tooltip={tooltip}
      data-tooltip-kbd={tooltipKbd}
      data-selected={selected && variant === 'secondary' ? true : undefined}
      className={`${buttonClass({ variant, size, iconOnly, filled, selected, segment, round, wrap })} ${className}`}
    >
      {icon}
      {/* For an icon-only button: decoration such as a status dot, not a label. */}
      {children}
    </button>
  );
}
