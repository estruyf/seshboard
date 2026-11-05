import { describe, expect, it } from 'vitest';
import { FAST_CREDITS_OUT, fastModeReport } from './fastMode.ts';

describe('fastModeReport', () => {
  it('says nothing for a Claude Code that sends no fast mode fields, or a state it does not know', () => {
    expect(fastModeReport({}, null)).toBeNull();
    expect(fastModeReport({ fast_mode_state: 'warp' }, null)).toBeNull();
  });

  it('does not treat a session that has not asked for fast mode as blocked', () => {
    expect(fastModeReport({ fast_mode_state: 'off', fast_mode_disabled_reason: 'sdk_opt_in_required' }, null)).toEqual({ fastMode: 'off', fastModeBlocked: null });
    expect(fastModeReport({ fast_mode_state: 'off', fast_mode_disabled_reason: 'pending' }, null)).toEqual({ fastMode: 'off', fastModeBlocked: null });
  });

  it("passes on what stands in fast mode's way, also a reason this version does not know", () => {
    expect(fastModeReport({ fast_mode_state: 'off', fast_mode_disabled_reason: 'extra_usage_disabled' }, null)).toEqual({ fastMode: 'off', fastModeBlocked: 'extra_usage_disabled' });
    expect(fastModeReport({ fast_mode_state: 'off', fast_mode_disabled_reason: 'something_new' }, null)).toEqual({ fastMode: 'off', fastModeBlocked: 'something_new' });
  });

  it('keeps being out of credits while it reports on, since that state stays on', () => {
    expect(fastModeReport({ fast_mode_state: 'on' }, FAST_CREDITS_OUT)).toEqual({ fastMode: 'on', fastModeBlocked: FAST_CREDITS_OUT });
    expect(fastModeReport({ fast_mode_state: 'on' }, null)).toEqual({ fastMode: 'on', fastModeBlocked: null });
    expect(fastModeReport({ fast_mode_state: 'off', fast_mode_disabled_reason: 'sdk_opt_in_required' }, FAST_CREDITS_OUT)).toEqual({ fastMode: 'off', fastModeBlocked: null });
  });

  it('reports a cooldown', () => {
    expect(fastModeReport({ fast_mode_state: 'cooldown' }, null)).toEqual({ fastMode: 'cooldown', fastModeBlocked: null });
  });
});
