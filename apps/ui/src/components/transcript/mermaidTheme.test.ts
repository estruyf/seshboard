import { describe, expect, it } from 'vitest';
import { mermaidThemeVariables } from './mermaidTheme.ts';

const LIGHT: Record<string, string> = {
  '--sb-bg': '#ffffff',
  '--sb-text': '#202736',
  '--sb-muted': '#505869',
  '--sb-border': '#e1e4e8',
  '--sb-accent-ink': '#916c00',
  '--sb-link': '#005cc5',
  '--sb-ok': '#00806f',
  '--sb-warn': '#d1186b',
  '--sb-error': '#d73a49',
  '--sb-caution': '#b35900',
  '--sb-memory': '#8250df',
  '--sb-pipeline': '#6741d9',
  '--sb-code-bg': '#f4f6fa',
  '--sb-chart-output': '#7048e8',
  '--sb-chart-cache-write': '#c2255c',
  '--sb-chart-cache-read': '#1c7ed6',
  '--sb-chart-input': '#099268',
  '--sb-chart-shipped': '#e8590c',
  '--font-sans': " -apple-system, 'SF Pro Text', sans-serif",
};
const DARK: Record<string, string> = { ...LIGHT, '--sb-bg': '#15181f', '--sb-text': '#d9dbe1', '--sb-accent-ink': '#ffd43b', '--sb-code-bg': '#202736' };
const reader = (tokens: Record<string, string>) => (name: string) => tokens[name] ?? '';
const HEX = /^#[0-9a-f]{6}$/;

describe('mermaidThemeVariables', () => {
  it("takes the page, text and lines from the theme's tokens", () => {
    const vars = mermaidThemeVariables(reader(LIGHT));
    expect(vars.background).toBe('#ffffff');
    expect(vars.textColor).toBe('#202736');
    expect(vars.lineColor).toBe('#505869');
    expect(vars.primaryBorderColor).toBe('#916c00');
    expect(vars.clusterBkg).toBe('#f4f6fa');
    expect(vars.fontFamily).toBe("-apple-system, 'SF Pro Text', sans-serif");
    expect(vars.darkMode).toBe(false);
  });

  it('is dark mode when the page is dark, and tints toward the page rather than white', () => {
    const light = mermaidThemeVariables(reader(LIGHT));
    const dark = mermaidThemeVariables(reader(DARK));
    expect(dark.darkMode).toBe(true);
    expect(dark.background).toBe('#15181f');
    // A node's fill is the accent over the page: light in light mode, dark in dark mode.
    expect(light.primaryColor).not.toBe(dark.primaryColor);
    const channel = (hex: unknown, i: number) => parseInt(String(hex).slice(1 + i * 2, 3 + i * 2), 16);
    expect(channel(light.primaryColor, 0)).toBeGreaterThan(200);
    expect(channel(dark.primaryColor, 0)).toBeLessThan(120);
  });

  it('gives Mermaid plain hex colours only, whatever format the theme uses', () => {
    const vars = mermaidThemeVariables(reader({ ...LIGHT, '--sb-bg': 'oklch(1 0 0)', '--sb-text': 'rgb(32 39 54)', '--sb-border': 'hsl(210 12% 89%)', '--sb-accent-ink': '#916c0080' }));
    for (const key of ['background', 'textColor', 'lineColor', 'primaryColor', 'primaryBorderColor', 'noteBkgColor', 'pie1', 'pieSectionTextColor']) {
      expect(String(vars[key]), key).toMatch(HEX);
    }
    expect(vars.textColor).toBe('#202736');
    // A translucent token is drawn over the page, so no transparency reaches Mermaid.
    expect(vars.primaryBorderColor).toMatch(HEX);
  });

  it('colours pie slices and chart series from the chart tokens, in their order', () => {
    const vars = mermaidThemeVariables(reader(LIGHT));
    expect(vars.pie1).toBe('#7048e8');
    expect(vars.pie2).toBe('#c2255c');
    expect(vars.pie12).toBe('#005cc5');
    const xy = vars.xyChart as { plotColorPalette: string; backgroundColor: string };
    expect(xy.plotColorPalette.split(',')).toHaveLength(12);
    expect(xy.plotColorPalette.startsWith('#7048e8,#c2255c,#1c7ed6')).toBe(true);
    expect(xy.backgroundColor).toBe('#ffffff');
    // The label on a slice is the page's colour, which the slice colours were picked to contrast with.
    expect(vars.pieSectionTextColor).toBe('#ffffff');
  });

  it('leaves the font out when the theme has none, and survives a token it lacks', () => {
    const vars = mermaidThemeVariables(reader({ '--sb-bg': '#fff' }));
    expect(vars).not.toHaveProperty('fontFamily');
    expect(String(vars.textColor)).toMatch(HEX);
  });
});
