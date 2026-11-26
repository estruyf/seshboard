/**
 * Quick start (Settings › General › Quick start): a global shortcut, ⌃⌥Space by default (Ctrl+Alt+Space elsewhere),
 * opens a small panel over whatever app is in front to start a session, like Raycast, without bringing Seshboard's
 * window forward. The rules (the shortcut as Electron writes it, where the panel goes) are pure, for testing; `QuickStart` gets `globalShortcut` and the window through a host, as `DockActivity` does.
 */

import type { QuickStartStatus } from '@seshboard/protocol/bridge';

/** The panel's width, as in the design (Round 55). */
export const QUICK_START_WIDTH = 760;
/** The see-through room around the panel in its window, for its shadow. */
export const QUICK_START_PAD = 24;
/**
 * The window's height. The panel is as tall as what it shows, at the top of the window; under it the window is see-
 * through (clicks go to the app under it), and the chips' menus and ⌘K's open there.
 */
export const QUICK_START_HEIGHT = 640;

/** The registry's modifiers (`cmd`, `ctrl`, `alt`, `shift`) as Electron's accelerators write them. */
const MODIFIERS: Record<string, string> = { cmd: 'Command', ctrl: 'Control', alt: 'Alt', shift: 'Shift' };
/** Keys whose accelerator name isn't the key itself in capitals. */
const NAMED: Record<string, string> = {
  space: 'Space',
  enter: 'Return',
  escape: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  plus: 'Plus',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

/**
 * A stored shortcut (`ctrl+alt+space`) as an Electron accelerator (`Control+Alt+Space`), or null when it can't be one:
 * no modifier, or a key Electron has no name for. `mod` is ⌘ on macOS and Ctrl elsewhere, as in the registry.
 */
export function toAccelerator(stored: string, platform: NodeJS.Platform): string | null {
  const parts = stored.split('+');
  const key = parts.pop();
  if (!key || parts.length === 0) return null;
  const modifiers: string[] = [];
  for (const part of parts) {
    const name = part === 'mod' ? (platform === 'darwin' ? 'Command' : 'Control') : MODIFIERS[part];
    if (!name) return null;
    if (!modifiers.includes(name)) modifiers.push(name);
  }
  if (modifiers.length === 1 && modifiers[0] === 'Shift') return null;
  const name = NAMED[key] ?? (/^[a-z0-9]$/.test(key) ? key.toUpperCase() : /^f([1-9]|1[0-9]|2[0-4])$/.test(key) ? key.toUpperCase() : null);
  return name ? [...modifiers, name].join('+') : null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the panel's window goes on the screen with the cursor: centred across, with the panel's field a third of the
 * way down, and kept inside the work area (higher up on a short screen).
 */
export function quickStartBounds(workArea: Rect): Rect {
  const width = Math.min(QUICK_START_WIDTH + 2 * QUICK_START_PAD, workArea.width);
  const height = Math.min(QUICK_START_HEIGHT, workArea.height);
  const x = workArea.x + Math.round((workArea.width - width) / 2);
  // The field (60px high) sits on the line a third of the way down.
  const top = workArea.y + Math.round(workArea.height / 3) - 30 - QUICK_START_PAD;
  const y = Math.max(workArea.y, Math.min(top, workArea.y + workArea.height - height));
  return { x, y, width, height };
}

/** What the log says when another app has the shortcut. */
export const inUseLog = (accelerator: string): string => `[quick start] ${accelerator} is in use by another app; pick another in Settings › General › Quick start`;

export interface QuickStartHost {
  readonly platform: NodeJS.Platform;
  /** `globalShortcut.register`: false when another app (or the system) has the keys. */
  register(accelerator: string, onPress: () => void): boolean;
  unregister(accelerator: string): void;
  /** Whether the panel is on screen. */
  visible(): boolean;
  /**
   * Puts the panel over the app in front, without bringing Seshboard's window forward. `keepDraft`: what was typed stays
   * (only after a screenshot hid it); otherwise it opens empty.
   */
  show(keepDraft: boolean): void;
  hide(): void;
  log(message: string): void;
  /** The shortcut's state changed: Settings shows it. */
  status(status: QuickStartStatus): void;
}

/**
 * The global shortcut and the panel's open and closed state. The shortcut opens the panel, and pressing it again
 * closes it. A shortcut another app has is reported (`status`, and the log), never dropped silently.
 */
export class QuickStart {
  #shortcut: string | null = null;
  #accelerator: string | null = null;
  #registered = false;

  constructor(private readonly host: QuickStartHost) {}

  get status(): QuickStartStatus {
    return { shortcut: this.#shortcut ?? '', registered: this.#registered };
  }

  /** The setting, at launch and on every change. Registering the same shortcut again does nothing. */
  setShortcut(stored: string): void {
    if (stored === this.#shortcut && this.#registered) return;
    if (this.#accelerator && this.#registered) this.host.unregister(this.#accelerator);
    this.#shortcut = stored;
    this.#accelerator = toAccelerator(stored, this.host.platform);
    this.#registered = false;
    if (this.#accelerator) {
      try {
        this.#registered = this.host.register(this.#accelerator, () => this.toggle());
      } catch {
        this.#registered = false;
      }
      if (!this.#registered) this.host.log(inUseLog(this.#accelerator));
    } else {
      this.host.log(`[quick start] ${stored} can't be a global shortcut`);
    }
    this.host.status(this.status);
  }

  /** Quitting: the keys go back to the system. */
  dispose(): void {
    if (this.#accelerator && this.#registered) this.host.unregister(this.#accelerator);
    this.#registered = false;
  }

  /** The shortcut: opens the panel, or closes it when it is open. */
  toggle(): void {
    if (this.host.visible()) this.hide();
    else this.open();
  }

  /** Shows the panel empty, as every press of the shortcut does. A screenshot brings it back with its draft (`keepDraft`). */
  open(keepDraft = false): void {
    this.host.show(keepDraft);
  }

  /** Esc, a click elsewhere, the shortcut again. */
  hide(): void {
    if (!this.host.visible()) return;
    this.host.hide();
  }
}
