import { isAbsolutePath, joinPath } from '@seshboard/protocol';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { Turn } from './protocol.ts';

/*
 * Codex's thread items as the messages Seshboard reads from Claude Code's transcripts. Every item is read loosely:
 * Codex releases almost daily, so a field may be missing or of another type, and an item may be of a kind this file
 * doesn't know. Neither may throw; the item shows with less, as a generic tool card, or not at all.
 */

type Loose = Record<string, unknown>;
type Block = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => arr(v).filter((s): s is string => typeof s === 'string');

/**
 * The user messages Codex writes itself and keeps out of a thread's `userMessage` items (its "contextual user
 * messages"): the folder and shell, AGENTS.md, a skill's instructions, a note that a turn was stopped. Codex leaves
 * them out of the app-server's view; left out here too, should an older history or a newer Codex let one through.
 */
const INJECTED = ['<environment_context>', '<user_instructions>', '# AGENTS.md instructions for ', '<skill>', '<user_shell_command>', '<turn_aborted>', '<subagent_notification>'];
const isInjected = (text: string) => INJECTED.some((marker) => text.trimStart().startsWith(marker));

/** A data URL's media type and base64 data, for an image block. */
function dataUrl(url: string): { mediaType: string; data: string } | null {
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(url);
  return match ? { mediaType: match[1]!, data: match[2]! } : null;
}

const imageBlock = (mediaType: string, data: string): Block => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });

/**
 * A `userMessage`'s parts as content blocks: the text, a pasted image (a data URL) as an image, and other images and a
 * file as a short note. A mention or a skill is in the text already when it was typed (`$skill`, `@app`); added only
 * when it isn't.
 */
function userContent(parts: unknown): Block[] {
  const texts: string[] = [];
  const images: Block[] = [];
  const extras: Array<{ name: string; path: string; sigil: string }> = [];
  for (const raw of arr(parts)) {
    const part = obj(raw);
    switch (part.type) {
      case 'text': {
        const text = str(part.text);
        if (text?.trim() && !isInjected(text)) texts.push(text);
        break;
      }
      case 'image': {
        const url = str(part.url);
        const image = url ? dataUrl(url) : null;
        if (image) images.push(imageBlock(image.mediaType, image.data));
        else texts.push(`[Image${url ? `: ${url}` : ''}]`);
        break;
      }
      case 'localImage':
        texts.push(`[Image${str(part.path) ? `: ${part.path}` : ''}]`);
        break;
      case 'mention':
      case 'skill': {
        const name = str(part.name) ?? '';
        const path = str(part.path) ?? '';
        if (name || path) extras.push({ name, path, sigil: part.type === 'skill' ? '$' : '@' });
        break;
      }
      default:
        break;
    }
  }
  const typed = texts.join('\n');
  for (const { name, path, sigil } of extras) {
    if ((name && typed.includes(`${sigil}${name}`)) || (path && typed.includes(path))) continue;
    // A file's path reads as Claude Code's `@path`; an app or a plugin (`app://…`) by its name.
    texts.push(sigil === '@' && path && !path.includes('://') ? `@${path}` : `${sigil}${name || path}`);
  }
  const text = texts.join('\n').trim();
  return [...(text ? [{ type: 'text', text }] : []), ...images];
}

/** The first prompt's text, for a session's first prompt and title. */
export function codexFirstPrompt(turns: readonly Turn[]): string | undefined {
  for (const turn of arr(turns)) {
    for (const item of arr(obj(turn).items)) {
      if (obj(item).type !== 'userMessage') continue;
      const text = userContent(obj(item).content).flatMap((b) => (b.type === 'text' ? [String(b.text)] : [])).join('\n').trim();
      if (text) return text;
    }
  }
  return undefined;
}

/** Shells Codex wraps a command in (`/bin/zsh -lc '…'`): only this shape is unwrapped. */
const SHELL_WRAP = /^(?:\/usr)?\/bin\/(?:zsh|bash|sh) -lc (.+)$/s;
/** Characters a shell word may hold without quotes. */
const PLAIN = /[\w@%+=:,./-]/;

