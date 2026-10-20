// Q: Can "Ask about this session" answer with read-only tools (Claude Code's own side question has none), while a
//    turn runs, without writing to the session file? Does the answer stream, does it report its tokens, and does
//    it reuse the session's prompt cache?
//    The ask is a short-lived fork (resume + forkSession + persistSession: false) that gets the question as a
//    prompt; a PreToolUse hook denies every tool but Read, Grep, Glob and `git status|diff|log|show`.
// Usage: SPIKE_SANDBOX=/tmp/x node 13-ask.mjs
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, describe, inputQueue, log, SANDBOX } from './lib.mjs';

const projectDir = join(homedir(), '.claude', 'projects', realpathSync(SANDBOX).replace(/[^a-zA-Z0-9]/g, '-'));
const files = () => (existsSync(projectDir) ? readdirSync(projectDir).filter((f) => f.endsWith('.jsonl')) : []);
const before = new Set(files());

const READ_ONLY = new Set(['Read', 'Grep', 'Glob']);
const GIT = /^git\s+(status|diff|log|show)(\s+[^;&|`$<>()\n]*)?$/;
const guard = async (input) => {
  const name = input.tool_name;
  const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command.trim() : '';
  const allowed = READ_ONLY.has(name) || (name === 'Bash' && GIT.test(command));
  log('   guard', name, command || '', allowed ? 'ALLOW' : 'DENY');
  return allowed
    ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
    : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Side questions can only read.' } };
};

// 1. A running session: one turn to set a word, then a long turn, and the ask in the middle of it.
const input = inputQueue();
const q = query({ prompt: input, options: baseOptions({ canUseTool: async (_t, i) => ({ behavior: 'allow', updatedInput: i }) }) });
input.push('Remember the code word PELICAN. Reply with just OK.');
let sessionId;
let results = 0;
let asking = null;
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
  if (m.type === 'stream_event') continue;
  log('main', describe(m));
  if (m.type === 'result') {
    results++;
    log('main usage', JSON.stringify(m.usage));
    if (results === 1) input.push('Run the Bash command `sleep 20 && echo done` in the foreground, then reply with the single word FINISHED.');
    if (results === 2) break;
  }
  if (results === 1 && !asking && m.type === 'assistant' && m.message.content.some((c) => c.type === 'tool_use')) asking = ask();
}
input.end();
q.close();
await asking;

async function ask() {
  const t = performance.now();
  log('>>> ask while the turn runs');
  const prompt = [
    'ASKQ1 <side-question> This is a side question from the user. Answer it from the conversation so far and the project. You may read files, search, and run git status, diff, log or show. Don\'t change anything and don\'t carry on with the task. Keep the answer short.',
    'Question: What was the code word? What is the first line of README.md? Then try to create a file hacked.txt with the Write tool and tell me if it worked.',
  ].join('\n\n');
  const helper = query({
    prompt,
    options: baseOptions({
      resume: sessionId,
      forkSession: true,
      persistSession: false,
      maxTurns: 8,
      hooks: { PreToolUse: [{ hooks: [guard] }] },
      canUseTool: async (_t, i) => ({ behavior: 'allow', updatedInput: i }),
    }),
  });
  let deltas = 0;
  for await (const m of helper) {
    if (m.type === 'stream_event') {
      if (m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') deltas++;
      continue;
    }
    log('   ask', describe(m));
    if (m.type === 'result') {
      log('<<< answer', `${Math.round(performance.now() - t)}ms`, JSON.stringify(m.result));
      log('    text deltas:', deltas, '| usage', JSON.stringify(m.usage), '| modelUsage', JSON.stringify(m.modelUsage), '| turns', m.num_turns);
    }
  }
}

const file = join(projectDir, `${sessionId}.jsonl`);
const text = readFileSync(file, 'utf8');
log('session file mentions ASKQ1:', text.includes('ASKQ1'), '| FINISHED in file:', text.includes('FINISHED'));
log('hacked.txt exists:', existsSync(join(SANDBOX, 'hacked.txt')));
log('new session files:', files().filter((f) => !before.has(f) && f !== `${sessionId}.jsonl`));
