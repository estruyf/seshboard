import { readFile, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { MAX_PREVIEW_IMAGE_BYTES, type ChangesBase, type DiffImage } from '@seshboard/protocol';
import { sniffImage } from '../system/filePreview.ts';
import { baseBranch, git, gitBytes, hasHead, insideRepo, mergeBase, topLevel } from './gitChanges.ts';

/**
 * An image file's two sides in a diff, for the mode the list was made in: `before` from git (HEAD, or where the branch
 * left its base; by its old name after a rename), `after` from the working tree. A side is null when the file isn't
 * there (added, deleted); its `data` is null when it is over `maxBytes` or isn't a PNG, JPEG, GIF, WebP or SVG image.
 */
export async function diffImages(cwd: string, base: ChangesBase, path: string, maxBytes = MAX_PREVIEW_IMAGE_BYTES): Promise<{ before: DiffImage | null; after: DiffImage | null }> {
  const root = await topLevel(cwd);
  const rel = insideRepo(root, path);
  const from = base === 'branch' ? await baseBranch(root).then((name) => (name ? mergeBase(root, name) : null)) : (await hasHead(root)) ? 'HEAD' : null;
  const [before, after] = await Promise.all([from ? committed(root, from, await oldPath(root, from, rel), maxBytes) : null, onDisk(join(root, rel), maxBytes)]);
  return { before, after };
}

/** The path `rel` had at `from`: its old name when git sees it as renamed since. */
async function oldPath(root: string, from: string, rel: string): Promise<string> {
  const wanted = rel.split(sep).join('/');
  const parts = (await git(root, ['diff', '--no-ext-diff', '--name-status', '-z', '-M', from])).split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]!;
    if (!code.startsWith('R')) {
      i++;
      continue;
    }
    if (parts[i + 2] === wanted) return parts[i + 1]!;
    i += 2;
  }
  return wanted;
}

/** The file as `from` has it, or null when it has none there. */
async function committed(root: string, from: string, path: string, maxBytes: number): Promise<DiffImage | null> {
  const spec = `${from}:${path}`;
  const size = Number((await git(root, ['cat-file', '-s', spec], { allowExitCodes: [128] })).trim());
  if (!Number.isFinite(size) || size <= 0) return null;
  if (size > maxBytes) return { size, mediaType: null, data: null };
  return image(await gitBytes(root, ['cat-file', 'blob', spec]));
}

/** The file in the working tree, or null when it is gone. */
async function onDisk(path: string, maxBytes: number): Promise<DiffImage | null> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  if (info.size > maxBytes) return { size: info.size, mediaType: null, data: null };
  return image(await readFile(path));
}

function image(bytes: Buffer): DiffImage {
  const mediaType = sniffImage(bytes);
  return { size: bytes.length, mediaType, data: mediaType ? bytes.toString('base64') : null };
}
