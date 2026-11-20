import type { ImageRef } from '@seshboard/protocol/client';
import { describe, expect, it } from 'vitest';
import type { DisplayItem } from './displayItems.ts';
import { replyImageGalleries } from './replyImages.ts';

const image = (imageId: string): ImageRef => ({ imageId, mediaType: 'image/png', bytes: 10 });
const prompt = (key: string, images: ImageRef[] = [], subagent = false): DisplayItem => ({ kind: 'user', key, at: null, text: 'Look', images, subagent });
const tool = (key: string, images: ImageRef[] | null): DisplayItem => ({
  kind: 'tool',
  key,
  at: null,
  id: key,
  name: 'Read',
  input: {},
  inputTruncated: false,
  result: images && { text: '', isError: false, truncated: false, images, at: null },
  subagent: false,
});
const ids = (images: ImageRef[] | undefined) => images?.map((item) => item.imageId);

describe('replyImageGalleries', () => {
  it('puts the images of every tool call in a reply in one gallery, in order', () => {
    const galleries = replyImageGalleries([prompt('p'), tool('a', [image('1')]), { kind: 'text', key: 't', at: null, text: 'Next', subagent: false }, tool('b', [image('2'), image('3')])]);
    expect(ids(galleries.get('1'))).toEqual(['1', '2', '3']);
    expect(ids(galleries.get('3'))).toEqual(['1', '2', '3']);
  });

  it('starts a new gallery at your next prompt', () => {
    const galleries = replyImageGalleries([prompt('p1'), tool('a', [image('1')]), prompt('p2'), tool('b', [image('2')])]);
    expect(ids(galleries.get('1'))).toEqual(['1']);
    expect(ids(galleries.get('2'))).toEqual(['2']);
  });

  it('keeps a reply together across the prompt to a subagent', () => {
    const galleries = replyImageGalleries([prompt('p'), tool('a', [image('1')]), prompt('sub', [], true), tool('b', [image('2')])]);
    expect(ids(galleries.get('1'))).toEqual(['1', '2']);
  });

  it('leaves out images you attached and calls without a result', () => {
    const galleries = replyImageGalleries([prompt('p', [image('mine')]), tool('a', null), tool('b', [image('1')])]);
    expect(galleries.has('mine')).toBe(false);
    expect(ids(galleries.get('1'))).toEqual(['1']);
  });
});