/** One POSIX shell word (quoted with `'…'`, `"…"` and `\`), or null when it is more than one or uses expansions. */
function shellWord(text: string): string | null {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return null;
      out += text.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if ('$`\\'.includes(text[j]!)) return null;
        j++;
      }
      if (j >= text.length) return null;
      out += text.slice(i + 1, j);
      i = j + 1;
    } else if (c === '\\' && i + 1 < text.length) {
      out += text[i + 1];
      i += 2;
    } else if (PLAIN.test(c)) {
      out += c;
      i++;
    } else {
      return null;
    }
  }
  return out;
}

/** The command Codex ran, without the login shell it wraps it in (`/bin/zsh -lc 'cat x'` is `cat x`). */
export function shellCommand(command: string): string {
  const wrapped = SHELL_WRAP.exec(command);
  const inner = wrapped ? shellWord(wrapped[1]!) : null;
  return inner?.trim() ? inner : command;
}

/**
 * Whether a command prints one whole file and nothing else (`cat file`), so a Read card says what it did. Codex also
 * calls `sed -n 1,80p file` or `cat file | head` a read; the Read card shows only the path, as if the whole file was
 * read, so those stay Bash cards with their command.
 */
function isWholeFileRead(command: string): boolean {
  const cat = /^cat (.+)$/s.exec(command.trim());
  return !!cat && !cat[1]!.startsWith('-') && shellWord(cat[1]!) !== null;
}

/**
 * A unified diff's hunks as Edit's `old_string`/`new_string` pairs: each hunk's context and removed lines before, its
 * context and added lines after. The Edit card diffs the two, so the hunk shows as it does for Claude Code. File
 * headers are left out; a hunk header without line counts (`@@`) runs to the next one. Each line keeps its newline
 * unless a `\ No newline at end of file` marker follows it, so a change to only the last newline still shows; the
 * newline both sides end with is then dropped, as Claude Code's own edits have none. A CRLF line's `\r` is dropped.
 */
export function diffEdits(diff: string): Array<{ old_string: string; new_string: string }> {
  type Hunk = { before: string[]; after: string[] };
  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  /** The sides the last line went to, which a `\ No newline` marker applies to. */
  let last: Array<'before' | 'after'> = [];
  let oldLeft = 0;
  let newLeft = 0;
  const lines = diff.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('@@')) {
      const counts = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      // A count left out means one line.
      oldLeft = counts ? (counts[1] === undefined ? 1 : Number(counts[1])) : Infinity;
      newLeft = counts ? (counts[2] === undefined ? 1 : Number(counts[2])) : Infinity;
      hunk = { before: [], after: [] };
      hunks.push(hunk);
      last = [];
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('\\')) {
      for (const side of last) hunk[side][hunk[side].length - 1] = hunk[side].at(-1)!.replace(/\n$/, '');
      last = [];
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0) continue;
    if (line.startsWith('+')) {
      hunk.after.push(`${line.slice(1)}\n`);
      last = ['after'];
      newLeft--;
    } else if (line.startsWith('-')) {
      hunk.before.push(`${line.slice(1)}\n`);
      last = ['before'];
      oldLeft--;
    } else if (line.startsWith(' ') || line === '') {
      // An empty line is a blank context line whose space was dropped.
      hunk.before.push(`${line.slice(1)}\n`);
      hunk.after.push(`${line.slice(1)}\n`);
      last = ['before', 'after'];
      oldLeft--;
      newLeft--;
    }
  }
  return hunks
    .filter((h) => h.before.length || h.after.length)
    .map((h) => {
      const before = h.before.join('');
      const after = h.after.join('');
      const trim = before.endsWith('\n') && after.endsWith('\n');
      return { old_string: trim ? before.slice(0, -1) : before, new_string: trim ? after.slice(0, -1) : after };
    });
}

type Tool = { name: string; input: Loose };
type Result = { text: string; isError: boolean; images?: Block[] } | null;

