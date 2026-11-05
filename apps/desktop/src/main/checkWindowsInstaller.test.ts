import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// @ts-expect-error A build script in plain JavaScript, with no types.
import { embeddedArchives, listedFiles, packageProblems } from '../../scripts/checkWindowsInstaller.mjs';

/** The start of a .7z archive with this much after its 32-byte header, with a checksum that is right or not. */
function archive(bodySize: number, validChecksum = true): Buffer {
  const out = Buffer.alloc(32 + bodySize);
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]).copy(out);
  out.writeBigUInt64LE(BigInt(bodySize - 4), 12);
  out.writeBigUInt64LE(4n, 20);
  out.writeUInt32LE(validChecksum ? crc32(out.subarray(12, 32)) : 0, 8);
  return out;
}

const LISTING = [
  'Listing archive: package.7z',
  '',
  '--',
  'Path = package.7z',
  'Type = 7z',
  'Method = 0A LZMA2:20 LZMA:20 BCJ2',
  '',
  '----------',
  'Path = locales',
  'Folder = +',
  'Method = ',
  '',
  'Path = Seshboard.exe',
  'Size = 10',
  'Method = BCJ2 LZMA2:20 LZMA:20:lc0:lp2 LZMA:20:lc0:lp2',
  '',
  'Path = ffmpeg.dll',
  'Method = 0A LZMA2:20',
  '',
].join('\r\n');

describe('embeddedArchives', () => {
  it('finds each archive between other bytes', () => {
    const pad = Buffer.alloc(10, 1);
    const data = Buffer.concat([pad, archive(20), pad, archive(8), pad]);
    expect(embeddedArchives(data)).toEqual([{ start: 10, end: 62 }, { start: 72, end: 112 }]);
  });

  it('skips what only looks like an archive', () => {
    expect(embeddedArchives(archive(20, false))).toEqual([]);
    expect(embeddedArchives(archive(20).subarray(0, 40))).toEqual([]);
    expect(embeddedArchives(archive(20).subarray(0, 16))).toEqual([]);
  });
});

describe('listedFiles', () => {
  it('reads the files and not the archive itself', () => {
    expect(listedFiles(LISTING)).toEqual([
      { path: 'locales', method: '' },
      { path: 'Seshboard.exe', method: 'BCJ2 LZMA2:20 LZMA:20:lc0:lp2 LZMA:20:lc0:lp2' },
      { path: 'ffmpeg.dll', method: '0A LZMA2:20' },
    ]);
  });
});

describe('packageProblems', () => {
  const app = { path: 'Seshboard.exe', method: 'BCJ LZMA2:26' };

  it('accepts what the installer can unpack', () => {
    expect(packageProblems([app, { path: 'locales', method: '' }, { path: 'icudtl.dat', method: 'LZMA2:26' }, { path: 'a.dll', method: 'BCJ2 LZMA2:26 LZMA:20:lc0:lp2 LZMA:20:lc0:lp2' }])).toEqual([]);
  });

  it('names a file with the ARM64 filter, by name or by number, and any filter it does not know', () => {
    const problems = packageProblems([app, { path: 'a.dll', method: 'ARM64 LZMA2:26' }, { path: 'b.dll', method: '0A LZMA2:20' }, { path: 'c.dll', method: 'RISCV LZMA2:26' }]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('a.dll');
  });

  it('wants the app itself in the package', () => {
    expect(packageProblems([{ path: 'icudtl.dat', method: 'LZMA2:26' }])).toEqual(['There is no Seshboard.exe.']);
  });
});
