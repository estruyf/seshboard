import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ariaKeysFor,
  ariaShortcut,
  available,
  clickKeysFor,
  comboPresses,
  formatKeys,
  formatShortcut,
  isStoredShortcut,
  keysFor,
  localizeKeys,
  modKey,
  matches,
  normalizeShortcut,
  reservedShortcuts,
  sameShortcut,
  shortcutById,
  shortcutFromEvent,
  shortcutGlyphs,
  SHORTCUTS,
  spokenKeys,
  storedShortcut,
  type ShortcutContext,
  type ShortcutDef,
  type ShortcutId,
} from './shortcuts.ts';

const press = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key, ...mods });

describe('shortcuts', () => {
  it('tells a stored shortcut from glyphs', () => {
    expect(isStoredShortcut('cmd+enter')).toBe(true);
    expect(isStoredShortcut('escape')).toBe(true);
    expect(isStoredShortcut('⌘↵')).toBe(false);
    expect(isStoredShortcut('Esc')).toBe(false);
  });
  it('shows glyphs as given and formats a stored shortcut', () => {
    expect(shortcutGlyphs('⌘↵')).toBe('⌘↵');
    expect(shortcutGlyphs('cmd+shift+p')).toBe('⌘⇧P');
    expect(shortcutGlyphs('escape')).toBe('Esc');
  });
  it('reads glyphs back as a stored shortcut', () => {
    expect(storedShortcut('⌘↵')).toBe('cmd+enter');
    expect(storedShortcut('⌘⇧H')).toBe('cmd+shift+h');
    expect(storedShortcut('⌃1')).toBe('ctrl+1');
    expect(storedShortcut('⌘⌫')).toBe('cmd+backspace');
    expect(storedShortcut('Esc')).toBe('escape');
    expect(storedShortcut('cmd+n')).toBe('cmd+n');
  });
  it('spells a shortcut the way aria-keyshortcuts wants it', () => {
    expect(ariaShortcut('cmd+shift+p')).toBe('Meta+Shift+P');
    expect(ariaShortcut(storedShortcut('⌘↵'))).toBe('Meta+Enter');
    expect(ariaShortcut(storedShortcut('Esc'))).toBe('Escape');
    expect(ariaShortcut(storedShortcut('⌃1'))).toBe('Control+1');
  });
  it('records + and Space by name, so they can be shown and split', () => {
    expect(shortcutFromEvent(press('+', { metaKey: true, shiftKey: true }))).toBe('cmd+shift+plus');
    expect(shortcutFromEvent(press(' ', { metaKey: true }))).toBe('cmd+space');
    expect(formatShortcut('cmd+shift+plus')).toBe('⌘⇧+');
    expect(formatShortcut('cmd+space')).toBe('⌘Space');
    expect(ariaShortcut('cmd+shift+plus')).toBe('Meta+Shift+Plus');
    expect(ariaShortcut('cmd+space')).toBe('Meta+Space');
    expect(isStoredShortcut('cmd+space')).toBe(true);
    expect(storedShortcut('⌘+')).toBe('cmd+plus');
  });
  it('reads shortcuts saved before + and Space had names', () => {
    expect(normalizeShortcut('cmd+shift++')).toBe('cmd+shift+plus');
    expect(normalizeShortcut('cmd+ ')).toBe('cmd+space');
    expect(normalizeShortcut('cmd+k')).toBe('cmd+k');
    expect(formatShortcut('cmd+shift++')).toBe('⌘⇧+');
    expect(shortcutGlyphs('cmd+ ')).toBe('⌘Space');
    expect(sameShortcut('cmd+shift++', 'cmd+shift+plus')).toBe(true);
    expect(sameShortcut('cmd+k', 'cmd+j')).toBe(false);
  });
  it('treats punctuation keys as stored shortcuts', () => {
    expect(isStoredShortcut('cmd+,')).toBe(true);
    expect(shortcutGlyphs('cmd+\\')).toBe('⌘\\');
    expect(isStoredShortcut('⌘,')).toBe(false);
  });
  it('reserves the app and menu shortcuts', () => {
    for (const key of ['cmd+k', 'cmd+f', 'cmd+g', 'cmd+\\', 'cmd+,', 'cmd+shift+f', 'cmd+shift+h', 'cmd+shift+d', 'cmd+shift+l', 'cmd+enter']) expect(reservedShortcuts().has(key)).toBe(true);
    expect(reservedShortcuts().has(shortcutFromEvent(press('K', { metaKey: true }))!)).toBe(true);
    expect(reservedShortcuts().has(shortcutFromEvent(press(',', { metaKey: true }))!)).toBe(true);
    expect(reservedShortcuts().has('cmd+shift+b')).toBe(false);
  });
});

