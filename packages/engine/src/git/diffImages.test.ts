import { mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffImages } from './diffImages.ts';
import { git } from './gitChanges.ts';

/** A PNG's signature and some bytes after it, which `sniffImage` takes for a PNG. */
const png = (fill: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, fill)]);

let repo: string;
const run = (...args: string[]) => git(repo, args);

beforeEach(async () => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-images-')));
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.email', 'test@example.com');
  await run('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'logo.png'), png(1));
  await run('add', '.');
  await run('commit', '-qm', 'initial');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('diffImages', () => {
  it('reads the committed image and the one on disk, byte for byte', async () => {
    writeFileSync(join(repo, 'logo.png'), png(2));
    const { before, after } = await diffImages(repo, 'uncommitted', 'logo.png');
    expect(before?.mediaType).toBe('image/png');
    expect(Buffer.from(before!.data!, 'base64')).toEqual(png(1));
    expect(Buffer.from(after!.data!, 'base64')).toEqual(png(2));
  });

  it('has no before for a new image and no after for a deleted one', async () => {
    writeFileSync(join(repo, 'new.png'), png(3));
    expect((await diffImages(repo, 'uncommitted', 'new.png')).before).toBeNull();
    unlinkSync(join(repo, 'logo.png'));
    const deleted = await diffImages(repo, 'uncommitted', 'logo.png');
    expect(deleted.after).toBeNull();
    expect(deleted.before?.data).not.toBeNull();
  });

  it('reads a renamed image by its old name', async () => {
    await run('mv', 'logo.png', 'brand.png');
    const { before } = await diffImages(repo, 'uncommitted', 'brand.png');
    expect(Buffer.from(before!.data!, 'base64')).toEqual(png(1));
  });

  it('gives the size without data over the limit or for a file that is no image', async () => {
    writeFileSync(join(repo, 'logo.png'), 'not an image');
    const { before, after } = await diffImages(repo, 'uncommitted', 'logo.png', 20);
    expect(before).toEqual({ size: 40, mediaType: null, data: null });
    expect(after).toEqual({ size: 12, mediaType: null, data: null });
  });

  it('refuses a path outside the repository', async () => {
    await expect(diffImages(repo, 'uncommitted', '../x.png')).rejects.toThrow();
  });
});
