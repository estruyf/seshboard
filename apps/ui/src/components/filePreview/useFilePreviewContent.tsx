import { previewKind, type PreviewKind } from '@seshboard/protocol/client';
import { Check, Code, Copy, Folder, RotateCw, WrapText } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename, dirnameOf } from '../../lib/format.ts';
import { fileManagerName } from '../../lib/platform.ts';
import { useFilePreview, type PreviewTarget, type PreviewView } from '../../state/filePreviewStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { useOpenIn } from '../OpenInButton.tsx';
import { formatBytes } from '../transcript/imageLayout.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { FileMarkdown } from './FileMarkdown.tsx';
import { SourceView } from './SourceView.tsx';

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

/** A file's preview, in pieces for the dialog and the side panel to place. */
export interface FilePreviewContent {
  name: string;
  kind: PreviewKind;
  /** Preview | Source, for a file that has both and was read. */
  switcher: ReactNode;
  /** Wrap lines, Reload, Open in editor, Show in the file manager, Copy path. */
  tools: ReactNode;
  /** The file, on the code background from edge to edge; it fills the room it gets and scrolls itself. */
  body: ReactNode;
}

/**
 * A Markdown, HTML or code file, read by the engine: rendered, or as its source with line numbers. It reads the file again
 * on Reload and when the window comes back to the front, so an edit by Claude shows without reopening. HTML runs in a
 * sandboxed frame: no scripts, no network. A link that named a line opens on the source, at that line.
 */
export function useFilePreviewContent(target: PreviewTarget): FilePreviewContent {
  const { path } = target;
  const views = useFilePreview((s) => s.views);
  const setView = useFilePreview((s) => s.setView);
  const wrap = useFilePreview((s) => s.wrap);
  const setWrap = useFilePreview((s) => s.setWrap);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const editors = useHosts((s) => s.editors);
  const openIn = useOpenIn();
  const [read, setRead] = useState<Read>({ path, state: 'loading' });
  const [copied, flash] = useFlash(1_500);
  // A link to a line shows the source, where the line is, without changing the view remembered for the next file.
  const [opened, setOpened] = useState(target.seq);
  const [atLine, setAtLine] = useState(Boolean(target.line));
  if (opened !== target.seq) {
    setOpened(target.seq);
    setAtLine(Boolean(target.line));
  }

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
  const view: PreviewView = kind === 'code' || atLine ? 'source' : views[kind];
  const showsSource = view === 'source';
  const name = basename(path);
  const fileManager = editors.find((e) => e.kind === 'finder');

  const openEditor = () => openIn(path, target.line ? { line: target.line } : {}).catch((e: unknown) => toast(`Couldn't open ${name}: ${e instanceof Error ? e.message : String(e)}`));
  const showFile = () => openIn(path, { editorId: fileManager?.id ?? 'finder' }).catch((e: unknown) => toast(`Couldn't show ${name} in ${fileManagerName()}: ${e instanceof Error ? e.message : String(e)}`));
  const copyPath = () => void navigator.clipboard.writeText(path).then(() => flash('Path copied'), () => toast("Couldn't copy the path"));

  const file = read.state === 'ready' ? read.file : null;
  const tooLarge = file !== null && file.content === null;

  const switcher = file && !tooLarge && kind !== 'code' && (
    <SegmentedControl
      mode="radio"
      label="View"
      size="sm"
      value={view}
      onChange={(next) => {
        setAtLine(false);
        setView(kind, next);
      }}
      segments={[
        { value: 'preview', label: 'Preview', data: { 'data-file-preview-view': 'preview' } },
        { value: 'source', label: 'Source', data: { 'data-file-preview-view': 'source' } },
      ]}
    />
  );

  const tools = (
    <>
      {file && !tooLarge && showsSource && (
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={<WrapText size={14} aria-hidden />}
          aria-label="Wrap lines"
          aria-pressed={wrap}
          selected={wrap}
          data-tooltip={wrap ? 'Wrap lines: on' : 'Wrap lines: off'}
          data-file-preview-wrap={wrap ? 'on' : 'off'}
          onClick={() => setWrap(!wrap)}
        />
      )}
      <Button variant="quiet" size="sm" iconOnly icon={<RotateCw size={14} aria-hidden />} aria-label="Reload" data-file-preview-reload="" onClick={() => void load()} />
      <Button variant="quiet" size="sm" iconOnly icon={<Code size={14} aria-hidden />} aria-label="Open in editor" onClick={() => void openEditor()} />
      <Button variant="quiet" size="sm" iconOnly icon={<Folder size={14} aria-hidden />} aria-label={`Show in ${fileManagerName()}`} onClick={() => void showFile()} />
      <Button variant="quiet" size="sm" iconOnly icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} aria-label="Copy path" onClick={copyPath} />
    </>
  );

  let content: ReactNode = null;
  if (read.state === 'loading')
    content = (
      <p role="status" className="p-5 text-ui text-muted">
        Loading…
      </p>
    );
  else if (read.state === 'error')
    content = (
      <div className="p-5">
        <Notice tone="error" data-file-preview-error="">
          {read.message}
        </Notice>
      </div>
    );
  else if (file && tooLarge)
    content = (
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
          This file is {formatBytes(file.size)}. Seshboard previews files up to {LIMIT_TEXT}.
        </Notice>
      </div>
    );
  else if (file && file.content !== null && showsSource)
    content = (
      <SourceView
        code={file.content}
        wrap={wrap}
        language={file.content.length > HIGHLIGHT_LIMIT ? undefined : file.kind === 'code' ? extensionOf(path) : file.kind}
        line={target.line}
        endLine={target.endLine}
        seq={target.seq}
      />
    );
  else if (file && file.content !== null && file.kind === 'markdown')
    content = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-5" data-file-preview-markdown="">
          <FileMarkdown text={file.content} baseDir={dirnameOf(path)} />
        </div>
      </div>
    );
  else if (file && file.content !== null && file.kind === 'html')
    content = (
      // The page's own colours on the browser's own canvas (white), whatever the theme: an unstyled page is black on white.
      <div className="flex min-h-0 flex-1" style={{ colorScheme: 'normal', backgroundColor: 'Canvas' }}>
        <iframe title={name} sandbox="" srcDoc={file.content} className="h-full w-full border-0" style={{ colorScheme: 'normal' }} data-file-preview-frame="" />
      </div>
    );

  return {
    name,
    kind,
    switcher,
    tools,
    body: (
      <div className="flex min-h-0 flex-1 flex-col bg-code" data-file-preview-body="">
        {content}
      </div>
    ),
  };
}
