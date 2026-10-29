import { AlertTriangle, Check, Info } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { THEME_MODES, type ThemeFile, type ThemeMode } from '@seshboard/protocol/theme-format';
import { highlightWith, syntaxThemeData } from '../../lib/highlight.ts';
import { contrastIssues, syntaxColorsOf, themeReport, type SyntaxColors } from '../../lib/themeReport.ts';
import { resolveTheme } from '../../lib/themeResolve.ts';
import { bridgeError, useThemes } from '../../state/themeStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { useCurrentMode } from './ThemeSettings.tsx';
import { ThemePreview } from './ThemePreview.tsx';

const SAMPLE = `export function applyTheme(theme: Theme) {
  const css = \`:root { … }\`;
  // values are validated colours only
  return css.length > 0;
}`;

const Swatch = ({ color }: { color: string }) => <span className="inline-block size-3.5 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_var(--sb-overlay-border)]" style={{ background: color }} />;
const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-border/60 px-1 font-mono text-meta">{children}</code>;
const MODE_LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark' };

function ReportLine({ icon, children, data }: { icon: ReactNode; children: ReactNode; data?: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 text-ui leading-relaxed" data-theme-report={data}>
      <span className="mt-[3px] flex shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** "in both modes", "in dark mode", or "in light (12) and dark (30)". */
function setLine(set: Partial<Record<ThemeMode, number>>, total: number) {
  const modes = THEME_MODES.filter((m) => set[m] !== undefined);
  if (modes.length === 2 && set.light === set.dark) return <><b>{set.light} of {total} colours set</b> in both modes.</>;
  if (modes.length === 1) return <><b>{set[modes[0]!]} of {total} colours set</b> in {modes[0]} mode.</>;
  return <><b>Colours set:</b> {set.light} of {total} in light mode, {set.dark} in dark mode.</>;
}

/**
 * Import “<name>”: both modes in miniature, what the file sets and what is generated, contrast below
 * WCAG AA, keys that are ignored, and the terminal and code colours, before anything is added.
 */
function ImportPreview({ theme, ignored, fileName, raw }: { theme: ThemeFile; ignored: string[]; fileName: string; raw: unknown }) {
  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const report = useMemo(() => themeReport(theme, resolved), [theme, resolved]);
  const mode = useCurrentMode();
  const [syntax, setSyntax] = useState<Partial<Record<ThemeMode, SyntaxColors>>>({});
  const [sample, setSample] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clash, setClash] = useState<{ use: boolean; builtIn: boolean } | null>(null);
  const themes = useThemes((s) => s.themes);
  const close = () => useThemes.getState().closeImport();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const colors: Partial<Record<ThemeMode, SyntaxColors>> = {};
      for (const m of THEME_MODES) if (theme[m]) colors[m] = syntaxColorsOf(await syntaxThemeData(resolved[m].syntax, m).catch(() => ({})));
      const html = await highlightWith(SAMPLE, 'ts', { light: resolved.light.syntax, dark: resolved.dark.syntax });
      if (!cancelled) {
        setSyntax(colors);
        setSample(html);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [theme, resolved]);

  const issues = contrastIssues(theme, resolved, syntax);
  const generated = THEME_MODES.flatMap((m) => report.generated[m] ?? []);
  const generatedNames = [...new Set(generated.map((g) => g.token))];
  const swatchMode = theme[mode] ? mode : theme.dark ? 'dark' : 'light';
  const tokens = resolved[swatchMode].tokens;
  const codeLabel = report.code.light === report.code.dark || !theme.light || !theme.dark ? report.code[theme.dark ? 'dark' : 'light'] : `light ${report.code.light}, dark ${report.code.dark}`;

  const add = async (how: 'add' | 'replace' | 'keep-both', use: boolean) => {
    const existing = themes.find((t) => t.file.name.toLowerCase() === theme.name.toLowerCase());
    if (how === 'add' && existing) return setClash({ use, builtIn: existing.builtIn });
    setBusy(true);
    setError(null);
    try {
      const id = (await window.seshboard?.addTheme(raw, how)) ?? null;
      close();
      if (id && use) useThemes.getState().select(id, { announce: true });
      else if (id) toast(`Added ${useThemes.getState().themes.find((t) => t.id === id)?.file.name ?? theme.name}`);
    } catch (e) {
      setError(bridgeError(e));
      setBusy(false);
      setClash(null);
    }
  };

  if (clash)
    return (
      <Dialog
        role="alertdialog"
        width="sm"
        title={`You already have “${theme.name}”`}
        subtitle={clash.builtIn ? `“${theme.name}” is built in, so this one is added as “${theme.name} 2”.` : `Replace it with this file, or keep both? The copy is named “${theme.name} 2”.`}
        onClose={() => setClash(null)}
        footer={
          <>
            <Button onClick={() => setClash(null)}>Cancel</Button>
            <Button variant={clash.builtIn ? 'primary' : 'secondary'} disabled={busy} onClick={() => void add('keep-both', clash.use)} data-theme-keep-both>
              Keep both
            </Button>
            {!clash.builtIn && (
              <Button variant="primary" disabled={busy} onClick={() => void add('replace', clash.use)} data-theme-replace>
                Replace
              </Button>
            )}
          </>
        }
      />
    );

  return (
    <Dialog
      width="lg"
      title={`Import “${theme.name}”`}
      subtitle={[fileName, theme.author && `by ${theme.author}`, `version ${theme.version}`].filter(Boolean).join(' · ')}
      onClose={close}
      onSubmit={() => void add('add', true)}
      data-theme-import-dialog
      footer={
        <>
          <Button kbd="Esc" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void add('add', false)} data-theme-add>
            Add theme
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={busy} onClick={() => void add('add', true)} data-theme-add-use>
            Add and use
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          {THEME_MODES.map((m) => (
            <div key={m}>
              <p className="mb-1.5 text-meta font-semibold tracking-wide text-faint uppercase">{MODE_LABEL[m]}</p>
              <ThemePreview tokens={theme[m] ? resolved[m].tokens : null} mode={m} missingLabel={`${MODE_LABEL[m]}: Demo Time`} className="h-40" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <ReportLine icon={<Check size={14} className="text-ok" aria-hidden />} data="set">
              {setLine(report.set, report.total)}
            </ReportLine>
            {generatedNames.length > 0 && (
              <ReportLine icon={<Info size={14} className="text-link" aria-hidden />} data="generated">
                <b>{generatedNames.length} generated</b> from canvas and accent: <span className="text-muted">{generatedNames.join(', ')}</span>.
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {generatedNames.slice(0, 18).map((token) => (
                    <span key={token} data-tooltip={token}>
                      <Swatch color={tokens[token]} />
                    </span>
                  ))}
                </span>
              </ReportLine>
            )}
            {issues.map((issue) => (
              <ReportLine key={`${issue.mode}-${issue.label}`} icon={<AlertTriangle size={14} className="text-caution" aria-hidden />} data="contrast">
                <b>
                  {issue.label}: {issue.ratio.toFixed(1)} : 1
                </b>{' '}
                in {issue.mode} mode. WCAG AA needs {issue.need}. It still imports.
                <span className="mt-1.5 flex items-center gap-1.5 text-meta text-muted">
                  <Swatch color={issue.fg} />
                  on
                  <Swatch color={issue.bg} />
                </span>
              </ReportLine>
            ))}
            {ignored.length > 0 && (
              <ReportLine icon={<Info size={14} className="text-faint" aria-hidden />} data="ignored">
                <span className="text-muted">
                  Ignored {ignored.length} unknown {ignored.length === 1 ? 'key' : 'keys'}:{' '}
                  {ignored.slice(0, 8).map((key, i) => (
                    <span key={key}>
                      {i > 0 && ', '}
                      <Code>{key}</Code>
                    </span>
                  ))}
                  {ignored.length > 8 && ` and ${ignored.length - 8} more`}
                </span>
              </ReportLine>
            )}
            {(!theme.light || !theme.dark) && (
              <ReportLine icon={<Info size={14} className="text-faint" aria-hidden />} data="one-mode">
                <span className="text-muted">No {theme.light ? 'dark' : 'light'} version. With Match System, {theme.light ? 'dark' : 'light'} mode uses Demo Time.</span>
              </ReportLine>
            )}
            <ReportLine icon={<Info size={14} className="text-faint" aria-hidden />} data="code">
              <span className="text-muted">Code: {codeLabel}</span>
            </ReportLine>
          </div>
          <div className="grid content-start gap-2.5 pt-1.5">
            <div>
              <p className="mb-1.5 text-meta text-faint">Terminal (dark)</p>
              <div className="flex overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--sb-overlay-border)]" data-theme-terminal-strip>
                {resolved.terminal.ansi.map((color, i) => (
                  <span key={i} className="h-4 flex-1" style={{ background: color }} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-meta text-faint">Code · {codeLabel}</p>
              {sample ? (
                // Shiki escapes the code; the HTML is spans with colour variables only.
                <div className="overflow-x-auto rounded-lg px-3 py-2.5 font-mono text-meta leading-relaxed" style={{ background: tokens['code-bg'], color: tokens.text }} dangerouslySetInnerHTML={{ __html: sample }} data-theme-code-sample />
              ) : (
                <pre className="overflow-x-auto rounded-lg px-3 py-2.5 font-mono text-meta leading-relaxed" style={{ background: tokens['code-bg'], color: tokens.text }}>
                  {SAMPLE}
                </pre>
              )}
            </div>
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Dialog>
  );
}

/** "Can't import this theme": the first problem with the file, and nothing was added. */
function Refused({ error }: { error: string }) {
  const close = () => useThemes.getState().closeImport();
  return (
    <Dialog role="alertdialog" width="sm" title="Can't import this theme" onClose={close} data-theme-refused footer={<Button onClick={close} autoFocus>OK</Button>}>
      <div className="grid gap-2">
        <Notice tone="error" icon={<AlertTriangle size={14} aria-hidden />}>
          {error}
        </Notice>
        <p className="text-ui text-muted">Nothing was added.</p>
      </div>
    </Dialog>
  );
}

/**
 * The import dialogs, open wherever an import starts (Settings, the palette, a file dropped on the
 * window), and the drop itself: a .json dropped outside a session's message box opens the import.
 */
export function ThemeImportDialogs() {
  const importing = useThemes((s) => s.importing);
  useThemeDrop();
  if (!importing) return null;
  return importing.ok ? <ImportPreview theme={importing.theme} ignored={importing.ignored} fileName={importing.fileName} raw={importing.raw} /> : <Refused error={importing.error} />;
}

/** A single .json file being dragged, not over a session (whose message box takes dropped files). */
const themeDrag = (event: DragEvent) => {
  const data = event.dataTransfer;
  if (!data || ![...data.types].includes('Files')) return false;
  if ((event.target as Element | null)?.closest?.('[data-drop-zone]')) return false;
  const items = [...data.items].filter((item) => item.kind === 'file');
  return items.length === 1;
};

function useThemeDrop() {
  useEffect(() => {
    const onOver = (event: DragEvent) => {
      if (event.defaultPrevented || !themeDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !themeDrag(event)) return;
      const file = event.dataTransfer?.files[0];
      if (!file || !/\.jsonc?$/i.test(file.name)) return;
      event.preventDefault();
      const path = window.seshboard?.getPathForFile(file);
      if (path) void useThemes.getState().openImport(path);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
