import { REMOTE_FILE_TEXT_BYTES, sessionFileKind, type SessionFileKind } from '@seshboard/protocol/client';
import { Check, Code, Copy, Folder, RotateCw, WrapText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename, dirnameOf } from '../../lib/format.ts';
import { fileManagerName } from '../../lib/platform.ts';
import { useFilePreview, type PreviewTarget, type PreviewView } from '../../state/filePreviewStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { useOpenIn } from '../OpenInButton.tsx';
import { callComputer } from '../computers/callComputer.ts';
import { formatBytes } from '../transcript/imageLayout.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { FileMarkdown } from './FileMarkdown.tsx';
import { RemoteFileContext, type RemoteFileSession } from './remotePreview.ts';
import { SourceView } from './SourceView.tsx';

/** The most text the preview limit allows (the engine's `MAX_PREVIEW_BYTES`), for the sentence that says why a file isn't shown. */
const LIMIT_TEXT = '2 MB';
/** The same for a file on another computer (`REMOTE_FILE_TEXT_BYTES`). */
const REMOTE_LIMIT_TEXT = `${REMOTE_FILE_TEXT_BYTES / 1_000_000} MB`;
/** The extension without its dot, which names the grammar (`ts`, `yml`); undefined when there is none. */
const extensionOf = (path: string): string | undefined => {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : undefined;
};
/** A file longer than this shows its source as plain text: highlighting a big file would stall the window. */
const HIGHLIGHT_LIMIT = 200_000;

interface Loaded {
  kind: SessionFileKind;
  size: number;
  content: string | null;
  modified: number;
  /** An image on another computer, as a data URL. */
  image?: string;
}

type Read = { path: string; state: 'loading' } | { path: string; state: 'error'; message: string; code: string | null } | { path: string; state: 'ready'; file: Loaded };

/** What the Files panel adds to a file's preview. */
export interface FilePreviewOptions {
  /** Lines Claude changed, marked in the source's gutter. */
  marks?: ReadonlyMap<number, string | null>;
  /** Changes when the file may have changed on disk (Claude wrote it): it is read again. */
  reloadKey?: number;
  /** "Rendered" rather than "Preview" on the switcher, as the Files panel says it. */
  renderedLabel?: string;
}

/** A file's preview, in pieces for the dialog and the side panel to place. */
export interface FilePreviewContent {
  name: string;
  kind: SessionFileKind;
  /** Preview | Source, for a file that has both and was read. */
  switcher: ReactNode;
  /** Wrap lines, Reload, Open in editor, Show in the file manager, Copy path. */
  tools: ReactNode;
  /** The file, on the code background from edge to edge; it fills the room it gets and scrolls itself. */
  body: ReactNode;
  /** The text read, while it is shown (null while loading, for an image, or a file too large). */
  text: string | null;
  /** Whether the source shows (rather than the rendered page). */
  showsSource: boolean;
  /** The mtime (ms) of the text read, for a save to check the file did not change since; null while there is none. */
  modified: number | null;
  /** Reads the file again. */
  reload(): void;
  /** Opens the file in the editor at the line it was opened at. */
  openEditor(): void;
}

/**
 * A Markdown, HTML or code file, read by the engine: rendered, or as its source with line numbers; an image as itself.
 * It reads the file again on Reload and when the window comes back to the front, so an edit by Claude shows without
 * reopening. HTML runs in a sandboxed frame: no scripts, no network. A link that named a line opens on the source, at that line.
 *
 * A file of a session on another computer (`target.computerId`) is read by that computer, which only gives files the
 * session made. Open in editor and Show in the file manager are left out: they act on this computer.
 */
