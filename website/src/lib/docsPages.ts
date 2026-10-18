import { getCollection, type CollectionEntry } from 'astro:content';
import { sidebar } from '../sidebar.mjs';

/** A docs page as the cards on the homepage, All features and Related show it. */
export interface PageCard {
  slug: string;
  title: string;
  description: string;
  href: string;
  /** The page has `sidebar: { badge: New }`: the feature came out in one of the last few releases. */
  isNew: boolean;
}

/** One group of the sidebar, with its pages. */
export interface PageGroup {
  label: string;
  pages: PageCard[];
}

/** The pages built in src/pages, which aren't in the content collection. */
const GENERATED: Record<string, Omit<PageCard, 'href' | 'isNew'>> = {
  'keyboard-shortcuts': { slug: 'keyboard-shortcuts', title: 'Keyboard shortcuts', description: 'Every keyboard shortcut in Switchboard, grouped by where it works.' },
  changelog: { slug: 'changelog', title: 'Changelog', description: 'What changed in each Switchboard release.' },
};

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

let entries: Map<string, CollectionEntry<'docs'>> | undefined;
async function docs() {
  entries ??= new Map((await getCollection('docs')).map((entry) => [entry.id, entry]));
  return entries;
}

function badgeText(entry: CollectionEntry<'docs'>): string | undefined {
  const badge = entry.data.sidebar?.badge;
  return typeof badge === 'string' ? badge : badge?.text;
}

/** The card for a page slug (`sessions/ask`), or a build error when no page has it, so a link never dangles. */
export async function pageCard(slug: string): Promise<PageCard> {
  const clean = slug.replace(/^\/|\/$/g, '');
  const generated = GENERATED[clean];
  if (generated) return { ...generated, href: `${base}/${clean}/`, isNew: false };
  const entry = (await docs()).get(clean);
  if (!entry) throw new Error(`No docs page "${slug}" (src/content/docs/${clean}.mdx)`);
  return {
    slug: clean,
    title: entry.data.title,
    description: entry.data.description ?? '',
    href: `${base}/${clean}/`,
    isNew: badgeText(entry) === 'New',
  };
}

type SidebarItem = (typeof sidebar)[number];

/** A sidebar item's page slugs: a slug, a `{ link }` to a generated page, or a group's items. */
function slugsOf(item: SidebarItem | string | { link: string } | { slug: string } | { items: unknown[] }): string[] {
  if (typeof item === 'string') return [item];
  if ('link' in item) return [item.link.replace(/^\/|\/$/g, '')];
  if ('slug' in item) return [item.slug];
  if ('items' in item) return (item.items as SidebarItem[]).flatMap(slugsOf);
  return [];
}

/** The sidebar's groups with their pages, in the sidebar's order. Pages outside a group are left out. */
export async function pageGroups(): Promise<PageGroup[]> {
  const groups = sidebar.filter((item): item is Extract<SidebarItem, { items: unknown[] }> => typeof item === 'object' && 'items' in item);
  return Promise.all(groups.map(async (group) => ({ label: group.label, pages: await Promise.all(slugsOf(group).map(pageCard)) })));
}

/** Every page marked New, in the sidebar's order. */
export async function newPages(): Promise<PageCard[]> {
  return (await pageGroups()).flatMap((group) => group.pages).filter((page) => page.isNew);
}
