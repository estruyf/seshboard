import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WORKING_FADE, WORKING_HOLD, WORKING_STILL_LEVEL } from '@seshboard/protocol/working-panel';
import remoteStyles from '../../../../remote/src/styles.css?raw';
import styles from '../../styles.css?raw';
import { WorkingPanel, type WorkingState } from './WorkingPanel.tsx';

const render = (state?: WorkingState) => renderToStaticMarkup(createElement(WorkingPanel, state ? { state } : {}));
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

describe('WorkingPanel', () => {
  it('draws the 3×3 panel: four plugged jacks and five free ones, decorative', () => {
    const html = render();
    expect(count(html, /data-jack="plugged"/g)).toBe(4);
    expect(count(html, /data-jack="free"/g)).toBe(5);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-working-panel=""');
    expect(html).toContain('width:16px;height:16px');
  });

  it('moves the light over the five free jacks while working, and sets no delays otherwise', () => {
    const working = render();
    expect(working).toContain('data-working-state="working"');
    expect(count(working, /--jack-delay:/g)).toBe(5);
    expect(working).toContain('--working-round:1500ms');
    for (const state of ['compacting', 'waiting'] as const) {
      const html = render(state);
      expect(html).toContain(`data-working-state="${state}"`);
      expect(count(html, /--jack-delay|--working-round/g)).toBe(0);
    }
  });

  it('takes a size', () => {
    expect(renderToStaticMarkup(createElement(WorkingPanel, { size: 24 }))).toContain('width:24px;height:24px');
  });
});

describe('the working panel on the compositor', () => {
  it('draws the lights as HTML over a still SVG, so only opacity and transform animate', () => {
    const html = render();
    // The SVG holds the plugs and the holes; it has no animated child.
    const svg = /<svg[\s\S]*?<\/svg>/.exec(html)![0];
    expect(count(svg, /jack-light|jack-glow|jack-lit/g)).toBe(0);
    expect(count(html, /class="jack-light"/g)).toBe(5);
    expect(count(html, /class="jack-glow"/g)).toBe(5);
    expect(count(html, /class="jack-lit"/g)).toBe(5);
    for (const css of [styles, remoteStyles]) {
      const keyframes = (name: string) => new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
      // Opacity and transform only.
      expect(keyframes('working-jack')).not.toMatch(/fill|width|height|r:|filter|box-shadow/);
      expect(keyframes('working-glow')).not.toMatch(/fill|width|height|r:|filter|box-shadow/);
      expect(keyframes('working-compacting')).not.toMatch(/fill|width|height|r:|filter|box-shadow/);
      expect(css).not.toMatch(/\.jack-(light|glow|lit) \{[^}]*fill:/);
    }
  });

  it('ties the lit dot to the glow: it is JACK / GLOW of the light, centred, whatever the size', () => {
    const html = render();
    // 2.8 / 6.55 of the light's square: (1 - 0.4275) / 2 on each side.
    expect(html).toMatch(/class="jack-lit" style="inset:28\.6\d*%"/);
    expect(styles).not.toMatch(/\.jack-lit \{[^}]*inset:/);
    // The glow of a jack on the panel's edge is clipped to the panel, as the SVG clipped it.
    for (const css of [styles, remoteStyles]) expect(css).toMatch(/\.working-panel \{\s*overflow: hidden;/);
  });

  it('pauses what never ends while the window is in the background, and lets the needs-you ring rest', () => {
    const blurred = [...styles.matchAll(/html\[data-blurred\][^{]*\{[^}]*\}/g)].map((match) => match[0]);
    const paused = blurred.filter((block) => /animation-play-state: paused;/.test(block)).join('\n');
    for (const selector of ['.working-panel .jack-light', '.working-panel .jack-glow', '.animate-spin', '.animate-pulse', "[class*='_infinite]']", '.stream-caret > :last-child > :last-child::after', '.stream-caret:empty::after', '.page-progress::before']) {
      expect(paused, selector).toContain(selector);
    }
    // A ping that never ends would be stopped at its biggest: it rests instead.
    expect(paused).not.toContain('.animate-ping');
    expect(blurred.some((block) => /\.animate-ping \{\s*animation: none;/.test(block))).toBe(true);
  });
});

describe('the working mark in both apps', () => {
  it('holds a jack full for its turn and dark after WORKING_FADE of a round, in the app and on the phone', () => {
    const percent = (share: number) => `${Math.round(share * 100)}%`;
    for (const css of [styles, remoteStyles]) {
      for (const name of ['working-jack', 'working-glow']) {
        const keyframes = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
        expect(keyframes, name).toContain(percent(WORKING_HOLD));
        expect(keyframes, name).toContain(percent(WORKING_FADE));
      }
      // Compacting pulses from the Dock's still frame, and holds it with Reduce motion.
      expect(css).toContain(`[data-working-state='compacting'] .jack-light {\n  opacity: ${WORKING_STILL_LEVEL};\n  animation: working-compacting `);
      expect(/@keyframes working-compacting \{\s*0%,\s*100% \{\s*opacity: ([\d.]+);/.exec(css)?.[1]).toBe(String(WORKING_STILL_LEVEL));
      expect(css).toMatch(/prefers-reduced-motion[\s\S]*\[data-working-state='compacting'\] \.jack-light \{\s*animation: none;/);
      expect(css).not.toContain('working-dots');
    }
  });

  it("keeps the phone's copy of the component the same as the app's", () => {
    // Everything but the doc comment over the component, which says which is the copy.
    // The phone's window-activity module sits one folder nearer.
    const code = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*\*\n \* Claude is working[\s\S]*?\*\/\n/, '').replace("'../../lib/windowActivity.ts'", "'../lib/windowActivity.ts'");
    expect(code('../../../../remote/src/components/WorkingPanel.tsx')).toBe(code('./WorkingPanel.tsx'));
  });
});
