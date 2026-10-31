import { describe, expect, it, vi } from 'vitest';
import type { GateOutcome } from '../../state/focusGate.ts';
import type { Choices } from './choices.ts';
import { branchBlocked, checkoutBranchFor, createParamsFor, sessionCreateParams, shouldPrewarm, startNewSession, type NewSessionStart, type StartDeps } from './startSession.ts';

const CHOICES: Choices = { model: 'opus', permissionMode: 'acceptEdits', effort: 'high', workspace: 'current', baseRef: 'fresh', branch: '' };
const START: NewSessionStart = { cwd: '/work/app', prompt: 'Fix the login redirect', choices: CHOICES, worktree: false, currentBranch: 'main', profileId: 'default' };

function deps(outcome: GateOutcome = 'start') {
  const calls: string[] = [];
  const fake = {
    calls,
    createSession: vi.fn(async () => (calls.push('create'), { sessionId: 'new-1' })),
    gate: vi.fn(async () => (calls.push('gate'), outcome)),
    addProject: vi.fn(async () => void calls.push('add')),
    keep: vi.fn(() => void calls.push('keep')),
    open: vi.fn(() => void calls.push('open')),
  } satisfies StartDeps & { calls: string[] };
  return fake;
}

describe('sessionCreateParams', () => {
  it('passes the choices, with empty ones as Claude Code’s defaults', () => {
    expect(sessionCreateParams(START)).toEqual({
      cwd: '/work/app',
      prompt: 'Fix the login redirect',
      attachments: [],
      model: 'opus',
      permissionMode: 'acceptEdits',
      effort: 'high',
      worktree: null,
      checkoutBranch: null,
      profileId: 'default',
    });
    expect(sessionCreateParams({ ...START, choices: { ...CHOICES, model: '', effort: '' } })).toMatchObject({ model: null, effort: null });
  });

  it('starts a provider profile with only the folder, the message, its model and mode', () => {
    expect(createParamsFor({ ...START, profileId: 'copilot', worktree: true, provider: { model: 'gpt-5-mini', permissionMode: 'auto' } })).toEqual({
      cwd: '/work/app',
      prompt: 'Fix the login redirect',
      attachments: [],
      model: 'gpt-5-mini',
      permissionMode: 'auto',
      profileId: 'copilot',
    });
  });

  it('gives a worktree a made-up name unless it was named', () => {
    const made = sessionCreateParams({ ...START, worktree: true }).worktree;
    expect(made?.baseRef).toBe('fresh');
    expect(made?.name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    expect(made?.name).not.toContain('login');
    expect(sessionCreateParams({ ...START, worktree: true, worktreeName: 'login' }).worktree).toEqual({ name: 'login', baseRef: 'fresh' });
  });

  it('checks out another branch first, but never for a worktree or the current branch', () => {
    const other = { ...CHOICES, branch: 'feature' };
    expect(sessionCreateParams({ ...START, choices: other }).checkoutBranch).toBe('feature');
    expect(checkoutBranchFor(other, true, 'main')).toBeNull();
    expect(checkoutBranchFor({ ...CHOICES, branch: 'main' }, false, 'main')).toBeNull();
  });

  it('never starts a link’s session in a mode that skips permission prompts', () => {
    expect(sessionCreateParams({ ...START, fromLink: true, choices: { ...CHOICES, permissionMode: 'bypassPermissions' } }).permissionMode).toBe('default');
  });
});

describe('branchBlocked', () => {
  it('says why a branch checked out in another worktree can’t be checked out here', () => {
    expect(branchBlocked('feature', ['feature', 'other'])).toBe('feature is checked out in another worktree. Pick another branch, or start in a new worktree.');
    expect(branchBlocked('main', ['feature'])).toBeNull();
    expect(branchBlocked(null, ['feature'])).toBeNull();
    expect(branchBlocked('feature', undefined)).toBeNull();
  });
});

describe('shouldPrewarm', () => {
  it('warms up the checkout as it is, not a worktree or another branch', () => {
    expect(shouldPrewarm(CHOICES)).toBe(true);
    expect(shouldPrewarm({ workspace: 'worktree', branch: '' })).toBe(false);
    expect(shouldPrewarm({ workspace: 'current', branch: 'feature' })).toBe(false);
  });
});

describe('startNewSession', () => {
  it('asks the focus limit first, then starts, adds the project and opens the session', async () => {
    const fake = deps();
    const outcome = await startNewSession({ ...START, addProject: true }, fake);
    expect(outcome).toEqual({ kind: 'started', sessionId: 'new-1' });
    expect(fake.calls).toEqual(['gate', 'create', 'keep', 'add', 'open']);
    expect(fake.open).toHaveBeenCalledWith('new-1');
    expect(fake.addProject).toHaveBeenCalledWith('/work/app');
  });

  it('starts nothing when the gate says stop, or when the prompt was saved for later', async () => {
    const stopped = deps('stop');
    expect(await startNewSession(START, stopped)).toEqual({ kind: 'stopped' });
    const saved = deps('saved');
    expect(await startNewSession(START, saved)).toEqual({ kind: 'saved' });
    expect([...stopped.calls, ...saved.calls]).toEqual(['gate', 'gate']);
  });

  it('hands the gate the way to save the prompt for later', async () => {
    const fake = deps();
    const saveForLater = vi.fn(async () => {});
    await startNewSession({ ...START, saveForLater }, fake);
    expect(fake.gate).toHaveBeenCalledWith({ saveForLater });
  });

  it('skips the gate after Start anyway, and never adds a link’s folder as a project', async () => {
    const fake = deps('stop');
    await startNewSession({ ...START, skipGate: true, fromLink: true, addProject: true }, fake);
    expect(fake.calls).toEqual(['create', 'keep', 'open']);
  });

  it('keeps the prompt with the choices it started with, so a session that fails first can start again', async () => {
    const fake = deps();
    await startNewSession({ ...START, worktree: true, attachments: [] }, fake);
    expect(fake.keep).toHaveBeenCalledWith('new-1', {
      cwd: '/work/app',
      prompt: 'Fix the login redirect',
      attachments: [],
      form: { choices: { ...CHOICES, workspace: 'worktree' }, profileId: 'default' },
    });
  });

  it('keeps nothing when the session could not be created', async () => {
    const fake = deps();
    fake.createSession.mockRejectedValueOnce(new Error('Not logged in'));
    await expect(startNewSession(START, fake)).rejects.toThrow('Not logged in');
    expect(fake.keep).not.toHaveBeenCalled();
  });

  it('starts nothing on a branch checked out in another worktree, but a new worktree still starts', async () => {
    const taken = { ...START, choices: { ...CHOICES, branch: 'feature' }, checkedOutElsewhere: ['feature'] };
    const fake = deps();
    await expect(startNewSession(taken, fake)).rejects.toThrow('feature is checked out in another worktree');
    expect(fake.calls).toEqual([]);
    expect(await startNewSession({ ...taken, worktree: true }, fake)).toMatchObject({ kind: 'started' });
  });

  it('still opens the session when adding the project fails', async () => {
    const fake = deps();
    fake.addProject.mockRejectedValueOnce(new Error('nope'));
    expect(await startNewSession({ ...START, addProject: true }, fake)).toMatchObject({ kind: 'started' });
    expect(fake.open).toHaveBeenCalled();
  });
});

describe('startNewSession with Auto', () => {
  const AUTO: NewSessionStart = { ...START, choices: { ...CHOICES, model: 'auto' }, autoEnabled: true };

  it('starts and opens the session at once, leaving the pick to the engine', async () => {
    const fake = deps();
    expect(await startNewSession(AUTO, fake)).toEqual({ kind: 'started', sessionId: 'new-1' });
    expect(fake.calls).toEqual(['gate', 'create', 'keep', 'open']);
    expect(fake.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'auto' }));
  });

  it('starts on the default model with Auto off', async () => {
    const fake = deps();
    await startNewSession({ ...AUTO, autoEnabled: false }, fake);
    expect(fake.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: null }));
  });
});

