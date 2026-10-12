import { describe, expect, it, vi } from 'vitest';
import type { GateOutcome } from '../../state/focusGate.ts';
import type { Choices } from './choices.ts';
import { checkoutBranchFor, sessionCreateParams, shouldPrewarm, startNewSession, type NewSessionStart, type StartDeps } from './startSession.ts';

const CHOICES: Choices = { model: 'opus', permissionMode: 'acceptEdits', effort: 'high', workspace: 'current', baseRef: 'fresh', branch: '' };
const START: NewSessionStart = { cwd: '/work/app', prompt: 'Fix the login redirect', choices: CHOICES, worktree: false, currentBranch: 'main', profileId: 'default' };

function deps(outcome: GateOutcome = 'start') {
  const calls: string[] = [];
  const fake = {
    calls,
    createSession: vi.fn(async () => (calls.push('create'), { sessionId: 'new-1' })),
    gate: vi.fn(async () => (calls.push('gate'), outcome)),
    addProject: vi.fn(async () => void calls.push('add')),
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
      autoPick: null,
    });
    expect(sessionCreateParams({ ...START, choices: { ...CHOICES, model: '', effort: '' } })).toMatchObject({ model: null, effort: null });
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
    expect(fake.calls).toEqual(['gate', 'create', 'add', 'open']);
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
    expect(fake.calls).toEqual(['create', 'open']);
  });

  it('still opens the session when adding the project fails', async () => {
    const fake = deps();
    fake.addProject.mockRejectedValueOnce(new Error('nope'));
    expect(await startNewSession({ ...START, addProject: true }, fake)).toMatchObject({ kind: 'started' });
    expect(fake.open).toHaveBeenCalled();
  });
});

describe('startNewSession with Auto', () => {
  const AUTO: NewSessionStart = { ...START, choices: { ...CHOICES, model: 'auto' }, attachments: [{ type: 'image', mediaType: 'image/png', data: 'x' }], autoEnabled: true };

  it('routes after the gate, and starts on the picked model with the pick', async () => {
    const fake = deps();
    const route = vi.fn(async () => (fake.calls.push('route'), { ok: true as const, routeId: 'r1', model: 'sonnet' as const, reason: 'A small change.', tokens: 900, estimateVsOpus: 0.6, allowed: ['haiku' as const, 'sonnet' as const] }));
    await startNewSession(AUTO, { ...fake, route });
    expect(fake.calls).toEqual(['gate', 'route', 'create', 'open']);
    expect(route).toHaveBeenCalledWith({ profileId: 'default', prompt: 'Fix the login redirect', imageCount: 1 });
    expect(fake.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'sonnet', autoPick: { routeId: 'r1', model: 'sonnet', reason: 'A small change.', tokens: 900, allowed: ['haiku', 'sonnet'] } }),
    );
  });

  it('starts nothing when routing is stopped (Esc), so the prompt stays', async () => {
    const fake = deps();
    expect(await startNewSession(AUTO, { ...fake, route: async () => null })).toEqual({ kind: 'stopped' });
    expect(fake.createSession).not.toHaveBeenCalled();
  });

  it('starts on the default model when Auto could not pick, and says why', async () => {
    const fake = deps();
    await startNewSession(AUTO, { ...fake, route: async () => ({ ok: false as const, routeId: null, reason: "Haiku didn't answer in time", tokens: 0, allowed: ['opus' as const] }) });
    expect(fake.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: null, autoPick: expect.objectContaining({ model: null, reason: "Haiku didn't answer in time" }) }));
  });

  it('never routes with Auto off: the default model, and no pick', async () => {
    const fake = deps();
    const route = vi.fn();
    await startNewSession({ ...AUTO, autoEnabled: false }, { ...fake, route });
    expect(route).not.toHaveBeenCalled();
    expect(fake.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: null, autoPick: null }));
  });

  it('does not route when the gate stops the start', async () => {
    const fake = deps('stop');
    const route = vi.fn();
    await startNewSession(AUTO, { ...fake, route });
    expect(route).not.toHaveBeenCalled();
  });
});
