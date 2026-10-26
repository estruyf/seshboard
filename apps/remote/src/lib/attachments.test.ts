import { describe, expect, it } from 'vitest';
import { REMOTE_FEATURE_ATTACHMENTS, REMOTE_MAX_FILES, REMOTE_MAX_IMAGES } from '@seshboard/protocol/remote-client';
import { acceptsFor, fileName, fileSize, placeFor, type Attachment } from './attachments.ts';

const image = (id: number): Attachment => ({ id, kind: 'image', image: { type: 'image', mediaType: 'image/jpeg', data: 'AAAA' } });
const file = (id: number): Attachment => ({ id, kind: 'file', file: { name: 'a.pdf', data: 'AAAA' }, size: 3 });
const png = { type: 'image/png', size: 1_000, name: 'a.png' };
const pdf = { type: 'application/pdf', size: 1_000, name: 'a.pdf' };

describe('acceptsFor', () => {
  it('takes images in a session on every version, and the rest only with the feature', () => {
    expect(acceptsFor([], false)).toEqual({ images: true, files: false });
    expect(acceptsFor([], true)).toEqual({ images: false, files: false });
    expect(acceptsFor([REMOTE_FEATURE_ATTACHMENTS], true)).toEqual({ images: true, files: true });
  });
});

describe('placeFor', () => {
  const all = { images: true, files: true };
  it('attaches an image as an image and anything else as a file', () => {
    expect(placeFor(png, [], all)).toEqual({ as: 'image' });
    expect(placeFor(pdf, [], all)).toEqual({ as: 'file' });
  });
  it('sends an image as a file once the images are full', () => {
    const full = Array.from({ length: REMOTE_MAX_IMAGES }, (_, i) => image(i));
    expect(placeFor(png, full, all)).toEqual({ as: 'file' });
    expect(placeFor(png, full, { images: true, files: false })).toEqual({ skip: `A message takes up to ${REMOTE_MAX_IMAGES} images.` });
  });
  it('leaves out files an older computer or a full message cannot take', () => {
    expect(placeFor(pdf, [], { images: true, files: false })).toEqual({ skip: 'Update Seshboard on your computer to send files.' });
    const full = Array.from({ length: REMOTE_MAX_FILES }, (_, i) => file(i));
    expect(placeFor(pdf, full, all)).toEqual({ skip: `A message takes up to ${REMOTE_MAX_FILES} files.` });
  });
  it('leaves out a file that does not fit what is left', () => {
    expect('skip' in placeFor({ ...pdf, size: 5_000_000 }, [], all)).toBe(true);
  });
});

describe('names and sizes', () => {
  it('drops folders from a name and writes sizes short', () => {
    expect(fileName('C:\\x\\y\\log.txt')).toBe('log.txt');
    expect(fileName('')).toBe('file');
    expect(fileSize(12_400)).toBe('12 KB');
    expect(fileSize(1_400_000)).toBe('1.4 MB');
  });
});
