import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CELL_STYLE, CODE_STYLE, PRE_STYLE, TABLE_STYLE, isWebLink } from './clipboardHtml.ts';

/**
 * What the reply looks like on the clipboard: plain HTML with no classes, buttons or theme colours, so the app it
 * is pasted into styles it as its own text. Inline styles only where the target would lose something without them:
 * code keeps a monospace font, and tables keep their borders. A selection copied from the transcript gets the same
 * rules from `cleanSelectionHtml` (`clipboardHtml.ts`).
 */
const components: Components = {
  a: ({ href, children }) => (isWebLink(href) ? <a href={href}>{children}</a> : <>{children}</>),
  pre: ({ children }) => <pre style={PRE_STYLE}>{children}</pre>,
  code: ({ children }) => <code style={CODE_STYLE}>{children}</code>,
  table: ({ children }) => <table style={TABLE_STYLE}>{children}</table>,
  th: ({ children }) => <th style={CELL_STYLE}>{children}</th>,
  td: ({ children }) => <td style={CELL_STYLE}>{children}</td>,
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
