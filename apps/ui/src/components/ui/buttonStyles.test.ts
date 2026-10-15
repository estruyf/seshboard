import { describe, expect, it } from 'vitest';
import { buttonClass, pillClass, type ButtonLook } from './buttonStyles.ts';

const look = (over: Partial<ButtonLook>): ButtonLook => ({ variant: 'secondary', size: 'md', iconOnly: false, filled: false, selected: false, ...over });
const classes = (s: string) => s.split(/\s+/).filter(Boolean);

describe('buttonClass', () => {
  it('fills a primary button yellow with dark ink, never white', () => {
    const c = classes(buttonClass(look({ variant: 'primary' })));
    expect(c).toEqual(expect.arrayContaining(['bg-accent', 'text-on-accent', 'font-semibold']));
    expect(c).not.toContain('text-white');
  });
  it('builds secondary and danger on the btn-secondary utility', () => {
    expect(classes(buttonClass(look({})))).toContain('btn-secondary');
    expect(classes(buttonClass(look({ variant: 'danger' })))).toEqual(expect.arrayContaining(['btn-secondary', 'text-error']));
  });
  it('fills a confirming danger button red', () => {
    const c = classes(buttonClass(look({ variant: 'danger', filled: true })));
    expect(c).toEqual(expect.arrayContaining(['bg-error', 'text-white']));
    expect(c).not.toContain('btn-secondary');
  });
  it('outlines the Ask button in the link blue, never the accent, and presses it with a stronger blue', () => {
    const c = classes(buttonClass(look({ variant: 'side', size: 'lg' })));
    expect(c).toEqual(expect.arrayContaining(['border', 'border-link/55', 'text-link']));
    expect(c.some((x) => x.includes('accent') || x.startsWith('bg-'))).toBe(false);
    const pressed = classes(buttonClass(look({ variant: 'side', size: 'lg', selected: true })));
    expect(pressed).toEqual(expect.arrayContaining(['border-link', 'bg-link/15', 'text-link']));
    expect(pressed.some((x) => x.includes('accent'))).toBe(false);
  });
  it('fills the Ask panel’s round send button in the link blue', () => {
    const c = classes(buttonClass(look({ variant: 'side', size: 'sm', iconOnly: true, filled: true, round: true })));
    expect(c).toEqual(expect.arrayContaining(['bg-link', 'text-bg', 'rounded-full', 'size-6']));
    expect(c).not.toContain('rounded-md');
  });
  it('sizes by height, or as a square when icon-only', () => {
    expect(classes(buttonClass(look({ size: 'sm' })))).toContain('h-6');
    expect(classes(buttonClass(look({ size: 'lg' })))).toContain('h-8');
    const square = classes(buttonClass(look({ variant: 'quiet', iconOnly: true })));
    expect(square).toContain('size-7');
    expect(square).not.toContain('h-7');
  });
  it('shows a selected quiet button as a neutral fill, not yellow', () => {
    const c = classes(buttonClass(look({ variant: 'quiet', selected: true })));
    expect(c).toEqual(expect.arrayContaining(['bg-selected', 'text-text']));
    expect(c.some((x) => x.includes('accent'))).toBe(false);
    expect(c).not.toContain('text-muted');
  });
});

describe('split button segments', () => {
  it('rounds only the outer corners, and parts the ▾ with a line in the ink', () => {
    const main = classes(buttonClass(look({ variant: 'primary', size: 'lg', segment: 'main' })));
    expect(main).toEqual(expect.arrayContaining(['rounded-l-md', 'h-8', 'bg-accent']));
    expect(main).not.toContain('rounded-md');
    const menu = classes(buttonClass(look({ variant: 'primary', size: 'lg', segment: 'menu' })));
    expect(menu).toEqual(expect.arrayContaining(['rounded-r-md', 'h-8', 'w-7', 'border-l', 'border-on-accent/20']));
    expect(menu).not.toContain('rounded-md');
  });
});

describe('pillClass', () => {
  const pill = { tone: 'default' as const, interactive: false, dashed: false, selected: false, shrink: false };
  it('is a 24px rounded chip with a border', () => {
    expect(classes(pillClass(pill))).toEqual(expect.arrayContaining(['h-6', 'rounded-full', 'border', 'px-2.5', 'text-meta']));
  });
  it('reacts to hover only as a button', () => {
    expect(pillClass(pill)).not.toContain('hover:');
    expect(pillClass({ ...pill, interactive: true })).toContain('hover:bg-border/50');
  });
  it('draws a count without a border', () => {
    const c = classes(pillClass({ ...pill, tone: 'count' }));
    expect(c).toContain('px-1.5');
    expect(c).not.toContain('border');
  });
  it('dashes an add pill', () => {
    expect(classes(pillClass({ ...pill, dashed: true, interactive: true }))).toContain('border-dashed');
  });
});
