import { describe, expect, it } from 'vitest';
import { BROWSER_OWNER, closeTab, livePages, moveTab, NO_TABS, openTab, ownerTabs, pinTab, rememberClosed, restore, rowIndicators, sameAddress, takeClosed, unpinTab, type TabsState } from './browserTabs.ts';

let n = 0;
const open = (state: TabsState, owner: string, url: string | null, focus = true) => openTab(state, owner, url, { id: `t${++n}`, now: ++n, seq: n, focus });
const ids = (state: TabsState, owner: string) => ownerTabs(state, owner).map((t) => t.id);

function three(owner = 's1') {
  let state = NO_TABS;
  const made: string[] = [];
  for (const url of ['https://a.test/', 'https://b.test/', 'https://c.test/']) {
    const r = open(state, owner, url);
    state = r.state;
    made.push(r.id);
  }
  return { state, made };
}

describe('sameAddress', () => {
  it('compares origin and path, ignoring #', () => {
    expect(sameAddress('https://github.com/a/pull/1#files', 'https://github.com/a/pull/1')).toBe(true);
    expect(sameAddress('https://github.com/a/pull/1', 'https://github.com/a/pull/2')).toBe(false);
    expect(sameAddress('http://github.com/a', 'https://github.com/a')).toBe(false);
    expect(sameAddress(null, 'https://github.com/')).toBe(false);
  });
});

describe('openTab', () => {
  it('opens a tab in front, at the end', () => {
    const { state, made } = three();
    expect(ids(state, 's1')).toEqual(made);
    expect(state.active.get('s1')).toBe(made[2]);
  });

  it('shows the tab already on that address instead of opening another', () => {
    const { state, made } = three();
    const again = open(state, 's1', 'https://a.test/#section');
    expect(again.id).toBe(made[0]);
    expect(again.state.tabs).toHaveLength(3);
    expect(again.state.active.get('s1')).toBe(made[0]);
  });

  it("keeps owners apart: another owner's tab on the address doesn't count", () => {
    const { state } = three();
    const other = open(state, BROWSER_OWNER, 'https://a.test/');
    expect(other.state.tabs).toHaveLength(4);
    expect(other.state.active.get(BROWSER_OWNER)).toBe(other.id);
  });

  it('opens an empty tab every time, and in the background on request', () => {
    const { state, made } = three();
    const empty = open(state, 's1', null);
    expect(open(empty.state, 's1', null).state.tabs).toHaveLength(5);
    const behind = open(state, 's1', 'https://d.test/', false);
    expect(behind.state.active.get('s1')).toBe(made[2]);
  });
});

describe('closeTab', () => {
  it('shows the tab to the right, else the left, else nothing', () => {
    const { state, made } = three();
    const middle = closeTab({ ...state, active: new Map([['s1', made[1]!]]) }, made[1]!);
    expect(middle.active.get('s1')).toBe(made[2]);
    const last = closeTab(state, made[2]!);
    expect(last.active.get('s1')).toBe(made[1]);
    let all = state;
    for (const id of made) all = closeTab(all, id);
    expect(all.active.has('s1')).toBe(false);
    expect(all.tabs).toEqual([]);
  });

  it('leaves the front tab alone when another one closes', () => {
    const { state, made } = three();
    expect(closeTab(state, made[0]!).active.get('s1')).toBe(made[2]);
  });
});

describe('pin, unpin and move', () => {
  it('puts pinned tabs first, in the order they were pinned', () => {
    const { state, made } = three();
    const pinned = pinTab(pinTab(state, made[2]!), made[1]!);
    expect(ids(pinned, 's1')).toEqual([made[2], made[1], made[0]]);
    expect(ownerTabs(pinned, 's1').map((t) => t.position)).toEqual([0, 1, 2]);
    // Unpinned, a tab goes first among the others.
    expect(ids(unpinTab(pinned, made[2]!), 's1')).toEqual([made[1], made[2], made[0]]);
  });

  it('moves a tab only inside its group', () => {
    const { state, made } = three();
    const pinned = pinTab(state, made[2]!);
    // An unpinned tab can't go before a pinned one.
    expect(ids(moveTab(pinned, made[1]!, 0), 's1')).toEqual([made[2], made[1], made[0]]);
    // A pinned tab can't go after an unpinned one.
    expect(ids(moveTab(pinned, made[2]!, 5), 's1')).toEqual([made[2], made[0], made[1]]);
  });
});

describe('restore', () => {
  it('adds the saved pinned tabs in order, without a page, and keeps tabs already here', () => {
    const { state, made } = three();
    const restored = restore(state, [
      { id: 'p2', owner: 's1', url: 'https://p2.test/', title: 'P2', position: 1 },
      { id: 'p1', owner: 's1', url: 'https://p1.test/', title: '', position: 0 },
      { id: made[0]!, owner: 's1', url: 'https://changed.test/', title: 'x', position: 0 },
    ]);
    expect(ids(restored, 's1')).toEqual(['p1', 'p2', ...made]);
    const p1 = restored.tabs.find((t) => t.id === 'p1')!;
    expect(p1).toMatchObject({ pinned: true, lastShownAt: 0, title: 'https://p1.test/' });
    expect(restored.tabs.find((t) => t.id === made[0])!.url).toBe('https://a.test/');
    expect(livePages(restored)).not.toContain('p1');
  });
});

describe('livePages', () => {
  it('keeps the pages shown most recently', () => {
    let state = NO_TABS;
    const made: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = open(state, 's1', `https://${i}.test/`);
      state = r.state;
      made.push(r.id);
    }
    expect(livePages(state)).toEqual(made.slice(2).reverse());
  });
});

describe('rememberClosed and takeClosed', () => {
  it('brings back the last closed tab, of an owner when asked, one at a time', () => {
    const { state, made } = three();
    const [a, b, c] = made.map((id) => state.tabs.find((t) => t.id === id)!);
    const other = { ...a!, id: 'x', owner: BROWSER_OWNER };
    let closed = rememberClosed(rememberClosed(rememberClosed(rememberClosed([], a!), b!), other), c!);
    const first = takeClosed(closed);
    expect(first.tab?.id).toBe(c!.id);
    const browser = takeClosed(first.closed, BROWSER_OWNER);
    expect(browser.tab?.id).toBe('x');
    closed = browser.closed;
    expect(takeClosed(closed, 's1').tab?.id).toBe(b!.id);
    expect(takeClosed([], 's1').tab).toBeNull();
  });

  it('skips empty tabs and keeps only the newest', () => {
    const { state } = three();
    const tab = state.tabs[0]!;
    expect(rememberClosed([], { ...tab, url: null })).toEqual([]);
    let closed: readonly (typeof tab)[] = [];
    for (let i = 0; i < 30; i++) closed = rememberClosed(closed, { ...tab, id: `c${i}` });
    expect(closed).toHaveLength(25);
    expect(closed.at(-1)!.id).toBe('c29');
  });
});

describe('rowIndicators', () => {
  it('shows a terminal and one browser mark, however many tabs', () => {
    expect(rowIndicators({ terminal: false, tabs: 0 })).toEqual([]);
    expect(rowIndicators({ terminal: true, tabs: 0 })).toEqual(['terminal']);
    expect(rowIndicators({ terminal: true, tabs: 4 })).toEqual(['terminal', 'browser']);
    expect(rowIndicators({ terminal: false, tabs: 1 })).toEqual(['browser']);
  });
});
