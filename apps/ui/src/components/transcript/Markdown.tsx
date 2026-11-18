import { memo, useMemo, useRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { withoutSkimMarks } from '@seshboard/protocol/client';
import { CheckMark } from '../ui/Checkbox.tsx';
import { REHYPE_PLUGINS, REMARK_PLUGINS, REMARK_REHYPE_OPTIONS, remarkPluginsFor } from './chatPlugins.ts';
import { CodeBlock } from './CodeBlock.tsx';
import { escapeLoneTags } from './escapeLoneTags.ts';
import { FileLink } from './FileLink.tsx';
import { ReplyImage } from './ReplyImage.tsx';
import { fileRefFromHref, fileUrlTransform, parseFileRef } from './fileRefs.ts';
import { newStreamingCache, streamingBlocks } from './streamingMarkdown.ts';

/** Fenced-block languages that get a Preview | Source switch. */
const MARKDOWN = new Set(['markdown', 'md']);

/** How an answer's Markdown renders; a previewed file's (`components/filePreview/FileMarkdown.tsx`) builds on it. */
export const markdownComponents: Components = {
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
  code: (props) => renderCode(props, true),
  img: ReplyImage,
  // A task list's box (`- [x]`): the app's check box look, read-only, instead of a native one.
  input: TaskBox,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse text-ui [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
        {children}
      </table>
    </div>
  ),
};

/** The box in front of a task list item (`- [ ]`, `- [x]`). Another `input` is not allowed through the sanitiser, so only checkboxes get here. */
export function TaskBox({ type, checked }: { type?: string; checked?: boolean }) {
  if (type !== 'checkbox') return null;
  return (
    <span role="checkbox" aria-checked={Boolean(checked)} aria-readonly="true" aria-label={checked ? 'Done' : 'Not done'} data-task-box={checked ? 'checked' : 'open'} className="mr-1.5 inline-flex align-[-2px]">
      <CheckMark checked={Boolean(checked)} />
    </span>
  );
}

/** What a `code` element holds if it is a fenced block, null for inline code; `markdown`: its language gets a Preview | Source switch. */
export function fencedBlock(className: string | undefined, children: ReactNode): { code: string; language: string | undefined; markdown: boolean } | null {
  const text = String(children ?? '');
  const language = /language-([\w+#.-]+)/.exec(className ?? '')?.[1];
  if (!language && !text.includes('\n')) return null;
  return { code: text.replace(/\n$/, ''), language, markdown: Boolean(language && MARKDOWN.has(language.toLowerCase())) };
}

/** Inline code, or a fenced block; `previews`: a Markdown block opens rendered (not inside another one's preview). */
function renderCode({ className, children }: { className?: string; children?: ReactNode }, previews: boolean) {
  const fence = fencedBlock(className, children);
  // Markdown Claude writes out (a README, a PR description) opens rendered, with its source a click away.
  if (fence) return <CodeBlock code={fence.code} language={fence.language} preview={previews && fence.markdown ? <PreviewBlock text={fence.code} /> : undefined} />;
  // Long inline code (URLs, paths) wraps instead of pushing the pane wider.
  const code = <code className="rounded bg-border/60 px-1 py-px font-mono text-[0.9em] [overflow-wrap:anywhere]">{children}</code>;
  // A file path (`src/a.ts:12`) becomes a link to open it in the editor, once the engine finds it.
  const fileRef = parseFileRef(String(children ?? ''));
  return fileRef ? (
    <FileLink fileRef={fileRef} fallback={code}>
      {code}
    </FileLink>
  ) : (
    code
  );
}

/** GitHub's alerts: a coloured bar and a title line, in the theme's tones. */
const ALERTS =
  '[&_blockquote[data-alert]]:rounded-r-md [&_blockquote[data-alert]]:border-l-4 [&_blockquote[data-alert]]:py-1 [&_blockquote[data-alert]]:pr-3 [&_blockquote[data-alert]]:text-text ' +
  '[&_[data-alert-title]]:font-semibold ' +
  '[&_blockquote[data-alert=note]]:border-link [&_blockquote[data-alert=note]]:bg-link/8 [&_blockquote[data-alert=note]_[data-alert-title]]:text-link ' +
  '[&_blockquote[data-alert=tip]]:border-ok [&_blockquote[data-alert=tip]]:bg-ok/8 [&_blockquote[data-alert=tip]_[data-alert-title]]:text-ok ' +
  '[&_blockquote[data-alert=important]]:border-caution [&_blockquote[data-alert=important]]:bg-caution/8 [&_blockquote[data-alert=important]_[data-alert-title]]:text-caution ' +
  '[&_blockquote[data-alert=warning]]:border-warn [&_blockquote[data-alert=warning]]:bg-warn/8 [&_blockquote[data-alert=warning]_[data-alert-title]]:text-warn ' +
  '[&_blockquote[data-alert=caution]]:border-error [&_blockquote[data-alert=caution]]:bg-error/8 [&_blockquote[data-alert=caution]_[data-alert-title]]:text-error';

/** What is the same in both sizes: task lists have no bullet (their box is the marker), and the raw HTML a reply may hold (`details`, `kbd`). */
const RICH =
  // A list of only tasks loses the room of its bullets; one with plain items keeps it and their bullets. A list inside a task has its indent.
  '[&_li.task-list-item]:list-none [&_:is(ul,ol).contains-task-list:not(:has(>li:not(.task-list-item)))]:pl-0 [&_li.task-list-item_:is(ul,ol)]:pl-5! ' +
  '[&_summary]:cursor-pointer [&_kbd]:rounded [&_kbd]:border [&_kbd]:border-edge [&_kbd]:bg-text/6 [&_kbd]:px-1 [&_kbd]:py-px [&_kbd]:font-mono [&_kbd]:text-[0.85em] ' +
  `[&_hr]:border-edge ${ALERTS}`;

/** The prose styles of an answer, also for another computer's (`components/computers/RemoteText.tsx`) and a previewed file's (`filePreview/FileMarkdown.tsx`). */
export const PROSE =
  'markdown text-body leading-relaxed select-text [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-title [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_:is(h4,h5,h6)]:mt-2 [&_:is(h4,h5,h6)]:font-semibold [&_h4]:text-[14px] [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-faint/60 [&_blockquote]:pl-3 [&_details]:my-1.5 [&_hr]:my-4 ' +
  RICH;

/**
 * The same renderer in reading mode (`components/readMode/`): sizes follow the reader's choice (the text size is set on
 * the column and everything here is relative to it), with room between paragraphs and headings in the app's font.
 */
export const READING_PROSE =
  'markdown leading-[1.75] select-text [&_:is(h1,h2,h3)]:scroll-mt-6 [&_:is(h1,h2,h3,h4,h5,h6)]:font-sans [&_:is(h1,h2,h3,h4,h5,h6)]:leading-snug [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_h1]:mt-10 [&_h1]:mb-4 [&_h1]:text-[1.6em] [&_h2]:mt-9 [&_h2]:mb-3 [&_h2]:text-[1.3em] [&_h3]:mt-7 [&_h3]:mb-2 [&_h3]:text-[1.1em] [&_h4]:text-[1.05em] [&_:is(h4,h5,h6)]:mt-6 [&_:is(h4,h5,h6)]:mb-2 [&_:is(h1,h2,h3,h4,h5,h6):first-child]:mt-0 [&_li]:my-1.5 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-faint/60 [&_blockquote]:pl-4 [&_details]:my-4 [&_hr]:my-8 [&_p_code]:text-[0.88em] [&_li_code]:text-[0.88em] ' +
  RICH;

/** `reading`: the roomier version for reading mode. */
export type MarkdownVariant = 'chat' | 'reading';

const proseOf = (variant: MarkdownVariant) => (variant === 'reading' ? READING_PROSE : PROSE);

/**
 * A Markdown block's preview. Its own Markdown blocks show as source: previews inside previews would parse the text
 * once more for each level, and a reply nesting thousands (```` ```md ```` in ```` ````md ````…) would freeze the window.
 */
const previewComponents: Components = { ...markdownComponents, code: (props) => renderCode(props, false) };

const PreviewBlock = memo(function PreviewBlock({ text }: { text: string }) {
  const source = useMemo(() => escapeLoneTags(text), [text]);
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} remarkRehypeOptions={REMARK_REHYPE_OPTIONS} urlTransform={fileUrlTransform} components={previewComponents}>
      {source}
    </ReactMarkdown>
  );
});


/** One block of Markdown. Its `text` has been through `escapeLoneTags` already, as a whole reply (not block by block: a tag and its end tag can be in different ones). */
const Block = memo(function Block({ text, keep = null }: { text: string; keep?: readonly number[] | null }) {
  const plugins = useMemo(() => (keep ? remarkPluginsFor(keep) : REMARK_PLUGINS), [keep]);
  return (
    <ReactMarkdown remarkPlugins={plugins} rehypePlugins={REHYPE_PLUGINS} remarkRehypeOptions={REMARK_REHYPE_OPTIONS} urlTransform={fileUrlTransform} components={markdownComponents}>
      {text}
    </ReactMarkdown>
  );
});

/** Assistant prose. Memoised: finished messages never change, so they render once. `keep`: the sentences Skim keeps; the rest fade. */
export const Markdown = memo(function Markdown({ text, variant = 'chat', keep = null }: { text: string; variant?: MarkdownVariant; keep?: readonly number[] | null }) {
  const source = useMemo(() => escapeLoneTags(text), [text]);
  return (
    <div className={proseOf(variant)}>
      <Block text={source} keep={keep} />
    </div>
  );
});

/**
 * Prose Claude is still writing, formatted as it arrives (like Streamdown): the text is
 * split into blocks so only the last one re-renders per delta, and that block has its
 * unclosed markers (`**bold`, `` `code ``, half a link) closed so they never show raw.
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({ text, variant = 'chat' }: { text: string; variant?: MarkdownVariant }) {
  // Skim's keep line, while it is written, never shows.
  // What is final of the text so far is escaped once and kept: only the last block changes as the text grows.
  const cache = useRef(newStreamingCache());
  const blocks = useMemo(() => streamingBlocks(withoutSkimMarks(text), cache.current), [text]);
  return (
    <div className={proseOf(variant)}>
      {blocks.map((block, i) => (
        // Blocks only ever grow at the end, so the index is a stable key.
        <Block key={i} text={block} />
      ))}
    </div>
  );
});
