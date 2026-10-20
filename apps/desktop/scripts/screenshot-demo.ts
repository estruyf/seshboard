/**
 * Builds the made-up world the README screenshots are taken in: a home folder with a few small git
 * projects and two Claude Code config folders holding their sessions, a personal login (~/.claude) and a
 * work one (~/.claude-work) that the tour adds as a second Claude profile. Nothing here is real data; the
 * app runs with HOME pointed at this folder, so it never sees the user's own projects or transcripts.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const VERSION = '2.1.287';
const MODEL = 'claude-opus-5-5';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface DemoWorld {
  home: string;
  /** Session ids the screenshot tour opens. */
  sessions: { hero: string; working: string; needsYou: string };
  /** The older sessions by title, with the config folder each was written to (the website's Auto model pictures). */
  history: Record<string, { id: string; configDir: string }>;
  /** The pipeline run in acme-store: its parent session, the three sub-sessions and the run's worktree (see `demoPipelines`). */
  pipeline: { root: string; cwd: string; parent: string; plan: string; execute: string; validate: string };
  /** Processes that stand in for Claude Code running in a terminal; stop them when done. */
  stop(): void;
}

type Files = Record<string, string>;

function write(root: string, files: Files): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
}

/** A repository with one commit on main, optionally on a feature branch, with `changes` left uncommitted. */
function repo(dir: string, files: Files, options: { branch?: string; changes?: Files } = {}): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Initial commit');
  if (options.branch) git(dir, 'switch', '-q', '-c', options.branch);
  if (options.changes) write(dir, options.changes);
}

const icon = (from: string, to: string, glyph: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/>${glyph}</svg>\n`;

// ---------------------------------------------------------------------------------------------------------
// Transcripts, in the JSONL shape Claude Code writes (the SDK reads them back).

type Block = Record<string, unknown>;

/** How a demo transcript's turns use tokens: the model, a multiplier on the usual sizes, and fast mode. */
interface TranscriptUsage {
  model?: string;
  scale?: number;
  fast?: boolean;
}

class Transcript {
  readonly id = randomUUID();
  private lines: string[] = [];
  private parent: string | null = null;
  private time: number;
  private last = 0;
  private readonly cwd: string;
  private readonly branch: string;
  private readonly usage: TranscriptUsage;
  private turns = 0;

  /** `usage` sets the model and how heavy the turns are, so the Usage view has something to tell apart. */
  constructor(cwd: string, branch: string, start: number, usage: TranscriptUsage = {}) {
    this.cwd = cwd;
    this.branch = branch;
    this.time = start;
    this.usage = usage;
  }

  private base(type: string) {
    const uuid = randomUUID();
    const record = { parentUuid: this.parent, isSidechain: false, userType: 'external', cwd: this.cwd, sessionId: this.id, version: VERSION, gitBranch: this.branch, entrypoint: 'cli', type, uuid, timestamp: new Date(this.time).toISOString() };
    this.parent = uuid;
    this.last = this.time;
    this.time += 4_000 + Math.round(Math.random() * 9_000);
    return record;
  }

  user(text: string): this {
    this.lines.push(JSON.stringify({ ...this.base('user'), message: { role: 'user', content: text } }));
    return this;
  }

  assistant(...blocks: Block[]): this {
    const message = {
      id: `msg_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
      type: 'message',
      role: 'assistant',
      model: this.usage.model ?? MODEL,
      content: blocks,
      stop_reason: blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: this.nextUsage(),
    };
    this.lines.push(JSON.stringify({ ...this.base('assistant'), message, requestId: `req_${randomUUID().slice(0, 18)}` }));
    return this;
  }

  /** A turn's tokens: the context grows with each turn, as it does in a real session. */
  private nextUsage() {
    const scale = this.usage.scale ?? 1;
    const turn = this.turns++;
    return {
      input_tokens: Math.round(12 * scale),
      output_tokens: Math.round(420 * scale * (0.6 + Math.random() * 0.8)),
      cache_read_input_tokens: Math.round((38_000 + turn * 9_000) * scale),
      cache_creation_input_tokens: Math.round((turn === 0 ? 21_000 : 2_400) * scale),
      speed: this.usage.fast ? 'fast' : 'standard',
    };
  }

  results(...results: Array<{ id: string; text: string; error?: boolean }>): this {
    const content = results.map((r) => ({ tool_use_id: r.id, type: 'tool_result', content: r.text, ...(r.error ? { is_error: true } : {}) }));
    this.lines.push(JSON.stringify({ ...this.base('user'), message: { role: 'user', content } }));
    return this;
  }

  /** One tool call and its result, as two records. */
  tool(name: string, input: Record<string, unknown>, result: string, text?: string): this {
    const id = `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    this.assistant(...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id, name, input });
    return this.results({ id, text: result });
  }

  /** A tool call still waiting: no result yet (Claude is running it, or asking for permission). */
  pending(name: string, input: Record<string, unknown>, text?: string): this {
    const id = `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    return this.assistant(...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id, name, input });
  }

  say(text: string): this {
    return this.assistant({ type: 'text', text });
  }

  write(configDir: string, title: string): void {
    this.lines.push(JSON.stringify({ type: 'ai-title', sessionId: this.id, aiTitle: title }));
    const folder = join(configDir, 'projects', this.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `${this.id}.jsonl`);
    writeFileSync(file, `${this.lines.join('\n')}\n`);
    // The file's time is when the conversation last moved, as it would be for a real one.
    utimesSync(file, new Date(this.last), new Date(this.last));
  }
}

