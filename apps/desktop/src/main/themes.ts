import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, join } from 'node:path';
import { DEFAULT_THEME_ID, parseColor, parseJsonc, parseThemeFile, THEME_SCHEMA_URL, themeSlug, toHex, uniqueThemeName, type ThemeEntry, type ThemeFile, type ThemeFileCheck, type ThemeState } from '@seshboard/protocol/theme';
import { guarded } from './guarded.ts';
import { writeFileAtomic } from './jsonFile.ts';

/** A theme file is a few KB; anything this big isn't one. */
const MAX_THEME_BYTES = 512 * 1024;
/** Editors save in bursts (write, rename, touch): wait for them to settle before reading. */
const RELOAD_DEBOUNCE_MS = 150;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Reads and validates a theme file from disk. */
export function readThemeFile(path: string): ThemeFileCheck & { raw?: unknown } {
  const fileName = basename(path);
  let text: string;
  try {
    if (statSync(path).size > MAX_THEME_BYTES) return { ok: false, error: 'This file is too big to be a theme.', fileName };
    text = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, error: "Seshboard couldn't read this file.", fileName };
  }
  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch (error) {
    return { ok: false, error: `This file isn't valid JSON (${error instanceof Error ? error.message : String(error)}).`, fileName };
  }
  const result = parseThemeFile(raw);
  if ('error' in result) return { ok: false, error: result.error, fileName };
  return { ok: true, theme: result.theme, ignored: result.ignored, fileName, raw };
}

/**
 * Themes: the built-ins that ship with the app, and the imported ones, one JSON file each in the
 * themes folder of the app data. Imported themes are a user choice, so they live here with the
 * preferences rather than in the engine's cache. The folder is watched: editing a theme's file applies
 * it as soon as it is saved, and a broken edit keeps the last good version (with a problem to show).
 */
