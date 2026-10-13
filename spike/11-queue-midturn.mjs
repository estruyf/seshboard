// Q: What does Claude Code do with a user message pushed while a turn is running?
//    Does SDKUserMessage.priority ('now' | 'next' | 'later') change it? Is B read at a tool boundary (steer), after the turn, or does it stop the turn?
// Usage: SPIKE_SANDBOX=/tmp/x node 11-queue-midturn.mjs [default|now|next|later]
import { query } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, log, describe } from './lib.mjs';

const priority = process.argv[2] ?? 'default';
const items = [];
let wake;
let done = false;
const push = (text, extra = {}) => {
  items.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, ...extra });
  wake?.();
};
const input = {
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (items.length) yield items.shift();
      if (done) return;
      await new Promise((r) => (wake = r));
    }
  },
};

const q = query({
  prompt: input,
  options: baseOptions({
    permissionMode: 'default',
    env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' },
    canUseTool: async (_t, i) => ({ behavior: 'allow', updatedInput: i }),
  }),
});

log(`scenario: B pushed with priority=${priority}`);
push('Run these two Bash commands one after the other, each in the foreground (never in the background): first `sleep 8 && echo one`, then `sleep 8 && echo two`. When both are done, reply with the single word ALPHA.');

let pushedB = false;
let results = 0;
const text = [];
for await (const m of q) {
  if (m.type === 'stream_event') continue;
  const d = describe(m);
  const extra = m.type === 'user' ? ` isReplay=${m.isReplay ?? false} priority=${m.priority ?? '-'}` : '';
  if (m.type === 'system' && m.subtype !== 'session_state_changed' && m.subtype !== 'init') log(d, JSON.stringify(m).slice(0, 160));
  else log(d + extra);
  if (m.type === 'user' && Array.isArray(m.message.content)) {
    for (const c of m.message.content) if (c.type === 'tool_result') log('   tool_result error=', c.is_error ?? false, JSON.stringify(String(Array.isArray(c.content) ? c.content.map((x) => x.text).join('') : c.content)).slice(0, 100));
  }
  if (m.type === 'assistant') {
    const t = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (t) { text.push(t); log('   text:', t.slice(0, 100)); }
    // First tool call is under way: push B now.
    if (!pushedB && m.message.content.some((c) => c.type === 'tool_use')) {
      pushedB = true;
      setTimeout(() => {
        log('>>> pushing B');
        push('Also: end your final answer with the single word BRAVO.', priority === 'default' ? {} : { priority });
      }, 2000);
    }
  }
  if (m.type === 'result') {
    results++;
    log(`result #${results}`, m.subtype, 'num_turns', m.num_turns, 'queued?', m.queued_user_messages ?? m.pending_user_messages ?? '-');
    if (results === 1) {
      // Give a following turn (B after the turn) a moment to start.
      setTimeout(() => { if (results === 1) { log('no second turn started; ending'); done = true; wake?.(); } }, 15000);
    } else { done = true; wake?.(); }
  }
}
log('all text:', JSON.stringify(text.join(' | ')));
log('results:', results);
