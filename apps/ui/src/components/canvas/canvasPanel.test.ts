import { describe, expect, it } from 'vitest';
import { atLogEnd, canvasInitial, canvasStartsItself, canvasView, composeHere, logTime, logTone, toggleCanvas } from './canvasPanel.ts';

const canvas = (over: Partial<{ trusted: boolean; state: 'stopped' | 'starting' | 'running' | 'failed'; url: string | null; held: boolean }> = {}) => ({ trusted: true, state: 'stopped' as const, url: null, held: false, ...over });

describe('canvasView', () => {
  it('asks before anything else while the canvas is not trusted', () => {
    expect(canvasView(canvas({ trusted: false, state: 'running', url: 'http://127.0.0.1:1/' }), false, null)).toBe('trust');
  });
  it('shows the page only while it runs and has one', () => {
    expect(canvasView(canvas({ state: 'running', url: 'http://127.0.0.1:1/' }), false, null)).toBe('page');
    expect(canvasView(canvas({ state: 'running' }), true, null)).toBe('starting');
  });
  it('waits while this panel or another one starts it', () => {
    expect(canvasView(canvas(), true, null)).toBe('starting');
    expect(canvasView(canvas({ state: 'starting' }), false, null)).toBe('starting');
  });
  it('says it failed, from this panel or from the engine', () => {
    expect(canvasView(canvas(), false, 'No page')).toBe('failed');
    expect(canvasView(canvas({ state: 'failed' }), false, null)).toBe('failed');
  });
  it('is stopped otherwise', () => {
    expect(canvasView(canvas(), false, null)).toBe('stopped');
  });
});

describe('canvasStartsItself', () => {
  it('starts a trusted, stopped canvas, and leaves a failed one for Try again', () => {
    expect(canvasStartsItself(canvas(), null)).toBe(true);
    expect(canvasStartsItself(canvas({ trusted: false }), null)).toBe(false);
    expect(canvasStartsItself(canvas({ state: 'failed' }), null)).toBe(false);
    expect(canvasStartsItself(canvas(), 'failed here')).toBe(false);
    expect(canvasStartsItself(canvas({ state: 'running' }), null)).toBe(false);
    // You stopped it: it waits for Start.
    expect(canvasStartsItself(canvas({ held: true }), null)).toBe(false);
  });
});

describe('toggleCanvas', () => {
  it('opens at the end once, and closes', () => {
    expect(toggleCanvas(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleCanvas(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleCanvas(['a', 'b'], 'a', false)).toEqual(['b']);
  });
});

describe('composeHere', () => {
  const page = { tagName: 'WEBVIEW' };
  it('goes to the panel whose page has the keyboard, in any pane', () => {
    expect(composeHere(page, page, false)).toBe(true);
  });
  it('else to the active pane, but not while another page has the keyboard', () => {
    expect(composeHere({ tagName: 'TEXTAREA' }, page, true)).toBe(true);
    expect(composeHere(null, page, true)).toBe(true);
    expect(composeHere({ tagName: 'WEBVIEW' }, page, true)).toBe(false);
    expect(composeHere({ tagName: 'TEXTAREA' }, page, false)).toBe(false);
  });
});

describe('small things', () => {
  it('takes the first letter for the rail', () => {
    expect(canvasInitial('front matter')).toBe('F');
    expect(canvasInitial(' ')).toBe('C');
  });
  it('writes a log line\'s time and tone', () => {
    expect(logTime(new Date(2026, 10, 28, 9, 5, 7).getTime())).toBe('09:05:07');
    expect(logTone({ level: 'info', from: 'canvas' })).toBe('plain');
    expect(logTone({ level: 'info', from: 'seshboard' })).toBe('quiet');
    expect(logTone({ level: 'warn', from: 'canvas' })).toBe('warn');
    expect(logTone({ level: 'error', from: 'seshboard' })).toBe('error');
  });
  it('knows when the log is at its end', () => {
    expect(atLogEnd(180, 120, 300)).toBe(true);
    expect(atLogEnd(100, 120, 300)).toBe(false);
  });
});
