// @ts-check
import { defineHastPlugin } from 'satteri';

/**
 * Puts the site's base in front of links to other pages (with a base of `/docs`, `/sessions/sidebar/` becomes
 * `/docs/sessions/sidebar/`), so the docs never write the base themselves.
 * Links that already start with it, links to other sites and `#hash` links are left alone.
 * @param {string} base
 */
export function withBase(base) {
  const prefix = base.replace(/\/$/, '');
  return defineHastPlugin({
    name: 'switchboard-with-base',
    element: {
      filter: ['a'],
      visit(node, ctx) {
        const href = node.properties?.href;
        if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return;
        if (!prefix || href === prefix || href.startsWith(`${prefix}/`)) return;
        ctx.setProperty(node, 'href', `${prefix}${href}`);
      },
    },
  });
}
