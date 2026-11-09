import { describe, expect, it } from 'vitest';
import { frameMessage, linkToOpen, MAX_VISUAL_HEIGHT, visualOf, visualThemeVars, visualTitle } from './visuals.ts';

describe('visuals', () => {
  it("reads a show_widget call's input", () => {
    expect(visualOf({ title: 'cost_chart', widget_code: '<div>hi</div>', loading_messages: ['Adding up', '', 3, 'Drawing'] })).toEqual({ code: '<div>hi</div>', title: 'cost_chart', loading: ['Adding up', 'Drawing'], svg: false });
    expect(visualOf({ widget_code: '  <svg viewBox="0 0 10 10"></svg>' })?.svg).toBe(true);
    expect(visualOf({ widget_code: '<svgish>' })?.svg).toBe(false);
    expect(visualOf({ title: 'empty', widget_code: '  ' })).toBeNull();
    expect(visualOf(null)).toBeNull();
  });

  it('names a visual from its snake_case title', () => {
    expect(visualTitle('monthly_cost_breakdown')).toBe('Monthly cost breakdown');
    expect(visualTitle('')).toBe('Visual');
  });

  it("maps the theme's tokens to the desktop app's variables, and leaves out what the theme lacks", () => {
    const tokens: Record<string, string> = { '--sb-text': '#111', '--sb-muted': '#555', '--sb-bg': '#fff', '--sb-code-bg': '#eee', '--sb-error': '#d00', '--sb-card': '#fafafa', '--font-sans': ' Inter, sans-serif' };
    const vars = visualThemeVars((name) => tokens[name] ?? '');
    expect(vars['--text-primary']).toBe('#111');
    expect(vars['--surface-0']).toBe('#fff');
    expect(vars['--surface-2']).toBe('#fafafa');
    expect(vars['--border-danger']).toBe('color-mix(in srgb, #d00 45%, #fff)');
    expect(vars['--bg-danger']).toBe('color-mix(in srgb, #d00 14%, #fff)');
    expect(vars).not.toHaveProperty('--surface-3');
    expect(vars['--font-sans']).toBe('Inter, sans-serif');
    expect(vars).not.toHaveProperty('--text-muted');
    expect(vars).not.toHaveProperty('--bg-success');
  });

  it("checks what the frame says, since it runs Claude's code", () => {
    expect(frameMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(frameMessage({ type: 'height', height: 120.2 })).toEqual({ type: 'height', height: 121 });
    expect(frameMessage({ type: 'drawn', height: 1e9 })).toEqual({ type: 'drawn', height: MAX_VISUAL_HEIGHT });
    expect(frameMessage({ type: 'height', height: Number.NaN })).toBeNull();
    expect(frameMessage({ type: 'prompt', text: '  Explain the cache step  ' })).toEqual({ type: 'prompt', text: 'Explain the cache step' });
    expect(frameMessage({ type: 'prompt', text: ' ' })).toBeNull();
    expect(frameMessage({ type: 'link', url: 'https://example.com/a' })).toEqual({ type: 'link', url: 'https://example.com/a' });
    expect(frameMessage({ type: 'link', url: 'file:///etc/passwd' })).toBeNull();
    expect(frameMessage({ type: 'render', code: '' })).toBeNull();
    expect(frameMessage('ready')).toBeNull();
  });

  it('opens http and https links only', () => {
    expect(linkToOpen('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(linkToOpen('javascript:alert(1)')).toBeNull();
    expect(linkToOpen('not a url')).toBeNull();
  });
});
