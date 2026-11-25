import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { isSameOrInside, type FileIconAssociations, type FileIconTheme, type FileIconThemeInfo } from '@seshboard/protocol';

/**
 * File icon themes from VS Code and the editors built on it (Insiders, Cursor, Windsurf, VSCodium): the `iconThemes`
 * an installed extension contributes. Seshboard reads the theme's JSON and its SVG or PNG icons; a theme drawn with
 * a font (`fontCharacter`) has no icons Seshboard can show. Nothing here writes to the editors' folders.
 */

/** The editors whose extensions folder (`~/<folder>/extensions`) is read, in this order. */
const EDITORS: ReadonlyArray<{ folder: string; name: string }> = [
  { folder: '.vscode', name: 'VS Code' },
  { folder: '.vscode-insiders', name: 'VS Code Insiders' },
  { folder: '.cursor', name: 'Cursor' },
  { folder: '.windsurf', name: 'Windsurf' },
  { folder: '.vscode-oss', name: 'VSCodium' },
];

/** The largest icon file Seshboard reads; icons are a few KB. */
const MAX_ICON_BYTES = 256 * 1024;
/** The largest theme JSON Seshboard reads (Material Icon Theme's is about 300 KB). */
const MAX_THEME_BYTES = 8 * 1024 * 1024;

interface Contribution {
  /** `publisher.name`, lower case. */
  extensionId: string;
  version: string;
  dir: string;
  editor: string;
  themes: Array<{ id: string; label: string; path: string }>;
  languages: LanguageContribution[];
}

interface LanguageContribution {
  id: string;
  extensions?: string[];
  filenames?: string[];
}

function pathLib(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

/**
 * Parses JSON with comments and trailing commas, as VS Code reads its theme and package files. Comments and the
 * commas before a closing bracket are dropped outside strings, then the rest goes to `JSON.parse`.
 */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === ',' && /^\s*[}\]]/.test(text.slice(i + 1, i + 200))) {
      // A trailing comma: the next thing after it closes the object or the array.
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out);
}

function readJson(path: string, maxBytes = 2 * 1024 * 1024): unknown {
  try {
    if (statSync(path).size > maxBytes) return null;
    return parseJsonc(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Compares `1.10.0` with `1.9.2` as versions, not as text. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** An extension's icon themes and languages, from its `package.json`; null when it has neither. */
function readContribution(dir: string, editor: string, platform: NodeJS.Platform): Contribution | null {
  const path = pathLib(platform);
  const pkg = readJson(path.join(dir, 'package.json'));
  if (!isRecord(pkg) || !isRecord(pkg.contributes)) return null;
  const publisher = str(pkg.publisher);
  const name = str(pkg.name);
  if (!name) return null;
  const themes: Contribution['themes'] = [];
  for (const t of Array.isArray(pkg.contributes.iconThemes) ? pkg.contributes.iconThemes : []) {
    if (!isRecord(t)) continue;
    const id = str(t.id);
    const file = str(t.path);
    if (id && file) themes.push({ id, label: str(t.label) ?? id, path: file });
  }
  const languages: LanguageContribution[] = [];
  for (const l of Array.isArray(pkg.contributes.languages) ? pkg.contributes.languages : []) {
    if (!isRecord(l) || !str(l.id)) continue;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
    languages.push({ id: l.id as string, extensions: list(l.extensions), filenames: list(l.filenames) });
  }
  if (!themes.length && !languages.length) return null;
  return { extensionId: `${publisher ?? 'unknown'}.${name}`.toLowerCase(), version: str(pkg.version) ?? '0.0.0', dir, editor, themes, languages };
}

/** The folders an extensions folder lists, without the ones VS Code marked as replaced (`.obsolete`). */
function extensionDirs(root: string, platform: NodeJS.Platform): string[] {
  const path = pathLib(platform);
  let names: string[];
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
  } catch {
    return [];
  }
  const obsolete = readJson(path.join(root, '.obsolete'));
  const gone = new Set(isRecord(obsolete) ? Object.keys(obsolete).filter((k) => obsolete[k] === true) : []);
  return names.filter((n) => !gone.has(n)).map((n) => path.join(root, n));
}

/** Where the editors install extensions, for this home folder. */
export function extensionRoots(home: string, platform: NodeJS.Platform = process.platform): Array<{ root: string; editor: string }> {
  const path = pathLib(platform);
  return EDITORS.map((e) => ({ root: path.join(home, e.folder, 'extensions'), editor: e.name }));
}

/**
 * The folders of the editors' own built-in extensions, which hold the languages VS Code knows without an extension
 * (TypeScript, Markdown, …). Icon themes such as vscode-icons map `.ts` to a language rather than to the extension.
 */
export function builtInExtensionRoots(home: string, platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env): string[] {
  const path = pathLib(platform);
  if (platform === 'darwin') {
    const apps = ['Visual Studio Code', 'Visual Studio Code - Insiders', 'Cursor', 'Windsurf', 'VSCodium'];
    return [path.join('/', 'Applications'), path.join(home, 'Applications')].flatMap((folder) => apps.map((app) => path.join(folder, `${app}.app`, 'Contents', 'Resources', 'app', 'extensions')));
  }
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles].filter((r): r is string => !!r);
    const apps = ['Microsoft VS Code', 'Microsoft VS Code Insiders', 'cursor', 'Windsurf', 'VSCodium'];
    return roots.flatMap((root) => apps.map((app) => path.join(root, app, 'resources', 'app', 'extensions')));
  }
  return ['/usr/share/code', '/usr/share/code-insiders', '/opt/visual-studio-code', '/usr/lib/code', '/snap/code/current/usr/share/code', '/usr/share/cursor', '/opt/Cursor', '/usr/share/windsurf', '/usr/share/codium'].map((dir) => path.join(dir, 'resources', 'app', 'extensions'));
}

