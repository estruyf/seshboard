import { trashName } from '../../lib/platform.ts';
import { Check, Copy, Download, FolderOpen, MoreHorizontal, Trash2, Upload } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ColorScheme } from '@switchboard/protocol/bridge';
import type { ThemeEntry, ThemeMode } from '@switchboard/protocol/theme-format';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { resolveTheme, themeModes } from '../../lib/themeResolve.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { bridgeError, useThemes } from '../../state/themeStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { RadioGroup } from '../ui/Radio.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { basename } from '../../lib/format.ts';
import { useFlash } from '../ui/useFlash.ts';
import { ThemePreview } from './ThemePreview.tsx';

const SCHEMES = [
  { value: 'system', label: 'Match System', data: { 'data-color-scheme': 'system' } },
  { value: 'light', label: 'Light', data: { 'data-color-scheme': 'light' } },
  { value: 'dark', label: 'Dark', data: { 'data-color-scheme': 'dark' } },
] as const;

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');
/** The mode on screen now (it follows the Appearance choice, which flips prefers-color-scheme). */
export function useCurrentMode(): ThemeMode {
  const dark = useSyncExternalStore(
    (onChange) => {
      const query = darkQuery();
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => darkQuery().matches,
  );
  return dark ? 'dark' : 'light';
}

/** "Dark only" for a theme without a light mode, and the other way round. */
export const onlyLabel = (entry: ThemeEntry) => {
  const modes = themeModes(entry.file);
  return modes === 'both' ? null : modes === 'dark' ? 'Dark only' : 'Light only';
};

function Heading({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="text-body font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-ui text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** One theme: both modes in miniature, its name and where it came from, and a ⋯ menu. */
function ThemeCard({ entry, selected, mode, onMenu }: { entry: ThemeEntry; selected: boolean; mode: ThemeMode; onMenu(at: ContextMenuPoint): void }) {
  const resolved = useMemo(() => resolveTheme(entry.file), [entry.file]);
  const only = onlyLabel(entry);
  // "Ethan Schoonover (ported by …)" reads as "Ethan Schoonover" on the card, so "built in" stays in view (the full line is its tooltip).
  const author = entry.file.author?.trim();
  const shortAuthor = author?.replace(/\s*\(ported by [^)]*\)$|,\s*ported for Switchboard$/i, '');
  // The ring is the theme's own accent, so the selected card reads as that theme.
  const ring = selected ? { boxShadow: `0 0 0 2px ${resolved[mode].tokens.accent}`, borderColor: 'transparent' } : undefined;
  return (
    <div className={`relative rounded-xl border bg-card ${selected ? '' : 'border-border hover:border-edge'}`} style={ring} data-theme-card={entry.id} data-theme-selected={selected || undefined}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        tabIndex={selected ? 0 : -1}
        onClick={() => useThemes.getState().select(entry.id, { announce: true })}
        // Right-click and Shift+F10 open the same menu as ⋯.
        onContextMenu={(event) => {
          event.preventDefault();
          const pointer = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null;
          onMenu(contextMenuPoint(pointer, event.currentTarget.getBoundingClientRect(), window.innerHeight));
        }}
        onKeyDown={(event) => {
          if (!isContextMenuKey(event)) return;
          event.preventDefault();
          onMenu(contextMenuPoint(null, event.currentTarget.getBoundingClientRect(), window.innerHeight));
        }}
        className="flex w-full flex-col gap-0 p-2 pb-2.5 text-left"
      >
        <span className="flex gap-1.5">
          <ThemePreview tokens={entry.file.light ? resolved.light.tokens : null} mode="light" className="h-20 flex-1" />
          <ThemePreview tokens={entry.file.dark ? resolved.dark.tokens : null} mode="dark" className="h-20 flex-1" />
        </span>
        <span className={`flex min-w-0 items-center gap-1.5 px-1 pt-2 ${selected ? 'pr-14' : 'pr-8'}`}>
          <span className="truncate text-ui font-semibold text-text">{entry.file.name}</span>
          {only && <span className="shrink-0 rounded-full bg-border px-1.5 text-meta font-semibold text-muted">{only}</span>}
        </span>
        <span className="truncate px-1 text-meta text-faint" data-tooltip={author !== shortAuthor ? author : undefined}>
          {[shortAuthor, entry.builtIn ? 'built in' : 'imported'].filter(Boolean).join(' · ')}
        </span>
      </button>
      <span className="absolute right-2 bottom-[30px] flex items-center gap-1">
        {selected && <Check size={14} className="text-accent-ink" aria-label="In use" />}
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={<MoreHorizontal size={14} aria-hidden />}
          aria-label={`More for ${entry.file.name}`}
          aria-haspopup="menu"
          data-theme-menu={entry.id}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu(contextMenuPoint(null, { left: rect.right - 180, top: rect.top, bottom: rect.bottom }, window.innerHeight));
          }}
        />
      </span>
    </div>
  );
}

