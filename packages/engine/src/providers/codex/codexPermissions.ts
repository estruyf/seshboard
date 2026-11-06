import type { PermissionDecision, PermissionRequest } from '@seshboard/protocol';
import { clipJson, LIMITS } from '../../claude/transcript.ts';
import { codexFileTool, codexItemId, shellCommand } from './codexEvents.ts';
import type { ApprovalDecision, ServerRequest, ThreadItem } from './protocol.ts';

type Loose = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const COMMAND = 'item/commandExecution/requestApproval';
const FILE_CHANGE = 'item/fileChange/requestApproval';
const QUESTION = 'item/tool/requestUserInput';

/** Whether Codex takes this answer to the request: all of them when it doesn't list them (`availableDecisions`). */
const offers = (params: Loose, decision: string) => !Array.isArray(params.availableDecisions) || params.availableDecisions.includes(decision);

/** The last part of a path, for a title. */
const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/**
 * A request of Codex's (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
 * `item/tool/requestUserInput`) as the permission or question card Claude Code's would show. Null for a request
 * Seshboard doesn't show, which the driver refuses.
 *
 * `item`: the item the request is about, as `CodexLive.item` has it. A file change's request has no diff of its own,
 * and a command's may leave the command to the item.
 */
export function codexPermissionRequest(requestId: string, request: ServerRequest, item: ThreadItem | null = null, now = Date.now()): Omit<PermissionRequest, 'sessionId'> | null {
  const params = obj(request.params);
  const known = obj(item);
  const turnId = str(params.turnId);
  const itemId = str(params.itemId);
  const toolUseId = turnId && itemId ? codexItemId(turnId, itemId) : null;
  const reason = str(params.reason);
  let toolName: string;
  let input: Loose;
  let title: string | null = null;
  let description: string | null = reason;
  let alwaysLabel: string | null = null;
  switch (request.method) {
    case COMMAND: {
      const command = shellCommand(str(params.command) ?? str(known.command) ?? '');
      const cwd = str(params.cwd) ?? str(known.cwd);
      const host = str(obj(params.networkApprovalContext).host);
      toolName = 'Bash';
      input = { command, ...(cwd ? { cwd } : {}), ...(reason ? { description: reason } : {}) };
      title = params.kind === 'writeStdin' ? 'Codex wants to type into a running command' : host ? `Codex wants network access to ${host}` : 'Codex wants to run a command';
      // What Codex's "for the session" means for a command: this command, until the session closes. Its proposed rule
      // (`proposedExecpolicyAmendment`) would be written to Codex's own settings for every session: not offered.
      alwaysLabel = offers(params, 'acceptForSession') ? 'Allow this command in this session' : null;
      break;
    }
    case FILE_CHANGE: {
      const changes = known.type === 'fileChange' ? arr(known.changes).map(obj) : [];
      const root = str(params.grantRoot);
      if (changes.length === 1) {
        // The transcript's card for the change: Edit (MultiEdit) with its hunks, Write with the content, Delete, Move.
        const tool = codexFileTool(changes[0]);
        toolName = tool.name;
        input = tool.input;
        const verb = { Write: 'create', Delete: 'delete', Move: 'move' }[tool.name] ?? 'edit';
        title = `Codex wants to ${verb} ${fileName(str(changes[0]!.path) ?? '')}`;
      } else {
        // Several files (or none known yet): the Edit card for the first, with every change in its details.
        toolName = 'Edit';
        const paths = changes.map((c) => str(c.path)).filter((p): p is string => !!p);
        input = { file_path: paths[0] ?? root ?? '', ...(changes.length ? { changes: changes.map((c) => ({ path: str(c.path) ?? '', ...codexFileTool(c) })) } : {}) };
        title = changes.length ? `Codex wants to change ${changes.length} files` : 'Codex wants to change files';
        if (paths.length) description = [reason, paths.join('\n')].filter(Boolean).join('\n\n');
      }
      if (root) {
        // Codex asks to write anywhere under a folder for the rest of the session: Allow grants it.
        title = `Codex wants to write in ${root}`;
        description = [reason, `Allow lets Codex change any file in ${root} for the rest of this session.`].filter(Boolean).join('\n\n');
      }
      alwaysLabel = offers(params, 'acceptForSession') ? 'Allow changes to these files in this session' : null;
      break;
    }
    case QUESTION: {
      const questions = arr(params.questions).map(obj).filter((q) => str(q.question));
      if (!questions.length) return null;
      toolName = 'AskUserQuestion';
      // Codex's questions take one answer: an option, or what you type (`isOther`; the card always offers it). A secret
      // one (`isSecret`) shows as typed, as nothing on the card hides it.
      input = {
        questions: questions.map((q) => ({
          question: q.question,
          header: str(q.header) ?? '',
          multiSelect: false,
          options: arr(q.options)
            .map(obj)
            .flatMap((o) => (str(o.label) ? [{ label: o.label, description: str(o.description) ?? '' }] : [])),
        })),
      };
      description = null;
      break;
    }
    default:
      // Permission profiles, MCP elicitations, dynamic tool calls and the legacy approvals: refused by the driver.
      return null;
  }
  const { value, truncated } = clipJson(input, LIMITS.toolInputString);
  return {
    requestId,
    toolName,
    toolUseId,
    input: value,
    ...(truncated ? { truncated } : {}),
    title,
    description,
    decisionReason: null,
    blockedPath: null,
    alwaysLabel,
    agentId: null,
    createdAt: now,
  };
}

/** Codex's answer to a question: each question's answers, by its id. */
export interface CodexUserInputAnswer {
  answers: Record<string, { answers: string[] }>;
}

/**
 * The answer Codex expects for its request, from the card's decision: `{ decision }` for an approval (Allow is
 * `accept`, Always allow `acceptForSession`, Deny `decline`, Deny that stops the turn `cancel`), `{ answers }` for a
 * question. Null for a request `codexPermissionRequest` doesn't show.
 *
 * An edited command (`updatedInput.command`) can't go to Codex, which runs only what it asked for: that is declined, as
 * you didn't approve the command Codex would run. No card edits a command (only `session.respond` itself could send
 * one), so the card doesn't mention it.
 */
export function codexAnswer(request: ServerRequest, decision: PermissionDecision): { decision: ApprovalDecision } | CodexUserInputAnswer | null {
  const params = obj(request.params);
  switch (request.method) {
    case COMMAND:
    case FILE_CHANGE: {
      if (decision.behavior === 'deny') return { decision: decision.interrupt ? 'cancel' : 'decline' };
      const edited = str(decision.updatedInput?.command);
      if (request.method === COMMAND && edited && edited.trim() !== shellCommand(str(params.command) ?? '').trim()) return { decision: 'decline' };
      return { decision: decision.always ? 'acceptForSession' : 'accept' };
    }
    case QUESTION: {
      if (decision.behavior === 'deny') return { answers: {} };
      // The card answers by question text, its picks and what you typed joined with `, `.
      const given = obj(decision.updatedInput?.answers);
      const answers: Record<string, { answers: string[] }> = {};
      for (const q of arr(params.questions).map(obj)) {
        const id = str(q.id);
        const question = str(q.question);
        if (!id || !question) continue;
        const answer = str(given[question])?.trim();
        answers[id] = { answers: answer ? [answer] : [] };
      }
      return { answers };
    }
    default:
      return null;
  }
}
