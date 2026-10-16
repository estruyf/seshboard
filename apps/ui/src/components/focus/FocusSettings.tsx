import { Minus, Plus } from 'lucide-react';
import { FOCUS_LIMIT_MAX, FOCUS_LIMIT_MIN, type FocusMode } from '@switchboard/protocol/bridge';
import type { ReactNode } from 'react';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Button } from '../ui/Button.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { lastLimit, rememberLimit } from './focusLimit.ts';

/** Where the article that explains the why lives. */
export const FOCUS_ARTICLE_URL = 'https://www.eliostruyf.com/ai-chaos-beast-head/';

function Row({ label, detail, children, labelId }: { label: string; detail: string; children: ReactNode; labelId?: string }) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-border py-3 first:border-t-0 first:pt-0" data-setting-row>
      <span className="min-w-0">
        <span id={labelId} className="block text-ui text-text">
          {label}
        </span>
        <span className="block text-meta text-muted">{detail}</span>
      </span>
      {children}
    </div>
  );
}

/** Settings › Focus: one switch, then the limit and how strict it is. */
export function FocusSettings() {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const on = prefs.focusLimit !== null;
  const limit = prefs.focusLimit ?? lastLimit();
  const setLimit = (next: number) => {
    const clamped = Math.min(FOCUS_LIMIT_MAX, Math.max(FOCUS_LIMIT_MIN, next));
    rememberLimit(clamped);
    update({ focusLimit: clamped });
  };

  return (
    <div className="grid gap-4" data-focus-settings>
      <p className="text-ui text-muted">
        AI makes starting work easy. A limit helps you keep up with what's already going.{' '}
        <a href={FOCUS_ARTICLE_URL} target="_blank" rel="noreferrer" className="text-link hover:underline" data-focus-why>
          Why a limit?
        </a>
      </p>
      <div className="rounded-xl border border-border bg-card px-4 py-3.5">
        <label className="flex cursor-pointer items-center justify-between gap-6">
          <span className="min-w-0">
            <span className="block text-ui text-text">Focus limit</span>
            <span className="block text-meta text-muted">Ask before going over a set number of sessions.</span>
          </span>
          <Switch checked={on} onChange={(next) => update({ focusLimit: next ? limit : null })} dataAttrs={{ 'data-focus-limit-switch': true }} />
        </label>
        {/* Only what the switch turns on: hidden while the limit is off. */}
        {on && (
          <div className="mt-3 border-t border-border pt-3" data-focus-options>
            <Row label="Sessions at the same time" detail="Working, waiting for you, or finished but not read yet." labelId="focus-limit-label">
              <div role="group" aria-labelledby="focus-limit-label" className="flex shrink-0 items-center rounded-md border border-edge">
                <Button variant="quiet" iconOnly icon={<Minus size={13} aria-hidden />} aria-label="Fewer sessions" disabled={limit <= FOCUS_LIMIT_MIN} onClick={() => setLimit(limit - 1)} className="rounded-r-none!" data-focus-limit-less />
                <output aria-live="polite" className="w-9 border-x border-edge text-center text-ui font-semibold tabular-nums text-text" data-focus-limit-value>
                  {limit}
                </output>
                <Button variant="quiet" iconOnly icon={<Plus size={13} aria-hidden />} aria-label="More sessions" disabled={limit >= FOCUS_LIMIT_MAX} onClick={() => setLimit(limit + 1)} className="rounded-l-none!" data-focus-limit-more />
              </div>
            </Row>
            <Row label="When you reach it" detail="Nudge asks first. Strict waits until you finish, settle or stop one.">
              <SegmentedControl<FocusMode>
                mode="radio"
                label="When you reach the focus limit"
                value={prefs.focusMode}
                onChange={(focusMode) => update({ focusMode })}
                segments={[
                  { value: 'nudge', label: 'Nudge', data: { 'data-focus-mode': 'nudge' } },
                  { value: 'strict', label: 'Strict', data: { 'data-focus-mode': 'strict' } },
                ]}
                className="shrink-0"
              />
            </Row>
            <Row label="Count terminal and IDE sessions" detail="Also count live Claude Code sessions started outside Switchboard.">
              <Switch checked={prefs.focusCountExternal} onChange={(focusCountExternal) => update({ focusCountExternal })} label="Count terminal and IDE sessions" dataAttrs={{ 'data-focus-count-external': true }} />
            </Row>
            <Row label="Count sessions on other computers" detail="Also count sessions that are working, need you or are unread on computers you paired.">
              <Switch checked={prefs.focusCountRemote} onChange={(focusCountRemote) => update({ focusCountRemote })} label="Count sessions on other computers" dataAttrs={{ 'data-focus-count-remote': true }} />
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}