describe('sessionCreateParams from an issue or pull request', () => {
  const origin = { type: 'pr' as const, repo: 'o/r', number: 151, readOnly: false };

  it('keeps where it came from, and starts a pull request’s worktree from its branch', () => {
    const params = sessionCreateParams({ ...START, worktree: true, worktreeName: 'pr-151-x', github: { origin, worktreeFrom: { branch: 'feat/issue-start', pullRequest: 151, fork: false } } });
    expect(params.github).toEqual(origin);
    expect(params.worktree).toEqual({ name: 'pr-151-x', baseRef: { branch: 'feat/issue-start', pullRequest: 151, fork: false } });
    expect(params.checkoutPullRequest).toBeUndefined();
    expect(params.checkoutBranch).toBeNull();
  });

  it('checks a pull request out in the current folder, and never another branch with it', () => {
    const params = sessionCreateParams({ ...START, choices: { ...CHOICES, branch: 'other' }, github: { origin, checkoutPullRequest: { number: 151, repo: 'o/r' } } });
    expect(params.checkoutPullRequest).toEqual({ number: 151, repo: 'o/r' });
    expect(params.worktree).toBeNull();
    expect(params.checkoutBranch).toBeNull();
  });

  it('starts from an issue in a worktree branched as usual', () => {
    const params = sessionCreateParams({ ...START, worktree: true, worktreeName: 'issue-32-fix', github: { origin: { type: 'issue', repo: 'o/r', number: 32, readOnly: false } } });
    expect(params.worktree).toEqual({ name: 'issue-32-fix', baseRef: 'fresh' });
    expect(params.github).toEqual({ type: 'issue', repo: 'o/r', number: 32, readOnly: false });
  });
});

describe('startNewSession in a cloned repository the engine holds', () => {
  const needed = { root: '/work/app', brings: { hooks: [{ event: 'SessionStart', command: './setup.sh' }], mcpServers: [], allow: [], plugins: [], settings: [] } };
  const refusal = Object.assign(new Error('Answer whether to trust it first.'), { code: 'TRUST_NEEDED', details: needed });

  it('asks the trust question and starts again once it is trusted', async () => {
    const d = deps();
    d.createSession.mockRejectedValueOnce(refusal);
    const trust = vi.fn(async () => true);
    expect(await startNewSession(START, { ...d, trust })).toEqual({ kind: 'started', sessionId: 'new-1' });
    expect(trust).toHaveBeenCalledWith(needed);
    expect(d.createSession).toHaveBeenCalledTimes(2);
  });

  it('stops, keeping the prompt, when the question is cancelled; fails as before without one', async () => {
    const d = deps();
    d.createSession.mockRejectedValueOnce(refusal);
    expect(await startNewSession(START, { ...d, trust: async () => false })).toEqual({ kind: 'stopped' });
    expect(d.calls).not.toContain('open');
    const plain = deps();
    plain.createSession.mockRejectedValueOnce(refusal);
    await expect(startNewSession(START, plain)).rejects.toBe(refusal);
  });
});
