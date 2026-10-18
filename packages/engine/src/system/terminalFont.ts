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

/** CSS generic families. The terminal's own fallback list already ends with them, so they are not font names to look up. */
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);

/** Drops empty names and generic families, and repeats (a name's case does not matter), keeping the order. */
function cleanFamilies(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key || GENERIC_FAMILIES.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(name.trim());
  }
  return result;
}

/**
 * The font names in a CSS `font-family` list, in order: `'Cascadia Code', "Segoe UI Emoji", monospace` gives
 * `Cascadia Code` and `Segoe UI Emoji`. Splits on commas outside quotes and takes the quotes off. A quote only
 * opens a quoted name at the start of one, so an apostrophe inside a name stays part of it.
 */
export function parseFontFamilies(value: string): string[] {
  const names: string[] = [];
  let name = '';
  let quote: string | null = null;
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      else name += char;
    } else if (char === ',') {
      names.push(name);
      name = '';
    } else if ((char === '"' || char === "'") && name.trim() === '') {
      quote = char;
      name = '';
    } else {
      name += char;
    }
  }
  names.push(name);
  return cleanFamilies(names);
}

/** The string a JSON setting holds, with its escapes resolved (`"\"Fira Code\", monospace"` is a list with quotes). */
function jsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

const JSON_STRING = String.raw`"((?:[^"\\]|\\.)*)"`;

/**
 * Every `font-family = X` line of a Ghostty config, in order: Ghostty uses the first as the main font and the
 * rest as fallbacks. An empty value (`font-family = ""`) clears what came before it.
 */
export function ghosttyFonts(config: string): string[] {
  let names: string[] = [];
  for (const match of config.matchAll(/^[ \t]*font-family[ \t]*=[ \t]*(.*?)[ \t]*\r?$/gm)) {
    const value = match[1] ?? '';
    const name = /^(["'])(.*)\1$/.exec(value)?.[2] ?? value;
    if (name.trim() === '') names = [];
    else names.push(name);
  }
  return cleanFamilies(names);
}

/** `"terminal.integrated.fontFamily": "X"` in VS Code's settings.json: a CSS list (JSON with comments, so read with a regex). */
export function vscodeTerminalFonts(settings: string): string[] {
  const match = new RegExp(String.raw`"terminal\.integrated\.fontFamily"\s*:\s*${JSON_STRING}`).exec(settings);
  return match?.[1] ? parseFontFamilies(jsonString(match[1])) : [];
}

/**
 * The font of Windows Terminal's profiles: `"font": { "face": "X" }` (the defaults come first), or the older
 * `"fontFace": "X"`. Usually one name, but it may list fallbacks with commas. JSON with comments, so read with a regex.
 */
export function windowsTerminalFonts(settings: string): string[] {
  const match = new RegExp(String.raw`"font"\s*:\s*\{[^}]*?"face"\s*:\s*${JSON_STRING}`).exec(settings) ?? new RegExp(String.raw`"fontFace"\s*:\s*${JSON_STRING}`).exec(settings);
  return match?.[1] ? parseFontFamilies(jsonString(match[1])) : [];
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
 * The fonts the user already uses in their terminal, in order, so the embedded terminal
 * looks the same and prompt glyphs (Nerd Fonts, Powerline) render.
 */
export function detectTerminalFont(home = homedir(), platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env): { fontFamilies: string[]; source: string } | null {
  const folders = settingsFolders(home, platform, env);
  for (const path of folders.ghostty) {
    const config = read(path);
    const fontFamilies = config ? ghosttyFonts(config) : [];
    if (fontFamilies.length > 0) return { fontFamilies, source: 'Ghostty' };
  }
  for (const path of folders.windowsTerminal) {
    const settings = read(path);
    const fontFamilies = settings ? windowsTerminalFonts(settings) : [];
    if (fontFamilies.length > 0) return { fontFamilies, source: 'Windows Terminal' };
  }
  for (const app of ['Code', 'Code - Insiders', 'Cursor']) {
    const settings = read(join(folders.vscode, app, 'User', 'settings.json'));
    const fontFamilies = settings ? vscodeTerminalFonts(settings) : [];
    if (fontFamilies.length > 0) return { fontFamilies, source: app === 'Code' ? 'VS Code' : app };
  }
  return null;
}
