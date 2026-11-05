import { describe, expect, it } from 'vitest';
import { askWhat, byTool, offersProjectProfile, switchNoticeFor, type SwitchFrom } from './providerSwitch.ts';

const claude: SwitchFrom = { profileOverride: null, provider: 'claude', worktree: false, checkoutBranch: null, runAsId: null, later: false, schedule: false };

describe('switching New session to a Copilot profile', () => {
  it('says the worktree was turned off, and Back goes to the profile it had', () => {
    expect(switchNoticeFor({ ...claude, worktree: true, profileOverride: 'work' }, 'copilot', [])).toEqual({
      back: 'work',
      provider: 'copilot',
      losses: ['worktree'],
      text: "Worktree turned off. GitHub Copilot can't run in a worktree yet.",
    });
  });

  it('counts a branch to check out only on the current checkout', () => {
    expect(switchNoticeFor({ ...claude, checkoutBranch: 'feat/login' }, 'copilot', [])?.losses).toEqual(['branch']);
    expect(switchNoticeFor({ ...claude, worktree: true, checkoutBranch: 'feat/login' }, 'copilot', [])?.losses).toEqual(['worktree']);
  });

  it('names a pipeline, the queue and a schedule', () => {
    expect(switchNoticeFor({ ...claude, runAsId: 'review' }, 'copilot', [])?.text).toBe("Pipeline turned off. GitHub Copilot can't run pipelines yet.");
    expect(switchNoticeFor({ ...claude, later: true, schedule: true }, 'copilot', [])?.losses).toEqual(['later', 'schedule']);
  });

  it('says nothing when nothing was on, when the provider has it, or between profiles of one provider', () => {
    expect(switchNoticeFor(claude, 'copilot', [])).toBeNull();
    expect(switchNoticeFor({ ...claude, worktree: true }, 'copilot', ['worktree'])).toBeNull();
    expect(switchNoticeFor({ ...claude, provider: 'copilot', worktree: true }, 'copilot', [])).toBeNull();
    expect(switchNoticeFor({ ...claude, worktree: true }, 'claude', [])).toBeNull();
  });
});

describe("making the profile the project's", () => {
  it("offers the link only when the picked profile isn't the project's own (or the default)", () => {
    expect(offersProjectProfile({ isProject: true, profileId: 'copilot', projectProfile: null, defaultProfile: 'builtin' })).toBe(true);
    expect(offersProjectProfile({ isProject: true, profileId: 'copilot', projectProfile: 'copilot', defaultProfile: 'builtin' })).toBe(false);
    expect(offersProjectProfile({ isProject: true, profileId: 'builtin', projectProfile: null, defaultProfile: 'builtin' })).toBe(false);
    expect(offersProjectProfile({ isProject: false, profileId: 'copilot', projectProfile: null, defaultProfile: 'builtin' })).toBe(false);
  });
});

it("asks what the provider should work on, by its short name", () => {
  expect(askWhat('copilot')).toBe('What should Copilot work on?');
  expect(askWhat('claude')).toBe('What should Claude work on?');
});

it("groups the profile menu by tool, Claude Code's first, keeping each group's order", () => {
  const profiles = [
    { id: 'a', provider: 'claude' as const },
    { id: 'c', provider: 'copilot' as const },
    { id: 'b', provider: 'claude' as const },
  ];
  expect(byTool(profiles).map((p) => p.id)).toEqual(['a', 'b', 'c']);
});
