// Q: Can a session's auto-compact window change while it runs (`applyFlagSettings({ autoCompactWindow })`), the way
//    effort does? `getContextUsage()` reports the threshold, so this needs no full context to check.
//    And when set at start (`options.settings`), with `node 18-compact-window-live.mjs start`.
// Usage: SPIKE_SANDBOX=/tmp/x node 18-compact-window-live.mjs
import { query } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, inputQueue, log } from './lib.mjs';

const input = inputQueue();
const atStart = process.argv[2] === 'start' ? { settings: { autoCompactWindow: 150000 } } : {};
const q = query({ prompt: input, options: baseOptions({ model: 'sonnet', ...atStart }) });
const report = async (label) => {
  const u = await q.getContextUsage();
  log(label, JSON.stringify({ maxTokens: u.maxTokens, autoCompactThreshold: u.autoCompactThreshold, isAutoCompactEnabled: u.isAutoCompactEnabled, model: u.model }));
};
input.push('Reply with just OK.');
for await (const m of q) {
  if (m.type !== 'result') continue;
  await report('default        ');
  await q.applyFlagSettings({ autoCompactWindow: 150000 });
  await report('window 150000  ');
  await q.applyFlagSettings({ autoCompactWindow: 400000 });
  await report('window 400000  ');
  break;
}
input.end();
q.close();