/** One `fileChange` change as Claude Code's tool: Write for a new file, Edit (MultiEdit for several hunks) for a change. */
function fileTool(change: Loose): Tool {
  const path = str(change.path) ?? '';
  const kind = obj(change.kind);
  const diff = str(change.diff) ?? '';
  if (kind.type === 'add') return { name: 'Write', input: { file_path: path, content: diff } };
  // There's no Claude Code tool that deletes: a card of its own, with the path.
  if (kind.type === 'delete') return { name: 'Delete', input: { file_path: path } };
  const moved = str(kind.move_path);
  const edits = diffEdits(diff);
  // A rename without changes: a card of its own, with both paths (the Edit card would show an empty diff).
  if (moved && !edits.length) return { name: 'Move', input: { from: path, to: moved } };
  const file = moved ?? path;
  if (edits.length > 1) return { name: 'MultiEdit', input: { file_path: file, edits } };
  return { name: 'Edit', input: { file_path: file, ...(edits[0] ?? { old_string: '', new_string: '' }) } };
}

/** What a finished `fileChange` change says as its result. */
function fileResult(change: Loose, status: unknown): Result {
  if (status === 'inProgress') return null;
  if (status === 'declined') return { text: 'Declined', isError: true };
  if (status === 'failed') return { text: 'Failed', isError: true };
  const kind = obj(change.kind);
  const path = str(change.path) ?? '';
  const moved = str(kind.move_path);
  const text = kind.type === 'add' ? `Created ${path}` : kind.type === 'delete' ? `Deleted ${path}` : moved ? `Moved ${path} to ${moved}` : `Updated ${path}`;
  return { text, isError: false };
}

/** An MCP tool's or a dynamic tool's output: its text parts, and its images as image blocks. */
function toolOutput(parts: unknown[]): { text: string; images: Block[] } {
  const texts: string[] = [];
  const images: Block[] = [];
  for (const raw of parts) {
    const part = obj(raw);
    const type = str(part.type);
    if ((type === 'text' || type === 'inputText') && str(part.text)) texts.push(part.text as string);
    else if (type === 'image' && str(part.data)) images.push(imageBlock(str(part.mimeType) ?? 'image/png', part.data as string));
    else if (type === 'inputImage' && str(part.imageUrl)) {
      const image = dataUrl(part.imageUrl as string);
      if (image) images.push(imageBlock(image.mediaType, image.data));
    } else if (type === 'resource' && str(obj(part.resource).text)) texts.push(obj(part.resource).text as string);
  }
  return { text: texts.join('\n'), images };
}

/** A web search's results as lines of title and link, when they have them. */
function searchResults(results: unknown): string {
  return arr(results)
    .map((r) => {
      const result = obj(r);
      const title = str(result.title);
      const url = str(result.url);
      return title || url ? [title, url].filter(Boolean).join('\n') : JSON.stringify(r);
    })
    .join('\n\n');
}

const FAILED = new Set(['failed', 'declined']);
/** A turn's statuses once it is over. */
const ENDED = new Set(['completed', 'interrupted', 'failed']);

/** An agent that ended without finishing. */
const AGENT_FAILED = new Set(['errored', 'notFound', 'interrupted']);
/** Codex's own fields on every item, left out of a generic card's input. */
const ITEM_FIELDS = new Set(['type', 'id', 'startedAtMs', 'completedAtMs', 'status']);

/** Each turn's items with the id their messages and tool calls get: the turn's and the item's, made unique should one repeat. */
function itemIds(turns: readonly Turn[]): Array<{ turn: Turn; turnId: string; items: Array<{ item: Loose; id: string }> }> {
  const seen = new Set<string>();
  return arr(turns).map((t, turnIndex) => {
    const turn = obj(t) as unknown as Turn;
    const turnId = str(turn.id) ?? `turn-${turnIndex}`;
    const items = arr(turn.items).map((raw, index) => {
      const item = obj(raw);
      let id = `${turnId}:${str(item.id) ?? index}`;
      if (seen.has(id)) id = `${id}#${index}`;
      seen.add(id);
      return { item, id };
    });
    return { turn, turnId, items };
  });
}

/**
 * The thread of the subagent a spawn call started (`collabAgentToolCall`, shown as an Agent card), by the card's
 * tool_use id: for the adapter to open the subagent's own conversation. Null for any other id.
 */
