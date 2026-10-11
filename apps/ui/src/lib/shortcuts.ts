/** Keys that can't be written as themselves in the `+`-joined form. */
const NAMED_KEYS: Record<string, string> = { "+": "plus", " ": "space" };

/** `cmd+shift+p` from a key event, or null for a bare modifier press. */
export function shortcutFromEvent(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
  code?: string;
}): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  // Option changes the character on macOS (⌥P = π); use the physical key instead.
  const raw =
    event.altKey && event.code?.startsWith("Key")
      ? event.code.slice(3).toLowerCase()
      : event.key.toLowerCase();
  const key = NAMED_KEYS[raw] ?? raw;
  return [
    event.metaKey && "cmd",
    event.ctrlKey && "ctrl",
    event.altKey && "alt",
    event.shiftKey && "shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

/**
 * A stored shortcut in today's form. Earlier versions saved `+` and Space as themselves
 * (`cmd+shift++`, `cmd+ `), which can't be split on `+`; those read as `plus` and `space`.
 */
export function normalizeShortcut(shortcut: string): string {
  if (shortcut === "+" || shortcut.endsWith("++"))
    return `${shortcut.slice(0, -1)}plus`;
  if (shortcut === " " || shortcut.endsWith("+ "))
    return `${shortcut.slice(0, -1)}space`;
  // The registry writes ⌘ as `mod`; Switchboard is macOS only, so it is always ⌘.
  return shortcut.replace(/(^|\+)mod(?=\+)/g, "$1cmd");
}

const KEY_GLYPHS: Record<string, string> = {
  cmd: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  enter: "↩",
  backspace: "⌫",
  escape: "Esc",
  plus: "+",
  space: "Space",
  tab: "⇥",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** `cmd+shift+p` as macOS shows it: `⌘⇧P`. */
export function formatShortcut(shortcut: string): string {
  return normalizeShortcut(shortcut)
    .split("+")
    .map((part) => KEY_GLYPHS[part] ?? part.toUpperCase())
    .join("");
}

const ARIA_KEYS: Record<string, string> = {
  cmd: "Meta",
  ctrl: "Control",
  alt: "Alt",
  shift: "Shift",
  enter: "Enter",
  backspace: "Backspace",
  escape: "Escape",
  plus: "Plus",
  space: "Space",
  tab: "Tab",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};

/** `cmd+shift+p` as `aria-keyshortcuts` spells it (`Meta+Shift+P`), so VoiceOver can announce an action's shortcut. */
export function ariaShortcut(shortcut: string): string {
  return normalizeShortcut(shortcut)
    .split("+")
    .map(
      (part) =>
        ARIA_KEYS[part] ?? (part.length === 1 ? part.toUpperCase() : part),
    )
    .join("+");
}

/** Modifiers, then a named key (`enter`, `p`, `1`) or one ASCII punctuation character other than `+` (`,`, `\`). */
const STORED =
  /^(?:(?:cmd|mod|ctrl|alt|shift)\+)*(?:[a-z0-9]+|[!-*,-\/:-@\[-`{-~])$/;

/** A stored shortcut (`cmd+enter`, `escape`, `cmd+,`) as opposed to glyphs typed for display (`⌘↵`, `Esc`). */
export const isStoredShortcut = (keys: string) =>
  STORED.test(normalizeShortcut(keys));

const GLYPH_MODIFIERS: Record<string, string> = {
  "⌘": "cmd",
  "⌃": "ctrl",
  "⌥": "alt",
  "⇧": "shift",
};
const GLYPH_KEYS: Record<string, string> = {
  "↵": "enter",
  "↩": "enter",
  "⌫": "backspace",
  esc: "escape",
  "↑": "arrowup",
  "↓": "arrowdown",
  "+": "plus",
  "⇥": "tab",
};

/**
 * Glyphs as people read them (`⌘↵`, `⌘⇧H`, `Esc`) back to the stored form (`cmd+enter`, `cmd+shift+h`,
 * `escape`), so a button that shows `⌘↵` can also announce it. A stored shortcut comes back in today's form.
 */
export function storedShortcut(keys: string): string {
  if (isStoredShortcut(keys)) return normalizeShortcut(keys);
  const parts: string[] = [];
  let rest = keys;
  while (rest && GLYPH_MODIFIERS[rest[0]!]) {
    parts.push(GLYPH_MODIFIERS[rest[0]!]!);
    rest = rest.slice(1);
  }
  const key = rest.toLowerCase();
  if (key) parts.push(GLYPH_KEYS[key] ?? key);
  return parts.join("+");
}

/** What a `<kbd>` shows for either form: glyphs stay as they are, a stored shortcut is formatted. */
export const shortcutGlyphs = (keys: string) =>
  isStoredShortcut(keys) ? formatShortcut(keys) : keys;

/** Whether two stored shortcuts are the same keys, reading older forms the way they are read today. */
export const sameShortcut = (a: string, b: string) =>
  normalizeShortcut(a) === normalizeShortcut(b);

// The registry: every shortcut Switchboard has, in one place. Handlers ask `matches(event, id)`, buttons
// show `keysFor(id)`, the command palette, the shortcuts sheet (⌘/), the actions editor's reserved keys
// and the README table all read from here, so a key is written down once.

/** Where you are, for `when()`. Built from the stores (and where focus was) when the shortcuts sheet opens. */
export interface ShortcutContext {
  view: "home" | "new-session" | "session" | "settings" | "projects" | "project";
  /** A session is open in the session view. */
  session: boolean;
  /** Claude is working, or waiting for you, in that session. */
  running: boolean;
  /** A permission or question card is waiting for an answer. */
  pending: "permission" | "question" | null;
  /** Sessions picked in the sidebar. */
  selection: number;
  /** Two sessions side by side. */
  split: boolean;
  /** The session's branch is behind its upstream, so it can be pulled. */
  behind: boolean;
  /** Where keyboard focus was. */
  focus: "terminal" | "composer" | "other";
  terminal: { open: boolean; maximized: boolean; actionRunning: boolean };
}

export type ShortcutSection =
  | "general"
  | "sessions"
  | "session"
  | "composer"
  | "permissions"
  | "actions"
  | "new-session"
  | "settings";

/** The sections' headings, in the sheet and the README. */
export const SECTION_TITLES: Record<ShortcutSection, string> = {
  general: "General",
  sessions: "Sessions and sidebar",
  session: "In a session",
  composer: "Message box",
  permissions: "Permissions and questions",
  actions: "Project actions",
  "new-session": "New session",
  settings: "Settings",
};

/** Where focus has to be for a key to do this. Two shortcuts on the same keys in different places don't collide. */
export type ShortcutPlace = "sidebar" | "find" | "composer" | "terminal";

export interface ShortcutDef {
  id: string;
  /**
   * Alternatives, each in the stored form (`mod+shift+p`, `mod` being ⌘). `mod+1..9` is a range, `mod+q mod+q`
   * a sequence (press it twice), `alt+click` a click and `middleclick` a click with the middle button.
   */
  keys: readonly string[];
  /** What it does, as the sheet and the README say it. */
  action: string;
  section: ShortcutSection;
  /** When it works, in a few words under the action ("While Claude is working"). */
  context?: string;
  /** Something more to know, after the context. */
  note?: string;
  /** Whether it works right now; always, when left out. */
  when?(ctx: ShortcutContext): boolean;
  /** Only while focus is there. */
  where?: ShortcutPlace;
  /** A menu bar item in main handles it, so it never reaches the page. */
  menu?: true;
  /** Not in `RESERVED_SHORTCUTS`: it works where project actions don't run, so an action may use the keys. */
  reserve?: false;
}

const inSession = (ctx: ShortcutContext) =>
  ctx.view === "session" && ctx.session;
const inMessageBox = (ctx: ShortcutContext) =>
  inSession(ctx) || ctx.view === "new-session";

export const SHORTCUTS = [
  // General
  {
    id: "session.new",
    keys: ["mod+n"],
    action: "New session",
    section: "general",
  },
  {
    id: "session.question",
    keys: ["mod+shift+n"],
    action: "Quick question (no project)",
    section: "general",
  },
  {
    id: "palette.commands",
    keys: ["mod+k", "mod+shift+p"],
    action: "Command palette",
    section: "general",
    context: "In the terminal ⌘K clears it, so use ⌘⇧P",
  },
  {
    id: "palette.goto",
    keys: ["mod+p"],
    action: "Go to a session or project",
    section: "general",
    note: "⌥↩ opens a session beside this one",
  },
  {
    id: "search",
    keys: ["mod+shift+f"],
    action: "Search all conversations",
    section: "general",
  },
  { id: "home", keys: ["mod+shift+h"], action: "Home", section: "general" },
  {
    id: "settings",
    keys: ["mod+,"],
    action: "Settings",
    section: "general",
    menu: true,
  },
  {
    id: "shortcuts",
    keys: ["mod+/"],
    action: "Keyboard shortcuts",
    section: "general",
  },
  {
    id: "quit",
    keys: ["mod+q mod+q"],
    action: "Quit",
    section: "general",
    context: "Switchboard asks first",
    note: "Press once if you turned that off",
    menu: true,
  },

  // Sessions and sidebar
  {
    id: "sidebar.toggle",
    keys: ["mod+b"],
    action: "Collapse or open the sidebar",
    section: "sessions",
  },
  {
    id: "session.next",
    keys: ["ctrl+tab"],
    action: "Next session",
    section: "sessions",
    context: "In the sidebar's order",
  },
  {
    id: "session.previous",
    keys: ["ctrl+shift+tab"],
    action: "Previous session",
    section: "sessions",
    context: "In the sidebar's order",
  },
  {
    id: "session.next-needs-you",
    keys: ["mod+shift+u"],
    action: "Next session that needs you",
    section: "sessions",
  },
  {
    id: "sidebar.move",
    keys: ["arrowup", "arrowdown"],
    action: "Move through sessions",
    section: "sessions",
    context: "In the sidebar",
    where: "sidebar",
  },
  {
    id: "sidebar.select",
    keys: ["mod+click", "shift+click", "shift+arrowup", "shift+arrowdown"],
    action: "Select several sessions",
    section: "sessions",
    context: "In the sidebar",
    where: "sidebar",
  },
  {
    id: "sidebar.select-group",
    keys: ["mod+a"],
    action: "Select every session in the group",
    section: "sessions",
    context: "In the sidebar",
    where: "sidebar",
  },
  {
    id: "sidebar.clear-selection",
    keys: ["escape"],
    action: "Clear the selection",
    section: "sessions",
    context: "While sessions are selected",
    when: (ctx) => ctx.selection > 0,
    where: "sidebar",
  },
  {
    id: "sidebar.rename",
    keys: ["f2"],
    action: "Rename the session",
    section: "sessions",
    context: "In the sidebar",
    where: "sidebar",
  },
  {
    id: "sidebar.delete",
    keys: ["mod+backspace"],
    action: "Delete the session",
    section: "sessions",
    context: "In the sidebar, to the Trash",
    where: "sidebar",
  },
  {
    id: "sidebar.open-beside",
    keys: ["alt+click"],
    action: "Open beside the current session",
    section: "sessions",
    context: "In the sidebar",
    where: "sidebar",
  },
  {
    id: "sidebar.archive",
    keys: ["middleclick"],
    action: "Archive a finished session",
    section: "sessions",
    context: "In the sidebar",
    where: "sidebar",
  },
  {
    id: "sidebar.section-toggle",
    keys: ["arrowleft", "arrowright"],
    action: "Close or open a section",
    section: "sessions",
    context: "On a section header in the sidebar",
    where: "sidebar",
  },
  {
    id: "sidebar.sections-all",
    keys: ["alt+click"],
    action: "Close or open every section",
    section: "sessions",
    context: "On a section header in the sidebar",
    where: "sidebar",
  },
  {
    id: "queue.start",
    keys: ["mod+enter"],
    action: "Start a queued item now",
    section: "sessions",
    context: "On a queued item, in the sidebar or Home",
    where: "sidebar",
  },
  {
    id: "queue.edit",
    keys: ["mod+e"],
    action: "Edit a queued item in New session",
    section: "sessions",
    context: "On a queued item, in the sidebar or Home",
    where: "sidebar",
  },
  {
    id: "queue.move",
    keys: ["alt+arrowup", "alt+arrowdown"],
    action: "Move a queued item up or down",
    section: "sessions",
    context: "On a queued item, in the sidebar or Home",
    where: "sidebar",
  },
  {
    id: "queue.move-top",
    keys: ["alt+shift+arrowup"],
    action: "Move a queued item to the top",
    section: "sessions",
    context: "On a queued item, in the sidebar or Home",
    where: "sidebar",
  },
  {
    id: "queue.remove",
    keys: ["backspace"],
    action: "Remove a queued item",
    section: "sessions",
    context: "On a queued item, in the sidebar or Home",
    note: "Undo puts it back",
    where: "sidebar",
  },
  {
    id: "context-menu",
    keys: ["shift+f10"],
    action: "Open the context menu",
    section: "sessions",
    context: "On a session, project or file; or right-click",
  },
  {
    id: "pane.close-other",
    keys: ["mod+\\"],
    action: "Close the other pane",
    section: "sessions",
    context: "With two panes open",
    when: (ctx) => ctx.split,
  },

  // In a session
  {
    id: "find",
    keys: ["mod+f"],
    action: "Find in the conversation",
    section: "session",
    when: (ctx) => inSession(ctx) && ctx.focus !== "terminal",
  },
  {
    id: "find.next",
    keys: ["enter", "mod+g"],
    action: "Next match",
    section: "session",
    context: "In Find",
    when: inSession,
    where: "find",
  },
  {
    id: "find.previous",
    keys: ["shift+enter", "mod+shift+g"],
    action: "Previous match",
    section: "session",
    context: "In Find",
    when: inSession,
    where: "find",
  },
  {
    id: "changes.toggle",
    keys: ["mod+shift+d"],
    action: "Show or hide Changes",
    section: "session",
    when: inSession,
  },
  {
    id: "terminal.toggle",
    keys: ["mod+j", "ctrl+`"],
    action: "Show or hide the terminal",
    section: "session",
    when: inSession,
  },
  {
    id: "terminal.maximize",
    keys: ["mod+shift+j"],
    action: "Maximize or restore the terminal",
    section: "session",
    when: inSession,
  },
  {
    id: "terminal.restore",
    keys: ["escape"],
    action: "Restore the terminal",
    section: "session",
    context: "While it fills the view, outside the shell",
    when: (ctx) => inSession(ctx) && ctx.terminal.maximized,
    where: "terminal",
  },
  {
    id: "terminal.clear",
    keys: ["mod+k"],
    action: "Clear the terminal",
    section: "session",
    context: "In the terminal",
    when: (ctx) => inSession(ctx) && ctx.terminal.open,
    where: "terminal",
  },
  {
    id: "terminal.stop-action",
    keys: ["ctrl+c"],
    action: "Stop the action",
    section: "session",
    context: "In the terminal, while an action runs",
    when: (ctx) => inSession(ctx) && ctx.terminal.actionRunning,
    where: "terminal",
  },
  {
    id: "git.pull",
    keys: ["mod+shift+l"],
    action: "Pull",
    section: "session",
    context: "When the branch is behind",
    when: (ctx) => inSession(ctx) && ctx.behind,
  },
  {
    id: "editor.open",
    keys: ["mod+o"],
    action: "Open the folder in your editor",
    section: "session",
    when: inSession,
  },
  {
    id: "memory.save",
    keys: ["mod+s"],
    action: "Save the memory or instructions you are editing",
    section: "general",
    context: "On a project's Memory tab, or Settings › Memory",
    when: (ctx) => ctx.view === "project" || ctx.view === "settings",
  },
  {
    id: "claude.stop",
    keys: ["escape"],
    action: "Stop Claude",
    section: "session",
    context: "While Claude is working",
    when: (ctx) => inSession(ctx) && ctx.running,
    where: "composer",
  },
  {
    id: "composer.send-now",
    keys: ["mod+shift+enter"],
    action: "Send now",
    section: "session",
    context: "While Claude is working",
    note: "Stops what Claude is doing so your message runs right away",
    when: (ctx) => inSession(ctx) && ctx.running,
    where: "composer",
  },
  {
    id: "mode.cycle",
    keys: ["shift+tab"],
    action: "Switch permission mode",
    section: "session",
    context: "In the message box",
    when: inSession,
    where: "composer",
  },

  // Message box
  {
    id: "composer.send",
    keys: ["enter", "mod+enter"],
    action: "Send",
    section: "composer",
    when: inMessageBox,
    where: "composer",
  },
  {
    id: "composer.newline",
    keys: ["shift+enter"],
    action: "New line",
    section: "composer",
    when: inMessageBox,
    where: "composer",
  },
  {
    id: "composer.commands",
    keys: ["/"],
    action: "Commands and skills",
    section: "composer",
    context: "At the start of the message",
    when: inMessageBox,
    where: "composer",
  },
  {
    id: "composer.mention",
    keys: ["@"],
    action: "Mention a file",
    section: "composer",
    when: inMessageBox,
    where: "composer",
  },
  {
    id: "composer.add-context",
    keys: ["mod+shift+a"],
    action: "Add files as context",
    section: "composer",
    context: "Several at once; they show as chips",
    when: inMessageBox,
    where: "composer",
  },
  {
    id: "composer.history",
    keys: ["arrowup", "arrowdown"],
    action: "Bring back an earlier message",
    section: "composer",
    context: "From the first line",
    note: "Esc goes back to what you were typing",
    when: inSession,
    where: "composer",
  },

  // Permissions and questions
  {
    id: "permission.allow",
    keys: ["mod+enter", "ctrl+enter"],
    action: "Allow, or send your answers",
    section: "permissions",
    context: "When a card is waiting",
    when: (ctx) => inSession(ctx) && ctx.pending !== null,
  },
  {
    id: "permission.deny",
    keys: ["escape"],
    action: "Deny, or skip the question",
    section: "permissions",
    context: "When a card is waiting",
    when: (ctx) => inSession(ctx) && ctx.pending !== null,
  },
  {
    id: "permission.pick",
    keys: ["1..9"],
    action: "Pick an answer",
    section: "permissions",
    context: "When a question is waiting",
    when: (ctx) => inSession(ctx) && ctx.pending === "question",
  },

  // New session
  {
    id: "new-session.pick",
    keys: ["mod+1..9"],
    action: "Pick a recent project",
    section: "new-session",
    when: (ctx) => ctx.view === "new-session",
    reserve: false,
  },
  {
    id: "new-session.start",
    keys: ["mod+enter"],
    action: "Start the session",
    section: "new-session",
    when: (ctx) => ctx.view === "new-session",
    where: "composer",
  },

  {
    id: "new-session.queue",
    keys: ["mod+shift+enter"],
    action: "Add the prompt to the queue",
    section: "new-session",
    context: "Starts when you say so",
    when: (ctx) => ctx.view === "new-session",
    where: "composer",
  },

  // Settings
  {
    id: "settings.close",
    keys: ["escape"],
    action: "Close Settings",
    section: "settings",
    when: (ctx) => ctx.view === "settings",
  },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

const BY_ID = new Map<string, ShortcutDef>(SHORTCUTS.map((s) => [s.id, s]));

export function shortcutById(id: ShortcutId): ShortcutDef {
  return BY_ID.get(id)!;
}

/** Whether a shortcut works in `ctx`. */
export const available = (def: ShortcutDef, ctx: ShortcutContext) =>
  def.when?.(ctx) ?? true;

const RANGE = /^(.*?)(\d)\.\.(\d)$/;

/**
 * The key presses one combo stands for, in today's stored form: a range is each of its keys, a sequence
 * its steps, a click none (it isn't a key press).
 */
export function comboPresses(combo: string): string[] {
  const steps = [...new Set(combo.split(" "))];
  return steps.flatMap((step) => {
    if (step.endsWith("click")) return [];
    const range = RANGE.exec(step);
    if (!range) return [normalizeShortcut(step)];
    const [, prefix, from, to] = range;
    const keys: string[] = [];
    for (let n = Number(from); n <= Number(to); n++)
      keys.push(normalizeShortcut(`${prefix}${n}`));
    return keys;
  });
}

/** One character that isn't a letter or digit (`/`, `@`, `\`): typing it may need ⇧ on some keyboards, so ⇧ doesn't count. */
const SYMBOL = /^[^a-z0-9]$/;
const withoutShiftForSymbols = (press: string) => {
  const parts = press.split("+");
  return SYMBOL.test(parts.at(-1)!)
    ? parts.filter((p) => p !== "shift").join("+")
    : press;
};

/** Whether a key press is `id`'s shortcut (any of its alternatives). */
export function matches(
  event: Parameters<typeof shortcutFromEvent>[0],
  id: ShortcutId,
): boolean {
  const pressed = shortcutFromEvent(event);
  if (!pressed) return false;
  const key = withoutShiftForSymbols(pressed);
  return shortcutById(id).keys.some((combo) =>
    comboPresses(combo).some((press) => withoutShiftForSymbols(press) === key),
  );
}

/** A shortcut's main keys in the stored form (`cmd+j`), for a button's `kbd` or a palette row. */
export const keysFor = (id: ShortcutId) =>
  comboPresses(shortcutById(id).keys[0]!)[0]!;

/** Every key that runs `id`, as `aria-keyshortcuts` lists them (space-separated). */
export const ariaKeysFor = (id: ShortcutId) =>
  shortcutById(id)
    .keys.flatMap((combo) =>
      combo.includes("..") || combo.includes(" ") ? [] : comboPresses(combo),
    )
    .map(ariaShortcut)
    .join(" ");

/** A piece of a combo as the sheet draws it: a keycap, or a word between keycaps. */
export type KeyPiece =
  | { cap: string; spoken: string }
  | { word: "to" | "then" | "click" | "middle-click" };

const SPOKEN: Record<string, string> = {
  cmd: "Command",
  ctrl: "Control",
  alt: "Option",
  shift: "Shift",
  enter: "Return",
  escape: "Escape",
  backspace: "Delete",
  tab: "Tab",
  space: "Space",
  plus: "Plus",
  arrowup: "Up Arrow",
  arrowdown: "Down Arrow",
  arrowleft: "Left Arrow",
  arrowright: "Right Arrow",
  "\\": "Backslash",
  ",": "Comma",
  "/": "Slash",
  "@": "At",
  ".": "Period",
  "`": "Backtick",
};

const capOf = (part: string): KeyPiece => ({
  cap: KEY_GLYPHS[part] ?? part.toUpperCase(),
  spoken: SPOKEN[part] ?? part.toUpperCase(),
});

/** One key press as keycaps: `mod+shift+p` is ⌘, ⇧, P. */
const pressPieces = (press: string): KeyPiece[] =>
  normalizeShortcut(press)
    .split("+")
    .map((part) =>
      part === "click"
        ? { word: "click" as const }
        : part === "middleclick"
          ? { word: "middle-click" as const }
          : capOf(part),
    );

/** A combo as keycaps and words: `mod+1..9` is ⌘ 1 to ⌘ 9, `mod+q mod+q` is ⌘ Q then ⌘ Q, `alt+click` is ⌥ click. */
export function keyPieces(combo: string): KeyPiece[] {
  return combo.split(" ").flatMap((step, index): KeyPiece[] => {
    const then: KeyPiece[] = index > 0 ? [{ word: "then" }] : [];
    const range = RANGE.exec(step);
    if (!range) return [...then, ...pressPieces(step)];
    const [, prefix, from, to] = range;
    return [
      ...then,
      ...pressPieces(`${prefix}${from}`),
      { word: "to" },
      ...pressPieces(`${prefix}${to}`),
    ];
  });
}

/** A combo as text: `mod+shift+p` is ⌘⇧P, `mod+1..9` ⌘1 to ⌘9, `mod+q mod+q` ⌘Q then ⌘Q, `alt+click` ⌥-click, `middleclick` Middle-click. */
export function formatKeys(combo: string): string {
  let text = "";
  for (const piece of keyPieces(combo)) {
    if ("cap" in piece) text += piece.cap;
    else if (piece.word === "click") text += `${text ? "-" : ""}click`;
    else if (piece.word === "middle-click") text += "Middle-click";
    else text += ` ${piece.word} `;
  }
  return text;
}

/** A combo as a screen reader should say it: "Command, K"; "Command, Q, then Command, Q". */
export function spokenKeys(combo: string): string {
  const words: string[] = [];
  let press: string[] = [];
  const flush = () =>
    press.length && (words.push(press.join(", ")), (press = []));
  for (const piece of keyPieces(combo)) {
    if ("cap" in piece) press.push(piece.spoken);
    else if (piece.word === "click") press.push("click");
    else if (piece.word === "middle-click") press.push("middle click");
    else (flush(), words.push(piece.word));
  }
  flush();
  return words.join(" ");
}

/** Menu bar keys main and the standard Edit, View and Window menus own: menu shortcuts never reach the page. */
const MENU_KEYS = [
  "cmd+h",
  "cmd+alt+h",
  "cmd+c",
  "cmd+v",
  "cmd+x",
  "cmd+a",
  "cmd+z",
  "cmd+shift+z",
  "cmd+alt+shift+v",
  "cmd+w",
  "cmd+m",
  "cmd+r",
  "cmd+shift+r",
  "cmd+alt+i",
  "cmd+0",
  "cmd+=",
  "cmd+plus",
  "cmd+shift+plus",
  "cmd+-",
  "cmd+ctrl+f",
];

/**
 * Keys project actions may not take over: every shortcut in the registry with a modifier (bare keys such as
 * Esc can't be an action's), and the menu bar's. An action on a menu key would never run.
 */
export const RESERVED_SHORTCUTS = new Set([
  ...SHORTCUTS.flatMap((s: ShortcutDef) =>
    s.reserve === false ? [] : s.keys.flatMap(comboPresses),
  ).filter((press) => press.includes("+")),
  ...MENU_KEYS,
]);
