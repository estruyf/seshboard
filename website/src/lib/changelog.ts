import GithubSlugger from 'github-slugger';
import { defineHastPlugin, markdownToHtml } from 'satteri';

/** A heading for the page's table of contents. */
export interface Heading {
  depth: number;
  slug: string;
  text: string;
}

const REPO = 'https://github.com/estruyf/switchboard/blob/main/';

/**
 * The repository's CHANGELOG.md as HTML for the Changelog page, rendered at build time so the page always
 * matches the file. The title line goes (the page has its own), links into the repository point at
 * GitHub, and every heading gets an id for the table of contents.
 */
export function renderChangelog(source: string): { html: string; headings: Heading[] } {
  const markdown = source
    .replace(/^# .*\n/, '')
    // Links to files in the repository (docs/deep-links.md) only work on GitHub.
    .replace(/\]\((?!https?:|#|mailto:)([^)]+)\)/g, (_, target: string) => `](${REPO}${target})`);
  const headings: Heading[] = [];
  const slugger = new GithubSlugger();
  const ids = defineHastPlugin({
    name: 'changelog-heading-ids',
    element: {
      filter: ['h2', 'h3'],
      visit(node, ctx) {
        const text = ctx.textContent(node).trim();
        const slug = slugger.slug(text);
        ctx.setProperty(node, 'id', slug);
        headings.push({ depth: Number(node.tagName.slice(1)), slug, text });
      },
    },
  });
  const { html } = markdownToHtml(markdown, { hastPlugins: [ids] });
  return { html, headings };
}
