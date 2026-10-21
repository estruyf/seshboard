import { previewKind, type PreviewKind } from '@switchboard/protocol/client';
import { Check, Code, Copy, Folder, RotateCw, WrapText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename, dirnameOf, tildify } from '../../lib/format.ts';
import { fileManagerName } from '../../lib/platform.ts';
import { useFilePreview, type PreviewView } from '../../state/filePreviewStore.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { useOpenIn } from '../OpenInButton.tsx';
import { CodeBlock } from '../transcript/CodeBlock.tsx';
import { formatBytes } from '../transcript/imageLayout.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { FileMarkdown } from './FileMarkdown.tsx';

/** The most text the preview limit allows (the engine's `MAX_PREVIEW_BYTES`), for the sentence that says why a file isn't shown. */
const LIMIT_TEXT = '2 MB';
/** The extension without its dot, which names the grammar (`ts`, `yml`); undefined when there is none. */
const extensionOf = (path: string): string | undefined => {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : undefined;
};
/** A file longer than this shows its source as plain text: highlighting a big file would stall the window. */
const HIGHLIGHT_LIMIT = 200_000;

interface Loaded {
  kind: PreviewKind;
  size: number;
  content: string | null;
  modified: number;
}

type Read = { path: string; state: 'loading' } | { path: string; state: 'error'; message: string } | { path: string; state: 'ready'; file: Loaded };

/**
 * A Markdown, HTML or code file, read by the engine, in a dialog of its own (`useFilePreview().open(path)`): rendered, or as its
 * source. Mounted once per window. It reads the file again on Reload and when the window comes back to the front, so an
 * edit by Claude shows without reopening. HTML runs in a sandboxed frame: no scripts, no network.
 */
export function FilePreviewDialog() {
  const path = useFilePreview((s) => s.path);
  // The smoke test opens a preview without a conversation that links to a throwaway file.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail === 'string') useFilePreview.getState().open(detail);
    };
    window.addEventListener('switchboard:preview-file', onOpen);
    return () => window.removeEventListener('switchboard:preview-file', onOpen);
  }, []);
  return path ? <Preview key={path} path={path} /> : null;
}