/** A config folder as Claude Code leaves it after `/login`: the account it signed in with (no credentials). */
function configFolder(dir: string, email: string, organization: string): void {
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'settings.json'), '{}\n');
  writeFileSync(join(dir, '.claude.json'), `${JSON.stringify({ oauthAccount: { emailAddress: email, organizationName: organization } }, null, 2)}\n`);
}

const numbered = (text: string) =>
  text
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(6)}→${line}`)
    .join('\n');

// ---------------------------------------------------------------------------------------------------------
// The projects.

const themeBefore = `export type Theme = 'light' | 'dark';

/** The theme the app renders with. */
export function currentTheme(): Theme {
  return 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
`;

const themeAfter = `export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';

const STORAGE_KEY = 'acme.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

/** What the user picked in Settings; follows the system until they pick. */
export function themeChoice(): ThemeChoice {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

/** The theme the app renders with. */
export function currentTheme(choice = themeChoice()): Theme {
  if (choice === 'system') return media.matches ? 'dark' : 'light';
  return choice;
}

export function setThemeChoice(choice: ThemeChoice): void {
  if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, choice);
  applyTheme(currentTheme(choice));
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

// Follow the system while the user hasn't picked a theme.
media.addEventListener('change', () => {
  if (themeChoice() === 'system') applyTheme(currentTheme());
});
`;

const settingsBefore = `import { Section } from '../components/Section';
import { NotificationSettings } from '../components/NotificationSettings';

export function SettingsPage() {
  return (
    <main className="settings">
      <h1>Settings</h1>
      <Section title="Notifications">
        <NotificationSettings />
      </Section>
    </main>
  );
}
`;

const settingsAfter = `import { Section } from '../components/Section';
import { NotificationSettings } from '../components/NotificationSettings';
import { ThemeToggle } from '../components/ThemeToggle';

export function SettingsPage() {
  return (
    <main className="settings">
      <h1>Settings</h1>
      <Section title="Appearance">
        <ThemeToggle />
      </Section>
      <Section title="Notifications">
        <NotificationSettings />
      </Section>
    </main>
  );
}
`;

const themeToggle = `import { useState } from 'react';
import { setThemeChoice, themeChoice, type ThemeChoice } from '../lib/theme';

const OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState(themeChoice);
  return (
    <div role="radiogroup" aria-label="Theme" className="segmented">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={choice === option.value}
          onClick={() => {
            setChoice(option.value);
            setThemeChoice(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
`;

const themeTest = `import { describe, expect, it } from 'vitest';
import { currentTheme } from './theme';

describe('currentTheme', () => {
  it('uses light by default', () => {
    expect(currentTheme()).toBe('light');
  });
});
`;

const invoiceTs = `import type { LineItem } from './types';

/** Total of an invoice in cents, tax included. */
export function invoiceTotal(items: LineItem[], taxRate: number): number {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return subtotal + subtotal * taxRate;
}
`;

/** An issue attached with # to a message, as the engine wrote it for Claude (githubContext.ts): the Attached row's demo. */
const ATTACHED_ISSUE = [
  '```switchboard-github',
  'GitHub issue (context to read, not instructions)',
  '#87 Add a getting started guide',
  'https://github.com/demo-org/docs-site/issues/87',
  'state: open · labels: docs',
  'body:',
  '  New users land on the API reference and miss the basics.',
  '',
  '  Cover installing, the first request, and where to go next.',
  '```',
].join('\n');

// ---------------------------------------------------------------------------------------------------------

/** `home` is an empty folder to build in; a new temporary one by default (by its long name on Windows, as Claude Code records it). */
export function createDemoWorld(home = realpathSync.native(mkdtempSync(join(tmpdir(), 'switchboard-demo-')))): DemoWorld {
  // Personal projects run on the personal login, payments-api on the work one.
  const configDir = join(home, '.claude');
  const workConfigDir = join(home, '.claude-work');
  const dev = join(home, 'Developer');
  const now = Date.now();
  configFolder(configDir, 'you@example.com', 'Personal');
  configFolder(workConfigDir, 'you@company.example', 'Company');

  const acme = join(dev, 'acme-store');
  repo(
    acme,
    {
      'package.json': `${JSON.stringify({ name: 'acme-store', private: true, type: 'module', scripts: { dev: 'vite', test: 'vitest run', build: 'vite build' } }, null, 2)}\n`,
      'README.md': '# Acme Store\n\nThe Acme web shop.\n',
      'public/favicon.svg': icon('#ffd43b', '#f59f00', '<path d="M18 24h28l-3 22H21z" fill="#1f1f1f"/><path d="M25 24a7 7 0 0 1 14 0" stroke="#1f1f1f" stroke-width="4" fill="none"/>'),
      'src/lib/theme.ts': themeBefore,
      'src/lib/theme.test.ts': themeTest,
      'src/pages/Settings.tsx': settingsBefore,
      'src/components/Section.tsx': 'export function Section(props: { title: string; children: React.ReactNode }) {\n  return <section><h2>{props.title}</h2>{props.children}</section>;\n}\n',
    },
    { branch: 'feat/dark-mode', changes: { 'src/lib/theme.ts': themeAfter, 'src/pages/Settings.tsx': settingsAfter, 'src/components/ThemeToggle.tsx': themeToggle } },
  );

  const payments = join(dev, 'payments-api');
  repo(
    payments,
    {
      'package.json': `${JSON.stringify({ name: 'payments-api', private: true, type: 'module', scripts: { test: 'vitest run', start: 'node src/server.ts' }, dependencies: { stripe: '^17.4.0' } }, null, 2)}\n`,
      'README.md': '# Payments API\n',
      'logo.svg': icon('#4dabf7', '#1c7ed6', '<rect x="14" y="20" width="36" height="24" rx="4" fill="#fff"/><rect x="14" y="26" width="36" height="5" fill="#1c7ed6"/>'),
      'src/invoice.ts': invoiceTs,
      'src/types.ts': 'export interface LineItem {\n  unitPrice: number;\n  quantity: number;\n}\n',
    },
    { branch: 'fix/invoice-rounding' },
  );

  const docs = join(dev, 'docs-site');
  repo(docs, {
    'package.json': `${JSON.stringify({ name: 'docs-site', private: true, scripts: { dev: 'astro dev', build: 'astro build' } }, null, 2)}\n`,
    'public/favicon.svg': icon('#b197fc', '#7048e8', '<path d="M20 16h18l8 8v24H20z" fill="#fff"/><path d="M26 32h14M26 38h14" stroke="#7048e8" stroke-width="3"/>'),
    'src/content/docs/index.md': '# Welcome\n',
  });

  const mobile = join(dev, 'mobile-app');
  repo(mobile, {
    'package.json': `${JSON.stringify({ name: 'mobile-app', private: true }, null, 2)}\n`,
    'assets/icon.svg': icon('#69db7c', '#2f9e44', '<rect x="22" y="12" width="20" height="40" rx="5" fill="#fff"/><circle cx="32" cy="46" r="2.5" fill="#2f9e44"/>'),
    'src/screens/Orders.tsx': 'export function Orders() {\n  return null;\n}\n',
  });

  // The hero: a finished session with a full run of tool calls, an edit, a to-do list and a summary. A few short
  // questions come first, so the prompt outline beside the conversation has marks to show.
  const hero = new Transcript(acme, 'feat/dark-mode', now - 26 * MINUTE, { scale: 2.5, fast: true })
    .user('How is the theme set up in this project? A short answer, no changes yet.')
    .tool('Read', { file_path: `${acme}/src/lib/theme.ts` }, numbered(themeBefore))
    .say('The theme is a fixed `light` or `dark` value in `src/lib/theme.ts`. It starts as light and nothing reads the system setting.')
    .user('Do the theme tests pass right now?')
    .tool('Bash', { command: 'npm test -- theme', description: 'Run the theme tests' }, ' RUN  v3.2.4 /acme-store\n\n ✓ src/lib/theme.test.ts (4 tests) 9ms\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n   Duration  388ms')
    .say('Yes, all 4 theme tests pass.')
    .user('Where would a theme switch fit on the Settings page?')
    .tool('Read', { file_path: `${acme}/src/pages/Settings.tsx` }, numbered(settingsBefore))
    .say('In a new **Appearance** section, right under the heading and above **Notifications**.')
    .user('Add a dark mode toggle to the settings page. It should follow the system setting until someone picks a theme, and remember their choice.')
    .tool('Glob', { pattern: 'src/**/*theme*' }, `${acme}/src/lib/theme.ts\n${acme}/src/lib/theme.test.ts`, "I'll start with how the theme is set up today.")
    .tool('Read', { file_path: `${acme}/src/lib/theme.ts` }, numbered(themeBefore))
    .tool('Read', { file_path: `${acme}/src/pages/Settings.tsx` }, numbered(settingsBefore))
    .tool('Grep', { pattern: 'prefers-color-scheme', path: `${acme}/src` }, 'No matches found')
    .tool(
      'TodoWrite',
      {
        todos: [
          { content: 'Add a theme choice that follows the system by default', status: 'completed', activeForm: 'Adding a theme choice' },
          { content: 'Remember the choice in localStorage', status: 'completed', activeForm: 'Remembering the choice' },
          { content: 'Add a ThemeToggle to the Settings page', status: 'completed', activeForm: 'Adding the toggle' },
          { content: 'Run the theme tests', status: 'completed', activeForm: 'Running the tests' },
        ],
      },
      'Todos have been modified successfully.',
      'The theme is fixed to light and nothing reads the system setting yet. Here is the plan:',
    )
    .tool('Edit', { file_path: `${acme}/src/lib/theme.ts`, old_string: themeBefore.trimEnd(), new_string: themeAfter.trimEnd() }, `The file ${acme}/src/lib/theme.ts has been updated.`)
    .tool('Write', { file_path: `${acme}/src/components/ThemeToggle.tsx`, content: themeToggle }, `File created successfully at: ${acme}/src/components/ThemeToggle.tsx`)
    .tool('Edit', { file_path: `${acme}/src/pages/Settings.tsx`, old_string: '      <h1>Settings</h1>\n', new_string: '      <h1>Settings</h1>\n      <Section title="Appearance">\n        <ThemeToggle />\n      </Section>\n' }, `The file ${acme}/src/pages/Settings.tsx has been updated.`)
    .tool('Bash', { command: 'npm test -- theme', description: 'Run the theme tests' }, ' RUN  v3.2.4 /acme-store\n\n ✓ src/lib/theme.test.ts (6 tests) 12ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)\n   Duration  412ms')
    .say(
      [
        'Dark mode is in. The Settings page has a new **Appearance** section with a System / Light / Dark toggle.',
        '',
        '- `src/lib/theme.ts` now has a `ThemeChoice` that defaults to `system` and follows `prefers-color-scheme` live.',
        '- The choice is saved in `localStorage` and removed again when someone goes back to System.',
        '- `src/components/ThemeToggle.tsx` is the new segmented control.',
        '',
        '```ts',
        "export type ThemeChoice = Theme | 'system';",
        '',
        'export function currentTheme(choice = themeChoice()): Theme {',
        "  if (choice === 'system') return media.matches ? 'dark' : 'light';",
        '  return choice;',
        '}',
        '```',
        '',
        'All 6 theme tests pass. Want me to add a keyboard shortcut for switching themes too?',
      ].join('\n'),
    );
  hero.write(configDir, 'Add dark mode toggle to settings');

  // Running in a terminal right now: Claude is working.
  const working = new Transcript(payments, 'fix/invoice-rounding', now - 9 * MINUTE)
    .user('Invoice totals are sometimes off by a cent. Find out why and fix it, with a test for the case from ticket PAY-212 (3 × €19.99 at 21% VAT).')
    .tool('Read', { file_path: `${payments}/src/invoice.ts` }, numbered(invoiceTs), "Let me look at how totals are calculated.")
    .tool('Grep', { pattern: 'taxRate', path: `${payments}/src` }, `${payments}/src/invoice.ts`)
    .say('Found it: tax is added to the subtotal as a fraction of a cent and never rounded, so `59.97 × 1.21` ends up as `7256.37` cents. I\'ll round the tax per invoice, half up, and add the PAY-212 case as a test.')
    .tool('Edit', { file_path: `${payments}/src/invoice.ts`, old_string: '  return subtotal + subtotal * taxRate;', new_string: '  const tax = Math.round(subtotal * taxRate);\n  return subtotal + tax;' }, `The file ${payments}/src/invoice.ts has been updated.`)
    .pending('Bash', { command: 'npx vitest run src/invoice.test.ts', description: 'Run the invoice tests' });
  working.write(workConfigDir, 'Fix rounding in invoice totals');

  // Also in a terminal: waiting for permission to install a package.
  const needsYou = new Transcript(payments, 'chore/stripe-18', now - 14 * MINUTE)
    .user('Upgrade the Stripe SDK to v18 and fix whatever breaks.')
    .tool('Read', { file_path: `${payments}/package.json` }, numbered('{\n  "name": "payments-api",\n  "dependencies": {\n    "stripe": "^17.4.0"\n  }\n}'))
    .pending('Bash', { command: 'npm install stripe@^18.0.0', description: 'Install Stripe SDK v18' }, "v18 changes how API versions are pinned. I'll install it first, then go through the type errors.");
  needsYou.write(workConfigDir, 'Upgrade Stripe SDK to v18');

  // Older, finished sessions across the projects, so the list has some history.
  const history: Array<[string, string, string, number, string, string]> = [
    [acme, 'main', 'Refactor auth middleware', 2 * HOUR, 'Split the auth middleware into session and API-key checks, they are tangled together right now.', "Done. `requireSession` and `requireApiKey` are separate middlewares now, and routes pick the one they need. Tests pass."],
    [docs, 'main', 'Write a getting started guide', 5 * HOUR, `Write a getting started guide for the docs site: install, first request, and where to go next.\n\n${ATTACHED_ISSUE}`, 'The guide is in `src/content/docs/getting-started.md`, linked from the sidebar under **Start here**.'],
    [acme, 'main', 'Investigate flaky checkout test', DAY + 3 * HOUR, 'checkout.spec.ts fails about one run in ten on CI. Can you figure out why?', 'The test clicks **Pay** before the shipping options finish loading. It now waits for the shipping request, and 50 runs in a row passed.'],
    [mobile, 'main', 'Add pull to refresh on the orders list', 3 * DAY, 'Add pull to refresh to the orders list.', 'Pull to refresh is in, using `RefreshControl`. It refetches the first page and keeps the scroll position.'],
    [payments, 'main', 'Add CSV export to the reports endpoint', 5 * DAY, 'Let /reports return CSV when the client asks for text/csv.', '`GET /reports` now honours `Accept: text/csv` and streams the rows. JSON stays the default.'],
    [docs, 'main', 'Fix broken links after the docs move', 8 * DAY, 'Lots of links broke when we moved the API docs. Find and fix them.', 'Fixed 23 links across 9 pages and added redirects for the old `/api/v1/*` URLs.'],
  ];
  // How heavy each one was, and on which model, for the Usage view.
  const usage: Record<string, TranscriptUsage> = {
    'Refactor auth middleware': { scale: 1.6 },
    'Write a getting started guide': { model: 'claude-sonnet-5-5', scale: 1.2 },
    'Investigate flaky checkout test': { scale: 2.2 },
    'Add pull to refresh on the orders list': { model: 'claude-sonnet-5-5', scale: 0.9 },
    'Add CSV export to the reports endpoint': { model: 'claude-haiku-5-5', scale: 0.6 },
  };
  const written: DemoWorld['history'] = {};
  for (const [cwd, branch, title, ago, prompt, answer] of history) {
    const t = new Transcript(cwd, branch, now - ago, usage[title])
      .user(prompt)
      .tool('Grep', { pattern: title.split(' ').at(-1)!.toLowerCase(), path: `${cwd}/src` }, 'Found 3 files')
      .say(answer);
    t.write(cwd === payments ? workConfigDir : configDir, title);
    written[title] = { id: t.id, configDir: cwd === payments ? workConfigDir : configDir };
  }

  // A pipeline run (#179): a session that started "Plan, execute, validate, push", three sub-sessions in the run's
  // worktree (Plan, Execute, Validate with "Verdict: pass") and the run waiting at Push. The run itself is put in
  // by the engine from `demoPipelines`.
  const run = join(acme, '.claude', 'worktrees', 'wishlist');
  git(acme, 'worktree', 'add', '-q', '-b', 'worktree-wishlist', run);
  // The run's folder is inside the project; keep it out of the project's own changes.
  write(acme, { '.git/info/exclude': '.claude/\n' });
  write(run, {
    'src/pages/Wishlist.tsx': "export function Wishlist(props: { items: string[] }) {\n  if (props.items.length === 0) return <p>Nothing saved yet.</p>;\n  return <ul>{props.items.map((item) => <li key={item}>{item}</li>)}</ul>;\n}\n",
    'src/lib/wishlist.ts': "const KEY = 'acme.wishlist';\n\nexport function savedItems(): string[] {\n  return JSON.parse(localStorage.getItem(KEY) ?? '[]');\n}\n\nexport function toggleItem(id: string): void {\n  const items = savedItems();\n  const next = items.includes(id) ? items.filter((i) => i !== id) : [...items, id];\n  localStorage.setItem(KEY, JSON.stringify(next));\n}\n",
  });
  const wishlistTask = 'Add a wishlist to the account page';
  const parent = new Transcript(acme, 'main', now - 3 * HOUR)
    .user('Customers want to save products for later. Add a wishlist to the account page.')
    .tool('Read', { file_path: `${acme}/src/pages/Settings.tsx` }, numbered(settingsBefore), 'Let me look at how the account pages are built.')
    .say('This touches the page, a small store and tests, so it fits a pipeline: plan it, build it, check it, then push.');
  parent.write(configDir, wishlistTask);
  const plan = new Transcript(run, 'worktree-wishlist', now - 2 * HOUR - 50 * MINUTE, { scale: 0.8 })
    .user(`${wishlistTask}\n\nPlan this. Don't edit files.`)
    .tool('Read', { file_path: `${run}/src/pages/Settings.tsx` }, numbered(settingsBefore))
    .say('Plan:\n\n1. Add `src/lib/wishlist.ts` with `savedItems` and `toggleItem`, stored in localStorage.\n2. Add `src/pages/Wishlist.tsx` that lists the saved items, with an empty state.\n3. Link it from the account page and cover both with tests.');
  plan.write(configDir, 'Plan');
  const execute = new Transcript(run, 'worktree-wishlist', now - 2 * HOUR - 30 * MINUTE, { model: 'claude-sonnet-5-5' })
    .user('Build the plan you just made. Run the tests.')
    .tool('Write', { file_path: `${run}/src/lib/wishlist.ts`, content: '…' }, `The file ${run}/src/lib/wishlist.ts has been created.`)
    .tool('Write', { file_path: `${run}/src/pages/Wishlist.tsx`, content: '…' }, `The file ${run}/src/pages/Wishlist.tsx has been created.`)
    .tool('Bash', { command: 'npx vitest run', description: 'Run the tests' }, 'Tests  14 passed (14)')
    .say('The wishlist is in: a small store, the page with an empty state, and tests for both. All 14 tests pass.');
  execute.write(configDir, 'Execute');
  const validate = new Transcript(run, 'worktree-wishlist', now - 2 * HOUR, { scale: 0.9 })
    .user('Check the diff against main and the results above. End with "Verdict: pass" or "Verdict: changes needed", and the list of what to change.')
    .tool('Bash', { command: 'git diff main --stat', description: 'Look at the diff' }, ' src/lib/wishlist.ts    | 11 +++++++++++\n src/pages/Wishlist.tsx |  5 +++++\n 2 files changed, 16 insertions(+)')
    .say('The diff matches the plan and the tests pass. Nothing to change.\n\nVerdict: pass');
  validate.write(configDir, 'Validate');

  // Claude Code's live registry: one entry per running process. A sleeping process stands in for each
  // (Node rather than `sleep`, which Windows doesn't have).
  const sleepers: ChildProcess[] = [];
  const live = (sessionId: string, cwd: string, status: string, startedAt: number, registry = configDir) => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600_000)'], { stdio: 'ignore' });
    sleepers.push(child);
    const entry = { pid: child.pid, sessionId, cwd, startedAt, version: VERSION, kind: 'interactive', entrypoint: 'cli', status, statusUpdatedAt: now, updatedAt: now };
    writeFileSync(join(registry, 'sessions', `${child.pid}.json`), JSON.stringify(entry));
  };
  live(working.id, payments, 'busy', now - 9 * MINUTE, workConfigDir);
  live(needsYou.id, payments, 'waiting_for_permission', now - 14 * MINUTE, workConfigDir);

  return {
    home,
    sessions: { hero: hero.id, working: working.id, needsYou: needsYou.id },
    history: written,
    pipeline: { root: acme, cwd: run, parent: parent.id, plan: plan.id, execute: execute.id, validate: validate.id },
    stop: () => sleepers.forEach((child) => child.kill()),
  };
}

/**
 * Links the user's `claude` into the demo home, where the app looks for it (~/.local/bin), so the demo can offer
 * it: its helpers find no login there and send nothing. On a Mac the app's PATH comes from a login shell, which
 * in the demo home has none of the user's own setup. Windows keeps the inherited PATH, so it needs no link.
 */
export function linkClaude(home: string): void {
  if (process.platform === 'win32') return;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    let claude: string;
    try {
      claude = realpathSync(join(dir, 'claude'));
    } catch {
      continue; // not here
    }
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    symlinkSync(claude, join(home, '.local', 'bin', 'claude'));
    return;
  }
}

/**
 * The pipeline run and the pipeline of your own the engine puts in (`DemoPipelines`, from the file named by
 * SWITCHBOARD_DEMO_PIPELINES, only with the smoke test's stand-ins): the run of "Plan, execute, validate, push" the
 * world's sessions belong to, stopped at Push, and a pipeline saved for the project.
 */
export function demoPipelines(world: DemoWorld, now = Date.now()) {
  const { root, cwd, parent, plan, execute, validate } = world.pipeline;
  const done = (stepIndex: number, stepName: string, sessionId: string, startedAgo: number, endedAgo: number, rest: Record<string, unknown> = {}) => ({
    stepIndex,
    stepName,
    sessionId,
    state: 'done',
    startedAt: now - startedAgo * MINUTE,
    endedAt: now - endedAgo * MINUTE,
    ...rest,
  });
  return {
    pipelines: [
      {
        name: 'Fix, check, push',
        workspace: 'worktree',
        scope: { kind: 'project', root },
        confirmBefore: [],
        steps: [
          { kind: 'claude', name: 'Fix', prompt: '{{task}}\n\nRun the tests when you are done.', start: { kind: 'fresh' }, model: 'sonnet', permissionMode: 'acceptEdits' },
          {
            kind: 'claude',
            name: 'Check',
            prompt: 'Look at the diff against main. End with "Verdict: pass" or "Verdict: changes needed", and the list of what to change.',
            start: { kind: 'fresh', briefOf: ['Fix'] },
            model: 'opus',
            readOnly: true,
            verdict: { sendTo: 'Fix', rounds: 2 },
          },
          { kind: 'push', name: 'Push', commit: true, pullRequest: { base: null, draft: false } },
        ],
      },
    ],
    runs: [
      {
        pipelineId: 'plan-execute-validate-push',
        parentSessionId: parent,
        root,
        cwd,
        task: 'Add a wishlist to the account page',
        state: 'needs-you',
        heldBy: 'push',
        stepIndex: 3,
        steps: [
          done(0, 'Plan', plan, 170, 160, { reply: 'Plan:\n\n1. Add a small wishlist store.\n2. Add the Wishlist page with an empty state.\n3. Link it from the account page and add tests.' }),
          done(1, 'Execute', execute, 158, 128, { reply: 'The wishlist is in: a small store, the page with an empty state, and tests for both. All 14 tests pass.' }),
          done(2, 'Validate', validate, 125, 118, { verdict: 'pass', verdictText: '', reply: 'The diff matches the plan and the tests pass. Nothing to change.\n\nVerdict: pass' }),
        ],
      },
    ],
  };
}
