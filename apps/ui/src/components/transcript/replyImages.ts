import type { ImageRef } from '@seshboard/protocol/client';
import { createContext } from 'react';
import type { DisplayItem } from './displayItems.ts';

/**
 * For each image a tool returned, every image of its reply: all that tools returned between two of your prompts, in
 * order, so the lightbox can step from one tool call's image to the next. Images you attached keep to their own message.
 */
export function replyImageGalleries(items: readonly DisplayItem[]): ReadonlyMap<string, ImageRef[]> {
  const galleries = new Map<string, ImageRef[]>();
  let reply: ImageRef[] = [];
  for (const item of items) {
    if (item.kind === 'user' && !item.subagent) reply = [];
    if (item.kind !== 'tool' || !item.result) continue;
    for (const image of item.result.images) {
      reply.push(image);
      galleries.set(image.imageId, reply);
    }
  }
  return galleries;
}

/** The galleries of the conversation being shown; empty where there is none, so a tool's images stay on their own. */
export const ReplyImagesContext = createContext<ReadonlyMap<string, ImageRef[]>>(new Map());
