import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badged } from './Badged.tsx';

const icon = createElement('svg', { 'data-icon': true });
const html = (props: Partial<Parameters<typeof Badged>[0]>) => renderToStaticMarkup(createElement(Badged, { icon, ...props }));

describe('Badged', () => {
  it('shows the count on the corner', () => {
    expect(html({ count: 3 })).toContain('>3</span>');
  });

  it('shows a dot instead of the count in Minimal mode', () => {
    const minimal = html({ count: 3, minimal: true, data: { 'data-rail-badge': true } });
    expect(minimal).not.toContain('>3<');
    expect(minimal).toContain('data-badge-dot');
    expect(minimal).toContain('size-1.5');
    expect(minimal).toContain('data-rail-badge');
  });

  it('shows nothing in Minimal mode with no count', () => {
    expect(html({ count: 0, minimal: true })).not.toContain('data-badge-dot');
  });

  it('keeps a dot as a neutral dot in Minimal mode', () => {
    expect(html({ dot: 'link', minimal: true })).toContain('bg-text');
  });

  it('draws a ready count in the accent, with its own text colour', () => {
    expect(html({ count: 2, tone: 'accent' })).toContain('bg-accent text-on-accent');
  });
});
