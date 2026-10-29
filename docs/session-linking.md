# Session linking

Mention another session in the message box, and Claude gets what it needs to know about it: its folder, branch, pull request, what it did and its last reply. The case that drives it is stacking work:

> create me this feature, and stack the PR on top of the one you opened in @Usage cost toggle

Claude starts from that session's branch and opens the new pull request with that branch as its base, without you copying a branch name or a PR link.

This note is the design. Phase 1 is built (see [Phase 1 as built](#phase-1-as-built)); [PLAN.md 5.11](../PLAN.md#511-session-linking) tracks the rest. Places in the code are named as they are on `main` at 0.0.23. The mockups are Round 36 in the Seshboard UI suggestions canvas: the `@` list, the sent message with **What Claude got**, and the parts (chip states, start from its branch, the stacked base, the session menu, `ask_session`, the phone).

## What exists today, and what it means for this design

- **The `@` list** (`Composer.tsx`, `updatePalette` and `choose`; `tokens.ts`, `tokenAtCaret`) only lists files from `files.search`. Picking a file **removes** the `@query` text and adds a chip to the context tray. Sessions break that rule on purpose (see [The mention stays in the text](#the-mention-stays-in-the-text)).
- **Chips become text in the renderer.** `promptWithContext` (`composer/contextItems.ts`) writes files as one line of `@` mentions and text items as fenced blocks under their label. The engine only ever receives text (`session.send` and `session.create` take `text` / `prompt`). `contextFromPrompt` only reads the line of file mentions back; fenced blocks don't come back as chips today.
- **Queued and saved text.** Up next (`up_next`), the queue (`later_prompts`, which also keeps `typed` and `context`) and the remote app all carry plain text, sent later, sometimes much later.
- **Worktrees are made by Claude Code** (`buildOptions` in `sessionHost.ts` passes `extraArgs.worktree`, and `settings.worktree.baseRef` only knows `fresh` and `head`). `WorktreeRequest.baseRef` is `z.enum(['fresh', 'head'])`. There is no way to say "from this branch" today, and the engine never runs `git worktree add` itself.
- **Pull requests are found by branch.** `git.prFor` reads the current branch of a folder and looks it up in `fetchPullRequests` (`gh pr list --state all --json number,state,headRefName,url,isDraft`). That list doesn't carry the base branch. `parsePrUrl` in `git/pullRequest.ts` already finds a PR link in `gh` output.
- **The catch-up card is about the last turn only** (`CatchUp`: `ask`, `did`, `skipped`, `need`, `signals`). `catchUp/fallback.ts` writes one without a model when summaries are off or Haiku doesn't answer.
- **Ask about this session** (`HostManager.askAbout`) answers from a fork with `persistSession: false`, behind the read-only `isReadOnlyTool` hook, under the session's own profile and folder. The engine has no in-process MCP server yet.
- **Prompts in the transcript** render as Markdown in `PromptItem` (`TranscriptItem.tsx`), so a fenced block shows as a code block.
- **Dragging a session from the sidebar** is the split-view tile drag (`useTileDrag`, pointer events, `planDrop`), not HTML drag and drop. The message box's drop target only takes files.

## The flow, worked through

The **Usage cost toggle** session finished an hour ago. It ran in the worktree `.claude/worktrees/usage-cost` on the branch `worktree-usage-cost` and opened PR #148 against `main`.

1. In New session for *switchboard*, you type `create me this feature, and stack the PR on top of the one you opened in @us`.
2. The `@` list opens with two groups. **Sessions** shows *Usage cost toggle* first: it matches "us" at the start of its title, and it has the PR #148 pill. **Files** follows with `usage.ts` and others.
3. You press ↩. The text now reads `… the one you opened in @Usage cost toggle ` and a chip *Usage cost toggle* is in the context tray, with the branch and `#148` as its detail.
4. Because the linked session has a branch in this repository, the route tray (Where) now offers **New worktree from worktree-usage-cost**, picked for you. The line under it says "Starts from the branch of Usage cost toggle."
5. You press ⌘↵. `promptWithContext` writes the chip as a stub block (`session: 3f2c…`). `session.create` gets `worktree: { name, baseRef: { branch: 'worktree-usage-cost' } }`.
6. The engine makes the worktree itself from `worktree-usage-cost` (see [Start from its branch](#start-from-its-branch)), then, right before the prompt goes to Claude Code, expands the stub into the full brief: folder, branch, PR #148 (open, base `main`), the catch-up's lines and the last reply.
7. Claude reads the brief, sees it is already on a branch based on `worktree-usage-cost`, builds the feature and runs `gh pr create --base worktree-usage-cost`.
8. The PR detector sees `gh pr create` in this session's output and stores PR #151 for it, with base `worktree-usage-cost`. The new session's header shows **Builds on Usage cost toggle · #148**.
9. If you open PR #151 with Seshboard's **Create pull request** dialog instead, it picks `worktree-usage-cost` as the base for you, with "Stacked on #148" under it.

## UI

### The `@` list

One trigger, two groups. A second trigger (`#` or `@@`) would be one more thing to learn, and `#` collides with issue numbers in saved prompts.

- **Empty query** (`@` alone): **Sessions** first, the 4 most recent sessions of this project other than this one, then **Files** as today.
- **With a query:** a word puts **Sessions** first, when one matches; a query with `/` or `.` in it is a path and only lists files, so the muscle memory of `@src/…` stays.
- **Sessions are matched** on the title, the branch (`worktree.branch`, else `gitBranch`) and the first prompt, with the same scoring as the `/` list (`slashScore`: start of a word first, then letters in order). This project's sessions first, then, once you've typed a query, other projects' (at most 3), most recent first within each.
- **Up to 6 sessions and 8 files.** Each group has a heading in the list's small capitals (`Sessions`, `Files`), like `Saved prompts` and `Commands` in the `/` list.
- **A session row:** status dot (`STATUS` tones), title, then in `text-meta`: branch in mono, the PR pill (`#148`, `link` tone, `Pill`), and the age. Another project's session shows its project name; another profile's shows the profile dot.
- **Left out:** this session, sessions of a paired computer (`remoteRowId`), helper and ephemeral sessions, archived sessions unless the query matches their title exactly.
- **Keys:** ↑ ↓ move across both groups, ↩ or Tab picks, Esc closes and keeps what you typed. ⌥↩ on a session opens it beside this one instead (Open beside).
- **Empty states:** no other sessions in the project shows no Sessions group (never an empty heading). No match at all closes the list, as today.

### The mention stays in the text

Picking a session inserts `@Usage cost toggle ` at the caret, and adds a chip. Unlike a file, the label stays in the text, so the sentence still reads, and so Claude can match "the one you opened in @Usage cost toggle" to the brief with the same label.

- The label is the session's title, cut to 60 characters on a word.
- Two linked sessions with the same title get ` (2)` on the second one's label, in the text and in its chip.
- Deleting the label from the text leaves the chip; removing the chip leaves the text. Both are fine: the brief is what carries the context.
- The label is plain text in the box (no inline token). The chip is what you remove.

### The chip

A `session` chip in the context tray (`ContextTray.tsx`): a link icon, the label, and as detail the branch and the PR (`worktree-usage-cost · #148`), or "No branch" / "No pull request yet". Its tooltip: "Claude gets this session's branch, pull request, what it did and its last reply." A click opens the session beside this one. At most 5 session chips per message; the sixth says "Link up to 5 sessions in one message."

### Other ways in

- **Session menu** (`useSessionMenu`): **New session linked to this one** opens New session on that session's project with the chip already in the tray and `@<title> ` in the box.
- **Palette:** **New session linked to this one** for the active session. **Link a session…** (the session picker, adding the chip and the label to the active message box) comes in phase 2.
- **Dragging from the sidebar** onto the message box is left out for now (see [Decisions](#decisions)).

### New session: start from its branch

When a linked session has a branch, is in the same repository, and no other chip already offers one, the **Where** choice in the route tray gains a third option:

- **Current checkout** (as today)
- **New worktree** (as today)
- **New worktree from worktree-usage-cost**, with the line "Starts from the branch of Usage cost toggle."

Picking a session chip selects it once. If you change Where yourself, it stays as you set it. Removing the chip goes back to what Where was before. With two linked sessions that have branches, the menu lists one option per branch. In a session that is already running, nothing changes in the form: the brief tells Claude the branch, and Claude switches if you ask it to.

### In the transcript

Your prompt card (`PromptItem`) reads the brief blocks out of the text with the shared parser, and shows:

- the text as you typed it, with `@Usage cost toggle` drawn as a mention (accent-ink, underline on hover, opens the session);
- under it, one row per linked session: link icon, **Linked:** the label, branch and PR pill, and the age of the brief ("as of 14:02");
- **What Claude got** on that row opens the full brief in a popover, as Claude read it.

A brief whose session no longer exists keeps its row, without the click, with "This session is gone."

### Editing and sending again

`contextFromPrompt` reads the session blocks back as `session` chips (with the session id from the block), and the label stays in the text. Anything that puts a message back in the box (Edit in Up next, Undo, Edit and resend) gets the chip back. On send the brief is built again, so it has today's branch and PR, not the old ones.

### Header and sidebar

- **Phase 1:** none. The links only show in the box and the transcript.
- **Phase 2:** the session header shows **Builds on Usage cost toggle · #148** when this session's branch was started from a linked session's branch, or when its PR's base is that branch. A click opens it.
- **Phase 4:** a stack view on the project page (Pull requests tab or its own), and a small stack mark on sidebar rows. Out of scope here.

## The brief

### Format

A label line, then a fence with the info string `switchboard-session`, so the parser never mistakes a code block for a brief:

````text
Linked session: Usage cost toggle
```switchboard-session
session: 3f2c9a1e-5b7d-4c0e-9a51-2f0d8c6e1b44
project: switchboard
folder: /Users/elio/dev/switchboard/.claude/worktrees/usage-cost
branch: worktree-usage-cost
pull request: #148 open, base main, https://github.com/estruyf/switchboard/pull/148
state: finished, last active 2026-10-18 13:02
asked: Add a setting to hide the estimated cost on the usage bars
commits:
- c9f6e15 feat(usage): add a setting to hide the estimated cost on the usage bars
- 1a2b3c4 test(usage): cover the hidden cost on the Limits cards
did:
- Added Show estimated cost to Settings › Usage
- Hid the cost on the usage bars and the Limits cards when it is off
- Added tests for the setting
skipped:
- The remote app still shows the cost
next: Review and merge the pull request
last reply:
Done. The setting is under Settings › Usage, on by default. PR #148 is open against main. The remote app still
shows the cost; that needs the remote contract to carry the preference, so I left it out.
```
````

- **The label line** is `Linked session: <label>`, the same label as the mention in the text.
- **Keys** are one per line, `key: value`, lowercase, in this order. A missing value says why: `branch: none (not a git repository)`, `pull request: none yet`, `state: working, details may change`.
- **Times are clock times** (`last active 2026-10-18 13:02`), never "1h ago": the brief stays in the transcript, and a relative time is wrong as soon as you read it later.
- **`commits`** are the branch's own commits (`git log --oneline <base>..<branch>`, at most 10, newest first), with the PR's base, else origin's default branch, as `<base>`. The catch-up card only covers the last turn; the commits cover the whole branch, which is what stacking builds on.
- **The fence** is `fenceFor(body)` (longer than any run of backticks in the body), like other text blocks.
- **The stub** the renderer writes is the same block with only `session:` (and the label line). The engine fills in the rest. A stub that reaches Claude unexpanded (a path that doesn't expand, see below) still names the session.

### Size budget

At most 4,000 characters per brief, 12,000 for all briefs in one message. Over it, drop in this order until it fits:

1. the last reply, cut to 1,500 characters, then to 600, then left out;
2. `skipped`, then `did` past its first 2 lines;
3. `asked`, cut to 120 characters;
4. `commits` past the first 5;
5. never: `session`, `project`, `folder`, `branch`, `pull request`, `state`.

A brief that had to cut says so in its last line: `shortened: last reply left out`.

### Where it's built: the engine, right before Claude reads it

The renderer writes the stub. The engine expands it at the moment the message goes to Claude Code. This goes against "on send" in the starting direction, on purpose:

- **Up next and the queue send later.** A message queued while Claude works, or a queue item started tomorrow, should carry the PR as it is then. Expanding at the moment it's handed over gets that right for every path.
- **The engine has the data:** the session index, the catch-up store, the PR store and the transcript. The renderer would need three more round trips per send.
- **No contract change for sending.** `session.send`, `session.create`, `later.*` and Up next keep carrying text. The stub is in the text, so every path that carries text carries the link.

Where it expands: in one place, `SessionHost.push`, through `expand` in the host's events. Every message goes through it: a send, the first prompt of `session.create` and `later.start`, Up next draining, Send now.

`push` is synchronous, so the brief is built from what the engine already holds: the session index, the catch-up store, `session_prs`, and a cache of pull requests by branch and commits per linked session. That cache is warmed when the chip is added (`sessions.linkInfo`) and again when a message with a stub is sent or queued (`HostManager.send` and `create` wait for it, at most 2 seconds). Sending never waits on `gh` longer than that; a slower answer lands in the cache for the next brief.

The transcript keeps the expanded text, since that's what Claude read. That makes the transcript the record of what each brief said.

### Kept out of titles, search and the catch-up

The expanded brief is part of your message in the transcript, so everything that reads your prompt would read the brief too. Each of these takes it out with `parseBriefs(text).text` first:

- the session's first prompt and the title made from it (`sessionIndex.ts`), so a session that links "Usage cost toggle" doesn't match "usage cost" in the `@` list or the sidebar search;
- search (`searchableText`), so a search finds the brief's words only in the session they describe;
- the catch-up card's `ask` (`promptText`), so Haiku summarises what you asked, not the brief.

### Missing pieces

| The linked session | The brief says |
|---|---|
| Has no catch-up card yet | A card from `catchUp/fallback.ts` (no model, no wait). Never a Haiku call at send time. |
| Catch-up summaries are off | The fallback card's signals only, plus the last reply. |
| Is working | `state: working, details may change`, its last reply so far, no `did`. |
| Waits for you | `state: waits for you (Allow Bash)`. |
| Has no branch | `branch: none (not a git repository)` or `branch: none (detached)`. Start from its branch isn't offered. |
| Has no PR | `pull request: none yet`. |
| Its worktree is gone | `folder: … (removed)`. Branch and PR still come from the stored values. |
| Is in another repository | Its own `project:` and `folder:`. See [Edge cases](#edge-cases) for reading its files. |
| Runs under another profile | The same brief: it's built from Seshboard's own data, no Claude call. |
| Was deleted | The chip turns into "This session is gone" in the box; on send the stub becomes `state: gone`. |

## Pull requests per session

### Where they come from

1. **Opened in the session:** the indexer sees a Bash call whose command has `gh pr create` and a PR link in its output (`parsePrUrl`). Stored with `source: 'opened'`.
2. **Opened by Seshboard:** `git.prCreate` stores the PR for the session it was started from (`source: 'opened'`).
3. **By branch:** the session's branch matched in `fetchPullRequests` (`source: 'branch'`). Any PR whose head is the session's branch counts as the session's own, whoever opened it (from the browser, another tool): for stacking, "the PR of that branch" is what you mean. `source` keeps the two apart for the UI.

A PR link that only shows up in text (Claude mentions someone else's PR) is not stored.

### When and how it is detected

In the incremental transcript pass that already reads every new message for search (`searchIndex.ts` with `transcript_indexed`), so sessions started outside Seshboard are covered too and nothing is read twice. Tool calls and their output are left out of search today; the PR pass reads them, the search text doesn't change.

### Staleness

- `fetchPullRequests` adds `baseRefName` to its `--json` fields.
- Stored PRs keep `state`, `base` and `checked_at`. They are refreshed when the chip is added and when a message with the stub is sent, through the project's pull request list (`gh pr list`, cached 5 minutes like the Worktrees tab's), never while the message waits more than 2 seconds.
- No `gh`, not signed in, or offline: the stored values are used, and the brief says `pull request: #148 open, base main (as of 14:02)`.
- A live `git.prFor` would fail once the worktree is gone or the branch changed. The stored branch from the session index and the stored PR rows don't depend on the folder, so that case is covered without it.

## Protocol

Sketches, not final code. What phase 1 shipped is under [Phase 1 as built](#phase-1-as-built).

```ts
// packages/protocol/src/context.ts
export const ContextItem = z.discriminatedUnion('kind', [
  /* file, text: as today */
  z.object({
    kind: z.literal('session'),
    sessionId: SessionId,
    /** The words in the text and on the chip: the title, cut to 60 characters, made unique in the message. */
    label: z.string().trim().min(1).max(80),
  }),
]);
```

The companion contract carries `ContextItem` in `context.add`. The VS Code extension never sends a `session` item; the engine refuses one from the socket (INVALID), so a companion can't make a link.

```ts
// packages/protocol/src/sessionLinks.ts (new): the format, shared by the UI, the engine and the remote app
export const SESSION_FENCE = 'switchboard-session';
export const MAX_LINKS_PER_MESSAGE = 5;
export const BRIEF_BUDGET = 4_000;
export const BRIEFS_BUDGET = 12_000;

export interface Brief {
  label: string;
  sessionId: string;
  /** Only `session:`, as the renderer writes it. */
  stub: boolean;
  fields: Partial<Record<'project' | 'folder' | 'branch' | 'pull request' | 'state' | 'asked' | 'next', string>>;
  did: string[];
  skipped: string[];
  lastReply: string | null;
}

/** The briefs in a message, and the text without them. Pure, no zod, so `./client` and `./remote-client` export it. */
export function parseBriefs(text: string): { text: string; briefs: Brief[] };
/** A brief as text, cut to the budget in the order above. */
export function writeBrief(brief: Brief, budget?: number): string;
```

```ts
// packages/protocol/src/worktrees.ts
export const WorktreePullRequest = z.object({
  number: z.number(),
  state: z.enum(['open', 'merged', 'closed']),
  url: z.string(),
  draft: z.boolean().optional(),
  /** The branch it merges into. */
  base: z.string().optional(),
});

// packages/protocol/src/host.ts
export const WorktreeRequest = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/, 'Use letters, digits, dot, dash or underscore'),
  /** `fresh`, `head`, or a branch in this repository to start from (a linked session's). */
  baseRef: z.union([z.enum(['fresh', 'head']), z.object({ branch: z.string().min(1).max(250) })]),
});
```

```ts
// packages/protocol/src/contract.ts
'sessions.linkable': {
  params: z.object({ sessionId: SessionId.nullable(), root: AbsolutePath.nullable(), query: z.string().max(200), limit: z.number().int().min(1).max(20).default(6) }),
  result: z.object({ sessions: z.array(LinkableSession) }),
},
/** What a chip shows, and what Start from its branch needs. */
'sessions.linkInfo': {
  params: z.object({ sessionId: SessionId }),
  result: z.object({ branch: z.string().nullable(), repoRoot: z.string().nullable(), pr: WorktreePullRequest.nullable(), gone: z.boolean() }),
},
/** The links a session's messages made, and the sessions that link to it (for the header, later the stack view). */
'sessions.links': {
  params: z.object({ sessionId: SessionId }),
  result: z.object({ to: z.array(SessionLink), from: z.array(SessionLink), buildsOn: SessionLink.nullable() }),
},
/** Pull requests opened in a session, newest first. */
'sessions.pullRequests': { params: z.object({ sessionId: SessionId }), result: z.object({ prs: z.array(SessionPullRequest) }) },
// events
'sessions.pullRequests.changed': z.object({ sessionId: z.string(), prs: z.array(SessionPullRequest) }),

export const LinkableSession = z.object({
  id: z.string(), title: z.string(), projectRoot: z.string(), branch: z.string().nullable(),
  pr: WorktreePullRequest.nullable(), status: SessionStatus, updatedAt: z.number(), profileId: z.string(),
});
export const SessionLink = z.object({ sessionId: z.string(), label: z.string(), at: z.number() });
export const SessionPullRequest = WorktreePullRequest.extend({
  repo: z.string(), head: z.string().nullable(), source: z.enum(['opened', 'branch']), checkedAt: z.number(),
});
```

`session.send` and `session.create` don't change. `chooseBase` in `git/pullRequest.ts` takes the linked branch as `asked` when the PR draft's session builds on one.

## Engine

| Part | Where |
|---|---|
| `parseBriefs`, `writeBrief`, the budget | `packages/protocol/src/sessionLinks.ts` |
| Build a brief from a session id: index, worktree, PR store, catch-up or fallback, last reply | `packages/engine/src/links/brief.ts` (new) |
| Expand stubs in a text, record the links | `links/expand.ts`, called from `SessionHost.push` and before the first prompt of `session.create` / `later.start` |
| `session_links` and `session_prs` reads and writes | `links/linkStore.ts` |
| PR detection in the incremental pass | `links/prDetect.ts`, called next to `searchableText` in `sessions/searchIndex.ts` |
| `baseRefName` in `gh pr list`, `gh pr view` for one PR | `git/worktrees.ts`, `git/pullRequest.ts` |
| Worktree from a branch | `git/worktreeFrom.ts` (new), used by `session.create` when `baseRef` is a branch |
| `sessions.linkable`, `linkInfo`, `links`, `pullRequests` | `engine.ts`, logic in `links/` |
| `ask_session` (phase 3) | `host/linkTool.ts`, an in-process MCP server passed in `buildOptions` |

### Start from its branch

Claude Code's worktree setting only knows `fresh` and `head`, so for a branch the engine makes the worktree itself, the way Claude Code would:

```
git -C <repo root> worktree add -b worktree-<name> <repo root>/.claude/worktrees/<name> <branch>
```

then starts the session with that folder as `cwd` and no `extraArgs.worktree`. Same place and branch name as Claude Code's, so the session index, the Worktrees tab and cleanup treat it like any other: Seshboard tells a worktree by its path (`host/sessionFolder.ts`, `git/worktrees.ts`), not by who made it. Claude Code's own worktree setup (a `WorktreeCreate` hook, if a project has one) doesn't run for it; the docs page says so, and Seshboard's own setup actions (`runOnWorktreeCreate`) still do. A branch that only exists on the remote is fetched first (`origin/<branch>`). Git refusing (the branch is gone, the name is taken) fails `session.create` with git's first useful line (`firstUsefulLine`), and the form keeps everything.

### Recording links

`expand` records a row in `session_links` for each stub it fills. The rows can be rebuilt from transcripts, because each expanded brief names its session: the table is a cache like `sessions`, not a user choice, and may be dropped on rebuild.

## Migration

```sql
-- v32: Links between sessions (a message in one mentioned the other) and the pull requests a session opened. Both are
-- read from transcripts (the briefs name their session, `gh pr create` prints its link), so a rebuild may drop them.
CREATE TABLE session_links (
  from_session TEXT NOT NULL,
  to_session   TEXT NOT NULL,
  label        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (from_session, to_session, created_at)
);
CREATE INDEX session_links_to ON session_links (to_session);
CREATE TABLE session_prs (
  session_id  TEXT NOT NULL,
  repo        TEXT NOT NULL,
  number      INTEGER NOT NULL,
  url         TEXT NOT NULL,
  state       TEXT NOT NULL,
  base        TEXT,
  head        TEXT,
  source      TEXT NOT NULL,
  seen_at     INTEGER NOT NULL,
  checked_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, repo, number)
);
```

## Asking the linked session (phase 3)

An in-process MCP server `switchboard` with one tool, passed in `buildOptions` only when the session has links:

```ts
ask_session({
  /** The `session:` value from a brief in this conversation. */
  session: string,
  /** One question, up to 2,000 characters. */
  question: string,
}) => { answer: string /* up to 4,000 characters */ }
```

- **Only linked sessions.** The tool refuses a session id that isn't in `session_links` from this session: Claude can't read any session it likes.
- **Read-only.** It is `HostManager.askAbout` on the linked session: a fork with `persistSession: false`, the `isReadOnlyTool` hook, its own folder and profile.
- **Limits:** 120 s, `ASK_MAX_TURNS`, one call at a time per session. A timeout answers "No answer in 2 minutes."
- **Cost:** recorded in `side_question_usage` under the asking session, so it shows in Usage › Side questions with the rest of that session's side questions.
- **Permission:** allowed without a prompt (`canUseTool` lets `mcp__switchboard__ask_session` through), since it can only read.
- **In the transcript** it's a tool row like others: "Asked Usage cost toggle: Which test covers the hidden cost?", with the answer when expanded.
- The brief ends with one line when the tool is there: `To ask this session more, call ask_session with its session id.`

## Edge cases

- **Another repository.** The brief has the folder, but Claude Code asks before reading outside the session's folder. New session offers "Let Claude read files in usage-cost" (`additionalDirectories`) when a linked session is in another repository. A running session gets the usual permission prompt.
- **Another profile.** The brief needs no Claude call. `ask_session` runs under the linked session's profile and is billed there; the tool row says "(Work profile)".
- **The same session twice** in a message: one brief, one link row.
- **Linking this session to itself:** not listed.
- **A linked session that links to others:** its briefs aren't copied into this one (the last reply is Claude's text, never your prompt).
- **Quick questions:** can be linked (no branch, no PR). Questions never offer Start from its branch.
- **Remote panes** (another computer's session): no Sessions group in their message box in phase 1, since the brief is built by this computer's engine.
- **The phone and the companion can't link.** A message from a paired phone goes through the same `push`, so a stub typed there would expand, and could name a session hidden from that phone: its brief would then show in a transcript the phone can read. So the remote contract's `session.send` defuses every stub before it is sent (`defuseStubs`: the fence's info string becomes `text`, so it reads as a code block and never expands). The companion only adds chips to the tray (a text chip's stub sits inside its own fence, which the parser skips), and `context.add` refuses a `session` item. Linking from the phone waits for phase 4, where it checks the session is visible to that phone first.
- **Windows:** folders in the brief are written as the platform writes them (`C:\Users\…`); `parseBriefs` takes either separator. The `git worktree add` path goes through `joinPath`.

## Phases

### Phase 1: tagging, the brief and PR detection

- `session` context item, the `@` list's Sessions group, the label in the text, the chip.
- `sessionLinks.ts` (format, parser, budget), the engine's `links/` (brief, expansion in `push`, warming before send).
- `session_links`, `session_prs`, PR detection in the incremental pass, `baseRefName`.
- Briefs kept out of the first prompt, search and the catch-up's ask. Stubs from the phone defused.
- The transcript's mention and **Linked:** row with **What Claude got**; `contextFromPrompt` reads briefs back.
- Session menu and palette: **New session linked to this one**.
- The remote app shows a brief as one line, "Linked: Usage cost toggle", through the shared parser.

### Phase 1 as built

Where the code differs from the sketches above:

- **The `@` list is built in the renderer** from the session list it already has (`linkableSessions` in `composer/sessionLinks.ts`), so there is no `sessions.linkable`. Its rows show the status, title, branch and age; the PR pill waits for a cheap source of PRs per row (phase 2, with `sessions.pullRequests`).
- **The contract has one new request,** `sessions.linkInfo` (the chip's branch and PR, and warming the brief). `sessions.links` and `sessions.pullRequests` come with phase 2's header.
- **The engine side** is `packages/engine/src/links/`: `linkStore.ts` (the two tables), `prDetect.ts` (`gh pr create` in transcripts), `brief.ts` (a brief from what is known, no waiting) and `linkService.ts` (warm, expand, the chip's info). `SessionHost.push` calls `expand` through `HostEvents.expand`; `HostManager.send` and `create` call `warm` first.
- **The companion** has its own item schema (`CompanionContextItem`: files and text), so `context.add` refuses a `session` item by its schema.
- **The format** (`packages/protocol/src/sessionLinks.ts`) adds `withoutBriefs`, which also takes off a brief cut short (a first prompt as Claude Code keeps it), and `defuseStubs` for the phone.
- **The transcript row** shows **What Claude got** as a disclosure under the row rather than a popover.
- **Up next** rows show what you typed, without the stub.
- **Smoke:** `link a session with @` (read-only, in New session).

### Phase 2: start from its branch, and the header

- `WorktreeRequest.baseRef` with a branch, `git/worktreeFrom.ts`, the Where option in New session. `worktreeFrom.ts` and the `{ branch }` base landed with New session from a pull request (issue #32), which uses them with `pullRequest`; the Where option for a linked session's branch is still to come.
- **Builds on …** in the session header, `sessions.links`.
- The Create pull request dialog picks the linked branch as base, "Stacked on #148".
- A `session` blank type in saved prompts ("Stack on {{parent:session}}"), and the palette's **Link a session…**.

### Phase 3: ask_session

- `host/linkTool.ts`, the MCP server, the guard, usage recording, the tool row.

### Phase 4: stacks

- A stack view on the project page, marks in the sidebar, the remote app's own link chips (checking the session is visible to that phone).
- Maybe: dragging a session from the sidebar onto a message box. The session menu and `@` cover linking, and the sidebar drag is the split view's tile drag, so this only comes if people ask for it.

## Tests

### Phase 1

- `sessionLinks.test.ts`: write and parse round trip; a stub; the budget's drop order; a reply with backticks; `parseBriefs` ignoring ordinary code blocks and a fence with another info string; both path separators.
- `contextItems.test.ts`: `promptWithContext` writes session stubs after text blocks; `contextFromPrompt` brings back files and sessions together; a label with ` (2)`.
- Composer scoring (a pure `linkableSessions`): group order for empty, title, branch and path-like queries; other projects only with a query.
- Engine (`links/*.test.ts`, real SQLite, real git): a brief for finished, working, waiting, no branch, no PR, worktree gone, gone session; expansion in `push` and in Up next draining; links recorded; PR detection from a recorded transcript with `gh pr create` output, and none from a link in plain text; `gh` missing.
- Smoke: open New session, type `@` with a session in the throwaway profile, pick it, check the chip (`data-context-chip="session"`) and the label; send in the sandbox (live smoke only) and check the **Linked:** row (`data-linked-session`).

### Phase 2

- `git/worktreeFrom.test.ts`: a worktree from a local branch, from a remote-only branch, a taken name, a missing branch.
- New session: the Where option appears with a linked branch, stays as you set it, goes when the chip goes.
- `chooseBase` with a linked branch. The header's **Builds on** for a started-from branch and for a PR base.

### Phase 3

- The tool refuses an unlinked id, denies a write tool, times out, records usage; a host test with the faked SDK checks it's only passed when the session has links.

## Docs and website

Per the [release checklist in CLAUDE.md](../CLAUDE.md#release-checklist), in the phase that ships each part:

- **New page** `website/src/content/docs/sessions/linking.mdx` ("Link sessions"), added to `website/src/sidebar.mjs` next to Ask about this session: the `@` list, the chip, the brief, the transcript row, stacking a PR, with screenshots from the demo world.
- **Update** `sessions/conversation.mdx` (the `@` list now has Sessions), `new-session/worktrees.mdx` (New worktree from a linked branch), the Create pull request page (the base for a stacked PR), `sessions/ask.mdx` (phase 3, `ask_session` as the tool version of Ask).
- **`features.json`:** the palette commands **Link a session…** and **New session linked to this one**, and the session menu item, each pointing at `sessions/linking`.
- **`docs/session-linking.md`** (this file) stays the technical note; the README gets one line under the session features.
- **Screenshots:** the demo world (`scripts/screenshot-demo.ts` and the website's) needs two sessions where one opened a PR.
- **`CHANGELOG.md`:** "Mention another session with @ in the message box: Claude gets its branch, pull request, what it did and its last reply."
- Shortcuts: none new, so `npm run docs:shortcuts` has nothing to change. macOS and Windows read the same; keys in the pages go through `<Kbd>`.

## Decisions

The design's open questions, as decided on 2026-10-18.

1. **The brief is built in the engine, when Claude reads it,** not in the renderer at send: Up next and the queue send later, and the engine has the data. The stub in the text is the cost, and it is accepted.
2. **No new field on `session.send` and `session.create`.** The stub in the text carries the link through every path that carries text.
3. **`session_links` and `session_prs` are a cache** that a rebuild may drop: both can be read back from transcripts.
4. **Start from its branch runs `git worktree add` in the engine.** Seshboard tells worktrees by their path, so one made at `.claude/worktrees/<name>` looks the same everywhere. A project's `WorktreeCreate` hook doesn't run for it; the docs page says so.
5. **Any PR whose head is the session's branch counts,** not only one opened in the session. `source` keeps them apart.
6. **No dragging a session onto the message box** for now (phase 4 at the earliest). The session menu and `@` cover it.
7. **A `session` blank in saved prompts:** phase 2.
8. **Other projects' sessions in the `@` list** only once you've typed a query, never for a bare `@`.
9. **4,000 characters per brief, 12,000 per message.**
10. **The brief lists the branch's commits** (`git log --oneline <base>..<branch>`, at most 10). They are cut after the last reply and never before 5.
11. **`ask_session` is billed to the asking session** in Usage.
12. **The remote app** shows a brief as one line in phase 1; linking from the phone waits for phase 4.

Found in review, and part of phase 1:

- **Stubs from the phone are defused** before they reach `push`, so a phone can't read a session hidden from it through a brief (see [Edge cases](#edge-cases)).
- **Briefs are kept out of the first prompt, search and the catch-up's ask** (see [Kept out of titles, search and the catch-up](#kept-out-of-titles-search-and-the-catch-up)).
- **Sending never waits on `gh` for more than 2 seconds;** the PR list is refreshed when the chip is added.
