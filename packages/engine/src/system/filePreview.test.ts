import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { MAX_PREVIEW_BYTES, RpcError } from '@seshboard/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { imgTags, inlineHtmlImages, localImagePath, readPreview, readPreviewImage, sniffImage, withPreviewCsp } from './filePreview.ts';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-preview-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A valid 1x1 PNG, and the first bytes of the other kinds. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof RpcError ? error.code : 'other';
  }
  return null;
};

describe('withPreviewCsp', () => {
  const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`;

  it('goes at the very top, after a doctype that starts the page', () => {
    expect(withPreviewCsp('<!doctype html><html><head lang="x"><title>t</title></head><body></body></html>')).toBe(`<!doctype html>${CSP}<html><head lang="x"><title>t</title></head><body></body></html>`);
    expect(withPreviewCsp('<!DOCTYPE html>\n<p>hi</p>')).toBe(`<!DOCTYPE html>${CSP}\n<p>hi</p>`);
    expect(withPreviewCsp('<p>hi</p>')).toBe(`${CSP}<p>hi</p>`);
  });

  it('is never put where it would not count: after a <head> in a comment, a script or a title', () => {
    for (const page of ['<!-- <head> --><head></head>', '<script>"<head>"</script>', '<title><head></title>']) expect(withPreviewCsp(page).startsWith(CSP)).toBe(true);
  });

  it('takes no time on a large page of unclosed tags', () => {
    const started = Date.now();
    withPreviewCsp('<head '.repeat(400_000));
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('imgTags', () => {
  it('finds <img> tags in any case, not <image> or <img2>, up to their first >', () => {
    expect(imgTags('<p><IMG src=a.png><image src=b><img2><img\nsrc="c">').map((t) => [t.index, t.text])).toEqual([
      [3, '<IMG src=a.png>'],
      [37, '<img\nsrc="c">'],
    ]);
  });

  it('stops at an <img without >, quickly however many there are', () => {
    expect(imgTags('<img src=a.png><img src=b')).toHaveLength(1);
    const started = Date.now();
    expect(imgTags('<img '.repeat(400_000))).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('sniffImage', () => {
  it('knows the five kinds by their bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(GIF)).toBe('image/gif');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(SVG)).toBe('image/svg+xml');
    expect(sniffImage(Buffer.from('  <svg></svg>'))).toBe('image/svg+xml');
  });

  it('refuses text, other documents and empty files', () => {
    expect(sniffImage(Buffer.from('hello'))).toBeNull();
    expect(sniffImage(Buffer.from('<html><svg></svg></html>'))).toBeNull();
    expect(sniffImage(Buffer.from('<?xml version="1.0"?><note/>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('readPreview', () => {
  it('reads Markdown as it is, without a byte order mark', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'a.md'), '﻿# Title\n');
    const result = await readPreview(join(dir, 'a.md'));
    expect(result).toMatchObject({ kind: 'markdown', size: 11, content: '# Title\n' });
    expect(result.modified).toBeGreaterThan(0);
  });

  it('adds the policy to HTML, with or without a head', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'a.html'), '<html><head><title>t</title></head><body>x</body></html>');
    writeFileSync(join(dir, 'b.HTM'), '<p>plain</p>');
    const a = await readPreview(join(dir, 'a.html'));
    expect(a.kind).toBe('html');
    expect(a.content).toMatch(/^<meta http-equiv="Content-Security-Policy" content="default-src 'none'.*><html><head><title>/);
    expect((await readPreview(join(dir, 'b.HTM'))).content).toMatch(/^<meta http-equiv="Content-Security-Policy".*<p>plain<\/p>$/);
  });

  it('inlines the images next to an HTML file', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'logo.png'), PNG);
    writeFileSync(join(dir, 'a.html'), '<img src="logo.png" alt="x">');
    const { content } = await readPreview(join(dir, 'a.html'));
    expect(content).toContain(`<img src="data:image/png;base64,${PNG.toString('base64')}" alt="x">`);
  });

  it('reports a file over the cap with its size and no content', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'big.md'), Buffer.alloc(MAX_PREVIEW_BYTES + 1, 'a'));
    writeFileSync(join(dir, 'edge.md'), Buffer.alloc(MAX_PREVIEW_BYTES, 'a'));
    expect(await readPreview(join(dir, 'big.md'))).toMatchObject({ kind: 'markdown', size: MAX_PREVIEW_BYTES + 1, content: null });
    expect((await readPreview(join(dir, 'edge.md'))).content).toHaveLength(MAX_PREVIEW_BYTES);
  });

  it('refuses a missing file, a folder and other extensions', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'folder.md'));
    writeFileSync(join(dir, 'a.png'), 'x');
    expect(await code(readPreview(join(dir, 'missing.md')))).toBe('NOT_FOUND');
    expect(await code(readPreview(join(dir, 'folder.md')))).toBe('UNSUPPORTED');
    expect(await code(readPreview(join(dir, 'a.png')))).toBe('UNSUPPORTED');
  });
});

describe('readPreview of code', () => {
  it('returns the text of a code file as it is', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    const file = await readPreview(join(dir, 'a.ts'));
    expect(file.kind).toBe('code');
    expect(file.content).toBe('export const a = 1;\n');
  });
});

describe('readPreviewImage', () => {
  it('returns base64 and the type from the bytes', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'a.png'), PNG);
    writeFileSync(join(dir, 'noext'), JPEG);
    writeFileSync(join(dir, 'v.svg'), SVG);
    expect(await readPreviewImage(join(dir, 'a.png'))).toEqual({ mediaType: 'image/png', data: PNG.toString('base64') });
    expect((await readPreviewImage(join(dir, 'noext'))).mediaType).toBe('image/jpeg');
    expect((await readPreviewImage(join(dir, 'v.svg'))).mediaType).toBe('image/svg+xml');
  });

  it('refuses a text file called .png, a folder and a missing file', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'fake.png'), 'not an image');
    mkdirSync(join(dir, 'dir.png'));
    expect(await code(readPreviewImage(join(dir, 'fake.png')))).toBe('UNSUPPORTED');
    expect(await code(readPreviewImage(join(dir, 'dir.png')))).toBe('UNSUPPORTED');
    expect(await code(readPreviewImage(join(dir, 'gone.png')))).toBe('NOT_FOUND');
  });

  it('refuses an image over 10 MB', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'big.png'), Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]));
    expect(await code(readPreviewImage(join(dir, 'big.png')))).toBe('TOO_LARGE');
  });
});

describe('inlineHtmlImages', () => {
  it('reads relative, parent, absolute and file: paths, and keeps the rest of the tag', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'pages'));
    mkdirSync(join(dir, 'img'));
    writeFileSync(join(dir, 'img', 'a b.png'), PNG);
    writeFileSync(join(dir, 'abs.gif'), GIF);
    const html = [
      `<img class="x" src='../img/a%20b.png?v=1' width=2>`,
      `<IMG src=${JSON.stringify(join(dir, 'abs.gif'))}>`,
      `<img src="file://${join(dir, 'abs.gif')}">`,
    ].join('\n');
    const out = await inlineHtmlImages(html, join(dir, 'pages'));
    expect(out).toContain(`<img class="x" src="data:image/png;base64,${PNG.toString('base64')}" width=2>`);
    expect(out.match(/data:image\/gif;base64,/g)).toHaveLength(2);
  });

  it('leaves remote, data, missing and fake images alone', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'fake.png'), 'text');
    const html = '<img src="https://x.test/a.png"><img src="data:image/png;base64,AA"><img src="//x.test/a.png"><img src="nope.png"><img src="fake.png"><img alt="no src">';
    expect(await inlineHtmlImages(html, dir)).toBe(html);
  });

  it('stops inlining at the page total', async () => {
    const dir = temp();
    // Four 9 MB images: the first two fit in 25 MB, the others do not.
    const big = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]);
    for (const n of [1, 2, 3, 4]) writeFileSync(join(dir, `${n}.png`), Buffer.concat([big, Buffer.from([n])]));
    const out = await inlineHtmlImages('<img src="1.png"><img src="2.png"><img src="3.png"><img src="4.png">', dir);
    expect(out.match(/src="data:/g)).toHaveLength(2);
    expect(out).toContain('<img src="3.png"><img src="4.png">');
  });

  it('reads only images on this computer, never from a network share', () => {
    const dir = temp();
    expect(localImagePath('a.png', dir)).toBe(join(dir, 'a.png'));
    // On Windows, looking at a network path sends the user's login to that server.
    for (const src of ['\\\\attacker\\share\\a.png', 'file://attacker/share/a.png', '//attacker/share/a.png']) expect(localImagePath(src, 'C:\\pages', 'win32')).toBeNull();
    expect(localImagePath('C:\\pages\\a.png', 'C:\\pages', 'win32')).toBe(sep === '\\' ? 'C:\\pages\\a.png' : null);
  });

  it('counts every use of an image against the page total, not only the first', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'big.png'), Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]));
    const out = await inlineHtmlImages('<img src="big.png">'.repeat(5), dir);
    expect(out.match(/src="data:/g)).toHaveLength(2);
  });

  it('skips an image over 10 MB', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'huge.png'), Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]));
    expect(await inlineHtmlImages('<img src="huge.png">', dir)).toBe('<img src="huge.png">');
  });
});
