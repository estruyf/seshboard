import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { sameRailItems, type RailLike } from './railItems.ts';

const Icon = (_: { name: string }) => null;
const click = () => {};
const item = (extra: Partial<Exclude<RailLike, 'divider'>> = {}): RailLike => ({ id: 'changes', icon: createElement(Icon, { name: 'diff' }), label: 'Changes · 3 files', ariaLabel: 'Changes, 3 files', count: 3, state: 'closed', data: { 'data-toggle-changes': true }, onClick: click, ...extra });

describe('sameRailItems', () => {
  it('keeps items that draw the same, also with a new but equal icon element', () => {
    expect(sameRailItems([item(), 'divider'], [item(), 'divider'])).toBe(true);
  });

  it('tells a new count, state, icon or click handler', () => {
    expect(sameRailItems([item()], [item({ count: 4, label: 'Changes · 4 files' })])).toBe(false);
    expect(sameRailItems([item()], [item({ state: 'front' })])).toBe(false);
    expect(sameRailItems([item()], [item({ icon: createElement(Icon, { name: 'other' }) })])).toBe(false);
    expect(sameRailItems([item()], [item({ onClick: () => {} })])).toBe(false);
    expect(sameRailItems([item()], [item(), 'divider'])).toBe(false);
  });
});
