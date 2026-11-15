import { describe, expect, it } from 'vitest';
import { elementImage, elementItem, elementName, quoteHeading } from './pageMessage.ts';

const element = { url: 'http://localhost:5173/about', selector: 'main > section.hero > button.cta:nth-of-type(2)', html: '<button class="cta">Go</button>', text: 'Go', image: 'iVBOR' };

describe('elementName', () => {
  it("is the selector's last step, without its place among its siblings", () => {
    expect(elementName(element.selector)).toBe('button.cta');
    expect(elementName('#save')).toBe('#save');
    expect(elementName('')).toBe('element');
  });
});

describe('elementItem', () => {
  it('names the element and its page, and holds the page, the selector and the HTML', () => {
    expect(elementItem(element)).toEqual({
      kind: 'text',
      source: 'element',
      label: 'Element button.cta on localhost:5173/about',
      text: '<!-- Page: http://localhost:5173/about -->\n<!-- Selector: main > section.hero > button.cta:nth-of-type(2) -->\n<button class="cta">Go</button>',
      language: 'html',
    });
  });

  it('cuts a long name to what a chip holds', () => {
    expect(elementItem({ ...element, url: `http://localhost:5173/${'a'.repeat(300)}` }).label).toHaveLength(200);
  });
});

describe('elementImage', () => {
  it("is the element's picture as a PNG, or nothing without one", () => {
    expect(elementImage(element)).toEqual({ type: 'image', mediaType: 'image/png', data: 'iVBOR', name: 'button.cta.png' });
    expect(elementImage({ ...element, image: null })).toBeNull();
  });
});

describe('quoteHeading', () => {
  it('says which page the quote is from', () => {
    expect(quoteHeading('http://localhost:5173/')).toBe('From http://localhost:5173/:');
  });
});
