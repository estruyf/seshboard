import { join } from 'node:path';
import { appIconKey, DEFAULT_APP_ICON, desktopIconFiles, type AppIconKey } from '@seshboard/protocol/bridge';

/** What `AppIcon` needs from Electron, so a test can stand in for it. */
export interface AppIconHost {
  platform: NodeJS.Platform;
  /** The colourways' files: `resources/app-icons` in development, `app-icons` in the packaged app's resources. */
  dir: string;
  /** The app bundle or installer already shows Graphite (a packaged build), so nothing has to be set for it. */
  bundled: boolean;
  /** `app.dock` on macOS. */
  dock?: { setIcon(image: string): void } | undefined;
  /** Every open window (the main one and the pop-outs). */
  windows(): { setIcon(icon: string): void; isDestroyed(): boolean }[];
  exists(path: string): boolean;
}

/**
 * Settings › Theme › App icon, applied without a restart: the Dock's icon on macOS (which the app switcher shows too),
 * and the windows' icon elsewhere (the taskbar shows the window's). Only while the app runs: Finder, Launchpad, the
 * Start menu and pinned shortcuts keep the bundle's icon, since changing those means writing to the signed bundle or
 * to the shortcut. So the choice is applied again at every launch, before the first window.
 */
export class AppIcon {
  #key: AppIconKey = DEFAULT_APP_ICON;
  /** Something other than the bundle's icon was set this run, so going back to Graphite has to set it too. */
  #changed = false;

  constructor(private readonly host: AppIconHost) {}

  get key(): AppIconKey {
    return this.#key;
  }

  /** Shows a colourway (a key this version doesn't know is Graphite) in the Dock or on every open window. */
  apply(value: unknown): void {
    this.#key = appIconKey(value);
    if (this.#key === DEFAULT_APP_ICON && !this.#changed && this.host.bundled) return;
    const file = this.#file();
    if (!file) return;
    this.#changed = true;
    if (this.host.platform === 'darwin') this.host.dock?.setIcon(file);
    else for (const win of this.host.windows()) if (!win.isDestroyed()) win.setIcon(file);
  }

  /** The colourway's 1024px Dock file on macOS, which the working animation draws its frames from. */
  dockFile(): string | undefined {
    return this.host.platform === 'darwin' ? this.#file() : undefined;
  }

  /**
   * The colourway in the Dock again, after the working animation drew over it. Graphite included: the Dock no longer
   * shows the bundle's icon once something else was set.
   */
  restore(): void {
    if (this.host.platform !== 'darwin') return;
    const file = this.#file();
    if (!file) return;
    this.#changed = true;
    this.host.dock?.setIcon(file);
  }

  /**
   * The `icon` for a new window, and for notifications (Windows and Linux): the colourway's tile, or undefined where
   * the bundle's own icon is right (macOS always takes the bundle's for both).
   */
  windowIcon(): string | undefined {
    if (this.host.platform === 'darwin' || (this.#key === DEFAULT_APP_ICON && !this.#changed && this.host.bundled)) return undefined;
    return this.#file();
  }

  /** The colourway's file for this platform, if the build has it. */
  #file(): string | undefined {
    const files = desktopIconFiles(this.#key);
    const name = this.host.platform === 'darwin' ? files.dock : this.host.platform === 'win32' ? files.ico : files.window;
    const path = join(this.host.dir, name);
    return this.host.exists(path) ? path : undefined;
  }
}