/** Nothing open, nothing going on: Home. */
const HOME: ShortcutContext = {
  view: 'home',
  session: false,
  running: false,
  pending: null,
  catchUp: null,
  selection: 0,
  split: false,
  behind: false,
  focus: 'other',
  terminal: { open: false, maximized: false, actionRunning: false },
};
const at = (patch: Partial<ShortcutContext>): ShortcutContext => ({ ...HOME, ...patch });
const SESSION = at({ view: 'session', session: true });

describe('the shortcut registry', () => {
  it('has unique ids, and keys in the stored form', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    for (const def of SHORTCUTS as readonly ShortcutDef[]) {
      for (const combo of def.keys) {
        for (const step of combo.split(' ')) {
          const press = step.replace(/(\d)\.\.\d$/, '$1').replace(/\+?(middle)?click$/, '').replace(/^$/, 'a');
          expect(isStoredShortcut(press), `${def.id}: ${combo}`).toBe(true);
        }
      }
    }
  });

  it('formats combos as macOS writes them', () => {
    expect(formatKeys('mod+shift+p')).toBe('⌘⇧P');
    expect(formatKeys('mod+k')).toBe('⌘K');
    expect(formatKeys('mod+1..9')).toBe('⌘1 to ⌘9');
    expect(formatKeys('1..9')).toBe('1 to 9');
    expect(formatKeys('mod+q mod+q')).toBe('⌘Q then ⌘Q');
    expect(formatKeys('alt+click')).toBe('⌥-click');
    expect(formatKeys('middleclick')).toBe('Middle-click');
    expect(formatKeys('ctrl+shift+tab')).toBe('⌃⇧⇥');
    expect(formatKeys('mod+\\')).toBe('⌘\\');
    expect(formatKeys('escape')).toBe('Esc');
    expect(formatKeys('shift+enter')).toBe('⇧↩');
    expect(formatKeys('f2')).toBe('F2');
  });

  it('says combos as words for screen readers', () => {
    expect(spokenKeys('mod+k')).toBe('Command, K');
    expect(spokenKeys('mod+shift+p')).toBe('Command, Shift, P');
    expect(spokenKeys('mod+q mod+q')).toBe('Command, Q then Command, Q');
    expect(spokenKeys('1..9')).toBe('1 to 9');
    expect(spokenKeys('alt+click')).toBe('Option, click');
    expect(spokenKeys('middleclick')).toBe('middle click');
  });

  it('reads mod as ⌘ everywhere a stored shortcut is read', () => {
    expect(normalizeShortcut('mod+shift+p')).toBe('cmd+shift+p');
    expect(sameShortcut('mod+j', 'cmd+j')).toBe(true);
    expect(keysFor('terminal.toggle')).toBe('cmd+j');
    expect(ariaKeysFor('palette.commands')).toBe('Meta+K Meta+Shift+P');
    expect(comboPresses('mod+1..3')).toEqual(['cmd+1', 'cmd+2', 'cmd+3']);
    expect(comboPresses('mod+q mod+q')).toEqual(['cmd+q']);
    expect(comboPresses('alt+click')).toEqual([]);
    expect(comboPresses('middleclick')).toEqual([]);
    expect(clickKeysFor('transcript.file-link-other')).toBe('shift+click');
    expect(formatKeys(clickKeysFor('transcript.file-link-other'))).toBe('⇧-click');
  });

  it('matches key presses to a shortcut and its alternatives', () => {
    expect(matches(press('k', { metaKey: true }), 'palette.commands')).toBe(true);
    expect(matches(press('P', { metaKey: true, shiftKey: true }), 'palette.commands')).toBe(true);
    expect(matches(press('p', { metaKey: true }), 'palette.commands')).toBe(false);
    expect(matches(press('k', { metaKey: true, ctrlKey: true }), 'palette.commands')).toBe(false);
    expect(matches(press('j', { metaKey: true }), 'terminal.toggle')).toBe(true);
    expect(matches(press('`', { ctrlKey: true }), 'terminal.toggle')).toBe(true);
    expect(matches(press('`', { metaKey: true }), 'terminal.toggle')).toBe(false);
    expect(matches(press('J', { metaKey: true, shiftKey: true }), 'terminal.toggle')).toBe(false);
    expect(matches(press('J', { metaKey: true, shiftKey: true }), 'terminal.maximize')).toBe(true);
    expect(matches(press('Tab', { ctrlKey: true }), 'session.next')).toBe(true);
    expect(matches(press('Tab', { ctrlKey: true, shiftKey: true }), 'session.next')).toBe(false);
    expect(matches(press('Tab', { ctrlKey: true, shiftKey: true }), 'session.previous')).toBe(true);
    expect(matches(press('Enter'), 'composer.send')).toBe(true);
    expect(matches(press('Enter', { metaKey: true }), 'composer.send')).toBe(true);
    expect(matches(press('Enter', { shiftKey: true }), 'composer.send')).toBe(false);
    expect(matches(press('Enter', { shiftKey: true }), 'composer.newline')).toBe(true);
    expect(matches(press('Enter', { ctrlKey: true }), 'permission.allow')).toBe(true);
    expect(matches(press('3'), 'permission.pick')).toBe(true);
    expect(matches(press('0'), 'permission.pick')).toBe(false);
    expect(matches(press('3', { metaKey: true }), 'new-session.pick')).toBe(true);
    expect(matches(press('\\', { metaKey: true }), 'pane.close-other')).toBe(true);
    expect(matches(press('X', { metaKey: true, shiftKey: true }), 'pane.swap')).toBe(true);
    expect(matches(press('O', { metaKey: true, shiftKey: true }), 'pane.orientation')).toBe(true);
    // Option changes the letter on a Mac (⌥W is ∑): the physical key counts.
    expect(matches({ ...press('∑', { metaKey: true, altKey: true }), code: 'KeyW' }, 'pane.close')).toBe(true);
    expect(matches(press('ArrowLeft', { metaKey: true, altKey: true }), 'pane.focus-left')).toBe(true);
    expect(matches(press('ArrowDown', { metaKey: true, altKey: true }), 'pane.focus-down')).toBe(true);
    // ⌥ with the arrows alone belongs to the queue and Up next.
    expect(matches(press('ArrowUp', { altKey: true }), 'pane.focus-up')).toBe(false);
    expect(matches(press('F2'), 'sidebar.rename')).toBe(true);
    expect(matches(press('Backspace', { metaKey: true }), 'sidebar.delete')).toBe(true);
    expect(matches(press('F10', { shiftKey: true }), 'context-menu')).toBe(true);
    expect(matches(press('g', { metaKey: true }), 'find.next')).toBe(true);
    expect(matches(press('G', { metaKey: true, shiftKey: true }), 'find.previous')).toBe(true);
    // ⌘/ is ⌘⇧7 on some keyboards: ⇧ doesn't count for a symbol.
    expect(matches(press('/', { metaKey: true }), 'shortcuts')).toBe(true);
    expect(matches(press('/', { metaKey: true, shiftKey: true }), 'shortcuts')).toBe(true);
    expect(matches(press('Shift', { shiftKey: true }), 'shortcuts')).toBe(false);
  });

  it('reserves every registry key with a modifier, and the menu bar', () => {
    for (const def of SHORTCUTS as readonly ShortcutDef[]) {
      if (def.reserve === false) continue;
      for (const press of def.keys.flatMap(comboPresses).filter((p) => p.includes('+'))) expect(reservedShortcuts().has(press), `${def.id}: ${press}`).toBe(true);
    }
    for (const key of ['cmd+/', 'cmd+shift+j', 'cmd+q', 'cmd+c', 'cmd+w', 'shift+tab']) expect(reservedShortcuts().has(key), key).toBe(true);
    // ⌘1 to ⌘9 only pick projects in New session, where actions don't run.
    expect(reservedShortcuts().has('cmd+1')).toBe(false);
    expect([...reservedShortcuts()].filter((k) => !k.includes('+'))).toEqual([]);
  });

  it('decides where each shortcut works', () => {
    // For every shortcut with a condition: a place it works, and one it doesn't.
    const cases: Partial<Record<ShortcutId, [works: ShortcutContext, doesnt: ShortcutContext]>> = {
      'sidebar.clear-selection': [at({ selection: 2 }), HOME],
      'pane.close': [at({ split: true }), HOME],
      'pane.close-other': [at({ split: true }), HOME],
      'pane.focus-left': [at({ split: true }), HOME],
      'pane.focus-right': [at({ split: true }), HOME],
      'pane.focus-up': [at({ split: true }), HOME],
      'pane.focus-down': [at({ split: true }), HOME],
      'pane.swap': [at({ split: true }), HOME],
      'pane.orientation': [at({ split: true }), HOME],
      find: [SESSION, { ...SESSION, focus: 'terminal' }],
      'find.next': [SESSION, HOME],
      'find.previous': [SESSION, HOME],
      'changes.toggle': [SESSION, at({ view: 'session' })],
      'agents.toggle': [SESSION, at({ view: 'session' })],
      'commands.toggle': [SESSION, at({ view: 'session' })],
      'ask.open': [SESSION, at({ view: 'session' })],
      'transcript.file-link-other': [SESSION, HOME],
      'transcript.run-send': [SESSION, HOME],
      'transcript.prompt-previous': [SESSION, { ...SESSION, focus: 'terminal' }],
      'transcript.prompt-next': [{ ...SESSION, focus: 'composer' }, HOME],
      'terminal.toggle': [at({ view: 'settings' }), at({ view: 'session', session: false })],
      'terminal.maximize': [at({ view: 'settings' }), at({ view: 'session', session: false })],
      'terminal.restore': [{ ...SESSION, terminal: { open: true, maximized: true, actionRunning: false } }, { ...SESSION, terminal: { open: true, maximized: false, actionRunning: false } }],
      'terminal.clear': [{ ...SESSION, terminal: { open: true, maximized: false, actionRunning: false } }, SESSION],
      'terminal.close-tab': [{ ...SESSION, terminal: { open: true, maximized: false, actionRunning: false } }, SESSION],
      'terminal.stop-action': [{ ...SESSION, terminal: { open: true, maximized: false, actionRunning: true } }, { ...SESSION, terminal: { open: true, maximized: false, actionRunning: false } }],
      'git.pull': [{ ...SESSION, behind: true }, SESSION],
      'pr.create': [SESSION, HOME],
      'session.new-window': [SESSION, HOME],
      'read.toggle': [SESSION, HOME],
      'projects.switch': [at({ view: 'project' }), { ...at({ view: 'project' }), focus: 'terminal' }],
      'projects.move': [at({ view: 'projects' }), HOME],
      'projects.find': [at({ view: 'project' }), SESSION],
      'projects.tab': [at({ view: 'project' }), at({ view: 'usage' })],
      'projects.switcher-settings': [at({ view: 'project' }), HOME],
      'read.previous': [SESSION, HOME],
      'read.next': [SESSION, HOME],
      'read.previous-heading': [SESSION, HOME],
      'read.next-heading': [SESSION, HOME],
      'read.bigger': [SESSION, HOME],
      'read.smaller': [SESSION, HOME],
      'read.reply': [SESSION, HOME],
      'editor.open': [SESSION, at({ view: 'new-session' })],
      'claude.stop': [{ ...SESSION, running: true }, SESSION],
      'composer.send-now': [{ ...SESSION, running: true }, SESSION],
      'composer.send-other': [{ ...SESSION, running: true }, SESSION],
      'upnext.edit': [{ ...SESSION, running: true }, SESSION],
      'upnext.move': [{ ...SESSION, running: true }, SESSION],
      'upnext.remove': [{ ...SESSION, running: true }, SESSION],
      'mode.cycle': [SESSION, HOME],
      'composer.send': [at({ view: 'new-session' }), HOME],
      'composer.newline': [SESSION, at({ view: 'settings' })],
      'composer.commands': [at({ view: 'new-session' }), at({ view: 'projects' })],
      'composer.mention': [SESSION, HOME],
      'composer.next-blank': [SESSION, HOME],
      'composer.previous-blank': [at({ view: 'new-session' }), HOME],
      'composer.history': [SESSION, at({ view: 'new-session' })],
      'composer.add-context': [at({ view: 'new-session' }), HOME],
      'composer.github': [SESSION, HOME],
      'composer.github-new-session': [at({ view: 'new-session' }), HOME],
      'permission.allow': [{ ...SESSION, pending: 'permission' }, SESSION],
      'permission.deny': [{ ...SESSION, pending: 'question' }, SESSION],
      'permission.pick': [{ ...SESSION, pending: 'question' }, { ...SESSION, pending: 'permission' }],
      'catchup.primary': [{ ...SESSION, catchUp: 'strip' }, SESSION],
      'catchup.close': [{ ...SESSION, catchUp: 'full' }, { ...at({ view: 'usage' }), catchUp: 'full' }],
      'catchup.review': [{ ...SESSION, catchUp: 'full' }, { ...SESSION, catchUp: 'strip' }],
      'catchup.commit': [{ ...SESSION, catchUp: 'full' }, { ...SESSION, catchUp: 'strip' }],
      'catchup.reply': [{ ...SESSION, catchUp: 'full' }, SESSION],
      'catchup.read': [{ ...SESSION, catchUp: 'full' }, SESSION],
      'catchup.archive': [{ ...SESSION, catchUp: 'full' }, SESSION],
      'catchup.expand': [{ ...SESSION, catchUp: 'strip' }, SESSION],
      'new-session.pick': [at({ view: 'new-session' }), SESSION],
      'new-session.find': [at({ view: 'new-session' }), { ...at({ view: 'new-session' }), focus: 'terminal' }],
      'new-session.start': [at({ view: 'new-session' }), SESSION],
      'new-session.queue': [at({ view: 'new-session' }), SESSION],
      'settings.close': [at({ view: 'settings' }), SESSION],
      'settings.search': [at({ view: 'settings' }), SESSION],
      'usage.limits': [at({ view: 'usage' }), SESSION],
      'usage.tokens': [at({ view: 'usage' }), at({ view: 'new-session' })],
      'usage.period': [at({ view: 'usage' }), HOME],
      'usage.back': [at({ view: 'usage' }), SESSION],
      'memory.save': [at({ view: 'project' }), SESSION],
    };
    const conditional = (SHORTCUTS as readonly ShortcutDef[]).filter((s) => s.when).map((s) => s.id);
    expect(Object.keys(cases).sort()).toEqual(conditional.sort());
    for (const [id, [works, doesnt]] of Object.entries(cases)) {
      expect(available(shortcutById(id as ShortcutId), works), `${id} works`).toBe(true);
      expect(available(shortcutById(id as ShortcutId), doesnt), `${id} doesn't`).toBe(false);
    }
    // The rest work anywhere.
    for (const def of (SHORTCUTS as readonly ShortcutDef[]).filter((s) => !s.when)) expect(available(def, HOME), def.id).toBe(true);
  });
});