function Preview({ path }: { path: string }) {
  const close = useFilePreview((s) => s.close);
  const views = useFilePreview((s) => s.views);
  const setView = useFilePreview((s) => s.setView);
  const wrap = useFilePreview((s) => s.wrap);
  const setWrap = useFilePreview((s) => s.setWrap);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const home = useHomeFolder();
  const editors = useHosts((s) => s.editors);
  const openIn = useOpenIn();
  const [read, setRead] = useState<Read>({ path, state: 'loading' });
  const [copied, flash] = useFlash(1_500);

  const load = useCallback(() => {
    if (!client) return;
    let cancelled = false;
    client.call('files.read', { path }).then(
      (file) =>
        !cancelled &&
        // A file that did not change keeps its state, so a refocus does not redraw the page.
        setRead((prev) => (prev.state === 'ready' && prev.file.modified === file.modified && prev.file.size === file.size && prev.file.content === file.content ? prev : { path, state: 'ready', file })),
      (error: unknown) => !cancelled && setRead({ path, state: 'error', message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, path]);

  useEffect(() => load(), [load]);
  // Claude may have changed the file while you looked at another window.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const kind: PreviewKind = read.state === 'ready' ? read.file.kind : (previewKind(path) ?? 'code');
  // Code has no rendered form: it is always its source.
  const view: PreviewView = kind === 'code' ? 'source' : views[kind];
  const showsSource = view === 'source';
  const name = basename(path);
  const fileManager = editors.find((e) => e.kind === 'finder');

  const openEditor = () => openIn(path).catch((e: unknown) => toast(`Couldn't open ${name}: ${e instanceof Error ? e.message : String(e)}`));
  const showFile = () => openIn(path, { editorId: fileManager?.id ?? 'finder' }).catch((e: unknown) => toast(`Couldn't show ${name} in ${fileManagerName()}: ${e instanceof Error ? e.message : String(e)}`));
  const copyPath = () => void navigator.clipboard.writeText(path).then(() => flash('Path copied'), () => toast("Couldn't copy the path"));

  const file = read.state === 'ready' ? read.file : null;
  const tooLarge = file !== null && file.content === null;

  return (
    <Dialog
      title={name}
      subtitle={<span className="font-mono text-meta [overflow-wrap:anywhere]">{tildify(path, home)}</span>}
      width="full"
      flush
      onClose={close}
      data-file-preview=""
      data-file-preview-kind={kind}
      headerActions={
        <>
          {file && !tooLarge && kind !== 'code' && (
            <SegmentedControl
              mode="radio"
              label="View"
              size="sm"
              value={view}
              onChange={(next) => setView(kind, next)}
              segments={[
                { value: 'preview', label: 'Preview', data: { 'data-file-preview-view': 'preview' } },
                { value: 'source', label: 'Source', data: { 'data-file-preview-view': 'source' } },
              ]}
              className="mr-1"
            />
          )}
          {file && !tooLarge && showsSource && (
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon={<WrapText size={14} aria-hidden />}
              aria-label="Wrap lines"
              aria-pressed={wrap}
              data-tooltip={wrap ? 'Wrap lines: on' : 'Wrap lines: off'}
              data-file-preview-wrap=""
              onClick={() => setWrap(!wrap)}
            />
          )}
          <Button variant="quiet" size="sm" iconOnly icon={<RotateCw size={14} aria-hidden />} aria-label="Reload" data-file-preview-reload="" onClick={() => void load()} />
          <Button variant="quiet" size="sm" iconOnly icon={<Code size={14} aria-hidden />} aria-label="Open in editor" onClick={() => void openEditor()} />
          <Button variant="quiet" size="sm" iconOnly icon={<Folder size={14} aria-hidden />} aria-label={`Show in ${fileManagerName()}`} onClick={() => void showFile()} />
          <Button variant="quiet" size="sm" iconOnly icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} aria-label="Copy path" onClick={copyPath} />
        </>
      }
    >
      {read.state === 'loading' && (
        <p role="status" className="p-5 text-ui text-muted">
          Loading…
        </p>
      )}
      {read.state === 'error' && (
        <div className="p-5">
          <Notice tone="error" data-file-preview-error="">
            {read.message}
          </Notice>
        </div>
      )}
      {file && tooLarge && (
        <div className="p-5">
          <Notice
            tone="neutral"
            data-file-preview-too-large=""
            actions={
              <>
                <Button size="sm" icon={<Code size={13} aria-hidden />} onClick={() => void openEditor()}>
                  Open in editor
                </Button>
                <Button size="sm" icon={<Folder size={13} aria-hidden />} onClick={() => void showFile()}>
                  Show in {fileManagerName()}
                </Button>
              </>
            }
          >
            This file is {formatBytes(file.size)}. Switchboard previews files up to {LIMIT_TEXT}.
          </Notice>
        </div>
      )}
      {file && file.content !== null && showsSource && (
        <div className="min-h-0 flex-1 overflow-auto" data-file-preview-source="">
          <CodeBlock code={file.content} wrap={wrap} language={file.content.length > HIGHLIGHT_LIMIT ? undefined : file.kind === 'code' ? extensionOf(path) : file.kind} />
        </div>
      )}
      {file && file.content !== null && view === 'preview' && file.kind === 'markdown' && (
        <div className="mx-auto w-full max-w-3xl px-8 py-6" data-file-preview-markdown="">
          <FileMarkdown text={file.content} baseDir={dirnameOf(path)} />
        </div>
      )}
      {file && file.content !== null && view === 'preview' && file.kind === 'html' && (
        // The page's own colours on the browser's own canvas (white), whatever the theme: an unstyled page is black on white.
        <div className="m-4 flex min-h-0 flex-1 overflow-hidden rounded-md border border-edge" style={{ colorScheme: 'normal', backgroundColor: 'Canvas' }}>
          <iframe title={name} sandbox="" srcDoc={file.content} className="h-full w-full border-0" style={{ colorScheme: 'normal' }} data-file-preview-frame="" />
        </div>
      )}
    </Dialog>
  );
}
