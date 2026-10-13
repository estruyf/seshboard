import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import { trashName } from '../../lib/platform.ts';
import type { SettingEntry } from './searchSettings.ts';

/**
 * Everything Settings' search can find, page by page in the order of the Settings list. Labels and the
 * lines under them are the ones the page shows; `keywords` are the other words people search for.
 * A new setting gets an entry here; the smoke test opens every entry and checks it lands on its setting.
 * Built when called, so shortcuts and the Trash's name match the platform.
 */
export function settingsIndex(): SettingEntry[] {
  const quit = formatKeys(keysFor('quit'));
  const trash = trashName();
  return [
    // General
    { id: 'startup', page: 'general', label: 'On startup', detail: 'What Switchboard shows when it opens: Home, the last session or New session.', keywords: 'launch open start', target: '[data-startup-view]' },
    {
      id: 'project-order',
      page: 'general',
      label: 'Project order',
      detail: 'How New session, Home and the command palette list your projects: the ones you used last first, or the order you set in Projects.',
      keywords: 'sort recent your order',
      target: '[data-project-order]',
    },
    {
      id: 'new-session-mode',
      page: 'general',
      label: 'Permission mode',
      detail: 'What New session starts in. A project’s or profile’s own default comes first, and a link never starts in Auto mode.',
      keywords: 'new session default ask first accept edits plan auto mode permissions',
      target: '[data-new-session-mode]',
    },
    { id: 'confirm-quit', page: 'general', label: 'Ask before quitting', detail: `${quit} shows a prompt first; pressing ${quit} again quits.`, keywords: 'quit exit close confirm', target: '[data-confirm-quit]' },

    // Theme
    { id: 'appearance', page: 'theme', label: 'Appearance', detail: 'Match System, Light or Dark.', keywords: 'dark mode light mode night colour color scheme', target: '[data-color-scheme]' },
    { id: 'theme', page: 'theme', label: 'Theme', detail: 'Colours for the app, the code blocks and the terminal. Themes are JSON files you can share.', keywords: 'color colors palette syntax', target: '[data-theme-picker]' },
    { id: 'theme-import', page: 'theme', label: 'Import…', detail: 'Add a theme from a .json file.', keywords: 'theme file json drop', target: '[data-theme-import]' },
    { id: 'theme-folder', page: 'theme', label: 'Open themes folder', detail: 'Where imported themes are kept.', keywords: 'theme files', target: '[data-theme-folder]' },

    // Sidebar
    { id: 'sidebar-style', page: 'sidebar', label: 'Sidebar style', detail: 'Large icons, Standard or Compact. Large icons makes each session’s project easy to spot.', keywords: 'density rows size', target: '[data-sidebar-style]' },
    {
      id: 'sidebar-collapsed',
      page: 'sidebar',
      label: 'When collapsed',
      detail: `What ${formatKeys(keysFor('sidebar.toggle'))} and the sidebar button do: a narrow rail of project icons, or hide the sidebar.`,
      keywords: 'minimal rail hidden hide collapse',
      target: '[data-sidebar-collapsed]',
    },
    {
      id: 'session-scope',
      page: 'sidebar',
      label: 'Show sessions from other apps',
      detail: 'Also list sessions from Terminal, Claude desktop and your editor. Off shows only sessions you started or continued in Switchboard.',
      keywords: 'external vs code all sessions',
      target: '[data-session-scope]',
    },

    // Sessions
    {
      id: 'auto-archive',
      page: 'sessions',
      label: 'Archive finished sessions after',
      detail: 'Working, needs you, unread and pinned sessions stay in the list. New activity brings a session back.',
      keywords: 'archived days old clean up',
      target: '[data-auto-archive-value]',
    },
    {
      id: 'auto-delete',
      page: 'sessions',
      label: 'Delete archived sessions',
      detail: `An archived session goes to the ${trash} after the days you set. Pinned and working sessions, and ones with a queued prompt or an unsent message, are kept.`,
      keywords: 'remove trash recycle bin clean up disk space old',
      target: '[data-auto-delete]',
    },
    {
      id: 'claude-cleanup',
      page: 'sessions',
      label: 'Claude Code’s own cleanup',
      detail: 'Claude Code deletes old transcripts on its own, after the days set in each profile (cleanupPeriodDays).',
      keywords: 'cleanupPeriodDays transcripts delete',
      target: '[data-claude-cleanup]',
      fallback: '[data-sessions-settings]',
    },
    { id: 'all-sessions', page: 'sessions', label: 'All sessions', detail: 'Every session, grouped by month, with filters. Unarchive them or move them to the ' + trash + '.', keywords: 'manage overview table disk size unarchive', target: '[data-session-manager]' },

    // Conversation
    {
      id: 'tool-activity',
      page: 'conversation',
      label: 'Tool activity',
      detail: 'Summarised shows each run of tool calls as one line, like Claude Code. Every step shows each one.',
      keywords: 'summarised summarized every step tools steps',
      target: '[data-tool-activity]',
    },
    {
      id: 'while-working',
      page: 'conversation',
      label: 'Enter',
      detail: `Queue holds your message in Up next until Claude finishes the turn. Steer gives it to Claude now, and Claude reads it at its next step. ${formatKeys(keysFor('composer.send-now'))} always stops Claude and sends at once.`,
      keywords: 'while working queue steer message send busy up next',
      target: '[data-while-working]',
    },
    { id: 'auto-model', page: 'conversation', label: 'Auto model', detail: 'Shows Auto in the model menu. Haiku reads only your prompt, never your files or memory.', keywords: 'automatic routing pick choose', target: '[data-auto-model-enabled]' },
    { id: 'auto-model-allowed', page: 'conversation', label: 'Models it can pick', detail: 'Haiku, Sonnet and Opus. At least one.', keywords: 'auto model', target: '[data-auto-model-allowed]' },
    { id: 'auto-model-lean', page: 'conversation', label: 'When in doubt', detail: 'Which way to lean on a close call: Cheaper, Balanced or Stronger.', keywords: 'auto model cost', target: '[data-auto-model-lean]' },
    { id: 'auto-model-suggest', page: 'conversation', label: 'Suggest a stronger model later', detail: 'When a session grows past its first prompt. Never switches by itself.', keywords: 'auto model upgrade', target: '[data-auto-model-suggest]' },

    // Focus
    { id: 'focus-limit', page: 'focus', label: 'Focus limit', detail: 'Ask before going over a set number of sessions.', keywords: 'at once concurrent maximum', target: '[data-focus-limit-switch]' },
    {
      id: 'focus-limit-count',
      page: 'focus',
      label: 'Sessions at the same time',
      detail: 'Working, waiting for you, or finished but not read yet.',
      keywords: 'focus limit number maximum',
      target: '[data-focus-limit-value]',
      fallback: '[data-focus-limit-switch]',
    },
    { id: 'focus-mode', page: 'focus', label: 'When you reach it', detail: 'Nudge asks first. Strict waits until you finish, settle or stop one.', keywords: 'focus limit nudge strict', target: '[data-focus-mode]', fallback: '[data-focus-limit-switch]' },
    {
      id: 'focus-external',
      page: 'focus',
      label: 'Count terminal and IDE sessions',
      detail: 'Also count live Claude Code sessions started outside Switchboard.',
      keywords: 'focus limit external vs code',
      target: '[data-focus-count-external]',
      fallback: '[data-focus-limit-switch]',
    },

    // Claude profiles
    {
      id: 'profiles',
      page: 'profiles',
      label: 'Claude profiles',
      detail: 'Use more than one Claude account, for example a personal plan and a work one. Each profile is a Claude Code config folder with its own login.',
      keywords: 'accounts login work personal config folder',
      target: '[data-profiles]',
    },
    {
      id: 'profile-defaults',
      page: 'profiles',
      label: 'New session defaults',
      detail: 'The model, effort, permission mode and workspace new sessions with a profile start with, unless their project sets its own.',
      keywords: 'account model effort permissions mode worktree default',
      target: '[data-profile-defaults-toggle]',
      fallback: '[data-profiles]',
    },
    { id: 'add-profile', page: 'profiles', label: 'Add profile', detail: 'A Claude Code config folder with its own login.', keywords: 'account new', target: '[data-add-profile]', fallback: '[data-profiles]' },
    { id: 'profile-guide', page: 'profiles', label: 'How to set up another profile', detail: 'Create a config folder and sign in, add it here, and link your projects.', keywords: 'account help', target: '[data-profile-guide-toggle]' },

    // Memory
    {
      id: 'memory-personal',
      page: 'memory',
      label: 'Personal memory',
      detail: 'Loads in every project. Plain Markdown in a folder you choose (iCloud, Dropbox, git).',
      keywords: 'claude.md folder sync',
      target: '[data-memory-personal]',
      fallback: '[data-settings-page="memory"] section',
    },
    { id: 'memory-folder', page: 'memory', label: 'Change folder…', detail: 'Where your personal memory is kept.', keywords: 'memory location move', target: '[data-memory-change-folder]', fallback: '[data-settings-page="memory"] section' },
    { id: 'memory-list', page: 'memory', label: 'Personal memories', detail: 'Memory about you and how you like to work.', keywords: 'notes preferences', target: '[data-memory-personal-list]', fallback: '[data-settings-page="memory"] section' },
    { id: 'memory-import', page: 'memory', label: 'Import from Claude export…', detail: 'Bring in what the Claude app remembers about you.', keywords: 'claude.ai', target: '[data-memory-import-export]', fallback: '[data-settings-page="memory"] section' },
    { id: 'memory-paste', page: 'memory', label: 'Paste from Claude app…', keywords: 'claude.ai import', target: '[data-memory-paste-app]', fallback: '[data-settings-page="memory"] section' },
    { id: 'memory-copy', page: 'memory', label: 'Copy for Claude app…', keywords: 'claude.ai export', target: '[data-memory-copy-for-app]', fallback: '[data-settings-page="memory"] section' },

    // VS Code
    {
      id: 'companion',
      page: 'vscode',
      label: 'VS Code',
      detail: 'The Switchboard extension sends what you’re looking at in the editor to a session, as chips above the message box.',
      keywords: 'cursor windsurf extension editor companion ide',
      target: '[data-companion-settings]',
    },
    { id: 'companion-install', page: 'vscode', label: 'Visual Studio Marketplace', detail: 'Install the Switchboard extension.', keywords: 'install download extension open vsx cursor windsurf', target: '[data-companion-link="marketplace"]' },

    // Backup
    { id: 'backup-export', page: 'backup', label: 'Export settings', detail: 'Choose what to include and save it to a file.', keywords: 'backup save move another computer', target: '[data-backup-export]' },
    { id: 'backup-import', page: 'backup', label: 'Import settings', detail: 'See what a file would change before anything happens. Your current settings are backed up first.', keywords: 'restore backup', target: '[data-backup-import]' },

    // Diagnostics
    { id: 'diagnostics-engine', page: 'diagnostics', label: 'Engine', detail: 'Status, round trip and engine version.', keywords: 'ping health', target: '[data-diagnostics-card="Engine"]' },
    { id: 'diagnostics-claude', page: 'diagnostics', label: 'Claude Code', detail: 'Binary, config folder and shell environment.', keywords: 'path version env', target: '[data-diagnostics-card="Claude Code"]' },
    { id: 'diagnostics-log', page: 'diagnostics', label: 'Engine log', detail: 'What the engine did recently.', keywords: 'logs errors debug', target: '[data-diagnostics-card="Engine log"]' },

    // About
    { id: 'version', page: 'about', label: 'Switchboard', detail: 'The version you run, its release notes and the changelog.', keywords: 'version release notes changelog', target: '[data-app-version]' },
    { id: 'check-updates', page: 'about', label: 'Check for Updates', detail: 'See if there is a newer Switchboard.', keywords: 'update upgrade new version', target: '[data-check-updates]' },
    { id: 'auto-update', page: 'about', label: 'Check for updates automatically', detail: 'Shortly after Switchboard opens, then every few hours. Nothing downloads until you choose to.', keywords: 'update', target: '[data-auto-update]' },
    { id: 'update-channel', page: 'about', label: 'Channel', detail: 'Stable: published releases. Nightly: pre-release builds as they are published.', keywords: 'update nightly stable beta pre-release', target: '[data-update-channel]' },
    { id: 'claude-updates', page: 'about', label: 'Claude Code', detail: 'The Claude Code you have, and updating it.', keywords: 'cli version update install', target: '[data-claude-updates]', fallback: '[data-about]' },
    {
      id: 'claude-auto-update',
      page: 'about',
      label: 'Check for Claude Code updates automatically',
      detail: 'Shortly after Switchboard opens, then every few hours. Nothing is installed until you choose Update.',
      keywords: 'cli update',
      target: '[data-claude-update-auto]',
      fallback: '[data-about]',
    },
  ];
}
