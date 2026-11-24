import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RowStatus } from '../../state/sidebarRows.ts';
import { minimalMark, minimalRowTooltip } from './rowLabel.ts';
import { StatusIcon } from './StatusIcon.tsx';

const STATUSES: RowStatus[] = ['needs-you', 'running', 'background', 'unread', 'error', 'idle', null];

describe('minimalMark', () => {
  it('gives every state its shape and name', () => {
    expect(STATUSES.map((status) => [status, minimalMark(status)])).toEqual([
      ['needs-you', { mark: 'dot', label: 'Needs you' }],
      ['running', { mark: 'spinner', label: 'Working' }],
      ['background', { mark: 'spinner', label: 'Working in the background' }],
      ['unread', { mark: 'ring', label: 'To review' }],
      ['error', { mark: 'error', label: 'Failed' }],
      ['idle', { mark: 'none', label: null }],
      [null, { mark: 'none', label: null }],
    ]);
  });
});

describe('StatusIcon, minimal', () => {
  const html = (status: RowStatus) => renderToStaticMarkup(createElement(StatusIcon, { status, variant: 'minimal' }));

  it('labels each mark with its state', () => {
    expect(html('needs-you')).toContain('aria-label="Needs you"');
    expect(html('needs-you')).toContain('data-minimal-mark="dot"');
    expect(html('running')).toContain('data-minimal-mark="spinner"');
    expect(html('unread')).toContain('aria-label="To review"');
  });

  it('turns the arc only without reduced motion', () => {
    expect(html('running')).toContain('motion-safe:animate-spin');
    expect(html('running')).toContain('M21 12a9 9 0 1 1-6.2-8.56');
  });

  it('keeps an empty slot when open, so titles line up', () => {
    expect(html('idle')).toBe('<span class="flex size-3 shrink-0 items-center justify-center" aria-hidden="true" data-minimal-mark="none"></span>');
  });

  it('keeps the standard icons without the variant', () => {
    expect(renderToStaticMarkup(createElement(StatusIcon, { status: 'needs-you' }))).toContain('bg-warn');
  });
});

describe('minimalRowTooltip', () => {
  it('carries what the second line had', () => {
    expect(minimalRowTooltip({ title: 'Fix login', waitingFor: 'Permission: Bash', project: 'acme-store', branch: 'main', computer: 'Studio', terminal: true, tabs: 2, profile: 'Work' })).toBe(
      'Fix login\nPermission: Bash\nacme-store · main\nOn Studio\nOpen: a terminal, 2 browser tabs\nProfile: Work',
    );
  });

  it('leaves out what is not there', () => {
    expect(minimalRowTooltip({ title: '', tabs: 1 })).toBe('Untitled session\nOpen: 1 browser tab');
  });
});
