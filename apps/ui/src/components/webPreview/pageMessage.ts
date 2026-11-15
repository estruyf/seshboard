import type { ContextItem, ImageAttachment } from '@seshboard/protocol/client';
import type { PickedElement } from '@seshboard/protocol/bridge';
import { shortUrl } from '@seshboard/protocol/client';

/** The line above a quote from a session's page: where it came from. */
export const quoteHeading = (url: string): string => `From ${url}:`;

/** The element's last step of its selector (`button.cta`), what its chip and picture are called. */
export function elementName(selector: string): string {
  const last = selector.split(/\s*>\s*/).at(-1)?.trim() ?? '';
  return last.replace(/:nth-of-type\(\d+\)$/, '') || 'element';
}

/**
 * A picked element as a chip for the message: named by its selector's last step and its page, with its HTML under a
 * line for the page and a line for the full selector, so Claude can find it on the page and in the code.
 */
export function elementItem(element: PickedElement): Extract<ContextItem, { kind: 'text' }> {
  const label = `Element ${elementName(element.selector)} on ${shortUrl(element.url)}`;
  return {
    kind: 'text',
    source: 'element',
    label: label.length > 200 ? `${label.slice(0, 199)}…` : label,
    text: `<!-- Page: ${element.url} -->\n<!-- Selector: ${element.selector} -->\n${element.html}`,
    language: 'html',
  };
}

/** The element's picture as an image for the message, or null when it has none. */
export function elementImage(element: PickedElement): ImageAttachment | null {
  if (!element.image) return null;
  return { type: 'image', mediaType: 'image/png', data: element.image, name: `${elementName(element.selector)}.png` };
}
