import { describe, expect, it } from 'vitest';
import { back, changeProject, currentStep, initialState, modeAllowed, modeForPrefix, NEW_SESSION_STEP, pushStep, switchMode, typeQuery, type PaletteStep } from './paletteState.ts';

const PROMPT: PaletteStep = { kind: 'prompt', root: '/work/app', worktree: false, chip: 'New session' };

describe('prefixes', () => {
  it('maps each prefix character to its mode', () => {
    expect(modeForPrefix('>')).toBe('commands');
    expect(modeForPrefix('+')).toBe('new');
    expect(modeForPrefix('!')).toBe('actions');
    expect(modeForPrefix('?')).toBe('help');
    expect(modeForPrefix('a')).toBeNull();
    expect(modeForPrefix(undefined)).toBeNull();
  });

  it('switches mode when a prefix is typed, keeping the rest as the query', () => {
    const goto = initialState('goto');
    expect(typeQuery(goto, '>')).toMatchObject({ mode: 'commands', query: '', steps: [] });
    expect(typeQuery(goto, '>new')).toMatchObject({ mode: 'commands', query: 'new' });
    expect(typeQuery(goto, '?')).toMatchObject({ mode: 'help' });
    expect(typeQuery(initialState('commands'), '!')).toMatchObject({ mode: 'actions', query: '' });
  });

  it('goes straight to picking a project with "+"', () => {
    const state = typeQuery(initialState('goto'), '+app');
    expect(state.mode).toBe('new');
    expect(currentStep(state)).toEqual(NEW_SESSION_STEP);
    expect(state.query).toBe('app');
  });

  it('treats everything as the query inside a step, and plain text as the query outside one', () => {
    const inStep = pushStep(initialState('commands'), NEW_SESSION_STEP);
    expect(typeQuery(inStep, '>x')).toMatchObject({ mode: 'commands', query: '>x', steps: [NEW_SESSION_STEP] });
    expect(typeQuery(initialState('goto'), 'fix the')).toMatchObject({ mode: 'goto', query: 'fix the' });
  });

  it('leaves a prefix mode for go-to when the prefix is deleted', () => {
    expect(back(initialState('commands'))).toEqual(initialState('goto'));
    expect(back(initialState('help'))).toEqual(initialState('goto'));
    expect(back(initialState('goto'))).toBeNull();
  });
});

describe('steps', () => {
  it('moves forward with an empty query and back to what was typed before', () => {
    let state = typeQuery(initialState('commands'), 'new');
    state = pushStep(state, NEW_SESSION_STEP);
    expect(state.query).toBe('');
    state = typeQuery(state, 'swi');
    state = pushStep(state, PROMPT);
    expect(currentStep(state)).toEqual(PROMPT);

    state = back(state)!;
    expect(currentStep(state)).toEqual(NEW_SESSION_STEP);
    expect(state.query).toBe('swi');
    state = back(state)!;
    expect(state).toMatchObject({ mode: 'commands', steps: [], query: 'new' });
  });

  it('leaves "+" for go-to when its first step goes back', () => {
    const state = initialState('new');
    expect(back(state)).toEqual(initialState('goto'));
    const prompt = pushStep(state, PROMPT);
    expect(currentStep(back(prompt)!)).toEqual(NEW_SESSION_STEP);
  });

  it('starts over when a command switches mode', () => {
    const state = pushStep(initialState('commands'), NEW_SESSION_STEP);
    expect(switchMode('help')).toEqual({ mode: 'help', query: '', steps: [], saved: [] });
    expect(currentStep(switchMode('goto'))).toBeNull();
    expect(currentStep(state)).not.toBeNull();
  });

  it('goes back to the project list when the project is changed, taking the prompt along', () => {
    let state = pushStep(initialState('commands'), NEW_SESSION_STEP);
    state = typeQuery(state, 'ap');
    state = changeProject(pushStep(state, PROMPT));
    expect(state).toMatchObject({ mode: 'commands', query: '', steps: [{ ...NEW_SESSION_STEP, from: '/work/app' }], saved: [''] });
    expect(back(state)).toMatchObject({ mode: 'commands', steps: [] });
  });

  it('puts a project list in place of a prompt step opened straight for a project', () => {
    const state = changeProject(pushStep(initialState('commands'), { ...PROMPT, worktree: true }));
    expect(state.steps).toEqual([{ kind: 'projects', purpose: 'new-session', worktree: true, chip: 'New session', from: '/work/app' }]);
    expect(back(state)).toMatchObject({ mode: 'commands', steps: [] });
    expect(changeProject(initialState('goto'))).toEqual(initialState('goto'));
  });
});

describe('in a pop-out', () => {
  it('has the commands, the project actions and the help, never Go to or New session', () => {
    expect(modeAllowed('commands', true)).toBe(true);
    expect(modeAllowed('actions', true)).toBe(true);
    expect(modeAllowed('help', true)).toBe(true);
    expect(modeAllowed('goto', true)).toBe(false);
    expect(modeAllowed('new', true)).toBe(false);
    expect(modeAllowed('goto', false) && modeAllowed('new', false)).toBe(true);
  });

  it('takes "+" as text, but still switches to the other prefixes', () => {
    const commands = initialState('commands');
    expect(typeQuery(commands, '+app', true)).toMatchObject({ mode: 'commands', query: '+app', steps: [] });
    expect(typeQuery(commands, '!', true)).toMatchObject({ mode: 'actions' });
    expect(typeQuery(commands, '?', true)).toMatchObject({ mode: 'help' });
  });

  it('goes back to the commands, which have nothing before them', () => {
    expect(back(initialState('commands'), true)).toBeNull();
    expect(back(initialState('actions'), true)).toEqual(initialState('commands'));
    expect(back(initialState('help'), true)).toEqual(initialState('commands'));
    // In the main window the commands go back to Go to.
    expect(back(initialState('commands'))).toEqual(initialState('goto'));
  });
});
