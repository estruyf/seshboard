import { describe, expect, it } from 'vitest';
import { diagramLink, type LinkLookup } from './mermaidLinks.ts';

const inside = (attributes: Record<string, string>): LinkLookup => ({ closest: (selector) => (selector === 'a' ? { getAttribute: (name) => attributes[name] ?? null } : null) });
const outside: LinkLookup = { closest: () => null };

describe('diagramLink', () => {
  it('finds a link by its href or its xlink:href and follows http and https only', () => {
    expect(diagramLink(inside({ href: 'https://example.com/docs' }))).toEqual({ anchor: true, url: 'https://example.com/docs' });
    expect(diagramLink(inside({ 'xlink:href': 'http://localhost:3000/a' }))).toEqual({ anchor: true, url: 'http://localhost:3000/a' });
    expect(diagramLink(inside({ href: 'javascript:alert(1)' }))).toEqual({ anchor: true, url: null });
    expect(diagramLink(inside({ href: 'about:blank' }))).toEqual({ anchor: true, url: null });
    expect(diagramLink(inside({}))).toEqual({ anchor: true, url: null });
  });

  it('says a click away from any link is not on one', () => {
    expect(diagramLink(outside)).toEqual({ anchor: false, url: null });
    expect(diagramLink(null)).toEqual({ anchor: false, url: null });
  });
});
