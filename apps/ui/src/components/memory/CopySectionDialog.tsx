import { useEffect, useId, useMemo, useState } from 'react';
import { firstSentence, MEMORY_TYPES, sectionBody, slugify, type SectionCopy } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { openMemoryFile } from '../../state/memoryStore.ts';
import { toast } from '../../state/toastStore.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Select } from '../ui/Select.tsx';
import { copyableSections, indexMeterText, relativeTo } from './memoryUi.ts';
import { useMemoryFile } from './useMemoryList.ts';

const field = 'h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';
const PREVIEW_DELAY_MS = 200;

/**
 * Copy a section of CLAUDE.md, a rule or CLAUDE.local.md into your own memory for the project: pick a `##` or `###`
 * section, name it, and see the memory file and the MEMORY.md line it adds. The instruction file isn't changed.
 */
export function CopySectionDialog({ root, file, onClose }: { root: string; file: string; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const id = useId();
  const { content, error: readError } = useMemoryFile(root, file, 0);
  const sections = useMemo(() => (content ? copyableSections(content) : []), [content]);
  const [heading, setHeading] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('project');
  const [description, setDescription] = useState('');
  const [preview, setPreview] = useState<SectionCopy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Picking a section fills in its name and description, which stay editable. */
  const pick = (title: string) => {
    const section = sections.find((s) => s.title === title);
    setHeading(title);
    setName(slugify(title));
    setDescription(section && content ? firstSentence(sectionBody(content, section)) : '');
  };
  const firstTitle = sections[0]?.title ?? null;
  useEffect(() => {
    if (firstTitle && heading === null) pick(firstTitle);
    // Only once the file is read: later picks are the user's.
  }, [firstTitle]);

  useEffect(() => {
    if (!client || !heading || !name.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      client.call('memory.createFromSection', { root, file, heading, name: name.trim(), type, description: description.trim(), dryRun: true }).then(
        (result) => !cancelled && (setPreview(result), setError(null)),
        (e: Error) => !cancelled && (setPreview(null), setError(e.message)),
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, root, file, heading, name, type, description]);

  const save = async () => {
    if (!client || !heading || !preview || busy) return;
    setBusy(true);
    try {
      const result = await client.call('memory.createFromSection', { root, file, heading, name: name.trim(), type, description: description.trim(), dryRun: false });
      onClose();
      toast('Saved to memory', {
        body: `${result.name}.md, from ${relativeTo(root, file)}.`,
        actions: [{ label: 'Open', primary: true, onSelect: () => openMemoryFile(root, result.path), data: { 'data-copy-open': true } }],
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const meter = preview ? indexMeterText(preview.indexLines) : null;
  return (
    <Dialog
      title="Copy a section to my memory"
      subtitle={`From ${relativeTo(root, file)}. The file itself stays as it is.`}
      width="md"
      placement="top"
      onClose={onClose}
      onSubmit={() => void save()}
      data-copy-section-dialog
      footerStart={
        meter && (
          <span className={`text-meta ${meter.over ? 'text-caution' : 'text-muted'}`} data-copy-index-lines={preview?.indexLines}>
            {meter.text}
            {meter.over && '; Claude Code reads the first 200'}
          </span>
        )
      }
      footer={
        <>
          <Button kbd="Esc" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" kbd="⌘↵" disabled={!preview || busy} onClick={() => void save()} data-copy-confirm>
            Save to memory
          </Button>
        </>
      }
    >
      {readError ? (
        <Notice tone="error">{`Couldn't read the file: ${readError}`}</Notice>
      ) : content === null ? (
        <p className="text-ui text-muted">Reading…</p>
      ) : sections.length === 0 ? (
        <Notice>This file has no sections (## or ### headings) to copy.</Notice>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
            <span className="text-ui text-muted">Section</span>
            <Select
              label="Section"
              value={heading ?? ''}
              onChange={pick}
              className={`${field} flex items-center justify-between`}
              menuWidth={320}
              options={sections.map((s) => ({ value: s.title, label: `${s.level === 3 ? '  ' : ''}${s.title}`, hint: s.level === 3 ? '###' : '##' }))}
              dataAttrs={{ 'data-copy-section': true }}
            />
            <label htmlFor={`${id}-name`} className="text-ui text-muted">
              Name
            </label>
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} className={`${field} font-mono`} data-copy-name />
            <span className="text-ui text-muted">Type</span>
            <Select label="Type" value={type} onChange={setType} className={`${field} flex items-center justify-between`} options={MEMORY_TYPES.map((t) => ({ value: t, label: t }))} dataAttrs={{ 'data-copy-type': true }} />
            <label htmlFor={`${id}-description`} className="text-ui text-muted">
              Description
            </label>
            <input id={`${id}-description`} value={description} onChange={(e) => setDescription(e.target.value)} className={field} data-copy-description />
          </div>
          <div className="grid gap-1.5">
            <p className="text-meta text-muted">{preview ? <span className="font-mono">{preview.path.split('/').slice(-2).join('/')}</span> : 'Preview'}</p>
            <pre className="max-h-[32vh] overflow-auto rounded-lg border border-edge bg-code p-3 font-mono text-ui break-words whitespace-pre-wrap select-text" data-copy-preview>
              {preview?.content ?? 'Reading…'}
            </pre>
            {preview && (
              <p className="text-meta text-muted">
                Adds to MEMORY.md: <span className="font-mono text-text">{preview.indexLine}</span>
              </p>
            )}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </Dialog>
  );
}
