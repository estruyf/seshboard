/**
 * The monkey: one random step at a time (a click, a shortcut, a palette command, typing, a drag, Escape…), weighted
 * towards what is on screen, plus the inputs the fuzzing uses. Every choice comes from the run's seeded `rng`.
 */
import { escapeCheck } from './checks.ts';
import { type Chaos, sleep } from './harness.ts';
import { focusInTerminal, targets } from './ui.ts';

/** MAX_PROMPT_LENGTH in packages/protocol/src/promptConstants.ts. */
export const MAX_PROMPT_LENGTH = 1_000_000;

/** Odd text for every field: blank, emoji, RTL, invisible and control characters, markup, paths, `@` and `/`. */
export function fuzzStrings(c: Chaos): string[] {
  const home = c.world.home;
  return [
    '',
    ' ',
    '     ',
    '\n\n\n',
    'a',
    '👩‍👩‍👧‍👦🏳️‍🌈🧑🏽‍💻',
    'مرحبا بالعالم שלום',
    'Z̷̢̛͔a̵̧͎l̴̨͝g̸͚̈o̶̡͝',
    '\u200b\u200c\u200d\ufeff',
    '\u202eevil.txt\u202c',
    'nul\u0000byte',
    'bell\u0007esc\u001b[31mred',
    'lone \ud800 surrogate',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '{{ constructor.constructor("return 1")() }}',
    '${process.env.HOME}',
    '```js\nunclosed fence',
    '**bold _italic `code',
    '[link](javascript:alert(1))',
    '| a | b |\n|---|',
    './relative/path',
    '../../..',
    `${home}/Developer/acme-store/../../../..`,
    `${home}/does not exist/ünïcødé`,
    `${home}/Developer/acme-store/package.json`,
    `${home}/${'deep/'.repeat(60)}`,
    '@',
    '@src/',
    '@nonexistent-file-xyz',
    '/',
    '/nonexistent-command',
    '/btw what is this?',
    '/comp',
    '   leading and trailing   ',
    'x'.repeat(2_001),
    `${'line\n'.repeat(30)}`,
  ];
}

/** Long text for the message box: around MAX_PROMPT_LENGTH, 2 MB, and a 5,000-line fenced block. */
export function longInputs(): Array<[string, string]> {
  return [
    ['under-max', 'x'.repeat(MAX_PROMPT_LENGTH - 1)],
    ['at-max', 'x'.repeat(MAX_PROMPT_LENGTH)],
    ['over-max', 'x'.repeat(MAX_PROMPT_LENGTH + 1)],
    ['2mb', 'y'.repeat(2 * 1024 * 1024)],
    ['5000-line-fence', `\`\`\`ts\n${Array.from({ length: 5000 }, (_, i) => `const v${i} = ${i};`).join('\n')}\n\`\`\``],
  ];
}

/** Shortcuts the monkey may press (macOS forms). Never ⌘Q, ⌘O (opens an editor) or ⌘W (closes the window). */
export const SHORTCUTS = [
  'Meta+N', 'Meta+Shift+N', 'Meta+K', 'Meta+Shift+P', 'Meta+P', 'Meta+Shift+F', 'Meta+Shift+H', 'Meta+/', 'Meta+B',
  'Control+Tab', 'Control+Shift+Tab', 'Meta+Shift+U', 'Meta+A', 'F2', 'Meta+Backspace', 'Alt+ArrowUp', 'Alt+ArrowDown',
  'Shift+F10', 'Meta+Backslash', 'Meta+F', 'Meta+G', 'Meta+Shift+G', 'Meta+Shift+D', 'Meta+J', 'Control+Backquote',
  'Meta+Shift+J', 'Meta+Shift+L', 'Meta+Enter', 'Meta+S', 'Meta+Shift+Enter', 'Alt+Enter', 'Shift+Tab', 'Meta+Shift+A',
  'Meta+1', 'Meta+2', 'Meta+3', 'Meta+E', 'Meta+Shift+T', 'Meta+Equal', 'Meta+Minus', 'Meta+0', 'Meta+Comma', '1', '2', 'Backspace',
] as const;

/** Palette command titles to type (a few letters of each), none that quits or opens real apps. */
export const PALETTE_WORDS = [
  'New session', 'Quick question', 'Go to', 'Next session', 'Toggle sidebar', 'Minimize sidebar', 'Home', 'Usage', 'Search', 'Settings',
  'Compact', 'Large', 'Appearance', 'Theme', 'Projects', 'Worktrees', 'Branches', 'Memory', 'Clean up', 'Rename', 'Reload skills',
  'Export settings', 'Diagnostics', 'Shortcuts', 'Focus', 'Notifications', 'Sounds', 'Unsent', 'Queue', 'Pin', 'Archive', 'Fork',
  'Rewind', 'Model', 'Effort', 'Mode', 'Ask about', 'Copy', 'Terminal', 'Changes', 'Tools', 'Close', 'Delete', 'Stop', 'Commit',
  'Pull request', 'Sync', 'Switch branch', 'Stage all', 'Revert all', 'Finish worktree', 'Edit actions', 'Run:', 'Dock', 'Maximize',
  'Other pane', 'Worktree', 'Save defaults', 'Update from remote', 'Remember', 'Check transcript', 'Add context',
];

