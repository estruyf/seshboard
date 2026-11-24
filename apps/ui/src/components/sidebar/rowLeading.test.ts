import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectTileView } from '../ProjectTileView.tsx';
import { queueRowTooltip, rowLeading, type SidebarRowKind } from './rowLabel.ts';
import { EmptyRowSlot } from './RowSlot.tsx';

const KINDS: SidebarRowKind[] = ['session', 'run', 'queue', 'pipeline-step'];

describe('rowLeading', () => {
  it('shows no project marker on any row in Minimal mode', () => {
    expect(KINDS.map((kind) => rowLeading(kind, { minimal: true }))).toEqual(['state', 'state', 'empty', 'state']);
  });

  it('keeps full mode as it was', () => {
    expect(KINDS.map((kind) => rowLeading(kind, { minimal: false }))).toEqual(['project', 'project', 'project', 'state']);
  });
});

describe('a queued row in Minimal mode', () => {
  it('has an empty 12px slot and no project tile', () => {
    const html = renderToStaticMarkup(createElement(EmptyRowSlot));
    expect(html).toContain('size-3');
    expect(html).toContain('data-row-leading="empty"');
    expect(html).not.toContain('data-project-icon');
  });

  it('names its project in the tooltip', () => {
    expect(queueRowTooltip('Fix the cart', 'acme-store', '2 min ago')).toBe('Fix the cart\nacme-store · queued 2 min ago');
    expect(queueRowTooltip('x'.repeat(400), 'docs', 'now').split('\n')[0]).toHaveLength(300);
  });
});

describe('a project tile with Project colours off', () => {
  const tile = (project: Parameters<typeof ProjectTileView>[0]['project'], colored: boolean) => renderToStaticMarkup(createElement(ProjectTileView, { project, name: 'acme-store', size: 16, letters: 1, colored }));

  it('draws the icon in greyscale', () => {
    const icon = { icon: { kind: 'image' as const, dataUrl: 'data:image/png;base64,AA==' } };
    expect(tile(icon, false)).toContain('filter:grayscale(1)');
    expect(tile(icon, true)).not.toContain('grayscale');
  });

  it('draws the letter in the muted grey', () => {
    expect(tile(undefined, false)).toContain('color:var(--sb-muted)');
    expect(tile(undefined, true)).toContain('background:hsl(');
  });
});
