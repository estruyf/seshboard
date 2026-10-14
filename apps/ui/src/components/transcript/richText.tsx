import type { CSSProperties } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const CELL: CSSProperties = { border: '1px solid #d0d7de', padding: '4px 8px', textAlign: 'left', verticalAlign: 'top' };

/** Links that still lead somewhere once pasted elsewhere; a link to a file in the project doesn't. */
const isWebLink = (href: string | undefined) => !!href && /^(https?:|mailto:)/i.test(href);

/**
 * What the reply looks like on the clipboard: plain HTML with no classes, buttons or theme colours, so the app it
 * is pasted into styles it as its own text. Inline styles only where the target would lose something without them:
 * code keeps a monospace font, and tables keep their borders.
 */
const components: Components = {
  a: ({ href, children }) => (isWebLink(href) ? <a href={href}>{children}</a> : <>{children}</>),
  pre: ({ children }) => <pre style={{ fontFamily: MONO, whiteSpace: 'pre-wrap' }}>{children}</pre>,
  code: ({ children }) => <code style={{ fontFamily: MONO }}>{children}</code>,
  table: ({ children }) => <table style={{ borderCollapse: 'collapse' }}>{children}</table>,
  th: ({ children }) => <th style={CELL}>{children}</th>,
  td: ({ children }) => <td style={CELL}>{children}</td>,
};

/**
 * A Claude reply as HTML for Copy as rich text, parsed the way the transcript parses it (react-markdown with GFM),
 * so headings, lists, emphasis, links, code blocks and tables paste as they show.
 */
export function replyHtml(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>,
  );
}
