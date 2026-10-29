import { describe, expect, it } from 'vitest';
import { REMOTE_MAX_IMAGES } from '@seshboard/protocol/remote-client';
import { addReason, ATTEMPTS, fitWithin, imageFiles, jpegName } from './images.ts';

describe('fitWithin', () => {
  it('keeps a small image as it is and scales a big one to 2,000px on its longest side', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(4000, 10, 1000)).toEqual({ width: 1000, height: 3 });
  });
});

describe('ATTEMPTS', () => {
  it('starts at 2,000px and 0.8, and only gets smaller or rougher', () => {
    expect(ATTEMPTS[0]).toEqual({ side: 2000, quality: 0.8 });
    for (let i = 1; i < ATTEMPTS.length; i++) {
      expect(ATTEMPTS[i]!.side).toBeLessThanOrEqual(ATTEMPTS[i - 1]!.side);
      expect(ATTEMPTS[i]!.quality).toBeLessThanOrEqual(ATTEMPTS[i - 1]!.quality);
    }
  });
});

describe('imageFiles', () => {
  it('takes only images, and only as many as still fit', () => {
    const files = [{ type: 'image/png' }, { type: 'text/plain' }, { type: 'image/jpeg' }, { type: 'image/heic' }];
    expect(imageFiles(files, 0)).toHaveLength(3);
    expect(imageFiles(files, REMOTE_MAX_IMAGES - 1)).toEqual([{ type: 'image/png' }]);
    expect(imageFiles(files, REMOTE_MAX_IMAGES)).toEqual([]);
  });

  it('says when a message has all the images it takes', () => {
    expect(addReason(0)).toBeNull();
    expect(addReason(REMOTE_MAX_IMAGES)).toBe(`A message takes up to ${REMOTE_MAX_IMAGES} images.`);
  });
});

describe('jpegName', () => {
  it('names the file for what it became', () => {
    expect(jpegName('Screenshot 2026-10-15.png')).toBe('Screenshot 2026-10-15.jpg');
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg');
    expect(jpegName('')).toBe('image.jpg');
  });
});