/** Settings › Theme: Appearance (Match System, Light, Dark), then the theme picker. */
export function ThemeSettings() {
  const colorScheme = usePreferences((s) => s.prefs.colorScheme);
  const update = usePreferences((s) => s.update);
  const themes = useThemes((s) => s.themes);
  const problems = useThemes((s) => s.problems);
  const active = useThemes((s) => s.active.entry);
  const mode = useCurrentMode();
  const [menuAt, setMenuAt] = useState<{ entry: ThemeEntry; at: ContextMenuPoint } | null>(null);
  const [removing, setRemoving] = useState<ThemeEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();

  const run = async (what: () => Promise<string | null | void>) => {
    setError(null);
    try {
      const message = await what();
      if (message) setFlash(message);
    } catch (e) {
      setError(bridgeError(e));
    }
  };

  const entries = (entry: ThemeEntry): MenuEntry[] => [
    {
      label: 'Export…',
      icon: <Download size={14} aria-hidden />,
      data: { 'data-theme-export': entry.id },
      onSelect: () =>
        void run(async () => {
          const path = await useThemes.getState().exportTheme(entry.id);
          return path ? `Exported “${entry.file.name}” to ${basename(path)}.` : null;
        }),
    },
    {
      label: 'Duplicate',
      icon: <Copy size={14} aria-hidden />,
      data: { 'data-theme-duplicate': entry.id },
      onSelect: () =>
        void run(async () => {
          const id = await window.switchboard?.duplicateTheme(entry.id);
          const copy = useThemes.getState().themes.find((t) => t.id === id);
          return copy ? `Added “${copy.file.name}”. Its file is in the themes folder, ready to edit.` : null;
        }),
    },
    ...(entry.builtIn
      ? []
      : ([
          { label: 'Show file', icon: <FolderOpen size={14} aria-hidden />, data: { 'data-theme-show': entry.id }, onSelect: () => window.switchboard?.showThemeFile(entry.id) },
          'separator',
          { label: 'Remove', icon: <Trash2 size={14} aria-hidden />, danger: true, data: { 'data-theme-remove': entry.id }, onSelect: () => setRemoving(entry) },
        ] satisfies MenuEntry[])),
  ];

  const only = onlyLabel(active);
  const missing = only ? (only === 'Dark only' ? 'light' : 'dark') : null;
  const themeProblems = themes.filter((t) => problems[t.id]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 py-6" data-theme-settings>
      <section className="grid gap-3" aria-label="Appearance">
        <Heading title="Appearance" />
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl<ColorScheme> mode="radio" label="Appearance" segments={SCHEMES} value={colorScheme} onChange={(colorScheme) => update({ colorScheme })} />
          {colorScheme === 'system' && <span className="text-ui text-faint">Follows macOS.</span>}
        </div>
      </section>

      <section className="grid gap-3" aria-label="Theme">
        <Heading title="Theme" description="Colours for the app, the code blocks and the terminal. Themes are JSON files you can share.">
          <Button variant="quiet" icon={<FolderOpen size={14} aria-hidden />} onClick={() => window.switchboard?.openThemesFolder()} data-theme-folder>
            Open themes folder
          </Button>
          <Button icon={<Upload size={14} aria-hidden />} onClick={() => void useThemes.getState().chooseImport()} data-theme-import>
            Import…
          </Button>
        </Heading>

        {themeProblems.map((theme) => (
          <Notice key={theme.id} tone="warn" data-theme-problem={theme.id}>
            Your last change to “{theme.file.name}” can't be used: {problems[theme.id]} Switchboard keeps the last version that worked.
          </Notice>
        ))}

        <RadioGroup label="Theme" className="grid grid-cols-3 gap-3.5">
          <div className="contents" data-theme-picker>
            {themes.map((entry) => (
              <ThemeCard
                key={entry.id}
                entry={entry}
                selected={entry.id === active.id}
                mode={mode}
                onMenu={(at) => setMenuAt({ entry, at })}
              />
            ))}
            <button
              type="button"
              onClick={() => void useThemes.getState().chooseImport()}
              className="flex min-h-36 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-edge p-3.5 text-center text-ui text-muted hover:bg-border/45 hover:text-text"
              data-theme-drop
            >
              <Upload size={16} aria-hidden />
              <span>Drop a theme .json here</span>
              <span className="text-meta text-faint">or anywhere in the window</span>
            </button>
          </div>
        </RadioGroup>

        {missing && (
          <p className="text-ui text-muted" data-theme-missing={missing}>
            “{active.file.name}” has no {missing} version. {colorScheme === 'system' ? `With Match System, ${missing} mode uses Demo Time.` : colorScheme === missing ? `${missing === 'light' ? 'Light' : 'Dark'} mode uses Demo Time.` : `${missing === 'light' ? 'Light' : 'Dark'} mode would use Demo Time.`}
          </p>
        )}
        {error && (
          <Notice tone="error" onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}
        {flash && (
          <Notice tone="success" data-theme-flash>
            {flash}
          </Notice>
        )}
        <Notice tone="info">Editing a theme file? Switchboard reloads the active theme when its file changes.</Notice>
      </section>

      {menuAt && <Menu x={menuAt.at.x} y={menuAt.at.y} above={menuAt.at.above} width={180} label={`${menuAt.entry.file.name} theme`} entries={entries(menuAt.entry)} onClose={() => setMenuAt(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove “${removing.file.name}”?`}
          danger
          confirmLabel={`Move to ${trashName()}`}
          body={<>Its file moves to the {trashName()}, so you can get it back from there.{removing.id === active.id && ' Switchboard goes back to Demo Time.'}</>}
          onConfirm={async () => {
            try {
              await window.switchboard?.removeTheme(removing.id);
            } catch (e) {
              throw new Error(bridgeError(e));
            }
            setFlash(`Removed “${removing.file.name}”.`);
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
