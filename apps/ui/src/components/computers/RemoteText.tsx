import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '../transcript/CodeBlock.tsx';
import { fencedBlock, PROSE, READING_PROSE, type MarkdownVariant } from '../transcript/Markdown.tsx';

/**
 * Text from another computer's conversation, formatted as Markdown. Unlike this computer's transcript, nothing in it
 * acts here: a path is not a link to open a file, a code block has no Run (its `CodeBlock` has no session's actions
 * around it, so it only copies), and an image shows only its alt text (no request leaves for an address in someone
 * else's transcript). Only http(s) links are links. React escapes the rest, and raw HTML is never rendered.
 *
 * `previews`: a Markdown block opens rendered, as in `Markdown` (not inside another one's preview).
 */
function componentsFor(variant: MarkdownVariant, previews: boolean): Components {
  // In reading mode the sizes follow the reader's text size, as `READING_PROSE` does.
  const table = variant === 'reading' ? 'text-[0.9em]' : 'text-ui';
  return {
    a: ({ href, children }) =>
      href && /^https?:\/\//i.test(href) ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-link underline decoration-link/40 underline-offset-2">
          {children}
        </a>
      ) : (
        <span>{children}</span>
      ),
    img: ({ alt }) => (alt ? <span className="text-muted">[{alt}]</span> : null),
    // Fenced blocks render through CodeBlock; `pre` is just a pass-through.
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const fence = fencedBlock(className, children);
      if (fence) return <CodeBlock code={fence.code} language={fence.language} preview={previews && fence.markdown ? <RemotePreview text={fence.code} variant={variant} /> : undefined} />;
      return <code className="rounded bg-border/60 px-1 py-px font-mono text-[0.9em] [overflow-wrap:anywhere]">{children}</code>;
    },
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className={`border-collapse ${table} [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left`}>{children}</table>
      </div>
    ),
  };
}

const COMPONENTS: Record<MarkdownVariant, Components> = { chat: componentsFor('chat', true), reading: componentsFor('reading', true) };
const PREVIEW_COMPONENTS: Record<MarkdownVariant, Components> = { chat: componentsFor('chat', false), reading: componentsFor('reading', false) };

const RemotePreview = memo(function RemotePreview({ text, variant }: { text: string; variant: MarkdownVariant }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={PREVIEW_COMPONENTS[variant]}>
      {text}
    </ReactMarkdown>
  );
});

/** `reading`: reading mode's roomier prose, as for `Markdown`. */
export const RemoteText = memo(function RemoteText({ text, variant = 'chat' }: { text: string; variant?: MarkdownVariant }) {
  return (
    <div className={variant === 'reading' ? READING_PROSE : PROSE}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS[variant]}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
