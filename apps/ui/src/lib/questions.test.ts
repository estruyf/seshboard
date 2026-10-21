import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '@switchboard/protocol/client';
import { addedProjects, knownFolders } from '../state/projectList.ts';
import {
  INITIAL_QUESTION_CHOICES,
  isQuestionsFolder,
  questionPatch,
  questionStartingChoices,
  QUESTIONS_NAME,
  readQuestionChoices,
  sessionOptions,
  withQuestions,
} from './questions.ts';

const DIR = '/Users/me/Library/Application Support/Switchboard/questions';

const project = (root: string, added: boolean): ProjectInfo => ({
  root,
  name: root.split('/').pop()!,
  nameSource: 'folder',
  icon: null,
  iconSource: null,
  added,
  exists: true,
  order: added ? 0 : null,
  defaults: { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null, defaultBranch: null },
  profileId: null,
  sessionCount: 2,
  lastActivity: 10,
});

describe('quick questions', () => {
  it('know the scratch folder and the folders inside it, once its path is known', () => {
    expect(isQuestionsFolder(DIR, DIR)).toBe(true);
    expect(isQuestionsFolder(`${DIR}/`, DIR)).toBe(true);
    expect(isQuestionsFolder(`${DIR}/notes`, DIR)).toBe(true);
    expect(isQuestionsFolder(`${DIR}-old`, DIR)).toBe(false);
    expect(isQuestionsFolder('/work/app', DIR)).toBe(false);
    expect(isQuestionsFolder(DIR, null)).toBe(false);
    expect(isQuestionsFolder(null, DIR)).toBe(false);
  });

  it('name the folder Questions without listing it as a project or a folder to add', () => {
    // Even when the engine listed it anyway, the entry is the app's own.
    const map = withQuestions([project('/work/app', true), project('/work/other', false), project(DIR, false)], DIR);
    expect(map.get(DIR)?.name).toBe(QUESTIONS_NAME);
    expect(addedProjects(map).map((p) => p.root)).toEqual(['/work/app']);
    expect(knownFolders(map, '', '/Users/me').map((p) => p.root)).toEqual(['/work/app', '/work/other']);
    expect(knownFolders(map, 'quest', '/Users/me')).toEqual([]);
    expect([...withQuestions([project('/work/app', true)], null).keys()]).toEqual(['/work/app']);
  });

  it('offer no git, project defaults or actions', () => {
    expect(sessionOptions(true)).toEqual({ git: false, addAsProject: false, projectDefaults: false, projectActions: false });
    expect(sessionOptions(false)).toEqual({ git: true, addAsProject: true, projectDefaults: true, projectActions: true });
  });

  it('start cautious, in this folder as it is, with the choices last made for a question', () => {
    expect(questionStartingChoices(INITIAL_QUESTION_CHOICES)).toEqual({ model: '', effort: '', permissionMode: 'default', workspace: 'current', baseRef: 'fresh', branch: '' });
    expect(questionStartingChoices({ model: 'haiku', effort: 'low', permissionMode: 'plan' })).toMatchObject({ model: 'haiku', effort: 'low', permissionMode: 'plan' });
    // A mode that never asks is never where a question starts.
    for (const mode of ['bypassPermissions', 'auto', 'dontAsk'] as const) expect(questionStartingChoices({ ...INITIAL_QUESTION_CHOICES, permissionMode: mode }).permissionMode).toBe('default');
  });

  it('remember model, effort and mode, never git choices', () => {
    expect(questionPatch({ model: 'opus', workspace: 'worktree', branch: 'main' })).toEqual({ model: 'opus' });
    expect(questionPatch({ permissionMode: 'acceptEdits', effort: '' })).toEqual({ permissionMode: 'acceptEdits', effort: '' });
    expect(readQuestionChoices({ model: 'opus', permissionMode: 'plan', effort: 3 })).toEqual({ model: 'opus', permissionMode: 'plan', effort: '' });
    expect(readQuestionChoices(null)).toEqual(INITIAL_QUESTION_CHOICES);
  });
});
