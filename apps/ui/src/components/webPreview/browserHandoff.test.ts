import { describe, expect, it } from 'vitest';
import { adoptTabs, parseHandoff, takeTabs } from './browserHandoff.ts';
import { NO_TABS, openTab, ownerTabs, pinTab, showTab, updateTab, type TabsState } from './browserTabs.ts';

let n = 0;
const open = (state: TabsState, owner: string, url: string | null, profileId: string | null = null) => openTab(state, owner, url, { id: `t${++n}`, now: ++n, seq: n, profileId });

/** Two sessions with tabs; s1 has a pinned tab, one in another profile, and its first in front. */
function setup() {
  let state = NO_TABS;
  const a = open(state, 's1', 'https://a.test/');
  const b = open(a.state, 's1', 'https://b.test/', 'p1');
  const c = open(b.state, 's2', 'https://c.test/');
  state = pinTab(c.state, b.id);
  state = updateTab(state, a.id, { zoom: 1.25, phone: true, audible: true });
  state = showTab(state, a.id, 100);
  return { state, a: a.id, b: b.id, c: c.id };
}

describe('browser handoff', () => {
  it('takes every tab of a session, with the one in front, and leaves the others', () => {
    const { state, a, b, c } = setup();
    const { handoff, state: left } = takeTabs(state, 's1');
    expect(handoff.tabs.map((t) => t.id)).toEqual([b, a]);
    expect(handoff.active).toBe(a);
    expect(handoff.tabs.every((t) => !t.audible)).toBe(true);
    expect(left.tabs.map((t) => t.id)).toEqual([c]);
    expect(left.active.has('s1')).toBe(false);
  });

  it('goes through main as plain data and comes back the same, in the same order', () => {
    const { state, a, b } = setup();
    const { handoff } = takeTabs(state, 's1');
    const parsed = parseHandoff(JSON.parse(JSON.stringify(handoff)), 's1')!;
    const back = adoptTabs(NO_TABS, 's1', parsed, 500);
    expect(ownerTabs(back, 's1').map((t) => [t.id, t.pinned, t.profileId, t.zoom, t.phone])).toEqual([
      [b, true, 'p1', 1, false],
      [a, false, null, 1.25, true],
    ]);
    expect(back.active.get('s1')).toBe(a);
    // The tab in front gets a page first where it lands.
    expect(back.tabs.find((t) => t.id === a)?.lastShownAt).toBe(500);
  });

  it('replaces the tabs a session had in the window it lands in', () => {
    const { state, a } = setup();
    const { handoff } = takeTabs(state, 's1');
    const here = open(NO_TABS, 's1', 'https://old.test/').state;
    const back = adoptTabs(here, 's1', { tabs: handoff.tabs.filter((t) => t.id === a), active: a }, 1);
    expect(ownerTabs(back, 's1').map((t) => t.url)).toEqual(['https://a.test/']);
  });

  it('closes the panel’s tabs when none came back, and leaves out what isn’t a tab', () => {
    const { state } = setup();
    expect(ownerTabs(adoptTabs(state, 's1', { tabs: [], active: null }, 1), 's1')).toEqual([]);
    expect(parseHandoff(null, 's1')).toBeNull();
    expect(parseHandoff({ tabs: 'no' }, 's1')).toBeNull();
    const parsed = parseHandoff({ tabs: [{ id: 'x', url: 'https://x.test/', owner: 'other' }, { url: 3 }, null], active: 'gone' }, 's1')!;
    expect(parsed.tabs.map((t) => [t.id, t.owner, t.zoom, t.pinned])).toEqual([['x', 's1', 1, false]]);
    expect(parsed.active).toBeNull();
    expect(adoptTabs(NO_TABS, 's1', parsed, 1).active.get('s1')).toBe('x');
  });
});