/** One random step. Never types into a terminal (a shell would run it) and never presses Enter there. */
export async function monkeyStep(c: Chaos): Promise<void> {
  const r = c.rng;
  const kind = r.weighted([
    [34, 'click'],
    [14, 'shortcut'],
    [7, 'palette'],
    [10, 'type'],
    [6, 'escape'],
    [5, 'tab'],
    [5, 'arrow'],
    [3, 'enter'],
    [4, 'context'],
    [3, 'multiclick'],
    [3, 'drag'],
    [3, 'hover'],
    [3, 'scroll'],
    [4, 'escape-check'],
  ] as const);
  const p = c.page;
  switch (kind) {
    case 'click':
    case 'context':
    case 'multiclick':
    case 'hover': {
      const all = await targets(c);
      if (!all.length) return;
      const inside = all.filter((t) => t.inOverlay);
      const pool = inside.length && r.chance(0.8) ? inside : all;
      const t = r.pick(pool);
      if (kind === 'click') {
        c.log('click', t.desc, [Math.round(t.x), Math.round(t.y)]);
        await p.mouse.click(t.x, t.y);
      } else if (kind === 'context') {
        if (r.chance(0.7)) {
          c.log('right-click', t.desc);
          await p.mouse.click(t.x, t.y, { button: 'right' });
        } else {
          c.log('focus+shift-f10', t.desc);
          await p.mouse.click(t.x, t.y);
          await p.keyboard.press('Shift+F10');
        }
      } else if (kind === 'multiclick') {
        const n = r.pick([2, 3]);
        c.log(n === 2 ? 'dblclick' : 'tripleclick', t.desc);
        await p.mouse.click(t.x, t.y, { clickCount: n });
      } else {
        c.log('hover', t.desc);
        await p.mouse.move(t.x, t.y, { steps: 3 });
      }
      return;
    }
    case 'shortcut': {
      const key = r.pick(SHORTCUTS);
      if ((key === 'Backspace' || key === '1' || key === '2') && (await focusInTerminal(c))) return;
      c.log('press', key);
      await p.keyboard.press(key);
      return;
    }
    case 'palette': {
      const word = r.pick(PALETTE_WORDS);
      const typed = word.slice(0, r.int(2, word.length));
      c.log('palette', typed);
      await p.keyboard.press('Meta+Shift+P');
      await sleep(60);
      await p.keyboard.type(typed, { delay: 5 });
      if (r.chance(0.6)) {
        for (let i = r.int(0, 3); i > 0; i--) await p.keyboard.press('ArrowDown');
        c.log('press', 'Enter (palette)');
        await p.keyboard.press('Enter');
      }
      return;
    }
    case 'type': {
      if (await focusInTerminal(c)) return; // never type into a shell
      const text = r.chance(0.5) ? r.pick(fuzzStrings(c)) : r.pick(['hello', 'fix the bug', 'abc', 'Rename me', '42', 'test ']);
      const editable = await p.evaluate(() => !!document.activeElement?.matches('input, textarea, [contenteditable="true"]')).catch(() => false);
      c.log(editable ? 'type' : 'type-unfocused', 'activeElement', text);
      if (text.length > 200 || r.chance(0.3)) await p.keyboard.insertText(text);
      else await p.keyboard.type(text, { delay: 2 });
      return;
    }
    case 'escape':
      c.log('press', 'Escape');
      await p.keyboard.press('Escape');
      return;
    case 'tab': {
      const key = r.chance(0.7) ? 'Tab' : 'Shift+Tab';
      c.log('press', key);
      await p.keyboard.press(key);
      return;
    }
    case 'arrow': {
      const key = r.pick(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown']);
      c.log('press', key);
      await p.keyboard.press(key);
      return;
    }
    case 'enter': {
      if (await focusInTerminal(c)) return;
      c.log('press', 'Enter');
      await p.keyboard.press('Enter');
      return;
    }
    case 'drag': {
      const handles = await p
        .evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-sidebar-resize], [data-changes-resize], [data-terminal-resize], [data-session-id], [data-action-pill], [data-queue-item]')]
            .map((el) => ({ r: el.getBoundingClientRect(), d: [...el.attributes].find((a) => a.name.startsWith('data-'))?.name ?? el.tagName }))
            .filter(({ r }) => r.width > 0 && r.height > 0)
            .map(({ r, d }) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, d })),
        )
        .catch(() => []);
      if (!handles.length) return;
      const h = r.pick(handles);
      const dx = r.int(-600, 600);
      const dy = r.int(-400, 400);
      c.log('drag', h.d, [Math.round(h.x), Math.round(h.y), dx, dy]);
      await p.mouse.move(h.x, h.y);
      await p.mouse.down();
      await p.mouse.move(h.x + dx / 2, h.y + dy / 2, { steps: 4 });
      if (r.chance(0.15)) {
        c.log('press', 'Escape (mid-drag)');
        await p.keyboard.press('Escape');
      }
      await p.mouse.move(h.x + dx, h.y + dy, { steps: 4 });
      await p.mouse.up();
      return;
    }
    case 'scroll': {
      const dy = r.int(-2500, 2500);
      c.log('wheel', '', dy);
      await p.mouse.move(r.int(100, 1400), r.int(80, 850));
      await p.mouse.wheel(0, dy);
      return;
    }
    case 'escape-check':
      await escapeCheck(c);
      return;
  }
}
