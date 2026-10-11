import { currentPlatform } from '../../lib/platform.ts';
import { ArrowRight, FolderOpen, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BACKUP_SECTIONS, settingsFileName, type BackupSection, type FolderMapping, type ImportChange, type ImportMode, type ImportPreview } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { DEFAULT_EXPORT_SECTIONS, groupChanges, hasEffect, SECTION_INFO, summarizeChanges } from '../../lib/backup.ts';
import { basename, guessHome, tildify } from '../../lib/format.ts';
import { useBackup } from '../../state/backupStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useThemes } from '../../state/themeStore.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Radio, RadioGroup } from '../ui/Radio.tsx';

const appVersion = () => window.switchboard?.appInfo.version ?? 'unknown';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function SectionChoices({ available, selected, onChange, attr }: { available: readonly BackupSection[]; selected: readonly BackupSection[]; onChange(next: BackupSection[]): void; attr: `data-${string}` }) {
  return (
    <div className="grid gap-2.5">
      {available.map((section) => (
        <Checkbox
          key={section}
          checked={selected.includes(section)}
          onChange={(on) => onChange(BACKUP_SECTIONS.filter((s) => (s === section ? on : selected.includes(s))))}
          dataAttrs={{ [attr]: section }}
        >
          <span className="block text-[12.5px] text-text">{SECTION_INFO[section].label}</span>
          <span className="block text-ui text-muted">{SECTION_INFO[section].detail}</span>
        </Checkbox>
      ))}
    </div>
  );
}

/** The imported themes' files (main keeps them; the engine writes and reads the settings file). */
const importedThemes = () => useThemes.getState().themes.filter((t) => !t.builtIn).map((t) => t.file);

