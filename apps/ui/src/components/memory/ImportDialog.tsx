import { Copy } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { MemoryImportPreview } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { Select } from '../ui/Select.tsx';
import { indexMeterText } from './memoryUi.ts';
import { flagsOf, PASTE_PROMPT, personalLinesAfter, picked, rowsOf, type ImportRow } from './importView.ts';

const PILL = { error: 'warn', caution: 'caution', muted: 'muted', link: 'link' } as const;

/**
 * Import memory from the Claude app: from its data export (the paths picked) or from text pasted from the app. A
 * preview first, one row per memory with where it goes and what to look at; nothing is written until Import. The text
 * is data: shown and saved as files, never sent to Claude.
 */
export function ImportDialog({ source, onClose }: { source: { kind: 'export'; paths: string[] } | { kind: 'paste' }; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const id = useId();
  const [pasted, setPasted] = useState('');
  const [preview, setPreview] = useState<MemoryImportPreview | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = (result: MemoryImportPreview) => {
    setPreview(result);
    setRows(rowsOf(result));
    setError(null);
  };
  useEffect(() => {
    if (!client || source.kind !== 'export') return;
    void client.call('memory.importExportPreview', { paths: source.paths }).then(show, (e: Error) => setError(e.message));
  }, [client, source]);

  const previewPaste = async () => {
    if (!client || !pasted.trim()) return;
    try {
      show(await client.call('memory.importPastePreview', { text: pasted }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const doImport = async () => {
    if (!client || !preview || busy) return;
    const picks = picked(rows).map((r) => ({ id: r.entry.id, target: r.target, type: r.entry.type }));
    if (picks.length === 0) return;
    setBusy(true);
    try {
      const { created, updated } = await client.call('memory.import', { token: preview.token, picks });
      onClose();
      toast(`Imported ${created + updated} ${created + updated === 1 ? 'memory' : 'memories'}`, { body: updated ? `${created} new, ${updated} updated.` : undefined });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const setRow = (index: number, patch: Partial<ImportRow>) => setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const count = picked(rows).length;
  const meter = preview ? indexMeterText(personalLinesAfter(preview, rows)) : null;
  const targets = preview ? [{ value: 'personal', label: 'Personal' }, ...preview.projects.map((p) => ({ value: p.root, label: p.name })), { value: 'skip', label: 'Skip' }] : [];

  return (
    <Dialog
      title={source.kind === 'export' ? 'Import from your Claude export' : 'Paste from the Claude app'}
      subtitle={
        preview
          ? `${preview.entries.length} ${preview.entries.length === 1 ? 'memory' : 'memories'} found. Conversations are never read. Nothing is written until Import.`
          : source.kind === 'export'
            ? 'Reading the export…'
            : 'Ask the app for its memories, then paste the answer here. It is saved as files, never sent to Claude.'
      }
      width="lg"
      placement="top"
      flush={!!preview}
      onClose={onClose}
      onSubmit={preview ? () => void doImport() : () => void previewPaste()}
      data-memory-import
      footerStart={meter && <span className={`text-meta ${meter.over ? 'text-caution' : 'text-muted'}`}>{meter.text.replace('MEMORY.md', 'Personal MEMORY.md')}</span>}
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          {preview ? (
            <Button variant="primary" kbd="⌘↵" disabled={count === 0 || busy} onClick={() => void doImport()} data-memory-import-confirm>
              Import {count}
            </Button>
          ) : (
            source.kind === 'paste' && (
              <Button variant="primary" kbd="⌘↵" disabled={!pasted.trim()} onClick={() => void previewPaste()} data-memory-paste-preview>
                Preview
              </Button>
            )
          )}
        </>
      }
    >
      {error && (
        <Notice tone="error" className={preview ? 'm-4' : 'mb-3'}>
          {error}
        </Notice>
      )}
      {!preview && source.kind === 'paste' && (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-ui text-muted">1. In the Claude app, send this:</span>
            <div className="flex items-start gap-2 rounded-lg border border-edge bg-code p-3">
              <p className="min-w-0 flex-1 font-mono text-ui select-text">{PASTE_PROMPT}</p>
              <Button size="sm" icon={<Copy size={12} aria-hidden />} onClick={() => void navigator.clipboard.writeText(PASTE_PROMPT).then(() => toast('Prompt copied'), () => {})} data-memory-paste-copy>
                Copy
              </Button>
            </div>
          </div>
          <label htmlFor={`${id}-pasted`} className="text-ui text-muted">
            2. Paste its answer:
          </label>
          <textarea
            id={`${id}-pasted`}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={10}
            autoFocus
            className="w-full resize-y rounded-md border border-edge bg-bg p-2.5 font-mono text-ui text-text outline-none focus:border-accent-ink"
            data-memory-paste-text
          />
        </div>
      )}
      {!preview && source.kind === 'export' && !error && <p className="text-ui text-muted">Reading…</p>}
      {preview && (
        <ul className="divide-y divide-edge" data-memory-import-rows>
          {rows.map((row, i) => (
            <li key={row.entry.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-5 py-2" data-memory-import-row={row.entry.id}>
              <Checkbox checked={row.checked} onChange={(checked) => setRow(i, { checked })} label={`Import ${row.entry.name}`} dataAttrs={{ 'data-memory-import-check': row.entry.id }} />
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate font-mono text-ui" data-tooltip={row.entry.excerpt}>
                  {row.entry.exportPath ?? row.entry.name}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-meta text-muted">
                  <span>→</span>
                  <Select
                    label={`Where ${row.entry.name} goes`}
                    value={row.target}
                    onChange={(target) => setRow(i, { target, checked: target === 'skip' ? false : row.checked || row.target === 'skip' })}
                    options={targets}
                    menuWidth={220}
                    className="flex h-6 items-center gap-1 rounded-md border border-edge bg-bg px-2 text-meta text-text"
                    dataAttrs={{ 'data-memory-import-target': row.entry.id }}
                  />
                  <span>· {row.entry.type}</span>
                  {row.entry.claudeProject && <span>· from {row.entry.claudeProject}</span>}
                </span>
              </span>
              <span className="flex flex-wrap justify-end gap-1">
                {flagsOf(row.entry, row.target).map((flag) => (
                  <Pill key={flag.label} tone={PILL[flag.tone]}>
                    {flag.label}
                  </Pill>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
