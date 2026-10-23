import { Info } from 'lucide-react';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Notice } from '../ui/Notice.tsx';
import { Toggle } from '../ui/Toggle.tsx';

/** Settings › Conversation › Catch-up. */
export function CatchUpSettings() {
  const summaries = usePreferences((s) => s.prefs.catchUpSummaries);
  const folded = usePreferences((s) => s.prefs.catchUpFolded);
  const update = usePreferences((s) => s.update);
  return (
    <div className="grid gap-4" data-catchup-settings>
      <Toggle
        label="Write catch-up summaries with Haiku"
        detail="A short briefing above the conversation when a session finishes, and a plain answer to Why? on a permission. Haiku reads your prompt, Claude’s last reply and the list of tool calls, never your files, diffs or memory."
        checked={summaries}
        attr="data-catchup-summaries"
        onChange={(catchUpSummaries) => update({ catchUpSummaries })}
      />
      <Toggle
        label="Show catch-ups folded"
        detail="A finished session shows the one-line strip instead of the full briefing. Press Space to open it. A turn that stopped with an error still opens in full."
        checked={folded}
        disabled={!summaries}
        attr="data-catchup-folded"
        onChange={(catchUpFolded) => update({ catchUpFolded })}
      />
      <Notice tone="info" icon={<Info size={13} aria-hidden />}>
        Each summary uses a few thousand Haiku tokens. They count toward your plan and show in Usage as Catch-up summaries.
      </Notice>
    </div>
  );
}