/** Keys that are meant to do different things at the same time and place, and how they're told apart. */
const INTENDED_OVERLAPS: Record<string, string> = {
  escape: 'Esc closes or cancels what is nearest: a menu or dialog first, then a waiting card, then the message box stops Claude.',
  'cmd+enter': 'A waiting card takes ⌘↩ (Allow) before the message box sends; in New session the message box sending is starting the session. On a queued item in the sidebar it starts that item, which a waiting card never overlaps (the card has focus in the session). Create pull request is a dialog: while it is open, ⌘↩ is its own.',
  'cmd+k': 'In the terminal ⌘K clears it, as in Terminal; the palette is ⌘⇧P there.',
  'shift+tab': 'In the text of the message box ⇧⇥ switches the permission mode; on the blanks of a saved prompt (above that text) it goes to the previous blank.',
  'alt+enter': 'In the # list ⌥↩ starts a new session from the highlighted issue or pull request; with the list closed, while Claude works, it queues or steers the other way.',
};

describe('shortcut collisions', () => {
  const VIEWS: ShortcutContext['view'][] = ['home', 'new-session', 'session', 'settings', 'projects', 'project', 'usage'];
  const FOCUS: ShortcutContext['focus'][] = ['terminal', 'composer', 'other'];
  /** Every view and focus, with everything off and with everything on (the most shortcuts at once). */
  const contexts = VIEWS.flatMap((view) =>
    FOCUS.flatMap((focus): ShortcutContext[] => [
      at({ view, focus, session: view === 'session' }),
      { view, focus, session: view === 'session', running: true, pending: 'question', catchUp: 'full', selection: 2, split: true, behind: true, terminal: { open: true, maximized: true, actionRunning: true } },
    ]),
  );

  const overlaps = () => {
    const found = new Map<string, Set<string>>();
    for (const ctx of contexts) {
      const live = (SHORTCUTS as readonly ShortcutDef[]).filter((s) => available(s, ctx));
      for (const [i, a] of live.entries()) {
        for (const b of live.slice(i + 1)) {
          // Two places for focus never overlap; one shortcut without a place works wherever the other does.
          if (a.where && b.where && a.where !== b.where) continue;
          const keysA = new Set(a.keys.flatMap(comboPresses));
          for (const press of b.keys.flatMap(comboPresses).filter((p) => keysA.has(p))) {
            if (!found.has(press)) found.set(press, new Set());
            found.get(press)!.add([a.id, b.id].sort().join(' + '));
          }
        }
      }
    }
    return found;
  };

  it('no two shortcuts share keys where both work, except the intended overlaps', () => {
    const unintended = [...overlaps()].filter(([press]) => !INTENDED_OVERLAPS[press]).map(([press, pairs]) => `${press}: ${[...pairs].join(', ')}`);
    expect(unintended).toEqual([]);
  });

  it('every intended overlap still happens (so the list stays honest)', () => {
    const found = overlaps();
    for (const press of Object.keys(INTENDED_OVERLAPS)) expect(found.has(press), press).toBe(true);
  });

  it('on Windows, where mod is Ctrl, only the same overlaps happen', () => {
    vi.stubGlobal('window', { switchboard: { platform: 'win32' } });
    try {
      const intended = new Set(Object.keys(INTENDED_OVERLAPS).map((press) => press.replace(/^cmd\+/, 'ctrl+')));
      expect([...overlaps()].filter(([press]) => !intended.has(press)).map(([press, pairs]) => `${press}: ${[...pairs].join(', ')}`)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('shortcuts on Windows', () => {
  beforeEach(() => vi.stubGlobal('window', { switchboard: { platform: 'win32' } }));
  afterEach(() => vi.unstubAllGlobals());

  it('reads mod, and ⌘ saved on a Mac, as Ctrl', () => {
    expect(normalizeShortcut('mod+shift+p')).toBe('ctrl+shift+p');
    expect(normalizeShortcut('cmd+shift+t')).toBe('ctrl+shift+t');
    expect(normalizeShortcut('cmd+ctrl+f')).toBe('ctrl+f');
    expect(keysFor('palette.commands')).toBe('ctrl+k');
    expect(matches(press('k', { ctrlKey: true }), 'palette.commands')).toBe(true);
    expect(matches(press('k', { metaKey: true }), 'palette.commands')).toBe(false);
    expect(modKey({ metaKey: false, ctrlKey: true })).toBe(true);
  });

  it('writes keys as words joined with +', () => {
    expect(formatShortcut('mod+shift+p')).toBe('Ctrl+Shift+P');
    expect(formatKeys('mod+q mod+q')).toBe('Ctrl+Q then Ctrl+Q');
    expect(formatKeys('mod+1..9')).toBe('Ctrl+1 to Ctrl+9');
    expect(formatKeys('alt+click')).toBe('Alt+click');
    expect(formatKeys(clickKeysFor('transcript.file-link-other'))).toBe('Shift+click');
    expect(formatKeys('mod+enter')).toBe('Ctrl+Enter');
    expect(spokenKeys('mod+enter')).toBe('Control, Enter');
    expect(ariaShortcut('mod+k')).toBe('Control+K');
  });

  it('writes glyphs typed for a button or hint the same way', () => {
    expect(shortcutGlyphs('⌘↵')).toBe('Ctrl+Enter');
    expect(localizeKeys('⌘⇧L')).toBe('Ctrl+Shift+L');
    expect(localizeKeys('⌘⌫')).toBe('Ctrl+Backspace');
    expect(localizeKeys('⌥')).toBe('Alt');
    expect(localizeKeys('Click to open · ⌥-click to open beside')).toBe('Click to open · Alt+click to open beside');
    expect(localizeKeys('⌘, or ⇧')).toBe('Ctrl, or Shift');
    // Names and paths in a hint keep their own plus signs.
    expect(localizeKeys('src/c++ · repo+ · a+-click')).toBe('src/c++ · repo+ · a+-click');
    expect(shortcutGlyphs('Esc')).toBe('Esc');
  });

  it("reserves Windows' menu keys", () => {
    expect(reservedShortcuts().has('ctrl+k')).toBe(true);
    expect(reservedShortcuts().has('ctrl+y')).toBe(true);
    expect(reservedShortcuts().has('f11')).toBe(true);
    expect(reservedShortcuts().has('cmd+k')).toBe(false);
  });
});
