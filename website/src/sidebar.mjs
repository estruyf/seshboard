// @ts-check
/**
 * The docs sidebar, grouped by what people want to do rather than by where it sits in the app. Every slug here
 * is a page in src/content/docs (or a page in src/pages for the two generated ones), and the features test
 * checks that features.json points at them. The All features page (features.mdx) is built from this list, so
 * a page added here shows up there too. Every group starts closed, so the list (and the menu on a phone) is a short
 * table of contents; Starlight opens the group of the page you are on.
 * @type {NonNullable<import('@astrojs/starlight/types').StarlightUserConfig['sidebar']>}
 */
export const sidebar = [
  'features',
  {
    label: 'Get started',
    collapsed: true,
    items: ['getting-started/install', 'getting-started/first-launch', 'getting-started/first-session', 'getting-started/next-steps', 'getting-started/windows', 'getting-started/linux'],
  },
  {
    label: 'Guides',
    collapsed: true,
    items: ['guides/parallel-sessions', 'guides/review-fast', 'guides/two-accounts', 'guides/from-your-phone', 'guides/repeat-less'],
  },
  {
    label: 'Start a session',
    collapsed: true,
    items: [
      'new-session/form',
      'new-session/models-and-options',
      'new-session/auto-model',
      'new-session/worktrees',
      'new-session/quick-questions',
      'new-session/queue',
      'new-session/schedules',
      'sessions/saved-prompts',
      'links',
    ],
  },
  {
    label: 'Stay on top',
    collapsed: true,
    items: ['sessions/sidebar', 'sessions/states', 'sessions/home', 'sessions/upcoming', 'sessions/catch-up', 'sessions/search', 'settings/notifications', 'focus-limit'],
  },
  {
    label: 'Inside a session',
    collapsed: true,
    items: [
      'sessions/conversation',
      'permissions',
      'sessions/ask',
      'sessions/linking',
      'sessions/pipelines',
      'sessions/github-issues',
      'sessions/agents',
      'sessions/commands',
      'sessions/mods',
      'terminal-changes-git/changes',
      'terminal-changes-git/git',
      'terminal-changes-git/terminal',
    ],
  },
  {
    label: 'Arrange your sessions',
    collapsed: true,
    items: ['sessions/split-view', 'sessions/own-window', 'sessions/pinned', 'sessions/archived', 'sessions/unsent-drafts'],
  },
  {
    label: 'Projects',
    collapsed: true,
    items: ['projects/projects-view', 'projects/clone-from-github', 'projects/overview', 'projects/sessions', 'projects/triggers', 'projects/worktrees', 'projects/branches', 'projects/memory', 'projects/actions', 'projects/settings'],
  },
  {
    label: 'Memory and knowledge',
    collapsed: true,
    items: ['memory/overview', 'memory/what-loads', 'memory/adding-memory', 'memory/links-and-search', 'memory/share-with-the-team', 'memory/personal-memory', 'memory/import', 'memory/health'],
  },
  {
    label: 'Accounts and usage',
    collapsed: true,
    items: ['settings/claude-profiles', 'usage'],
  },
  {
    label: 'Work from anywhere',
    collapsed: true,
    items: ['remote-access', 'other-computers', 'vscode-companion'],
  },
  {
    label: 'Make it yours',
    collapsed: true,
    items: ['themes/built-in', 'themes/custom', 'themes/syntax-colours', 'settings/backup'],
  },
  {
    label: 'Reference',
    collapsed: true,
    items: [
      'command-palette',
      { label: 'Keyboard shortcuts', link: '/keyboard-shortcuts/' },
      'settings',
      'settings/sessions',
      'settings/updates',
      'troubleshooting',
      { label: 'Changelog', link: '/changelog/' },
    ],
  },
];
