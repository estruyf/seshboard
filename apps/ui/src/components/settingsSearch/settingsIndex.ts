import { clickKeysFor, formatKeys, keysFor } from '../../lib/shortcuts.ts';
import { fileManagerName, trashName } from '../../lib/platform.ts';
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

    // Projects
    {
      id: 'project-order',
      page: 'projects',
      label: 'Project order',
      detail: 'How New session, Home and the command palette list your projects: the ones you used last first, or the order you set in Projects.',
      keywords: 'sort recent your order',
      target: '[data-project-order]',
    },
    {
      id: 'clone-github',
      page: 'projects',
      label: 'Clone from GitHub',
      detail: 'Start a project from a GitHub URL. New session clones it into the folder below, adds it to your projects and runs your first prompt there.',
      keywords: 'git clone repository repo url download',
      target: '[data-clone-enabled]',
    },
    { id: 'clone-folder', page: 'projects', label: 'Clone into', detail: 'The folder new projects go in, such as ~/Developer.', keywords: 'clone folder developer code location', target: '[data-clone-folder-choose]' },

    // Mods
    {
      id: 'show-mods',
      page: 'mods',
      label: 'Show mods',
      detail: "Bands, panes, statuses, toasts and replaced views from your plugins. Off, sessions use only Switchboard's own views.",
      keywords: 'mods plugins panes status line statusline bands toasts ui surfaces extensions',
      target: '[data-show-mods]',
    },
    {
      id: 'mods-list',
      page: 'mods',
      label: 'Mods',
      detail: 'Each mod from your enabled plugins, with a switch that shows or hides its UI here.',
      keywords: 'mods plugins panes status line hide show ui enabledPlugins managed marketplace',
      target: '[data-mods-list]',
      fallback: '[data-mods-settings]',
    },

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
      id: 'prompt-outline',
      page: 'conversation',
      label: 'Show prompt outline',
      detail: 'A thin rail beside the conversation with a mark for each of your prompts. Click a mark to go back to it.',
      keywords: 'outline prompts rail marks minimap jump previous next long conversation navigate',
      target: '[data-prompt-outline-setting]',
    },
    {
      id: 'fade-panes',
      page: 'conversation',
      label: 'Fade inactive panes',
      detail: "With sessions side by side, the panes you aren't working in are faded until you point at one. Off, they look the same as the active pane, which keeps its line along the top.",
      keywords: 'split view panes tiles dim faded opacity inactive active focus side by side',
      target: '[data-fade-panes-setting]',
    },
    {
      id: 'turn-details',
      page: 'conversation',
      label: 'Under each reply',
      detail: 'Shows next to the actions when you hover a reply. Nothing, Time, Time and duration, or Time, duration and tokens.',
      keywords: 'timestamp time duration tokens turn ended took how long clock usage reply line',
      target: '[data-turn-details-setting]',
    },
    {
      id: 'file-link-click',
      page: 'conversation',
      label: 'Clicking a file link',
      detail: `What a click does on a file in Claude’s replies. ${formatKeys(clickKeysFor('transcript.file-link-other'))} does the other, and right-click lists both.`,
      keywords: `file link path click open show reveal editor ${fileManagerName()} finder explorer shift context menu`,
      target: '[data-file-link-click]',
    },
    {
      id: 'while-working',
      page: 'conversation',
      label: 'Enter',
      detail: `Queue holds your message in Up next until Claude finishes the turn. Steer gives it to Claude now, and Claude reads it at its next step. ${formatKeys(keysFor('composer.send-now'))} always stops Claude and sends at once.`,
      keywords: 'while working queue steer message send busy up next',
      target: '[data-while-working]',
    },
    {
      id: 'resume-at-limit',
      page: 'conversation',
      label: 'Resume after a usage limit resets',
      detail: 'Ask each time offers Resume when it resets on a session a usage limit stopped. Always resumes it by itself, shortly after the limit resets.',
      keywords: 'usage limit rate limit plan reset continue resume automatically wait 5-hour weekly',
      target: '[data-resume-at-limit]',
    },
    {
      id: 'catchup-summaries',
      page: 'conversation',
      label: 'Write catch-up summaries with Haiku',
      detail: 'A short briefing when a session finishes, and a plain answer to Why? on a permission.',
      keywords: 'catch-up briefing banner summary what happened review why permission model tokens',
      target: '[data-catchup-summaries]',
    },
    { id: 'auto-model', page: 'conversation', label: 'Auto model', detail: 'Shows Auto in the model menu. Haiku reads only your prompt, never your files or memory.', keywords: 'automatic routing pick choose', target: '[data-auto-model-enabled]' },
    { id: 'auto-model-allowed', page: 'conversation', label: 'Models it can pick', detail: 'Haiku, Sonnet and Opus. At least one.', keywords: 'auto model', target: '[data-auto-model-allowed]' },
    { id: 'auto-model-lean', page: 'conversation', label: 'When in doubt', detail: 'Which way to lean on a close call: Cheaper, Balanced or Stronger.', keywords: 'auto model cost', target: '[data-auto-model-lean]' },
    { id: 'auto-model-suggest', page: 'conversation', label: 'Suggest a stronger model later', detail: 'When a session grows past its first prompt. Never switches by itself.', keywords: 'auto model upgrade', target: '[data-auto-model-suggest]' },

    // Notifications and sounds
    {
      id: 'notifications',
      page: 'notifications',
      label: 'Notifications',
      detail: 'A system notification when Claude needs you, finishes or stops with an error, and when a project action ends.',
      keywords: 'notification alerts banner notification centre center do not disturb needs you finished error action blocked permission system settings',
      target: '[data-notifications-toggle]',
    },
    { id: 'notifications-test', page: 'notifications', label: 'Check that they come through.', detail: 'Send a test notification', keywords: 'notification test try', target: '[data-notifications-test]' },
    { id: 'sounds', page: 'notifications', label: 'Sounds', detail: 'A sound per moment. Works with notifications on or off.', keywords: 'sound audio chime alert mute notification', target: '[data-sounds-toggle]' },
    { id: 'sound-needs-you', page: 'notifications', label: 'Needs you', detail: 'Claude asks for a permission, has a question or a plan.', keywords: 'sound needs you permission question plan waiting', target: '[data-sound-event="needsYou"]' },
    { id: 'sound-finished', page: 'notifications', label: 'Finished', detail: 'Claude finished a turn.', keywords: 'sound finished done complete chime', target: '[data-sound-event="finished"]' },
    { id: 'sound-error', page: 'notifications', label: 'Stopped with an error', detail: 'Claude stopped because something failed.', keywords: 'sound error failed', target: '[data-sound-event="error"]' },
    { id: 'sound-action-ended', page: 'notifications', label: 'Project action ended', detail: 'A project action like Dev or Test stopped.', keywords: 'sound action dev test script', target: '[data-sound-event="actionEnded"]' },
    { id: 'sound-volume', page: 'notifications', label: 'Volume', detail: 'For every sound.', keywords: 'sound volume loud quiet', target: '[data-sound-volume]' },

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
    {
      id: 'focus-remote',
      page: 'focus',
      label: 'Count sessions on other computers',
      detail: 'Also count sessions that are working, need you or are unread on computers you paired.',
      keywords: 'focus limit remote computers paired',
      target: '[data-focus-count-remote]',
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

    // Usage
    {
      id: 'usage-view',
      page: 'usage',
      label: 'Usage view',
      detail: 'Which sessions, projects and models used your plan, and how your limits filled up over time.',
      keywords: 'open usage plan limits tokens insights 5-hour weekly',
      target: '[data-usage-view-setting]',
    },
    {
      id: 'show-cost',
      page: 'usage',
      label: 'Show estimated cost',
      detail: "What your tokens would cost at Anthropic's API prices: after the usage bars, for each session, and in the Usage view.",
      keywords: 'cost price money dollars euro spend api estimate usage bar footer session project model tokens',
      target: '[data-show-cost]',
    },
    {
      id: 'show-bar-cost',
      page: 'usage',
      label: 'Show it on the usage bars',
      detail: 'The estimated cost after the 5-hour and weekly bars, under the message box and in New session.',
      keywords: 'cost price money dollars euro estimate usage bar footer stats 5h week',
      target: '[data-show-bar-cost]',
    },
    {
      id: 'cost-currency',
      page: 'usage',
      label: 'Currency',
      detail: 'The currency of the estimated cost.',
      keywords: 'money dollars euro pounds yen exchange rate cost price',
      target: '[data-cost-currency]',
    },
    {
      id: 'large-context',
      page: 'usage',
      label: 'Warn about a large context',
      detail: 'Says above the message box how large it is and when its cache expires.',
      keywords: 'context window full percent prompt cache expire expiry compact tokens warning alert ring',
      target: '[data-large-context-enabled]',
    },
    {
      id: 'large-context-percent',
      page: 'usage',
      label: 'Large from',
      detail: 'How full the context window is before it counts as large. The context ring turns orange here too.',
      keywords: 'context window percent threshold full warning ring orange',
      target: '[data-large-context-percent]',
    },
    {
      id: 'large-context-notify',
      page: 'usage',
      label: 'Notify before the cache expires',
      detail: "5 minutes before a large session's hour-long cache expires.",
      keywords: 'prompt cache expire expiry notification reminder context hour',
      target: '[data-large-context-notify]',
    },
    {
      id: 'large-context-quit',
      page: 'usage',
      label: 'Warn when quitting',
      detail: 'Quitting with a large session open asks first.',
      keywords: 'quit exit close context cache prompt warning end of day',
      target: '[data-large-context-quit]',
    },

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
    // Prompts
    { id: 'prompts-new', page: 'prompts', label: 'New prompt', detail: 'Prompts with blanks you fill in when you use them. Type / in any message box.', keywords: 'prompts templates snippets saved blanks create add', target: '[data-saved-prompts-new]' },
    { id: 'prompts-list', page: 'prompts', label: 'Saved prompts', detail: 'Every project, just for you, or shared with the project.', keywords: 'prompts templates snippets saved blanks share move delete edit', target: '[data-saved-prompts-settings]', fallback: '[data-settings-page="prompts"] section' },

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

    // Remote
    {
      id: 'remote-enabled',
      page: 'remote',
      label: 'Allow access from my phone',
      detail: 'Follow your sessions from your phone or another browser, answer Claude and send prompts. Only devices you pair get in.',
      keywords: 'phone mobile remote access iphone android tunnel turn on off switch status running',
      target: '[data-remote-enabled]',
    },
    { id: 'remote-pair', page: 'remote', label: 'Pair a device', detail: 'Scan a QR code with your phone, or open the link in another browser.', keywords: 'pair a phone qr code pairing add device browser', target: '[data-remote-action="pair"]', fallback: '[data-remote-settings]' },
    { id: 'remote-devices', page: 'remote', label: 'Paired devices', detail: 'Your phones, browsers and computers. Revoke disconnects one at once.', keywords: 'paired phones revoke devices remove browsers', target: '[data-remote-devices]', fallback: '[data-remote-settings]' },
    {
      id: 'remote-idle-line',
      page: 'remote',
      label: 'Show in the sidebar when nobody is connected',
      detail: 'While Remote is on, the bottom of the sidebar shows who is connected to this computer. With nobody connected, a quiet line says Remote is on.',
      keywords: 'sidebar connected to this mac devices nobody connected remote on line footer hide',
      target: '[data-remote-idle-line]',
      fallback: '[data-remote-settings]',
    },
    { id: 'remote-rename', page: 'remote', label: 'Rename a device', detail: 'Give a paired device a name you recognise.', keywords: 'rename name device phone label', target: '[data-remote-devices]', fallback: '[data-remote-settings]' },
    { id: 'remote-reconnect', page: 'remote', label: 'Reconnect a paired device', detail: 'After a quick tunnel restarted with a new address.', keywords: 'show the address to paired phones new address changed tunnel restarted', target: '[data-remote-link]', fallback: '[data-remote-settings]' },
    { id: 'remote-tunnel', page: 'remote', label: 'Connection', detail: 'Cloudflare quick tunnel, Tailscale, ngrok or your own address.', keywords: 'reach this computer through tunnel cloudflare cloudflared tailscale ngrok proxy address change', target: '[data-remote-connection]', fallback: '[data-remote-settings]' },
    { id: 'remote-port', page: 'remote', label: 'Advanced › Port', detail: 'The local port Remote listens on. Your tunnel forwards to it.', keywords: 'port 47615 listen local address forward tunnel advanced security', target: '[data-remote-advanced]', fallback: '[data-remote-settings]' },

    // Other computers
    {
      id: 'computers-link',
      page: 'remote',
      label: 'Other computers',
      detail: "Paste the link from another computer's Pair a device to follow its sessions from here.",
      keywords: 'another computer mac pc remote pair connect link machine sessions',
      target: '[data-remote-computers]',
    },
    { id: 'computers-list', page: 'remote', label: 'Paired computers', detail: 'Open its sessions, or Remove it.', keywords: 'forget remove computers machines offline open', target: '[data-computers-list]', fallback: '[data-remote-computers]' },

    // Backup
    { id: 'backup-export', page: 'backup', label: 'Export settings', detail: 'Choose what to include and save it to a file.', keywords: 'backup save move another computer', target: '[data-backup-export]' },
    { id: 'backup-import', page: 'backup', label: 'Import settings', detail: 'See what a file would change before anything happens. Your current settings are backed up first.', keywords: 'restore backup', target: '[data-backup-import]' },

    // Diagnostics
    { id: 'diagnostics-mod-logs', page: 'diagnostics', label: 'Mod logs', detail: 'What mods wrote to their log in running sessions.', keywords: 'mods plugins log ui_log debug', target: '[data-diagnostics-card="Mod logs"]' },
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