export function useFilePreviewContent(target: PreviewTarget, options: FilePreviewOptions = {}): FilePreviewContent {
  const { marks, reloadKey, renderedLabel = 'Preview' } = options;
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

  const { computerId, sessionId } = target;
  const remote: RemoteFileSession | null = useMemo(() => (computerId && sessionId ? { computerId, sessionId } : null), [computerId, sessionId]);

  const load = useCallback(() => {
    if (!client) return;
    let cancelled = false;
    // An image has no text to read: it comes as its bytes, from this computer or the session's.
    const read: Promise<Loaded> =
      sessionFileKind(path) === 'image'
        ? (remote ? callComputer(client, remote.computerId, 'files.image', { sessionId: remote.sessionId, path }) : client.call('files.image', { path })).then(({ mediaType, data }) => ({ kind: 'image', size: data.length, content: null, modified: 0, image: `data:${mediaType};base64,${data}` }))
        : remote
          ? callComputer(client, remote.computerId, 'files.read', { sessionId: remote.sessionId, path })
          : client.call('files.read', { path });
    read.then(
      (file) =>
        !cancelled &&
        // A file that did not change keeps its state, so a refocus does not redraw the page.
        setRead((prev) => (prev.state === 'ready' && prev.file.modified === file.modified && prev.file.size === file.size && prev.file.content === file.content && prev.file.image === file.image ? prev : { path, state: 'ready', file })),
      (error: unknown) => !cancelled && setRead({ path, state: 'error', message: error instanceof Error ? error.message : String(error), code: (error as { code?: unknown })?.code === undefined ? null : String((error as { code?: unknown }).code) }),
    );
    return () => {
      cancelled = true;
    };
    // `reloadKey` reads the file again when Claude wrote it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, path, remote, reloadKey]);

  useEffect(() => load(), [load]);
  // Claude may have changed the file while you looked at another window.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const kind: SessionFileKind = read.state === 'ready' ? read.file.kind : (sessionFileKind(path) ?? 'code');
  // Code and plain text have no rendered form: they are always their source. An image has no source.
  const view: PreviewView = kind === 'image' ? 'preview' : kind === 'code' || kind === 'text' || atLine ? 'source' : views[kind];
  const showsSource = view === 'source';
  const name = basename(path);
  const fileManager = editors.find((e) => e.kind === 'finder');

  const openEditor = () => openIn(path, target.line ? { line: target.line } : {}).catch((e: unknown) => toast(`Couldn't open ${name}: ${e instanceof Error ? e.message : String(e)}`));
  const showFile = () => openIn(path, { editorId: fileManager?.id ?? 'finder' }).catch((e: unknown) => toast(`Couldn't show ${name} in ${fileManagerName()}: ${e instanceof Error ? e.message : String(e)}`));
  const copyPath = () => void navigator.clipboard.writeText(path).then(() => flash('Path copied'), () => toast("Couldn't copy the path"));

  const file = read.state === 'ready' ? read.file : null;
  const tooLarge = file !== null && file.content === null && !file.image;

  const switcher = file && !tooLarge && kind !== 'code' && kind !== 'text' && kind !== 'image' && (
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
        { value: 'preview', label: renderedLabel, data: { 'data-file-preview-view': 'preview' } },
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
      {!remote && <Button variant="quiet" size="sm" iconOnly icon={<Code size={14} aria-hidden />} aria-label="Open in editor" onClick={() => void openEditor()} />}
      {!remote && <Button variant="quiet" size="sm" iconOnly icon={<Folder size={14} aria-hidden />} aria-label={`Show in ${fileManagerName()}`} onClick={() => void showFile()} />}
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
        {read.code === 'NOT_FOUND' ? (
          <Notice tone="neutral" data-file-preview-error="gone">
            This file is gone.
          </Notice>
        ) : read.code === 'UNSUPPORTED' && !remote ? (
          <Notice
            tone="neutral"
            data-file-preview-error="unsupported"
            actions={
              <Button size="sm" icon={<Code size={13} aria-hidden />} onClick={() => void openEditor()}>
                Open in editor
              </Button>
            }
          >
            Seshboard can't show this file. Open it in your editor.
          </Notice>
        ) : (
          <Notice tone="error" data-file-preview-error="">
            {read.message}
          </Notice>
        )}
      </div>
    );
  else if (file && tooLarge)
    content = (
      <div className="p-5">
        <Notice
          tone="neutral"
          data-file-preview-too-large=""
          actions={
            remote ? undefined : (
              <>
                <Button size="sm" icon={<Code size={13} aria-hidden />} onClick={() => void openEditor()}>
                  Open in editor
                </Button>
                <Button size="sm" icon={<Folder size={13} aria-hidden />} onClick={() => void showFile()}>
                  Show in {fileManagerName()}
                </Button>
              </>
            )
          }
        >
          This file is {formatBytes(file.size)}. Seshboard previews files up to {remote ? `${REMOTE_LIMIT_TEXT} from another computer` : LIMIT_TEXT}.
        </Notice>
      </div>
    );
  else if (file?.image)
    content = (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
        <img src={file.image} alt={name} className="max-h-full max-w-full object-contain" data-file-preview-image="loaded" />
      </div>
    );
  else if (file && file.content !== null && showsSource)
    content = (
      <SourceView
        code={file.content}
        wrap={wrap}
        language={file.content.length > HIGHLIGHT_LIMIT || file.kind === 'text' ? undefined : file.kind === 'code' || file.kind === 'image' ? extensionOf(path) : file.kind}
        line={target.line}
        endLine={target.endLine}
        seq={target.seq}
        marks={marks}
      />
    );
  else if (file && file.content !== null && file.kind === 'markdown')
    content = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-5" data-file-preview-markdown="">
          <RemoteFileContext.Provider value={remote}>
            <FileMarkdown text={file.content} baseDir={dirnameOf(path)} />
          </RemoteFileContext.Provider>
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
    text: file && !tooLarge ? file.content : null,
    showsSource,
    // Only for this file's own read: the one before can still show while the next file loads.
    modified: file && !tooLarge && read.path === path ? file.modified : null,
    reload: () => void load(),
    openEditor: () => void openEditor(),
    body: (
      <div className="flex min-h-0 flex-1 flex-col bg-code" data-file-preview-body="">
        {content}
      </div>
    ),
  };
}
