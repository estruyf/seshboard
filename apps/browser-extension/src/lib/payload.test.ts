import { describe, expect, it } from 'vitest';
import type { CompanionSession } from '@seshboard/protocol/companion-client';
import { badgeText, consoleItem, screenshotImage, defaultTarget, filterTargets, menuDefault, pageItems, shortTitle, targetOptions, targetSummary } from './payload.ts';

const session = (id: string, status: CompanionSession['status'] = 'idle', title = `Session ${id}`): CompanionSession => ({ id, title, cwd: '/work/web', projectRoot: '/work/web', branch: null, status, updatedAt: 0, inApp: true });
const page = { url: 'https://github.com/acme/web/issues/412', title: 'Checkout fails #412', selection: '  The total goes negative.  ' };

describe('pageItems', () => {
  it('sends the selection with its page, and the page itself', () => {
    expect(pageItems(page, { selection: true, page: true })).toEqual([
      { kind: 'text', source: 'page', label: 'Selection on Checkout fails #412', text: 'The total goes negative.\n\nFrom Checkout fails #412 (https://github.com/acme/web/issues/412)' },
      { kind: 'text', source: 'page', label: 'Checkout fails #412', text: 'Checkout fails #412\nhttps://github.com/acme/web/issues/412' },
    ]);
  });

  it('leaves out an empty selection, and names a page without a title by its host', () => {
    expect(pageItems({ url: 'http://localhost:5173/cart', title: '', selection: ' ' }, { selection: true, page: true })).toEqual([{ kind: 'text', source: 'page', label: 'localhost:5173', text: 'http://localhost:5173/cart\nhttp://localhost:5173/cart' }]);
    expect(pageItems(page, { selection: false, page: false })).toEqual([]);
  });

  it('cuts long titles', () => {
    expect(shortTitle('a'.repeat(70))).toHaveLength(60);
    expect(shortTitle(' Two\n words ')).toBe('Two words');
  });
});

describe('targets', () => {
  const projects = [
    { root: '/work/api', name: 'api' },
    { root: '/work/web', name: 'web' },
  ];

  it('lists the session on screen first, then New session in each project with the matched one first', () => {
    const options = targetOptions([session('a'), session('b')], session('b'), projects, '/work/web');
    expect(options.map((o) => [targetSummary(o), o.tag])).toEqual([
      ['Session b', 'On screen'],
      ['Session a', null],
      ['New session in web', 'This page'],
      ['New session in api', null],
    ]);
    expect(options[0]!.detail).toBe('web');
    expect(options[2]!.target).toEqual({ kind: 'new', cwd: '/work/web' });
  });

  it('filters by every word typed, in the label, the folder or the tag', () => {
    const options = targetOptions([session('a', 'needs-you', 'Fix the login form'), session('b', 'idle', 'Joke request')], null, projects, null);
    expect(filterTargets(options, '').length).toBe(4);
    expect(filterTargets(options, 'LOGIN fix').map((o) => o.label)).toEqual(['Fix the login form']);
    expect(filterTargets(options, 'needs').map((o) => o.label)).toEqual(['Fix the login form']);
    expect(filterTargets(options, 'new api').map((o) => o.value)).toEqual(['new:/work/api']);
    expect(filterTargets(options, '/work/web').map((o) => o.value)).toEqual(['new:/work/web']);
    expect(filterTargets(options, 'nothing like it')).toEqual([]);
  });

  it('starts on the page’s project, else the session on screen, else the first', () => {
    const options = targetOptions([session('a')], null, projects, null);
    expect(defaultTarget(options, session('a'), '/work/web')).toBe('new:/work/web');
    expect(defaultTarget(options, session('a'), null)).toBe('session:a');
    expect(defaultTarget(options, null, null)).toBe('session:a');
    expect(defaultTarget([], null, null)).toBeNull();
  });

  it('starts the right-click panel on the session on screen, or on New session in the page’s project', () => {
    const options = targetOptions([session('a')], session('a'), projects, '/work/web');
    expect(menuDefault('send', options, session('a'), '/work/web')).toBe('session:a');
    expect(menuDefault('send', options, null, '/work/web')).toBe('new:/work/web');
    expect(menuDefault('start', options, session('a'), '/work/web')).toBe('new:/work/web');
    expect(menuDefault('start', options, session('a'), null)).toBeNull();
  });

  it('counts the sessions waiting on you for the badge', () => {
    expect(badgeText([session('a', 'needs-you'), session('b', 'working')])).toBe('1');
    expect(badgeText([])).toBe('');
    expect(badgeText(Array.from({ length: 12 }, (_, i) => session(String(i), 'needs-you')))).toBe('9+');
  });
});

describe('console errors and screenshots', () => {
  it('lists the errors in one chip, the most recent last', () => {
    const at = Date.UTC(2026, 10, 27, 9, 30, 5);
    expect(consoleItem([], { url: 'http://localhost:5173/' })).toBeNull();
    expect(
      consoleItem(
        [
          { kind: 'error', message: 'Cart total is NaN', at },
          { kind: 'network', message: 'POST http://localhost:5173/api/orders → 422 Unprocessable Entity', at },
        ],
        { url: 'http://localhost:5173/cart' },
      ),
    ).toEqual({
      kind: 'text',
      source: 'console',
      label: 'Console errors on localhost:5173 (2)',
      language: 'text',
      text: 'Errors in the console of http://localhost:5173/cart:\n\n[09:30:05] error: Cart total is NaN\n[09:30:05] network: POST http://localhost:5173/api/orders → 422 Unprocessable Entity',
    });
  });

  it('turns a captured tab into an image for the message box', () => {
    expect(screenshotImage('data:image/jpeg;base64,AAAA', { url: 'http://localhost:5173/cart' })).toEqual({ type: 'image', mediaType: 'image/jpeg', data: 'AAAA', name: 'localhost-5173.jpg' });
    expect(screenshotImage('not a data url', { url: 'https://x.dev' })).toBeNull();
  });
});
