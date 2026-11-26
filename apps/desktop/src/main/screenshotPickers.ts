/**
 * The area picker on each system, for Take a screenshot. macOS has `screencapture` (quickStartScreenshot.ts). Linux has
 * no picker of its own: the first screenshot tool found on the PATH is used, the desktop's own first. Windows opens the
 * Snipping Tool's picker (`ms-screenclip:`, as Win+Shift+S does), which puts the picture on the clipboard: Seshboard
 * watches the clipboard for it, and stops when the picker closes. Pure, for testing; main runs the commands.
 */

/** A command that writes the picked area to the file it is given, as a PNG, and writes nothing when Esc leaves it. */
export interface PickerCommand {
  /** What the panel and the log call it. */
  name: string;
  file: string;
  args: string[];
}

/** Where a command is on this PATH, or null. `delimiter` is `:` on Linux. */
export function findOnPath(command: string, path: string | undefined, exists: (file: string) => boolean, delimiter = ':'): string | null {
  for (const dir of (path ?? '').split(delimiter)) {
    if (!dir) continue;
    const file = `${dir.replace(/\/+$/, '')}/${command}`;
    if (exists(file)) return file;
  }
  return null;
}

interface LinuxTool {
  name: string;
  /** The commands it needs on the PATH. */
  needs: string[];
  /** Where it works: only under Wayland, only under X11, or both. */
  session: 'wayland' | 'x11' | 'any';
  command(out: string): Omit<PickerCommand, 'name'>;
}

/** Runs a line in `sh` with the file as `$1`, so the path is never part of the script. */
const shell = (script: string, out: string): Omit<PickerCommand, 'name'> => ({ file: '/bin/sh', args: ['-c', script, 'sh', out] });

const LINUX_TOOLS: Record<string, LinuxTool> = {
  gnome: { name: 'GNOME Screenshot', needs: ['gnome-screenshot'], session: 'any', command: (out) => ({ file: 'gnome-screenshot', args: ['-a', '-f', out] }) },
  spectacle: { name: 'Spectacle', needs: ['spectacle'], session: 'any', command: (out) => ({ file: 'spectacle', args: ['-r', '-b', '-n', '-o', out] }) },
  // slurp prints nothing when Esc leaves it, so grim never runs.
  grim: { name: 'grim and slurp', needs: ['grim', 'slurp'], session: 'wayland', command: (out) => shell('area=$(slurp) && grim -g "$area" "$1"', out) },
  // --raw writes the PNG to stdout, and nothing after Esc: the file stays empty, which counts as no picture.
  flameshot: { name: 'Flameshot', needs: ['flameshot'], session: 'any', command: (out) => shell('flameshot gui --raw > "$1"', out) },
  maim: { name: 'maim', needs: ['maim'], session: 'x11', command: (out) => ({ file: 'maim', args: ['-s', out] }) },
  scrot: { name: 'scrot', needs: ['scrot'], session: 'x11', command: (out) => ({ file: 'scrot', args: ['-s', out] }) },
};

/** The tools to try, in order: the desktop's own first (GNOME, KDE), then the ones that work on any desktop. */
export function linuxToolOrder(env: { XDG_CURRENT_DESKTOP?: string; WAYLAND_DISPLAY?: string }): string[] {
  const desktop = (env.XDG_CURRENT_DESKTOP ?? '').toLowerCase();
  const first = desktop.includes('kde') ? ['spectacle'] : desktop.includes('gnome') || desktop.includes('unity') || desktop.includes('cinnamon') ? ['gnome'] : [];
  const rest = ['flameshot', 'grim', 'spectacle', 'gnome', 'maim', 'scrot'];
  const wayland = !!env.WAYLAND_DISPLAY;
  return [...first, ...rest.filter((id) => !first.includes(id))].filter((id) => {
    const session = LINUX_TOOLS[id]!.session;
    return session === 'any' || (session === 'wayland') === wayland;
  });
}

/** The picker to use on Linux, or null when none is installed. */
export function linuxPicker(env: { PATH?: string; XDG_CURRENT_DESKTOP?: string; WAYLAND_DISPLAY?: string }, exists: (file: string) => boolean, out: string): PickerCommand | null {
  for (const id of linuxToolOrder(env)) {
    const tool = LINUX_TOOLS[id]!;
    if (tool.needs.every((command) => findOnPath(command, env.PATH, exists))) return { name: tool.name, ...tool.command(out) };
  }
  return null;
}

/** What the panel says on Linux when no picker is installed. */
export const NO_LINUX_PICKER = 'Install a screenshot tool to take screenshots: GNOME Screenshot, Spectacle, Flameshot, or grim and slurp.';

/** The Snipping Tool's area picker, as Win+Shift+S opens it. */
export const SNIP_URI = 'ms-screenclip:';
/** The processes that show the Snipping Tool's picker (Windows 10 and 11). */
export const SNIP_PROCESSES = ['screenclippinghost.exe', 'snippingtool.exe'];

/** Whether the picker is on screen, from `tasklist /FO CSV /NH`: one quoted name first on each line. */
export function snipRunning(tasklist: string): boolean {
  return tasklist.split(/\r?\n/).some((line) => SNIP_PROCESSES.includes(/^"([^"]+)"/.exec(line.trim())?.[1]?.toLowerCase() ?? ''));
}

export interface SnipHost {
  /** The image on the clipboard as a PNG, or null. */
  readImage(): Promise<Buffer | null>;
  /** Opens the picker. */
  open(): Promise<void>;
  /** Whether the picker is on screen. */
  running(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** How long Seshboard waits for a picture at most, and how often it looks. */
export const SNIP_TIMEOUT_MS = 90_000;
export const SNIP_POLL_MS = 400;

/**
 * Opens the Snipping Tool's picker and waits for a new picture on the clipboard. It stops when the picker closes (Esc)
 * after it was seen; when the picker is never seen (another name on a newer Windows), it waits until the time is up.
 */
export async function waitForSnip(host: SnipHost, timeoutMs = SNIP_TIMEOUT_MS, pollMs = SNIP_POLL_MS): Promise<Buffer | null> {
  const before = await host.readImage();
  const fresh = (image: Buffer | null) => (image && image.length > 0 && !(before && image.equals(before)) ? image : null);
  await host.open();
  const start = host.now();
  let seen = false;
  while (host.now() - start < timeoutMs) {
    await host.sleep(pollMs);
    const image = fresh(await host.readImage());
    if (image) return image;
    if (await host.running()) seen = true;
    else if (seen) {
      // The picker closed: the picture can land on the clipboard a moment after.
      await host.sleep(pollMs);
      return fresh(await host.readImage());
    }
  }
  return null;
}
