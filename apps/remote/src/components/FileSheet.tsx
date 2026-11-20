import { useEffect, useState } from 'react';
import { REMOTE_FILE_TEXT_BYTES, sessionFileKind } from '@seshboard/protocol/remote-client';
import type { Client } from './Connected.tsx';
import { FileOpenerContext } from './fileOpener.ts';
import { Markdown } from './Markdown.tsx';
import { Sheet } from './Sheet.tsx';

type Read =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'text'; kind: 'markdown' | 'html' | 'code'; size: number; content: string | null }
  | { state: 'image'; url: string };

const nameOf = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/**
 * A file the session made, read by the computer: Markdown drawn as in the conversation, an image, or the text of the
 * rest (an HTML page too: it never runs here). The computer refuses any other file, and says so. A path in the file
 * opens that file here instead (`onOpen`).
 */
export function FileSheet({ client, sessionId, path, onOpen, onClose }: { client: Client; sessionId: string; path: string; onOpen: (path: string) => void; onClose: () => void }) {
  const [read, setRead] = useState<Read>({ state: 'loading' });
  useEffect(() => {
    if (!client) return;
    let live = true;
    setRead({ state: 'loading' });
    const failed = (error: Error) => live && setRead({ state: 'error', message: error.message });
    if (sessionFileKind(path) === 'image') {
      void client.call('files.image', { sessionId, path }).then(({ mediaType, data }) => live && setRead({ state: 'image', url: `data:${mediaType};base64,${data}` }), failed);
    } else {
      void client.call('files.read', { sessionId, path }).then(({ kind, size, content }) => live && setRead({ state: 'text', kind, size, content }), failed);
    }
    return () => {
      live = false;
    };
  }, [client, sessionId, path]);

  return (
    <Sheet title={nameOf(path)} subtitle={<span className="font-mono break-all">{path}</span>} onClose={onClose} tall hook="file">
      <div className="pt-1 pb-2" data-remote-file={read.state === 'text' ? read.kind : read.state}>
        {read.state === 'loading' ? (
          <p className="text-ui text-muted">Loading…</p>
        ) : read.state === 'error' ? (
          <p className="text-ui text-error">{read.message}</p>
        ) : read.state === 'image' ? (
          <img src={read.url} alt={nameOf(path)} className="mx-auto max-w-full rounded-lg" />
        ) : read.content === null ? (
          <p className="text-ui text-muted">
            This file is {Math.ceil(read.size / 1_000)} KB. Files up to {REMOTE_FILE_TEXT_BYTES / 1_000_000} MB open here.
          </p>
        ) : read.kind === 'markdown' ? (
          <FileOpenerContext.Provider value={onOpen}>
            <Markdown text={read.content} />
          </FileOpenerContext.Provider>
        ) : (
          <pre className="overflow-x-auto overscroll-x-contain rounded-lg bg-code p-2.5 font-mono text-meta leading-relaxed whitespace-pre-wrap break-words">{read.content}</pre>
        )}
      </div>
    </Sheet>
  );
}
