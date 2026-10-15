import { memo, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { parseMarkdown, type Block, type Inline } from '../lib/markdown.ts';
import { healMarkdown, splitBlocks } from '../lib/streamingMarkdown.ts';
import { toast } from './Toasts.tsx';

const PROSE = 'markdown flex min-w-0 flex-col gap-2 text-body break-words';

/**
 * Claude's text with its markdown: headings, emphasis, lists, links, code and tables, drawn as React elements from
 * `parseMarkdown`, so nothing in a transcript ever becomes HTML. No syntax highlighting, to keep the app small.
 */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`${PROSE} ${className}`}>
      <Blocks text={text} />
    </div>
  );
}

/**
 * Text Claude is still writing, formatted as it arrives, as on the computer: split into top-level blocks so only the
 * last one is parsed again per delta, and that one has its unclosed markers (`**bold`, `` `code ``, half a link)
 * closed so they never show raw.
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({ text }: { text: string }) {
  const parts = useMemo(() => splitBlocks(text), [text]);
  return (
    <div className={PROSE}>
      {parts.map((part, i) => (
        // Blocks only ever grow at the end, so the index is a stable key.
        <Blocks key={i} text={i === parts.length - 1 ? healMarkdown(part) : part} />
      ))}
    </div>
  );
});

const Blocks = memo(function Blocks({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return blocks.map((block, i) => <BlockView key={i} block={block} />);
});

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const size = block.depth <= 2 ? 'text-title' : 'text-body';
      return <p role="heading" aria-level={Math.min(block.depth + 2, 6)} className={`${size} pt-1 font-semibold`}>{inlines(block.children)}</p>;
    }
    case 'paragraph':
      return <p>{inlines(block.children)}</p>;
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-0.5">
          <div className="flex flex-col gap-1">{item.map((b, j) => <BlockView key={j} block={b} />)}</div>
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start} className="flex list-decimal flex-col gap-1 pl-6 marker:text-faint">
          {items}
        </ol>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-faint">{items}</ul>
      );
    }
    case 'code':
      return <CodeBlock text={block.text} lang={block.lang} />;
    case 'table':
      return (
        <div className="overflow-x-auto overscroll-x-contain rounded-lg border border-border">
          <table className="w-max min-w-full border-collapse text-ui">
            <thead className="bg-code">
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} style={{ textAlign: block.align[i] ?? 'left' }} className="border-b border-border px-2.5 py-1.5 font-semibold">
                    {inlines(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-border first:border-t-0">
                  {row.map((cell, i) => (
                    <td key={i} style={{ textAlign: block.align[i] ?? 'left' }} className="px-2.5 py-1.5 align-top">
                      {inlines(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'quote':
      return <blockquote className="flex flex-col gap-2 border-l-2 border-edge pl-3 text-muted">{block.children.map((b, i) => <BlockView key={i} block={b} />)}</blockquote>;
    case 'rule':
      return <hr className="border-border" />;
  }
}

function inlines(nodes: Inline[]) {
  return nodes.map((node, i) => <InlineView key={i} node={node} />);
}

function InlineView({ node }: { node: Inline }) {
  switch (node.type) {
    case 'text':
      return <>{node.text}</>;
    case 'strong':
      return <strong className="font-semibold">{inlines(node.children)}</strong>;
    case 'em':
      return <em>{inlines(node.children)}</em>;
    case 'del':
      return <del className="text-muted">{inlines(node.children)}</del>;
    case 'code':
      return <code className="rounded bg-code px-1 py-px font-mono text-[0.88em] break-all">{node.text}</code>;
    case 'br':
      return <br />;
    case 'link':
      return node.href ? (
        <a href={node.href} target="_blank" rel="noopener noreferrer" className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link">
          {inlines(node.children)}
        </a>
      ) : (
        <>{inlines(node.children)}</>
      );
  }
}

/** A code block: monospace, scrolling sideways inside itself, with Copy. */
export function CodeBlock({ text, lang }: { text: string; lang: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast("Couldn't copy", { tone: 'error' });
    }
  };
  return (
    <div className="group relative rounded-lg bg-code">
      <div className="flex items-center justify-between gap-2 px-2.5 pt-1">
        <span className="font-mono text-meta text-faint">{lang ?? ''}</span>
        <button type="button" onClick={() => void copy()} aria-label={copied ? 'Copied' : 'Copy code'} className="-mr-1 flex min-h-8 items-center gap-1 rounded-md px-1.5 text-meta text-muted hover:bg-border/50 hover:text-text pointer-fine:min-h-6" data-remote-copy>
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto overscroll-x-contain px-2.5 pb-2.5 font-mono text-meta leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}