export class ThemeStore {
  readonly dir: string;
  #builtIns: ThemeEntry[] = [];
  #imported = new Map<string, ThemeEntry>();
  #problems: Record<string, string> = {};
  #watcher: FSWatcher | null = null;
  #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    dir: string,
    builtIns: ReadonlyArray<{ id: string; raw: unknown }>,
    private readonly onChange: (state: ThemeState) => void = () => {},
  ) {
    this.dir = dir;
    for (const { id, raw } of builtIns) {
      // The same validation as an import; the unit tests make sure every built-in passes it.
      const result = parseThemeFile(raw);
      if ('error' in result) console.error(`[themes] built-in ${id}: ${result.error}`);
      else this.#builtIns.push({ id, builtIn: true, file: result.theme, path: null });
    }
    this.#loadFolder();
  }

  /** Every theme, built-ins first, then imported ones by name. */
  state(): ThemeState {
    const imported = [...this.#imported.values()].sort((a, b) => a.file.name.localeCompare(b.file.name));
    return { themes: [...this.#builtIns, ...imported], problems: { ...this.#problems } };
  }

  get(id: string): ThemeEntry | undefined {
    return this.#builtIns.find((t) => t.id === id) ?? this.#imported.get(id);
  }

  /**
   * The window's background before the page paints: the theme's `bg` for the mode (or its canvas),
   * Demo Time's for a mode the theme doesn't have, as `#rrggbb` (what Electron takes).
   */
  background(id: string, dark: boolean): string {
    const mode = dark ? 'dark' : 'light';
    const own = this.get(id)?.file[mode];
    const fallback = this.get(DEFAULT_THEME_ID)?.file[mode];
    const value = own ? (own.colors?.bg ?? own.canvas) : (fallback?.colors?.bg ?? fallback?.canvas);
    const color = value ? parseColor(value) : null;
    return color ? toHex({ ...color, a: 1 }) : dark ? '#15181f' : '#ffffff';
  }

  /** Why a parsed file isn't a valid theme, or null when it is. */
  validate(raw: unknown): string | null {
    const result = parseThemeFile(raw);
    return 'error' in result ? result.error : null;
  }

  /** Reads and validates a file someone wants to import. */
  check(path: string): ThemeFileCheck {
    const result = readThemeFile(path);
    if (!result.ok) return result;
    return { ok: true, theme: result.theme, ignored: result.ignored, fileName: result.fileName, raw: result.raw };
  }

  /**
   * Adds a theme from a (validated again) parsed file. `replace` writes over the imported theme with
   * the same name; `keep-both` (or a clash with a built-in) saves it under the next free name.
   */
  add(raw: unknown, how: 'add' | 'replace' | 'keep-both'): string {
    const result = parseThemeFile(raw);
    if ('error' in result) throw new Error(result.error);
    const name = result.theme.name;
    const existing = [...this.#imported.values()].find((t) => t.file.name.toLowerCase() === name.toLowerCase());
    if (how === 'replace' && existing) return this.#write(existing.id, raw as Record<string, unknown>, name);
    const takenNames = this.state().themes.map((t) => t.file.name);
    const finalName = how === 'keep-both' || takenNames.some((n) => n.toLowerCase() === name.toLowerCase()) ? uniqueThemeName(name, takenNames) : name;
    return this.#write(this.#freeId(themeSlug(finalName)), raw as Record<string, unknown>, finalName);
  }

  /** Saves a copy of a theme (built in or imported) as a new imported theme. */
  duplicate(id: string): string {
    const source = this.get(id);
    if (!source) throw new Error('That theme is gone.');
    const raw = source.path ? (readThemeFile(source.path).raw ?? source.file) : source.file;
    const name = uniqueThemeName(source.file.name, this.state().themes.map((t) => t.file.name));
    return this.#write(this.#freeId(themeSlug(name)), raw as Record<string, unknown>, name);
  }

  /** Forgets an imported theme whose file was moved to the Trash (the watcher would too, a moment later). */
  removed(id: string): void {
    this.#imported.delete(id);
    delete this.#problems[id];
    this.#emit();
  }

  /** Starts following the folder: themes added, edited or deleted there show up in the app. */
  watch(): void {
    if (this.#watcher) return;
    try {
      this.#ensureDir();
      this.#watcher = watch(this.dir, (_event, file) => {
        const name = typeof file === 'string' ? file : null;
        if (!name || !name.endsWith('.json')) return;
        clearTimeout(this.#timers.get(name));
        this.#timers.set(
          name,
          setTimeout(
            guarded('theme reload', () => {
              this.#timers.delete(name);
              this.#reload(name);
            }),
            RELOAD_DEBOUNCE_MS,
          ),
        );
      });
      this.#watcher.on('error', () => this.close());
    } catch {
      // No watching (the folder vanished): themes still load at start.
    }
  }

  close(): void {
    this.#watcher?.close();
    this.#watcher = null;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  #ensureDir(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  #loadFolder(): void {
    let files: string[] = [];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }
    for (const file of files) {
      const id = file.slice(0, -'.json'.length);
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || this.#builtIns.some((t) => t.id === id)) continue;
      const result = readThemeFile(join(this.dir, file));
      if (result.ok) this.#imported.set(id, { id, builtIn: false, file: result.theme, path: join(this.dir, file) });
      else console.error(`[themes] ${file}: ${result.error}`);
    }
  }

  /** A file in the folder changed, appeared or went away. */
  #reload(file: string): void {
    const id = file.slice(0, -'.json'.length);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || this.#builtIns.some((t) => t.id === id)) return;
    const path = join(this.dir, file);
    if (!existsSync(path)) {
      if (this.#imported.delete(id) || this.#problems[id]) {
        delete this.#problems[id];
        this.#emit();
      }
      return;
    }
    const result = readThemeFile(path);
    if (result.ok) {
      const before = this.#imported.get(id);
      if (before && JSON.stringify(before.file) === JSON.stringify(result.theme) && !this.#problems[id]) return;
      this.#imported.set(id, { id, builtIn: false, file: result.theme, path });
      delete this.#problems[id];
    } else if (this.#imported.has(id)) {
      // A broken edit: keep using the last good version, and say what's wrong.
      if (this.#problems[id] === result.error) return;
      this.#problems[id] = result.error;
    } else return;
    this.#emit();
  }

  #freeId(slug: string): string {
    const taken = (id: string) => this.get(id) !== undefined || existsSync(join(this.dir, `${id}.json`));
    if (!taken(slug)) return slug;
    for (let n = 2; ; n++) if (!taken(`${slug}-${n}`)) return `${slug}-${n}`;
  }

  #write(id: string, raw: Record<string, unknown>, name: string): string {
    this.#ensureDir();
    const path = join(this.dir, `${id}.json`);
    const content: Record<string, unknown> = { $schema: THEME_SCHEMA_URL, ...(isObject(raw) ? raw : {}), name };
    writeFileAtomic(path, `${JSON.stringify(content, null, 2)}\n`);
    const result = parseThemeFile(content);
    if ('error' in result) throw new Error(result.error);
    this.#imported.set(id, { id, builtIn: false, file: result.theme as ThemeFile, path });
    delete this.#problems[id];
    this.#emit();
    return id;
  }

  #emit(): void {
    this.onChange(this.state());
  }
}
