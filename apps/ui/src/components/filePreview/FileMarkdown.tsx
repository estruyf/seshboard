import { ImageOff } from 'lucide-react';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { fileUrl } from '../transcript/fileRefs.ts';
import { markdownComponents, PROSE } from '../transcript/Markdown.tsx';
import { useFileLinkActions } from '../transcript/useFileLinkActions.tsx';
import { FILE_REHYPE_PLUGINS, FILE_REMARK_PLUGINS, fileUrlTransform } from './markdownPlugins.ts';
import { resolveRelative } from './resolveRelative.ts';

/** GitHub's alerts: a coloured bar and a title line, in the theme's tones. */
const ALERTS =
  '[&_blockquote[data-alert]]:rounded-r-md [&_blockquote[data-alert]]:border-l-4 [&_blockquote[data-alert]]:py-1 [&_blockquote[data-alert]]:pr-3 [&_blockquote[data-alert]]:text-text ' +
  '[&_[data-alert-title]]:font-semibold ' +
  '[&_blockquote[data-alert=note]]:border-link [&_blockquote[data-alert=note]]:bg-link/8 [&_blockquote[data-alert=note]_[data-alert-title]]:text-link ' +
  '[&_blockquote[data-alert=tip]]:border-ok [&_blockquote[data-alert=tip]]:bg-ok/8 [&_blockquote[data-alert=tip]_[data-alert-title]]:text-ok ' +
  '[&_blockquote[data-alert=important]]:border-caution [&_blockquote[data-alert=important]]:bg-caution/8 [&_blockquote[data-alert=important]_[data-alert-title]]:text-caution ' +
  '[&_blockquote[data-alert=warning]]:border-warn [&_blockquote[data-alert=warning]]:bg-warn/8 [&_blockquote[data-alert=warning]_[data-alert-title]]:text-warn ' +
  '[&_blockquote[data-alert=caution]]:border-error [&_blockquote[data-alert=caution]]:bg-error/8 [&_blockquote[data-alert=caution]_[data-alert-title]]:text-error';

/** The prose of a previewed file: the conversation's styles, plus what a README has (images, details, tables, alerts). */
const FILE_PROSE = `${PROSE} ${ALERTS} [&_img]:inline-block [&_img]:max-w-full [&_details]:my-1.5 [&_summary]:cursor-pointer [&_hr]:my-4 [&_hr]:border-edge [&_pre]:my-2`;

/** Images already read, by path, so Reload and scrolling back don't fetch them again; a small LRU. */
const images = new Map<string, Promise<string>>();
const IMAGE_CACHE = 40;

/** An image of the file, through the engine (the renderer never loads `file://`). Without it, or when it can't be read, the alt text shows. */
function PreviewImage({ path, alt }: { path: string; alt: string }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ path: string; url: string | null; failed: boolean }>({ path, url: null, failed: false });
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let pending = images.get(path);
    if (!pending) {
      pending = client.call('files.image', { path }).then(({ mediaType, data }) => `data:${mediaType};base64,${data}`);
      pending.catch(() => images.delete(path));
      images.set(path, pending);
      if (images.size > IMAGE_CACHE) images.delete(images.keys().next().value!);
    }
    pending.then(
      (url) => !cancelled && setState({ path, url, failed: false }),
      () => !cancelled && setState({ path, url: null, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, path]);
  const own = state.path === path ? state : { url: null, failed: false };
  if (own.url) return <img src={own.url} alt={alt} data-file-preview-image="loaded" />;
  return <ImageFallback alt={alt} failed={own.failed} />;
}

function ImageFallback({ alt, failed }: { alt: string; failed: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-card px-1.5 py-0.5 text-ui text-muted" data-file-preview-image={failed ? 'failed' : 'pending'}>
      <ImageOff size={12} aria-hidden />
      {alt || 'Image'}
    </span>
  );
}

/** A relative or `file:` link: a file link on the resolved path, so a Markdown file previews here and the rest follow the setting. */
function LocalLink({ path, children }: { path: string; children: ReactNode }) {
  const { action, tooltip, error, handlers, extras } = useFileLinkActions(path);
  return (
    <>
      <a
        href={fileUrl(path)}
        {...handlers}
        className={`underline decoration-current/30 underline-offset-2 hover:decoration-current ${error ? 'text-error' : 'text-link'}`}
        data-tooltip={error ?? tooltip}
        aria-description={tooltip}
        data-file-link={path}
        data-file-link-action={action}
      >
        {children}
      </a>
      {extras}
    </>
  );
}

const LINK = 'text-link underline decoration-link/40 underline-offset-2';

/** Scrolls to the element an `#anchor` names (raw HTML ids are prefixed by the sanitiser). */
function scrollToAnchor(id: string) {
  const name = decodeURIComponent(id);
  const target = document.getElementById(name) ?? document.getElementById(`user-content-${name}`);
  target?.scrollIntoView({ block: 'start' });
}

/**
 * The Markdown of a previewed file. Like an answer in the conversation, with raw HTML (sanitised), GitHub's alerts, images
 * read through the engine and links that follow the file: web links open in the browser, relative and `file:` ones are file
 * links, so a Markdown file next to it previews in the same dialog. `baseDir` is the file's folder.
 */
export const FileMarkdown = memo(function FileMarkdown({ text, baseDir }: { text: string; baseDir: string }) {
  const components = useMemo<Components>(
    () => ({
      ...markdownComponents,
      a: ({ href, children }) => {
        if (href?.startsWith('#')) {
          return (
            <a
              href={href}
              className={LINK}
              onClick={(event) => {
                event.preventDefault();
                scrollToAnchor(href.slice(1));
              }}
            >
              {children}
            </a>
          );
        }
        const path = resolveRelative(href, baseDir);
        if (path) return <LocalLink path={path}>{children}</LocalLink>;
        // The main process opens http(s) links in the browser and blocks everything else.
        return (
          <a href={href} target="_blank" rel="noreferrer" className={LINK}>
            {children}
          </a>
        );
      },
      img: ({ src, alt }) => {
        // Web images are not loaded (the app allows none); say what they were.
        const path = typeof src === 'string' ? resolveRelative(src, baseDir) : null;
        return path ? <PreviewImage path={path} alt={alt ?? ''} /> : <ImageFallback alt={alt ?? ''} failed />;
      },
    }),
    [baseDir],
  );
  return (
    <div className={FILE_PROSE}>
      <ReactMarkdown remarkPlugins={FILE_REMARK_PLUGINS} rehypePlugins={FILE_REHYPE_PLUGINS} urlTransform={fileUrlTransform} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
