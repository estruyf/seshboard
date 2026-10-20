// @ts-check
import { satteri } from '@astrojs/markdown-satteri';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import { withBase } from './src/plugins/withBase.mjs';
import { sidebar } from './src/sidebar.mjs';

/*
 * The site lives at the root of its own domain on GitHub Pages (the domain is in public/CNAME). Pages link to each
 * other as `/sessions/sidebar/`, and `withBase` puts the base in front at build time, so moving the site under a
 * path only needs `site` and `base` changed here.
 */
const production = 'https://switchboard.struyfconsulting.com';
/** Cloudflare Pages builds the preview of `dev` and of pull requests (switch-dev.struyfconsulting.com) and sets CF_PAGES. */
const preview = Boolean(process.env.CF_PAGES);
const site = preview ? (process.env.CF_PAGES_URL ?? production) : production;
const base = '/';
const prefix = base.replace(/\/$/, '');
/** Pages built from the app's code (src/pages), which the links validator can't see into. */
const generatedPages = new RegExp(`^${prefix}/(keyboard-shortcuts|changelog)/(#.*)?$`);

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  markdown: {
    // Runs before the links validator (which the plugin adds after these), so it checks the links as they ship.
    processor: satteri({ hastPlugins: [withBase(base)] }),
  },
  integrations: [
    starlight({
      title: 'Switchboard',
      description: 'A fast app for Mac and Windows for running and keeping track of your Claude Code sessions.',
      logo: { src: './src/assets/logo.svg', alt: 'Switchboard' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/estruyf/switchboard' }],
      customCss: ['./src/styles/switchboard.css'],
      head: [
        // A preview must not compete with the real site in search results.
        ...(preview ? [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } }] : []),
        { tag: 'meta', attrs: { property: 'og:image', content: `${site}${prefix}/og.png` } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: `${site}${prefix}/og.png` } },
      ],
      components: {
        ThemeProvider: './src/components/overrides/ThemeProvider.astro',
        ThemeSelect: './src/components/overrides/ThemeSelect.astro',
        Hero: './src/components/overrides/Hero.astro',
        Footer: './src/components/overrides/Footer.astro',
      },
      editLink: { baseUrl: 'https://github.com/estruyf/switchboard/edit/main/website/' },
      credits: false,
      sidebar,
      plugins: [starlightLinksValidator({ exclude: ({ link }) => generatedPages.test(link) })],
    }),
  ],
});