/** Export settings: pick what to include, then where to save the file. */
export function ExportDialog({ onClose }: { onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const prefs = usePreferences((s) => s.prefs);
  const [sections, setSections] = useState<BackupSection[]>(DEFAULT_EXPORT_SECTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async () => {
    if (!client) return;
    setError(null);
    setBusy(true);
    try {
      const path = await window.switchboard?.chooseExportFile(settingsFileName(new Date()));
      if (path) setSaved((await client.call('settings.export', { path, sections, preferences: { ...prefs }, themes: importedThemes(), appVersion: appVersion() })).path);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      placement="top"
      title="Export settings"
      subtitle="Save your Switchboard setup to a file, to move to another Mac, restore after a reset, or share your actions. Sessions stay in ~/.claude."
      onClose={onClose}
      data-export-dialog
      footer={
        saved ? (
          <>
            <span role="status" className="min-w-0 flex-1 truncate text-ui text-ok" data-export-saved={saved} data-tooltip={saved}>
              Saved to {saved}
            </span>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            {error ? (
              <span role="alert" className="min-w-0 flex-1 truncate text-ui text-error" data-tooltip={error}>
                Couldn't export: {error}
              </span>
            ) : (
              sections.length === 0 && <span className="min-w-0 flex-1 text-ui text-muted">Choose at least one thing to include.</span>
            )}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || sections.length === 0 || !client} data-export-settings>
              {busy ? 'Exporting…' : 'Export…'}
            </Button>
          </>
        )
      }
    >
      <SectionChoices available={BACKUP_SECTIONS} selected={sections} onChange={setSections} attr="data-export-section" />
    </Dialog>
  );
}

const CHANGE_STYLE: Record<ImportChange['change'], { label: string; className: string }> = {
  add: { label: 'Add', className: 'bg-ok/15 text-ok' },
  change: { label: 'Change', className: 'bg-accent/15 text-accent-ink' },
  remove: { label: 'Remove', className: 'bg-error/15 text-error' },
  keep: { label: 'Keep yours', className: 'bg-border/70 text-muted' },
  skip: { label: 'Skip', className: 'bg-warn/15 text-warn' },
};

/**
 * Import settings: choose a file, then see what it would add, change or skip before anything happens.
 * Folders missing on this Mac can be pointed at another folder. The engine backs up the current
 * settings first; imported shell actions need approval before they run.
 */
export function ImportDialog({ onClose }: { onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sections, setSections] = useState<BackupSection[] | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [relocate, setRelocate] = useState<FolderMapping[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);

  // Ask for the file first; cancelling the dialog closes this one too.
  useEffect(() => {
    let cancelled = false;
    void window.switchboard?.chooseImportFile().then((chosen) => {
      if (cancelled) return;
      if (chosen) setPath(chosen);
      else onClose();
    });
    return () => {
      cancelled = true;
    };
  }, [onClose]);

  const request = (apply: boolean) =>
    client!.call('settings.import', {
      path: path!,
      sections: sections ?? [...BACKUP_SECTIONS],
      mode,
      relocate,
      preferences: { ...usePreferences.getState().prefs },
      themes: importedThemes(),
      appVersion: appVersion(),
      apply,
    });

  useEffect(() => {
    if (!client || !path || backupPath) return;
    let cancelled = false;
    setError(null);
    request(false).then(
      (result) => {
        if (cancelled) return;
        setPreview(result.preview);
        // Everything the file has is ticked at first.
        setSections((current) => current ?? result.preview.sections);
      },
      (e) => !cancelled && setError(message(e)),
    );
    return () => {
      cancelled = true;
    };
    // `request` reads these; listing them re-runs the preview whenever a choice changes.
  }, [client, path, sections, mode, relocate, backupPath]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await request(true);
      // Themes first, so a theme the imported preferences pick is there when they apply.
      for (const theme of result.themes) await window.switchboard?.addTheme(theme.raw, theme.how);
      if (result.preferences && Object.keys(result.preferences).length > 0) usePreferences.getState().update(result.preferences);
      setPreview(result.preview);
      setBackupPath(result.backupPath);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const pointAt = async (from: string) => {
    const to = await window.switchboard?.pickFolder();
    if (to) setRelocate((list) => [...list.filter((m) => m.from !== from), { from, to }]);
  };

  const home = useMemo(() => guessHome([...(preview?.missingFolders ?? []), ...relocate.map((m) => m.to), ...(preview?.changes.map((c) => c.label) ?? [])]), [preview, relocate]);
  const groups = useMemo(() => groupChanges((preview?.changes ?? []).filter((c) => sections?.includes(c.section))), [preview, sections]);
  const effect = preview ? hasEffect(preview.changes) : false;

  if (!path) return null;
  const exported = preview?.exportedAt ? new Date(preview.exportedAt) : null;

  return (
    <Dialog
      placement="top"
      title="Import settings"
      subtitle={
        preview
          ? `From ${basename(path)}${exported && !Number.isNaN(exported.getTime()) ? `, exported ${exported.toLocaleDateString()}` : ''}${preview.appVersion !== 'unknown' ? ` by Switchboard ${preview.appVersion}` : ''}.`
          : `Reading ${basename(path)}…`
      }
      onClose={onClose}
      data-import-dialog
      footer={
        backupPath ? (
          <Button variant="primary" onClick={onClose} data-import-done>
            Done
          </Button>
        ) : (
          <>
            <span role={error ? 'alert' : 'status'} className={`min-w-0 flex-1 truncate text-ui ${error ? 'text-error' : 'text-muted'}`} data-tooltip={error ?? undefined} data-import-summary>
              {error ?? (preview ? summarizeChanges(preview.changes, preview.unchanged) : '')}
            </span>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void apply()} disabled={busy || !effect || !client} data-import-settings>
              {busy ? 'Importing…' : mode === 'replace' ? 'Replace' : 'Import'}
            </Button>
          </>
        )
      }
    >
      {backupPath ? (
        <div role="status" className="grid gap-2 text-[12.5px]" data-import-finished>
          <p className="text-text">Settings imported.</p>
          <p className="text-muted">
            Your previous settings were saved to <span className="font-mono text-[11.5px] break-all text-text">{backupPath}</span>. To undo, import that file with Replace.
          </p>
          {preview?.changes.some((c) => c.section === 'actions' && c.detail?.startsWith('needs')) && (
            <p className="text-muted">Imported shell actions ask for your approval the first time they run.</p>
          )}
        </div>
      ) : !preview ? (
        <p className="text-ui text-muted">{error ? 'This file could not be read. Check that it is a settings file exported from Switchboard, then try again.' : 'Reading the file…'}</p>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-2">
            <h3 className="text-ui font-semibold text-muted">Include</h3>
            {preview.sections.length === 0 ? (
              <p className="text-ui text-muted">This file has nothing to import.</p>
            ) : (
              <SectionChoices available={preview.sections} selected={sections ?? []} onChange={setSections} attr="data-import-section" />
            )}
          </div>
          <div className="grid gap-2">
            <h3 className="text-ui font-semibold text-muted">When something is already set here</h3>
            <RadioGroup label="Import mode" className="grid gap-2">
              <Radio checked={mode === 'merge'} onSelect={() => setMode('merge')} dataAttrs={{ 'data-import-mode': 'merge' }}>
                <span className="block text-[12.5px] text-text">Merge</span>
                <span className="block text-ui text-muted">Add what is missing and keep your own values.</span>
              </Radio>
              <Radio checked={mode === 'replace'} onSelect={() => setMode('replace')} dataAttrs={{ 'data-import-mode': 'replace' }}>
                <span className="block text-[12.5px] text-text">Replace</span>
                <span className="block text-ui text-muted">Make projects, actions and preferences match the file. Sessions are only ever added.</span>
              </Radio>
            </RadioGroup>
          </div>
          {(preview.missingFolders.length > 0 || relocate.length > 0) && (
            <div className="grid gap-2" data-import-folders>
              <h3 className="text-ui font-semibold text-muted">Folders</h3>
              <p className="text-ui text-muted">These folders aren’t on {currentPlatform() === 'darwin' ? 'this Mac' : 'this computer'}. Point them at another folder, or leave them to skip their project and actions.</p>
              {preview.missingFolders.map((folder) => (
                <div key={folder} className="flex items-center gap-2 text-ui" data-missing-folder={folder}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text" data-tooltip={folder}>
                    {tildify(folder, home)}
                  </span>
                  <span className="text-warn">not found</span>
                  <Button icon={<FolderOpen size={12} aria-hidden />} onClick={() => void pointAt(folder)} aria-label={`Choose a folder for ${tildify(folder, home)}`}>
                    Choose folder…
                  </Button>
                </div>
              ))}
              {relocate.map((m) => (
                <div key={m.from} className="flex items-center gap-2 text-ui">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" data-tooltip={m.from}>
                    {tildify(m.from, home)}
                  </span>
                  <ArrowRight size={12} className="shrink-0 text-faint" aria-hidden />
                  <span className="sr-only">moves to</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text" data-tooltip={m.to}>
                    {tildify(m.to, home)}
                  </span>
                  <Button
                    variant="quiet"
                    size="sm"
                    iconOnly
                    icon={<Undo2 size={13} aria-hidden />}
                    onClick={() => setRelocate((list) => list.filter((x) => x.from !== m.from))}
                    aria-label={`Undo the new folder for ${m.from}`}
                    data-tooltip="Undo"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3" data-import-preview>
            <h3 className="text-ui font-semibold text-muted">What changes</h3>
            {groups.length === 0 && <p className="text-ui text-muted">{preview.unchanged > 0 ? 'Everything in this file is already set up here.' : 'Nothing to import.'}</p>}
            {groups.map((group) => (
              <div key={group.section} className="grid gap-1">
                <h4 className="text-ui font-medium text-text">{SECTION_INFO[group.section].label}</h4>
                <ul className="grid gap-0.5">
                  {group.changes.map((c, i) => (
                    <li key={`${c.label}:${i}`} className="flex items-center gap-2 text-ui" data-import-change={c.change}>
                      <span className={`w-[70px] shrink-0 rounded px-1.5 py-px text-center text-[10.5px] font-medium ${CHANGE_STYLE[c.change].className}`}>{CHANGE_STYLE[c.change].label}</span>
                      <span className="min-w-0 truncate text-text" data-tooltip={c.label}>
                        {group.section === 'projects' ? tildify(c.label, home) : c.label}
                      </span>
                      {c.detail && <span className="min-w-0 flex-1 truncate text-muted">{c.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Mounts the export or import dialog while one is open. */
export function BackupDialogs() {
  const open = useBackup((s) => s.open);
  const close = useBackup((s) => s.close);
  if (open === 'export') return <ExportDialog onClose={close} />;
  if (open === 'import') return <ImportDialog onClose={close} />;
  return null;
}
