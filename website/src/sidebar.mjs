// @ts-check
/**
 * The docs sidebar, grouped like the app. Every slug here is a page in src/content/docs (or a page in
 * src/pages for the two generated ones), and the features test checks that features.json points at them.
 * @type {NonNullable<import('@astrojs/starlight/types').StarlightUserConfig['sidebar']>}
 */
export const sidebar = [
  {
    label: 'Getting started',
    items: ['getting-started/install', 'getting-started/first-launch', 'getting-started/first-session', 'getting-started/windows'],
  },
  {
    label: 'Sessions',
    items: [
      'sessions/sidebar',
      'sessions/states',
      'sessions/catch-up',
      'sessions/conversation',
      'sessions/side-questions',
      'sessions/home',
      'sessions/search',
      'sessions/split-view',
      'sessions/pinned',
      'sessions/archived',
      'sessions/unsent-drafts',
    ],
  },
  {
    label: 'New session',
    items: ['new-session/form', 'new-session/models-and-options', 'new-session/auto-model', 'new-session/worktrees', 'new-session/quick-questions', 'new-session/queue'],
  },
  'command-palette',
  { label: 'Keyboard shortcuts', link: '/keyboard-shortcuts/' },
  {
    label: 'Projects',
    items: ['projects/projects-view', 'projects/overview', 'projects/sessions', 'projects/worktrees', 'projects/branches', 'projects/memory', 'projects/actions', 'projects/settings'],
  },
  {
    label: 'Memory and knowledge',
    items: ['memory/overview', 'memory/what-loads', 'memory/adding-memory', 'memory/links-and-search', 'memory/share-with-the-team', 'memory/personal-memory', 'memory/import', 'memory/health'],
  },
  {
    label: 'Terminal, changes and git',
    items: ['terminal-changes-git/terminal', 'terminal-changes-git/changes', 'terminal-changes-git/git'],
  },
  'permissions',
  'focus-limit',
  'usage',
  {
    label: 'Themes',
    items: ['themes/built-in', 'themes/custom', 'themes/syntax-colours'],
  },
  {
    label: 'Settings',
    items: ['settings', 'settings/sessions', 'settings/notifications', 'settings/claude-profiles', 'settings/updates', 'settings/backup'],
  },
  'vscode-companion',
  'links',
  'troubleshooting',
  { label: 'Changelog', link: '/changelog/' },
];
