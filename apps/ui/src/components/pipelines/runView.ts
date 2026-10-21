// Pipelines (#179): what the parent's step tree, a sub-session and a run row show, in words, without React or the
// stores, so it can be tested. The words a run shows on a phone too are the protocol's (`pipelineView.ts`), re-exported
// here; what only the computer shows (a step's actions) is below.

export {
  holdLine,
  PARENT_PLACEHOLDER,
  parentRows,
  pushLine,
  READ_ONLY_LINE,
  replyToStepPlaceholder,
  roundDivider,
  runButtons,
  stepDetail,
  stepDuration,
  stepMeta,
  stepPills,
  stepRowName,
  stopNotice,
  verdictView,
  waitsOnStep,
  withRunStub,
  type ParentRow,
  type StopNotice,
  type VerdictView,
} from '@switchboard/protocol/client';

/** A project action's result in a step's prompt, in a few words: "exit 0 · 214 passed", "exit 1 · 2 problems · last 40 lines attached". */
export function actionDetail(action: { exitCode: number | null; tail: string }): string {
  if (action.exitCode === null) return ['did not run', firstLine(action.tail)].filter(Boolean).join(' · ');
  const parts = [`exit ${action.exitCode}`];
  const count = countIn(action.tail, action.exitCode === 0);
  if (count) parts.push(count);
  if (action.exitCode !== 0) {
    const lines = action.tail.replace(/\n+$/, '').split('\n').filter((l, i, all) => l.trim() || i < all.length - 1).length;
    if (lines) parts.push(`last ${lines} ${lines === 1 ? 'line' : 'lines'} attached`);
  }
  return parts.join(' · ');
}

const firstLine = (text: string) => text.split('\n').find((l) => l.trim())?.trim().slice(0, 80) ?? '';

/** The count a test or lint run ends with ("214 passed", "2 problems"), from the end of its output. */
function countIn(tail: string, ok: boolean): string | null {
  const patterns = ok ? [/(\d+) (passed)/i, /(\d+) (tests?)\b/i] : [/(\d+) (problems?)/i, /(\d+) (failed)/i, /(\d+) (errors?)/i];
  const lines = tail.split('\n').reverse();
  for (const pattern of patterns) {
    for (const line of lines) {
      const m = pattern.exec(line);
      if (m) return `${m[1]} ${m[2]!.toLowerCase()}`;
    }
  }
  return null;
}
