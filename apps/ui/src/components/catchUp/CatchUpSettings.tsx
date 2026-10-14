import { Info } from 'lucide-react';
import type { CatchUpLayout } from '@switchboard/protocol/bridge';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Toggle } from '../ui/Toggle.tsx';

/** Settings › Conversation › Catch-up. */
export function CatchUpSettings() {
  const layout = usePreferences((s) => s.prefs.catchUpLayout);
  const summaries = usePreferences((s) => s.prefs.catchUpSummaries);
  const update = usePreferences((s) => s.update);
  return (
    <div className="grid gap-4" data-catchup-settings>
      <div className="flex items-center justify-between gap-4" data-setting-row>
        <span>
          <span className="block text-ui">Layout</span>
          <span className="block text-meta text-muted">A short briefing when a session finishes or needs you.</span>
        </span>
        <SegmentedControl<CatchUpLayout>
          mode="radio"
          label="Catch-up layout"
          value={layout}
          onChange={(catchUpLayout) => update({ catchUpLayout })}
          segments={[
            { value: 'card', label: 'Card', tooltip: 'In place of the conversation, until you expand it', data: { 'data-catchup-layout-choice': 'card' } },
            { value: 'banner', label: 'Banner', tooltip: 'Above the conversation, which stays in view', data: { 'data-catchup-layout-choice': 'banner' } },
            { value: 'off', label: 'Off', data: { 'data-catchup-layout-choice': 'off' } },
          ]}
          className="shrink-0"
        />
      </div>
      <Toggle
        label="Write catch-up summaries with Haiku"
        detail="Haiku reads your prompt, Claude’s last reply and the list of tool calls, never your files, diffs or memory. Off, the lines come from the tool calls."
        checked={summaries}
        attr="data-catchup-summaries"
        onChange={(catchUpSummaries) => update({ catchUpSummaries })}
      />
      <Notice tone="info" icon={<Info size={13} aria-hidden />}>
        Each summary uses a few thousand Haiku tokens. They count toward your plan and show in Usage as Catch-up summaries.
      </Notice>
    </div>
  );
}