/**
 * Languages VS Code knows by default, for when no editor's own extensions can be read: the common ones, so a theme
 * that maps by language still gives `.ts`, `.md` and the rest their icons.
 */
const FALLBACK_LANGUAGES: LanguageContribution[] = [
  { id: 'typescript', extensions: ['.ts', '.cts', '.mts'] },
  { id: 'typescriptreact', extensions: ['.tsx'] },
  { id: 'javascript', extensions: ['.js', '.cjs', '.mjs', '.es6'] },
  { id: 'javascriptreact', extensions: ['.jsx'] },
  { id: 'json', extensions: ['.json', '.webmanifest'], filenames: ['.babelrc', '.prettierrc'] },
  { id: 'jsonc', extensions: ['.jsonc'], filenames: ['tsconfig.json', 'jsconfig.json', '.eslintrc.json', 'settings.json', 'launch.json', 'tasks.json', 'extensions.json'] },
  { id: 'markdown', extensions: ['.md', '.markdown', '.mdown'] },
  { id: 'html', extensions: ['.html', '.htm', '.xhtml'] },
  { id: 'css', extensions: ['.css'] },
  { id: 'scss', extensions: ['.scss'] },
  { id: 'less', extensions: ['.less'] },
  { id: 'python', extensions: ['.py', '.pyi', '.pyw'] },
  { id: 'ruby', extensions: ['.rb'], filenames: ['Gemfile', 'Rakefile'] },
  { id: 'go', extensions: ['.go'] },
  { id: 'rust', extensions: ['.rs'] },
  { id: 'java', extensions: ['.java'] },
  { id: 'kotlin', extensions: ['.kt', '.kts'] },
  { id: 'swift', extensions: ['.swift'] },
  { id: 'c', extensions: ['.c', '.h'] },
  { id: 'cpp', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh'] },
  { id: 'csharp', extensions: ['.cs', '.csx'] },
  { id: 'php', extensions: ['.php'] },
  { id: 'shellscript', extensions: ['.sh', '.bash', '.zsh'], filenames: ['.bashrc', '.zshrc', '.profile'] },
  { id: 'powershell', extensions: ['.ps1', '.psm1'] },
  { id: 'bat', extensions: ['.bat', '.cmd'] },
  { id: 'yaml', extensions: ['.yml', '.yaml'] },
  { id: 'xml', extensions: ['.xml', '.xsd', '.plist'] },
  { id: 'sql', extensions: ['.sql'] },
  { id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
  { id: 'makefile', extensions: ['.mk'], filenames: ['Makefile', 'makefile', 'GNUmakefile'] },
  { id: 'ignore', extensions: ['.gitignore'], filenames: ['.gitignore', '.npmignore', '.dockerignore'] },
  { id: 'properties', extensions: ['.ini', '.properties', '.conf'] },
  { id: 'dotenv', extensions: ['.env'], filenames: ['.env'] },
  { id: 'lua', extensions: ['.lua'] },
  { id: 'dart', extensions: ['.dart'] },
  { id: 'r', extensions: ['.r'] },
  { id: 'perl', extensions: ['.pl', '.pm'] },
  { id: 'plaintext', extensions: ['.txt'] },
  { id: 'vue', extensions: ['.vue'] },
  { id: 'svelte', extensions: ['.svelte'] },
  { id: 'astro', extensions: ['.astro'] },
  { id: 'mdx', extensions: ['.mdx'] },
  { id: 'toml', extensions: ['.toml'] },
];

/** Every extension of every editor that contributes icon themes or languages. */
function scan(home: string, platform: NodeJS.Platform, builtInRoots: readonly string[], withBuiltIn: boolean): { installed: Contribution[]; builtIn: Contribution[] } {
  const installed = extensionRoots(home, platform).flatMap(({ root, editor }) => extensionDirs(root, platform).map((dir) => readContribution(dir, editor, platform)).filter((c): c is Contribution => c !== null));
  if (!withBuiltIn) return { installed, builtIn: [] };
  const builtIn = builtInRoots.flatMap((root) => extensionDirs(root, platform).map((dir) => readContribution(dir, 'built-in', platform)).filter((c): c is Contribution => c !== null));
  return { installed, builtIn };
}

/** The id Seshboard saves for a theme: the extension and the theme's own id. */
const themeKey = (extensionId: string, themeId: string) => `${extensionId}/${themeId}`;

/** The newest version of each extension: an editor keeps the old folder for a while after an update. */
function newest(contributions: Contribution[]): Contribution[] {
  const byId = new Map<string, Contribution>();
  for (const c of contributions) {
    const known = byId.get(c.extensionId);
    if (!known || compareVersions(c.version, known.version) > 0) byId.set(c.extensionId, c);
  }
  return [...byId.values()];
}

export interface IconThemeOptions {
  home?: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  /** The editors' built-in extensions folders; `builtInExtensionRoots` when left out (tests pass their own). */
  builtInRoots?: readonly string[];
}

/** The file icon themes installed in the editors, by label. One theme installed in two editors shows once. */
export function listIconThemes(options: IconThemeOptions = {}): FileIconThemeInfo[] {
  const { installed } = scan(options.home ?? homedir(), options.platform ?? process.platform, [], false);
  return newest(installed)
    .flatMap((c) => c.themes.map((t) => ({ id: themeKey(c.extensionId, t.id), label: t.label, editor: c.editor })))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** A loaded theme: what the UI gets, and where its icons are on disk (kept in the engine). */
interface LoadedTheme {
  theme: FileIconTheme;
  /** Icon id to file, inside the extension's folder. */
  files: Map<string, string>;
  /** The JSON's mtime, so an update of the extension loads again. */
  modified: number;
  json: string;
}

const MAPS = ['fileExtensions', 'fileNames', 'folderNames', 'folderNamesExpanded', 'languageIds'] as const;
const SINGLES = ['file', 'folder', 'folderExpanded'] as const;

/** A theme's associations, with names in lower case (VS Code matches names that way) and only icons it can draw. */
function associations(raw: unknown, drawable: ReadonlySet<string>): FileIconAssociations {
  const out: FileIconAssociations = {};
  if (!isRecord(raw)) return out;
  for (const key of SINGLES) {
    const id = str(raw[key]);
    if (id && drawable.has(id)) out[key] = id;
  }
  for (const key of MAPS) {
    const map = raw[key];
    if (!isRecord(map)) continue;
    const clean: Record<string, string> = {};
    for (const [name, id] of Object.entries(map)) if (typeof id === 'string' && drawable.has(id)) clean[key === 'languageIds' ? name : name.toLowerCase()] = id;
    out[key] = clean;
  }
  return out;
}

/** File names and extensions to languages, from the contributions: the later one wins, as in VS Code. */
function languageTable(contributions: LanguageContribution[]): FileIconTheme['languages'] {
  const extensions: Record<string, string> = {};
  const fileNames: Record<string, string> = {};
  for (const lang of contributions) {
    for (const ext of lang.extensions ?? []) if (ext.startsWith('.') && ext.length > 1) extensions[ext.slice(1).toLowerCase()] = lang.id;
    for (const name of lang.filenames ?? []) fileNames[name.toLowerCase()] = lang.id;
  }
  return { extensions, fileNames };
}

/**
 * Loads the themes it is asked for and keeps them, with where their icons are. Loading again after the extension
 * changed (a new version, another mtime) reads it again.
 */
export class IconThemes {
  private readonly loaded = new Map<string, LoadedTheme>();
  private readonly home: string;
  private readonly platform: NodeJS.Platform;
  private readonly builtInRoots: readonly string[];

  constructor(options: IconThemeOptions = {}) {
    this.home = options.home ?? homedir();
    this.platform = options.platform ?? process.platform;
    this.builtInRoots = options.builtInRoots ?? builtInExtensionRoots(this.home, this.platform, options.env ?? process.env);
  }

  list(): FileIconThemeInfo[] {
    return listIconThemes({ home: this.home, platform: this.platform });
  }

  /** The theme with this id, or null when it is no longer installed or can't be read. */
  load(id: string): FileIconTheme | null {
    const { installed, builtIn } = scan(this.home, this.platform, this.builtInRoots, true);
    const latest = newest(installed);
    const owner = latest.find((c) => c.themes.some((t) => themeKey(c.extensionId, t.id) === id));
    const entry = owner?.themes.find((t) => themeKey(owner.extensionId, t.id) === id);
    if (!owner || !entry) return null;
    const path = pathLib(this.platform);
    const json = path.resolve(owner.dir, entry.path);
    if (!isSameOrInside(json, owner.dir)) return null;
    let modified: number;
    try {
      modified = statSync(json).mtimeMs;
    } catch {
      return null;
    }
    const known = this.loaded.get(id);
    if (known && known.json === json && known.modified === modified) return known.theme;

    const raw = readJson(json, MAX_THEME_BYTES);
    if (!isRecord(raw) || !isRecord(raw.iconDefinitions)) return null;
    const files = new Map<string, string>();
    for (const [iconId, def] of Object.entries(raw.iconDefinitions)) {
      const file = isRecord(def) ? str(def.iconPath) : null;
      if (!file) continue;
      const at = path.resolve(path.dirname(json), file);
      if (isSameOrInside(at, owner.dir)) files.set(iconId, at);
    }
    const drawable = new Set(files.keys());
    // Built-in languages first, then the extensions installed, so an installed language wins as in VS Code.
    const languageSources = builtIn.length ? builtIn.flatMap((c) => c.languages) : FALLBACK_LANGUAGES;
    const theme: FileIconTheme = {
      id,
      label: entry.label,
      hidesExplorerArrows: raw.hidesExplorerArrows === true,
      base: associations(raw, drawable),
      light: isRecord(raw.light) ? associations(raw.light, drawable) : null,
      languages: languageTable([...languageSources, ...latest.flatMap((c) => c.languages)]),
    };
    this.loaded.set(id, { theme, files, modified, json });
    return theme;
  }

  /** The icons as data URLs, by id; null for an icon the theme doesn't have or that can't be read. */
  async icons(id: string, ids: readonly string[]): Promise<Record<string, string | null>> {
    let loaded = this.loaded.get(id);
    if (!loaded && this.load(id)) loaded = this.loaded.get(id);
    const out: Record<string, string | null> = {};
    await Promise.all(
      ids.map(async (iconId) => {
        const file = loaded?.files.get(iconId);
        out[iconId] = file ? await dataUrl(file) : null;
      }),
    );
    return out;
  }
}

const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

async function dataUrl(file: string): Promise<string | null> {
  const mime = MIME[file.slice(file.lastIndexOf('.') + 1).toLowerCase()];
  if (!mime) return null;
  try {
    const bytes = await readFile(file);
    if (bytes.length > MAX_ICON_BYTES) return null;
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
