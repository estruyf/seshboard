import { ChevronDown } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import type { ShortcutId } from '../../lib/shortcuts.ts';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { Button } from './Button.tsx';
import type { ButtonSize, ButtonVariant } from './buttonStyles.ts';

interface SplitButtonProps {
  /** `primary` for the one yellow action in an area (New session's Start). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  /** An icon before the main part's label. */
  icon?: ReactNode;
  onClick(): void;
  /** The main part's shortcut, shown after its label. */
  kbd?: string;
  shortcut?: ShortcutId;
  /** The main part only; the ▾ follows `menuDisabled`. */
  disabled?: boolean;
  /** Why the main part is unavailable: the tooltip over the whole button. */
  reason?: string | null;
  /** The ▾'s menu: the main action again, then the other ways to do it. */
  entries: MenuEntry[];
  menuDisabled?: boolean;
  /** The ▾'s name and tooltip ("More ways to start"); also names the menu. */
  menuLabel: string;
  menuWidth?: number;
  /** `data-*` hooks for the main part and the ▾. */
  data?: Record<`data-${string}`, string | boolean>;
  menuData?: Record<`data-${string}`, string | boolean>;
}

/**
 * A button with a ▾ beside it that opens a menu of related actions, one shape with a 1px line between
 * the halves (New session's Start: start, add to queue, start in a new worktree). The menu opens above,
 * lined up with the button's right edge, since the message box sits low in the window.
 */
export function SplitButton({ variant = 'primary', size = 'lg', children, icon, onClick, kbd, shortcut, disabled = false, reason, entries, menuDisabled = false, menuLabel, menuWidth = 240, data, menuData }: SplitButtonProps) {
  const menu = useMenu();
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    // A disabled button gets no hover, so the reason sits on the wrapper; an enabled ▾ keeps its own tooltip.
    <span className="flex" data-tooltip={reason ?? undefined} data-split-button>
      <Button variant={variant} size={size} segment="main" icon={icon} kbd={kbd} shortcut={shortcut} onClick={onClick} disabled={disabled} className="disabled:pointer-events-none" {...data}>
        {children}
      </Button>
      <Button
        ref={toggle}
        variant={variant}
        size={size}
        segment="menu"
        iconOnly
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={!!menu.at}
        icon={<ChevronDown size={14} aria-hidden />}
        disabled={menuDisabled}
        className="disabled:pointer-events-none"
        onClick={() => {
          if (menu.at) return menu.close();
          const rect = toggle.current!.getBoundingClientRect();
          menu.openAt(rect.right - menuWidth, rect.top - 6);
        }}
        {...menuData}
      />
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} above width={menuWidth} entries={entries} onClose={menu.close} label={menuLabel} anchor={toggle} />}
    </span>
  );
}
