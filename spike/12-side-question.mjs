// Q: How does Claude Code run /btw (a side question) for an SDK host? Does it work while a turn runs, without
//    queueing or steering it? Does anything of the side exchange land in the session file? Does it stream?
//    And can a session that isn't running answer one from a short-lived fork that writes nothing?
// Usage: SPIKE_SANDBOX=/tmp/x node 12-side-question.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, inputQueue, log, describe, SANDBOX } from './lib.mjs';

const projectDir = join(homedir(), '.claude', 'projects', SANDBOX.replace(/[^a-zA-Z0-9]/g, '-'));
const files = () => (existsSync(projectDir) ? readdirSync(projectDir).filter((f) => f.endsWith('.jsonl')) : []);
const before = new Set(files());

// 1. A running session: one turn to set a word, then a long turn, and a side question in the middle of it.
const input = inputQueue();
const q = query({
  prompt: input,
  options: baseOptions({ env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' }, canUseTool: async (_t, i) => ({ behavior: 'allow', updatedInput: i }) }),
});
input.push('Remember the code word PELICAN. Reply with just OK.');
let sessionId;
let results = 0;
let asked = false;
let sideStreamEvents = 0;
let sideAt = 0;
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
  if (m.type === 'stream_event') {
    if (sideAt && !results) sideStreamEvents++;
    continue;
  }
  if (m.type === 'system' && m.subtype === 'control_request_progress') log('progress', JSON.stringify(m));
  else if (m.type !== 'system' || m.subtype !== 'session_state_changed') log(describe(m));
  if (m.type === 'result') {
    results++;
    if (results === 1) input.push('Run the Bash command `sleep 10 && echo done` in the foreground, then reply with the single word FINISHED.');
    if (results === 2) break;
  }
  if (results === 1 && !asked && m.type === 'assistant' && m.message.content.some((c) => c.type === 'tool_use')) {
    asked = true;
    sideAt = performance.now();
    log('>>> askSideQuestion while the turn runs');
    q.askSideQuestion('BTWQ1: what was the code word?')
      .then((r) => log('<<< side answer', `${Math.round(performance.now() - sideAt)}ms`, JSON.stringify(r)))
      .catch((e) => log('<<< side error', e.message));
  }
}
log('stream events from the main turn while the side question ran (not split per request):', sideStreamEvents);
input.end();
q.close();

const file = join(projectDir, `${sessionId}.jsonl`);
const text = readFileSync(file, 'utf8');
log('session file mentions BTWQ1:', text.includes('BTWQ1'), '| lines:', text.split('\n').length);

// 2. The session isn't running: a short-lived fork that persists nothing.
const helper = query({
  prompt: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) },
  options: baseOptions({ resume: sessionId, forkSession: true, persistSession: false }),
});
const t = performance.now();
try {
  const r = await helper.askSideQuestion('BTWQ2: what was the code word?', { history: [{ question: 'BTWQ1: what was the code word?', response: 'PELICAN' }] });
  log('helper answer', `${Math.round(performance.now() - t)}ms`, JSON.stringify(r));
} catch (e) {
  log('helper error', e.message);
}
helper.close();
const after = readFileSync(file, 'utf8');
log('original file changed by the helper:', after !== text, '| mentions BTWQ2:', after.includes('BTWQ2'));
log('new session files:', files().filter((f) => !before.has(f) && f !== `${sessionId}.jsonl`));
