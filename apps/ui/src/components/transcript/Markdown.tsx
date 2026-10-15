import { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock.tsx';
import { FileLink } from './FileLink.tsx';
import { fileRefFromHref, parseFileRef } from './fileRefs.ts';
import { healMarkdown, splitBlocks } from './streamingMarkdown.ts';

/** Fenced-block languages that get a Preview | Source switch. */
const MARKDOWN = new Set(['markdown', 'md']);

const components: Components = {
  a: ({ href, children }) => {
    // The main process opens http(s) links in the browser and blocks everything else.
    const link = (
      <a href={href} target="_blank" rel="noreferrer" className="text-link underline decoration-link/40 underline-offset-2">
        {children}
      </a>
    );
    // A link to a file in the project (`[a.ts](src/a.ts#L12)`) opens in the editor instead.
    const fileRef = fileRefFromHref(href);
    return fileRef ? (
      <FileLink fileRef={fileRef} fallback={link}>
        {children}
      </FileLink>
    ) : (
      link
    );
  },
  // Fenced blocks render through CodeBlock (highlighted when idle); `pre` is just a pass-through.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? '');
    const language = /language-([\w+#-]+)/.exec(className ?? '')?.[1];
    if (language || text.includes('\n')) {
      const code = text.replace(/\n$/, '');
      // Markdown Claude writes out (a README, a PR description) opens rendered, with its source a click away.
      return <CodeBlock code={code} language={language} preview={language && MARKDOWN.has(language.toLowerCase()) ? <Block text={code} /> : undefined} />;
    }
    // Long inline code (URLs, paths) wraps instead of pushing the pane wider.
    const code = <code className="rounded bg-border/60 px-1 py-px font-mono text-[0.9em] [overflow-wrap:anywhere]">{children}</code>;
    // A file path (`src/a.ts:12`) becomes a link to open it in the editor, once the engine finds it.
    const fileRef = parseFileRef(text);
    return fileRef ? (
      <FileLink fileRef={fileRef} fallback={code}>
        {code}
      </FileLink>
    ) : (
      code
    );
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse text-ui [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
        {children}
      </table>
    </div>
  ),
};

/** The prose styles of an answer, also for another computer's (`components/computers/RemoteText.tsx`). */
export const PROSE =
  'markdown text-body leading-relaxed select-text [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-title [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted';

const Block = memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
});

/** Assistant prose. Memoised: finished messages never change, so they render once. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className={PROSE}>
      <Block text={text} />
    </div>
  );
});

/**
 * Prose Claude is still writing, formatted as it arrives (like Streamdown): the text is
 * split into blocks so only the last one re-renders per delta, and that block has its
 * unclosed markers (`**bold`, `` `code ``, half a link) closed so they never show raw.
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <div className={PROSE}>
      {blocks.map((block, i) => (
        // Blocks only ever grow at the end, so the index is a stable key.
        <Block key={i} text={i === blocks.length - 1 ? healMarkdown(block) : block} />
      ))}
    </div>
  );
});
