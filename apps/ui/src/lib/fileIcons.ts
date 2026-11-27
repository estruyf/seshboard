import type { FileIconAssociations, FileIconTheme } from '@seshboard/protocol/client';

type MapKey = 'fileExtensions' | 'fileNames' | 'folderNames' | 'folderNamesExpanded' | 'languageIds';

/**
 * The names to look up for a path, longest first: `a/.github/workflows` gives `a/.github/workflows`,
 * `.github/workflows` and `workflows`, so a theme's entry with a parent folder wins over the bare name.
 */
function suffixes(path: string): string[] {
  const parts = path.toLowerCase().split('/').filter(Boolean);
  return parts.map((_, i) => parts.slice(i).join('/'));
}

/** A name's extensions, longest first: `app.test.ts` gives `test.ts` and `ts`, `.gitignore` gives `gitignore`. */
export function extensionsOf(name: string): string[] {
  const lower = name.toLowerCase();
  const out: string[] = [];
  for (let i = lower.indexOf('.'); i >= 0 && i < lower.length - 1; i = lower.indexOf('.', i + 1)) out.push(lower.slice(i + 1));
  return out;
}

/**
 * Which icon of the theme a file or folder gets, as VS Code picks it: the file's name (with its folders when the
 * theme names them), then its extensions, longest first, then its language, then the theme's file icon. A folder
 * by its name, open or closed. In light mode, the theme's `light` entries come first. Null when the theme has none.
 */
export function fileIconId(theme: FileIconTheme, path: string, options: { dir: boolean; open?: boolean; light?: boolean }): string | null {
  const layers: FileIconAssociations[] = options.light && theme.light ? [theme.light, theme.base] : [theme.base];
  const find = (key: MapKey, names: readonly string[]) => {
    for (const name of names) for (const layer of layers) {
      const id = layer[key]?.[name];
      if (id) return id;
    }
    return null;
  };
  const single = (key: 'file' | 'folder' | 'folderExpanded') => layers.map((l) => l[key]).find(Boolean) ?? null;
  const names = suffixes(path);

  if (options.dir) {
    if (options.open) return find('folderNamesExpanded', names) ?? find('folderNames', names) ?? single('folderExpanded') ?? single('folder');
    return find('folderNames', names) ?? single('folder');
  }
  const name = names[names.length - 1] ?? '';
  const extensions = extensionsOf(name);
  const byName = find('fileNames', names);
  if (byName) return byName;
  const byExtension = find('fileExtensions', extensions);
  if (byExtension) return byExtension;
  const language = theme.languages.fileNames[name] ?? extensions.map((e) => theme.languages.extensions[e]).find(Boolean);
  return (language ? find('languageIds', [language]) : null) ?? single('file');
}
