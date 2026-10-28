import { describe, expect, it } from 'vitest';
import { REMOTE_ATTACHMENT_BYTES, REMOTE_MAX_FILES, REMOTE_MAX_IMAGES } from '@seshboard/protocol/client';
import { base64Length, fileSize, fitWithin, jpegName, placeFor, remoteDropVerdict, remoteFileName, type RemoteAttachment } from './remoteAttachments.ts';

const image = (id: number, data = 'aGVsbG8='): RemoteAttachment => ({ id, kind: 'image', image: { type: 'image', mediaType: 'image/jpeg', data, name: 'shot.jpg' } });
const file = (id: number, data = 'aGVsbG8='): RemoteAttachment => ({ id, kind: 'file', file: { name: 'notes.txt', data }, size: 5 });
const ALL = { images: true, files: true };
const png = { type: 'image/png', size: 1_000, name: 'shot.png' };
const pdf = { type: 'application/pdf', size: 1_000, name: 'spec.pdf' };

describe('remote attachments', () => {
  it('attaches images as images and the rest as files', () => {
    expect(placeFor(png, [], ALL, 'mystic')).toEqual({ as: 'image' });
    expect(placeFor(pdf, [], ALL, 'mystic')).toEqual({ as: 'file' });
  });

  it('sends an image as a file once the images are full', () => {
    const full = Array.from({ length: REMOTE_MAX_IMAGES }, (_, i) => image(i));
    expect(placeFor(png, full, ALL, 'mystic')).toEqual({ as: 'file' });
    expect(placeFor(png, full, { images: true, files: false }, 'mystic')).toEqual({ skip: `A message takes up to ${REMOTE_MAX_IMAGES} images.` });
  });

  it('says to update a computer that takes no files', () => {
    expect(placeFor(pdf, [], { images: true, files: false }, 'mystic')).toEqual({ skip: 'Update Seshboard on mystic to send files.' });
  });

  it('leaves out files past the count or the size of one message', () => {
    const files = Array.from({ length: REMOTE_MAX_FILES }, (_, i) => file(i));
    expect(placeFor(pdf, files, ALL, 'mystic')).toEqual({ skip: `A message takes up to ${REMOTE_MAX_FILES} files.` });
    const nearlyFull = [image(1, 'a'.repeat(REMOTE_ATTACHMENT_BYTES - 100))];
    expect(placeFor({ ...pdf, size: 75 }, nearlyFull, ALL, 'mystic')).toEqual({ as: 'file' });
    expect(placeFor({ ...pdf, size: 76 }, nearlyFull, ALL, 'mystic')).toMatchObject({ skip: expect.stringContaining('spec.pdf is too big to send') });
  });

  it('says what a drop would do', () => {
    const state = { items: [], accepts: ALL, disabledReason: null, computer: 'mystic' };
    expect(remoteDropVerdict({ files: false, types: [] }, state)).toBeNull();
    expect(remoteDropVerdict({ files: true, types: ['image/png', 'application/pdf'] }, state)).toEqual({ kind: 'ok', attach: 1, mention: 1, full: false });
    expect(remoteDropVerdict({ files: true, types: ['application/pdf'] }, { ...state, accepts: { images: true, files: false } })).toEqual({ kind: 'disabled', reason: 'Update Seshboard on mystic to send files.' });
    expect(remoteDropVerdict({ files: true, types: ['image/png'] }, { ...state, disabledReason: 'mystic is not connected' })).toEqual({ kind: 'disabled', reason: 'mystic is not connected' });
  });

  it('sizes and names what it sends', () => {
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
    expect(fileSize(900)).toBe('900 B');
    expect(fileSize(12_400)).toBe('12 KB');
    expect(fileSize(1_400_000)).toBe('1.4 MB');
    expect(fitWithin(4_000, 3_000)).toEqual({ width: 2_000, height: 1_500 });
    expect(jpegName('Screen Shot.png')).toBe('Screen Shot.jpg');
    expect(remoteFileName('/Users/me/spec.pdf')).toBe('spec.pdf');
    expect(remoteFileName('')).toBe('file');
  });
});
