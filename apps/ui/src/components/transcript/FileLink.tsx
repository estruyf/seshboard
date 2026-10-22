import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useFileLinkActions } from './useFileLinkActions.tsx';
import { createPathResolver, fileUrl, type FileRef, type PathResolver } from './fileRefs.ts';

const FileLinkContext = createContext<PathResolver | null>(null);

/**
 * Lets the Markdown inside turn file paths into links that show in the file manager or open in the editor. Relative paths are
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
 * Inline code or a link in a reply that names a file: a link once the engine finds it, and  until then or
 * when it doesn't exist. A click shows the file in the file manager or opens it in the editor (at its line), as
 * Settings › Conversation says; Shift-click does the other, and the context menu has both.
 */
export function FileLink({ fileRef, fallback, children }: { fileRef: FileRef | null; fallback: ReactNode; children: ReactNode }) {
  const path = useResolvedPath(fileRef);
  if (!path) return <>{fallback}</>;
  return (
    <ResolvedFileLink path={path} line={fileRef?.line} endLine={fileRef?.endLine}>
      {children}
    </ResolvedFileLink>
  );
}

function ResolvedFileLink({ path, line, endLine, children }: { path: string; line: number | undefined; endLine: number | undefined; children: ReactNode }) {
  const { action, tooltip, error, handlers, extras } = useFileLinkActions(path, line, endLine);
  return (
    <>
      <a
        href={fileUrl(path)}
        {...handlers}
        className={`underline decoration-current/30 underline-offset-2 hover:decoration-current ${error ? 'text-error' : 'text-link'}`}
        data-tooltip={error ?? tooltip}
        aria-description={tooltip}
        data-file-link={line ? `${path}:${line}` : path}
        data-file-link-action={action}
      >
        {children}
      </a>
      {extras}
    </>
  );
}
