import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative } from 'node:path';
import type { ProjectIcon } from '@seshboard/protocol';

/** Icons travel to the renderer as data URLs, so keep them small. */
export const MAX_ICON_BYTES = 200_000;

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Conventional icon locations inside one package, best first (vector before bitmap, app icons before favicons). */
const PACKAGE_CANDIDATES = [
  'public/favicon.svg',
  'public/icon.svg',
  'public/logo.svg',
  'src/app/icon.svg',
  'app/icon.svg',
  'static/favicon.svg',
  'favicon.svg',
  'icon.svg',
  'logo.svg',
  'assets/icon.svg',
  'assets/logo.svg',
  '.github/logo.svg',
  'public/favicon.png',
  'public/apple-touch-icon.png',
  'public/icon.png',
  'public/logo.png',
  'src/app/icon.png',
  'app/icon.png',
  'static/favicon.png',
  'icon.png',
  'logo.png',
  'assets/icon.png',
  'assets/logo.png',
  '.github/logo.png',
  'build/icon.png',
  'resources/icon.png',
  'public/favicon.ico',
  'src/app/favicon.ico',
  'app/favicon.ico',
  'static/favicon.ico',
  'favicon.ico',
];

const WORKSPACE_DIRS = ['apps', 'packages'];

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function usable(path: string): boolean {
  const stat = statSync(path, { throwIfNoEntry: false });
  return !!stat?.isFile() && stat.size > 0 && stat.size <= MAX_ICON_BYTES && extname(path).toLowerCase() in MIME;
}

/**
 * Whether `path` is inside `root`, also after following symbolic links. A repository's settings file picks
 * the icon path, and its contents are sent to the window, so it must not reach files elsewhere on the disk.
 */
function within(root: string, path: string): boolean {
  const inside = (base: string, target: string) => {
    const rel = relative(base, target);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };
  if (!inside(root, path)) return false;
  try {
    return inside(realpathSync(root), realpathSync(path));
  } catch {
    return false;
  }
}

/**
 * An icon declared by the package itself: package.json `icon` (VS Code extensions) or `iconPath` in t3.json / .seshboard.json (or .switchboard.json, its name before the rename).
 * It must be inside `root`, the project folder (a workspace package may point at the monorepo's shared icon).
 */
function declaredIcon(dir: string, root: string): string | null {
  for (const [file, key] of [
    ['.seshboard.json', 'iconPath'],
    ['.switchboard.json', 'iconPath'],
    ['t3.json', 'iconPath'],
    ['package.json', 'icon'],
  ] as const) {
    const value = readJson(join(dir, file))?.[key];
    if (typeof value === 'string' && value && !value.startsWith('http')) {
      const path = join(dir, value);
      if (within(root, path) && usable(path)) return path;
    }
  }
  return null;
}

function conventionalIcon(dir: string, root: string): string | null {
  return PACKAGE_CANDIDATES.map((c) => join(dir, c)).find((path) => usable(path) && within(root, path)) ?? null;
}

/**
 * Finds a project's icon: declared at the root, then by convention at the
 * root, then the same in workspace packages (apps/*, packages/*) for monorepos.
 */
export function detectIconPath(root: string): string | null {
  const atRoot = declaredIcon(root, root) ?? conventionalIcon(root, root);
  if (atRoot) return atRoot;
  for (const workspace of WORKSPACE_DIRS) {
    let names: string[];
    try {
      names = readdirSync(join(root, workspace)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = join(root, workspace, name);
      const found = declaredIcon(dir, root) ?? conventionalIcon(dir, root);
      if (found) return found;
    }
  }
  return null;
}

export function iconDataUrl(path: string): ProjectIcon | null {
  if (!usable(path)) return null;
  const mime = MIME[extname(path).toLowerCase()]!;
  return { kind: 'image', dataUrl: `data:${mime};base64,${readFileSync(path).toString('base64')}` };
}
