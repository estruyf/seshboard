import { dirname } from 'node:path';
import { bodyTokens, splitFrontmatter } from '@seshboard/protocol';

/** A memory as links see it: where it is, its name and its text. */
export interface LinkedMemory {
  path: string;
  name: string;
  body: string;
}

/** The `[[name]]` links in a body, in order, each name once (links inside code and escaped ones don't count). */
export function linkNames(body: string): string[] {
  const names: string[] = [];
  for (const token of bodyTokens(body)) if ('link' in token && !names.includes(token.link)) names.push(token.link);
  return names;
}

export interface LinkMap {
  [path: string]: { links: Array<{ name: string; target: string | null }>; backlinks: string[] };
}

/**
 * Every memory's links, resolved, and the memories that link to it. A name resolves in the memory's own folder
 * first, then in the personal folder; one that resolves nowhere isn't written yet (`target` null).
 */
export function resolveLinks(memories: readonly LinkedMemory[], personalDir: string | null): LinkMap {
  const byFolder = new Map<string, Map<string, string>>();
  for (const m of memories) {
    const dir = dirname(m.path);
    let names = byFolder.get(dir);
    if (!names) byFolder.set(dir, (names = new Map()));
    // The first one wins when two files in a folder claim one name.
    if (!names.has(m.name)) names.set(m.name, m.path);
  }
  const map: LinkMap = {};
  for (const m of memories) map[m.path] = { links: [], backlinks: [] };
  for (const m of memories) {
    for (const name of linkNames(m.body)) {
      const target = byFolder.get(dirname(m.path))?.get(name) ?? (personalDir ? byFolder.get(personalDir)?.get(name) : undefined) ?? null;
      map[m.path]!.links.push({ name, target });
      if (target && target !== m.path && !map[target]!.backlinks.includes(m.path)) map[target]!.backlinks.push(m.path);
    }
  }
  return map;
}

/**
 * A memory file with its `[[from]]` links pointing at `to` instead: only in the body (never the frontmatter), only real
 * links (not in code, not escaped). A label stays (`[[from|the label]]` → `[[to|the label]]`). Everything else is kept
 * byte for byte.
 */
export function rewriteLinks(text: string, from: string, to: string): string {
  const { raw } = splitFrontmatter(text);
  const head = text.slice(0, raw.length);
  const body = text.slice(raw.length);
  return (
    head +
    bodyTokens(body)
      .map((token) => {
        if (!('link' in token)) return token.text;
        if (token.link !== from) return token.raw;
        return token.label !== token.link ? `[[${to}|${token.label}]]` : `[[${to}]]`;
      })
      .join('')
  );
}
