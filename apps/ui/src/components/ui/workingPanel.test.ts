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
    expect(html).toContain('width="16"');
  });

  it('moves the light over the five free jacks while working, and holds still otherwise', () => {
    const working = render();
    expect(working).toContain('data-working-state="working"');
    expect(count(working, /--jack-delay:/g)).toBe(5);
    expect(working).toContain('--working-round:1500ms');
    for (const state of ['still', 'waiting'] as const) {
      const html = render(state);
      expect(html).toContain(`data-working-state="${state}"`);
      expect(count(html, /--jack-delay|--working-round/g)).toBe(0);
    }
  });

  it('takes a size', () => {
    expect(renderToStaticMarkup(createElement(WorkingPanel, { size: 24 }))).toContain('width="24"');
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
      // The still frame is as lit as the Dock's.
      expect(css).toContain(`[data-working-state='still'] .jack-light {\n  opacity: ${WORKING_STILL_LEVEL};`);
      expect(css).not.toContain('working-dots');
    }
  });

  it("keeps the phone's copy of the component the same as the app's", () => {
    // Everything but the doc comment over the component, which says which is the copy.
    const code = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*\*\n \* Claude is working[\s\S]*?\*\/\n/, '');
    expect(code('../../../../remote/src/components/WorkingPanel.tsx')).toBe(code('./WorkingPanel.tsx'));
  });
});
