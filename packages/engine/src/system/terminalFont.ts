import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** `font-family = "X"` in a Ghostty config (the first one wins, like Ghostty's primary font). */
export function ghosttyFont(config: string): string | null {
  const match = /^\s*font-family\s*=\s*"?([^"\n]+?)"?\s*$/m.exec(config);
  return match?.[1]?.trim() || null;
}

/** `"terminal.integrated.fontFamily": "X"` in VS Code's settings.json (JSON with comments, so read with a regex). */
export function vscodeTerminalFont(settings: string): string | null {
  const match = /"terminal\.integrated\.fontFamily"\s*:\s*"([^"]+)"/.exec(settings);
  return match?.[1]?.trim() || null;
}

/**
 * The font of Windows Terminal's profiles: `"font": { "face": "X" }` (the defaults come first), or the older
 * `"fontFace": "X"`. JSON with comments, so read with a regex.
 */
export function windowsTerminalFont(settings: string): string | null {
  const match = /"font"\s*:\s*\{[^}]*?"face"\s*:\s*"([^"]+)"/.exec(settings) ?? /"fontFace"\s*:\s*"([^"]+)"/.exec(settings);
  return match?.[1]?.trim() || null;
}

/** Where each app keeps its settings on this platform. */
function settingsFolders(home: string, platform: NodeJS.Platform, env: Record<string, string | undefined>) {
  if (platform === 'win32') {
    const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return {
      ghostty: [] as string[],
      vscode: appData,
      windowsTerminal: ['Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe'].map((p) => join(localAppData, 'Packages', p, 'LocalState', 'settings.json')),
    };
  }
  const config = env.XDG_CONFIG_HOME || join(home, '.config');
  return {
    ghostty: [join(config, 'ghostty', 'config'), join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')],
    vscode: platform === 'darwin' ? join(home, 'Library', 'Application Support') : config,
    windowsTerminal: [] as string[],
  };
}

/**
 * The font the user already uses in their terminal, so the embedded terminal
 * looks the same and prompt glyphs (Nerd Fonts, Powerline) render.
 */
export function detectTerminalFont(home = homedir(), platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env): { fontFamily: string; source: string } | null {
  const folders = settingsFolders(home, platform, env);
  for (const path of folders.ghostty) {
    const config = read(path);
    const font = config && ghosttyFont(config);
    if (font) return { fontFamily: font, source: 'Ghostty' };
  }
  for (const path of folders.windowsTerminal) {
    const settings = read(path);
    const font = settings && windowsTerminalFont(settings);
    if (font) return { fontFamily: font, source: 'Windows Terminal' };
  }
  for (const app of ['Code', 'Code - Insiders', 'Cursor']) {
    const settings = read(join(folders.vscode, app, 'User', 'settings.json'));
    const font = settings && vscodeTerminalFont(settings);
    if (font) return { fontFamily: font, source: app === 'Code' ? 'VS Code' : app };
  }
  return null;
}
