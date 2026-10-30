import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, downscale, encodePng, shrinkPng } from './pngShrink.ts';

/** A PNG chunk with its length and checksum. */
function chunk(name: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(name, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A PNG from already filtered scanlines (each starting with its filter byte), plus any extra chunks before IDAT. */
function png(width: number, height: number, depth: number, type: number, rows: number[][], extra: Buffer[] = [], interlace = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = type;
  header[12] = interlace;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', header), ...extra, chunk('IDAT', deflateSync(Buffer.from(rows.flat()))), chunk('IEND', Buffer.alloc(0))]);
}

const pixel = (data: Uint8Array, width: number, x: number, y: number) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

describe('decodePng', () => {
  it('reads RGB with each filter type', () => {
    // Two pixels a row: (10,20,30) then (40,50,60) on the first row, (11,22,33) then (44,55,66) on the rest.
    const rows = [
      [1, 10, 20, 30, 30, 30, 30], // Sub: the second pixel adds the first.
      [2, 1, 2, 3, 4, 5, 6], // Up: adds the row above.
      [0, 11, 22, 33, 44, 55, 66], // None.
      [3, 11 - 5, 22 - 11, 33 - 16, 44 - 27, 55 - 38, 66 - 49], // Average of left and up.
      [4, 0, 0, 0, 0, 0, 0], // Paeth: up is nearest for both pixels here.
    ];
    const image = decodePng(png(2, 5, 8, 2, rows))!;
    expect(image).toMatchObject({ width: 2, height: 5 });
    expect(pixel(image.data, 2, 1, 0)).toEqual([40, 50, 60, 255]);
    expect(pixel(image.data, 2, 0, 1)).toEqual([11, 22, 33, 255]);
    expect(pixel(image.data, 2, 1, 1)).toEqual([44, 55, 66, 255]);
    expect(pixel(image.data, 2, 1, 3)).toEqual([44, 55, 66, 255]);
    expect(pixel(image.data, 2, 0, 4)).toEqual([11, 22, 33, 255]);
    expect(pixel(image.data, 2, 1, 4)).toEqual([44, 55, 66, 255]);
  });

  it('reads palettes with transparency, low bit depths and 16-bit grey', () => {
    const palette = chunk('PLTE', Buffer.from([255, 0, 0, 0, 0, 255]));
    const alpha = chunk('tRNS', Buffer.from([128]));
    // Two-bit indices: 0, 1, 1, 0.
    const indexed = decodePng(png(4, 1, 2, 3, [[0, 0b00010100]], [palette, alpha]))!;
    expect([0, 1, 2, 3].map((x) => pixel(indexed.data, 4, x, 0))).toEqual([[255, 0, 0, 128], [0, 0, 255, 255], [0, 0, 255, 255], [255, 0, 0, 128]]);

    const grey = decodePng(png(2, 1, 1, 0, [[0, 0b01000000]]))!;
    expect(pixel(grey.data, 2, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(grey.data, 2, 1, 0)).toEqual([255, 255, 255, 255]);

    const deep = decodePng(png(1, 1, 16, 4, [[0, 0x80, 0x01, 0xff, 0xff]]))!;
    expect(pixel(deep.data, 1, 0, 0)).toEqual([128, 128, 128, 255]);
  });

  it('turns away what it does not read', () => {
    expect(decodePng(Buffer.from('not a png at all, just some text here'))).toBeNull();
    expect(decodePng(png(1, 1, 8, 6, [[0, 1, 2, 3, 4]], [], 1))).toBeNull();
    expect(decodePng(png(1, 1, 8, 3, [[0, 0]]))).toBeNull();
  });
});

describe('shrinkPng', () => {
  it('scales a large image down to the size, averaging with alpha', () => {
    const width = 512;
    const data = new Uint8Array(width * width * 4);
    // The left half opaque red, the right half transparent (its colour must not bleed into the edge).
    for (let y = 0; y < width; y++) for (let x = 0; x < width / 2; x++) data.set([255, 0, 0, 255], (y * width + x) * 4);
    for (let y = 0; y < width; y++) for (let x = width / 2; x < width; x++) data.set([0, 255, 0, 0], (y * width + x) * 4);
    const small = decodePng(shrinkPng(encodePng({ width, height: width, data }), 128)!)!;
    expect(small).toMatchObject({ width: 128, height: 128 });
    expect(pixel(small.data, 128, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(pixel(small.data, 128, 100, 10)[3]).toBe(0);
  });

  it('keeps the shape and leaves small images alone', () => {
    const wide = downscale({ width: 400, height: 100, data: new Uint8Array(400 * 100 * 4) }, 128);
    expect([wide.width, wide.height]).toEqual([128, 32]);
    const tiny = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) };
    expect(downscale(tiny, 128)).toBe(tiny);
  });
});
