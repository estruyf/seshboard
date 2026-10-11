import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useOpenIn } from '../OpenInButton.tsx';
import { createPathResolver, fileUrl, type FileRef, type PathResolver } from './fileRefs.ts';

const FileLinkContext = createContext<PathResolver | null>(null);

/**
 * Lets the Markdown inside turn file paths into links that open in the editor. Relative paths are
 * looked up from `cwd`, the session's folder. Without it (or without the engine) paths stay text.
 */
export function FileLinksProvider({ cwd, children }: { cwd: string | null; children: ReactNode }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const resolver = useMemo(() => (client ? createPathResolver((paths) => client.call('files.resolve', { cwd, paths }).then((r) => r.paths)) : null), [client, cwd]);
  return <FileLinkContext.Provider value={resolver}>{children}</FileLinkContext.Provider>;
}

/** How long a path has to stay the same before it's looked up: while Claude writes, it grows a letter at a time. */
const SETTLE_MS = 250;

/** The absolute path of the file `ref` names, or null while unknown or when there is none. */
function useResolvedPath(ref: FileRef | null): string | null {
  const resolver = useContext(FileLinkContext);
  const path = ref?.path ?? null;
  // Rows scroll in and out of the virtualised list: an answer we already have shows at once.
  const [resolved, setResolved] = useState(() => (resolver && path ? (resolver.peek(path) ?? null) : null));
  useEffect(() => {
    const known = resolver && path ? resolver.peek(path) : null;
    setResolved(known ?? null);
    if (!resolver || !path || known !== undefined) return;
    let cancelled = false;
    const timer = setTimeout(() => void resolver.resolve(path).then((result) => !cancelled && setResolved(result)), SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resolver, path]);
  return resolved;
}

/**
 * Inline code or a link in a reply that names a file: a link that opens the file in the default
 * editor (at its line) once the engine finds it, and `fallback` until then or when it doesn't exist.
 */
export function FileLink({ fileRef, fallback, children }: { fileRef: FileRef | null; fallback: ReactNode; children: ReactNode }) {
  const path = useResolvedPath(fileRef);
  const openIn = useOpenIn();
  const editor = useHosts((s) => s.editors.find((e) => e.id === s.defaultEditorId)?.name ?? null);
  const [error, setError] = useState<string | null>(null);
  if (!path) return <>{fallback}</>;
  const line = fileRef?.line;
  const target = line ? `${path}:${line}` : path;
  return (
    <>
      <a
        href={fileUrl(path)}
        onClick={(event) => {
          // The main process would refuse a file:// link anyway; the engine opens it in the editor.
          event.preventDefault();
          setError(null);
          openIn(path, line ? { line } : {}).catch((e: unknown) => setError(`Couldn't open ${target}: ${e instanceof Error ? e.message : String(e)}`));
        }}
        className={`underline decoration-current/30 underline-offset-2 hover:decoration-current ${error ? 'text-error' : 'text-link'}`}
        data-tooltip={error ?? `Open ${target} in ${editor ?? 'your editor'}`}
        data-file-link={target}
      >
        {children}
      </a>
      {/* The tooltip only shows on hover; say it out loud too. */}
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
    </>
  );
}