export function codexSubagentThread(turns: readonly Turn[], toolUseId: string): string | null {
  const found = itemIds(turns)
    .flatMap((t) => t.items)
    .find(({ item, id }) => id === toolUseId && item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent');
  return found ? (strings(found.item.receiverThreadIds)[0] ?? null) : null;
}

const iso = (ms: number | null) => (ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * A Codex thread's turns (oldest first, read with `itemsView: 'full'`) as the messages Seshboard reads from Claude Code.
 * Pure. Subagents' own threads are separate threads, so nothing is left out here.
 *
 * Each item makes its own messages, with ids from the turn's and the item's (stable across reads): a prompt a user
 * message, a reply or reasoning an assistant message, and a tool an assistant message with its `tool_use` blocks
 * followed by a user message with their `tool_result`s (none while it runs). Tools are renamed and reshaped to Claude
 * Code's where there is one (Bash, Read, Edit, Write, WebSearch, WebFetch, Agent), so they show with the same cards.
 */
export function codexMessages(turns: readonly Turn[]): RawSessionMessage[] {
  const entries = itemIds(turns);
  // What each subagent last reported, from any call that waited on it: its spawn card shows it as the agent's report.
  const agentStates = new Map<string, { status: string; message: string | null }>();
  for (const { item } of entries.flatMap((t) => t.items)) {
    if (item.type !== 'collabAgentToolCall') continue;
    for (const [thread, raw] of Object.entries(obj(item.agentsStates))) {
      const state = obj(raw);
      const message = str(state.message);
      if (message?.trim() || !agentStates.get(thread)?.message) agentStates.set(thread, { status: str(state.status) ?? '', message: message?.trim() ? message : null });
    }
  }

  const out: RawSessionMessage[] = [];
  for (const { turn, turnId, items } of entries) {
    for (const { item, id } of items) convertItem(turn, item, id, agentStates, out);
    out.push(...turnEnd(turn, turnId));
  }
  return out;
}

/** One item's messages, added to `out`. */
function convertItem(turn: Turn, item: Loose, id: string, agentStates: ReadonlyMap<string, { status: string; message: string | null }>, out: RawSessionMessage[]): void {
  const turnStart = num(turn.startedAt) ?? num(turn.completedAt);
  const started = num(item.startedAtMs) ?? num(item.completedAtMs) ?? (turnStart !== null ? turnStart * 1000 : null);
  const ended = num(item.completedAtMs) ?? started;
  const message = (type: 'user' | 'assistant' | 'system', uuid: string, at: number | null, body: unknown): RawSessionMessage => ({
    type,
    uuid,
    message: body,
    parent_tool_use_id: null,
    ...(iso(at) ? { timestamp: iso(at) } : {}),
  });
  const assistant = (content: Block[]) => out.push(message('assistant', id, started, { role: 'assistant', content }));
  const note = (text: string) => out.push(message('system', id, ended, { role: 'system', content: [{ type: 'text', text }] }));
  const tools = (calls: Array<{ id: string; tool: Tool; result: Result }>) => {
    if (!calls.length) return;
    assistant(calls.map(({ id: callId, tool }) => ({ type: 'tool_use', id: callId, name: tool.name, input: tool.input })));
    const results = calls.flatMap(({ id: callId, result: own }) => {
      // A tool still running in a turn that ended (stopped, failed) never finishes: without a result it would wait for
      // one for good. Plans have no status and stay without one, and so does a turn whose status is missing.
      const result = own ?? (item.status === 'inProgress' && ENDED.has(String(turn.status)) ? { text: 'Interrupted', isError: true } : null);
      return result ? [{ type: 'tool_result', tool_use_id: callId, is_error: result.isError, content: result.images?.length ? [...(result.text ? [{ type: 'text', text: result.text }] : []), ...result.images] : result.text }] : [];
    });
    if (results.length) out.push(message('user', `${id}:result`, ended, { role: 'user', content: results }));
  };
  const tool = (t: Tool, result: Result) => tools([{ id, tool: t, result }]);

  switch (item.type) {
    case 'userMessage': {
      const content = userContent(item.content);
      if (content.length) out.push(message('user', id, started, { role: 'user', content }));
      break;
    }
    case 'agentMessage': {
      const text = str(item.text);
      if (text?.trim()) assistant([{ type: 'text', text }]);
      break;
    }
    case 'reasoning': {
      const summary = strings(item.summary).join('\n\n');
      const thinking = summary.trim() ? summary : strings(item.content).join('\n\n');
      if (thinking.trim()) assistant([{ type: 'thinking', thinking }]);
      break;
    }
    case 'plan': {
      // A plan Codex proposed (plan mode), in Markdown: the plan card Claude Code's ExitPlanMode shows. No result, as
      // nothing was asked to approve it.
      const text = str(item.text);
      if (text?.trim()) tools([{ id, tool: { name: 'ExitPlanMode', input: { plan: text } }, result: null }]);
      break;
    }
    case 'commandExecution': {
      const status = item.status;
      const exitCode = num(item.exitCode);
      const output = str(item.aggregatedOutput) ?? '';
      const result: Result =
        status === 'inProgress' ? null : { text: output || (status === 'declined' ? 'Declined' : ''), isError: FAILED.has(String(status)) || (exitCode !== null && exitCode !== 0) };
      const command = shellCommand(str(item.command) ?? '');
      const actions = arr(item.commandActions).map(obj);
      const read = actions.length === 1 && actions[0]!.type === 'read' ? str(actions[0]!.path) : null;
      if (read && isWholeFileRead(command)) {
        // `cat file`: a Read card for the file, its output as the content.
        const cwd = str(item.cwd);
        tool({ name: 'Read', input: { file_path: !isAbsolutePath(read) && cwd ? joinPath(cwd, read) : read } }, result);
      } else {
        tool({ name: 'Bash', input: { command } }, result);
      }
      break;
    }
    case 'fileChange': {
      const changes = arr(item.changes).map(obj);
      tools(changes.map((change, i) => ({ id: changes.length === 1 ? id : `${id}:${i}`, tool: fileTool(change), result: fileResult(change, item.status) })));
      break;
    }
    case 'mcpToolCall': {
      const args = item.arguments;
      const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Loose) : args === undefined || args === null ? {} : { arguments: args };
      const error = str(obj(item.error).message);
      let result: Result = null;
      if (error !== null) result = { text: error, isError: true };
      else if (item.status !== 'inProgress') {
        const res = obj(item.result);
        const output = toolOutput(arr(res.content));
        const structured = res.structuredContent;
        const text = output.text || (structured !== undefined && structured !== null ? JSON.stringify(structured, null, 2) : '');
        result = { text, isError: item.status === 'failed', images: output.images };
      }
      tool({ name: `mcp__${str(item.server) ?? 'unknown'}__${str(item.tool) ?? 'unknown'}`, input }, result);
      break;
    }
    case 'webSearch': {
      const action = obj(item.action);
      const url = str(action.url);
      const found = { text: searchResults(item.results), isError: false };
      if ((action.type === 'openPage' || action.type === 'findInPage') && url) {
        const pattern = str(action.pattern);
        tool({ name: 'WebFetch', input: { url, ...(pattern ? { prompt: `Find "${pattern}"` } : {}) } }, found);
      } else {
        const queries = strings(action.queries);
        const query = str(item.query)?.trim() || str(action.query)?.trim() || queries[0] || '';
        tool({ name: 'WebSearch', input: { query, ...(queries.length > 1 ? { queries } : {}) } }, found);
      }
      break;
    }
    case 'imageView':
      tool({ name: 'Read', input: { file_path: str(item.path) ?? '' } }, { text: '', isError: false });
      break;
    case 'contextCompaction':
      // The notice Claude Code's compactions show ("Conversation compacted").
      out.push(message('system', id, ended, { subtype: 'compact_boundary' }));
      break;
    case 'enteredReviewMode': {
      const review = str(item.review)?.trim();
      note(review ? `Review started: ${review}` : 'Review started');
      break;
    }
    case 'exitedReviewMode': {
      // The review's findings are in `review`: they read as a reply.
      note('Review finished');
      const review = str(item.review);
      if (review?.trim()) out.push(message('assistant', `${id}:review`, ended, { role: 'assistant', content: [{ type: 'text', text: review }] }));
      break;
    }
    case 'collabAgentToolCall': {
      const prompt = str(item.prompt);
      const model = str(item.model);
      const receivers = strings(item.receiverThreadIds);
      const done = item.status !== 'inProgress';
      if (item.tool === 'spawnAgent') {
        // The Agent card, which opens the subagent's own thread (`codexSubagentThread`). Its result is what the agent
        // last reported, else that it started.
        const state = receivers[0] ? agentStates.get(receivers[0]) : undefined;
        const failed = item.status === 'failed' || AGENT_FAILED.has(state?.status ?? '');
        const result: Result = done ? { text: state?.message ?? (failed ? 'The agent did not start' : 'Agent started'), isError: failed } : null;
        tool({ name: 'Agent', input: { prompt: prompt ?? '', ...(model ? { model } : {}) } }, result);
      } else {
        // Waiting for, messaging or closing an agent: a generic card named after Codex's tool.
        const states = Object.values(obj(item.agentsStates)).map((s) => str(obj(s).message)).filter((m): m is string => !!m?.trim());
        const result: Result = done ? { text: states.join('\n\n'), isError: item.status === 'failed' } : null;
        tool({ name: snake(str(item.tool) ?? 'agent'), input: { ...(prompt ? { prompt } : {}), ...(receivers.length ? { agents: receivers } : {}) } }, result);
      }
      break;
    }
    case 'hookPrompt': {
      const text = arr(item.fragments).map((f) => str(obj(f).text) ?? '').filter((t) => t.trim()).join('\n\n');
      if (text) tool({ name: 'Hook', input: { prompt: text } }, { text: '', isError: false });
      break;
    }
    case 'dynamicToolCall': {
      const args = item.arguments;
      const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Loose) : args === undefined || args === null ? {} : { arguments: args };
      const output = toolOutput(arr(item.contentItems));
      const result: Result = item.status === 'inProgress' ? null : { text: output.text, isError: item.status === 'failed' || item.success === false, images: output.images };
      const namespace = str(item.namespace);
      tool({ name: namespace ? `${namespace}.${str(item.tool) ?? 'tool'}` : (str(item.tool) ?? 'tool'), input }, result);
      break;
    }
    case 'imageGeneration': {
      const saved = str(item.savedPath);
      const prompt = str(item.revisedPrompt);
      const data = str(item.result);
      const failed = item.failure !== null && item.failure !== undefined;
      const result: Result = item.status === 'inProgress' ? null : { text: saved ?? '', isError: failed, images: data ? [imageBlock('image/png', data)] : [] };
      tool({ name: 'ImageGeneration', input: { ...(prompt ? { prompt } : {}), ...(saved ? { file_path: saved } : {}) } }, result);
      break;
    }
    case 'subAgentActivity':
      // A subagent starting or finishing: the spawn's Agent card already shows it.
      break;
    default: {
      // An item this file doesn't know (sleep, a function's output, a newer kind): a generic card with its fields,
      // when it has any.
      const type = str(item.type);
      const input = Object.fromEntries(Object.entries(item).filter(([key]) => !ITEM_FIELDS.has(key)));
      if (type && Object.keys(input).length) tool({ name: type, input }, item.status === 'inProgress' ? null : { text: '', isError: FAILED.has(String(item.status)) });
      break;
    }
  }
}

const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** How a turn ended, when it didn't finish: stopped by you (the notice Claude Code's show), or failed with Codex's error. */
function turnEnd(turn: Turn, id: string): RawSessionMessage[] {
  const at = iso(num(turn.completedAt) !== null ? num(turn.completedAt)! * 1000 : null);
  const base = { parent_tool_use_id: null, ...(at ? { timestamp: at } : {}) };
  if (turn.status === 'interrupted') return [{ ...base, type: 'user', uuid: `${id}#end`, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }];
  if (turn.status === 'failed') {
    const error = str(obj(turn.error).message)?.trim();
    return [{ ...base, type: 'system', uuid: `${id}#end`, message: { role: 'system', content: [{ type: 'text', text: error ? `Codex stopped with an error: ${error}` : 'Codex stopped with an error' }] } }];
  }
  return [];
}
