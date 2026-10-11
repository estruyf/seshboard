import { isSameOrInside, type Effort, type PermissionMode, type ProjectInfo } from '@switchboard/protocol/client';
import { linkPermissionMode, type Choices } from '../components/newSession/choices.ts';

/**
 * Quick questions: sessions started without picking a project. They all run in one scratch folder the
 * engine owns (`questions.folder`), so Claude Code sees an ordinary folder and transcripts, resume, fork and
 * search work as for any other session. The UI only names that folder differently and leaves out what a
 * project has (git, project actions, defaults).
 */

/** What sessions in the scratch folder are called wherever a project's name would show. */
export const QUESTIONS_NAME = 'Questions';
/** One of them, in New session, the palette and the session header. */
export const QUESTION_LABEL = 'Quick question';

/** Whether `path` is the scratch folder (or a folder inside it). False until the folder is known. */
export function isQuestionsFolder(path: string | null | undefined, dir: string | null): boolean {
  if (!path || !dir) return false;
  return isSameOrInside(path, dir);
}

/**
 * The scratch folder as an entry in the projects map, so every place that names a session's folder says
 * "Questions". It is never `added` and counts no sessions, so no list of projects or folders shows it.
 */
export function questionsEntry(dir: string): ProjectInfo {
  return {
    root: dir,
    name: QUESTIONS_NAME,
    nameSource: 'custom',
    icon: null,
    iconSource: null,
    added: false,
    exists: true,
    order: null,
    defaults: { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null },
    profileId: null,
    sessionCount: 0,
    lastActivity: null,
  };
}

/** The projects as the engine lists them, plus the scratch folder's entry once its path is known. */
export function withQuestions(projects: readonly ProjectInfo[], dir: string | null): Map<string, ProjectInfo> {
  const map = new Map(projects.filter((p) => !isQuestionsFolder(p.root, dir)).map((p) => [p.root, p]));
  if (dir) map.set(dir, questionsEntry(dir));
  return map;
}

/** What a quick question offers: no git (worktree, branch, base), no project to add, save defaults for, or run actions in. */
export interface SessionOptions {
  git: boolean;
  addAsProject: boolean;
  projectDefaults: boolean;
  projectActions: boolean;
}

export function sessionOptions(question: boolean): SessionOptions {
  return { git: !question, addAsProject: !question, projectDefaults: !question, projectActions: !question };
}

/** The choices remembered for quick questions, apart from those for projects. */
export interface QuestionChoices {
  model: string;
  effort: Effort | '';
  permissionMode: PermissionMode;
}

/** Where the quick question choices are kept in the engine's app state. */
export const QUESTION_DEFAULTS_KEY = 'newSession.questionDefaults';

export const INITIAL_QUESTION_CHOICES: QuestionChoices = { model: '', effort: '', permissionMode: 'default' };

/** Reads stored quick question choices leniently. */
export function readQuestionChoices(value: unknown): QuestionChoices {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    model: typeof raw.model === 'string' ? raw.model : INITIAL_QUESTION_CHOICES.model,
    effort: typeof raw.effort === 'string' ? (raw.effort as Effort | '') : INITIAL_QUESTION_CHOICES.effort,
    permissionMode: typeof raw.permissionMode === 'string' && raw.permissionMode !== '' ? (raw.permissionMode as PermissionMode) : INITIAL_QUESTION_CHOICES.permissionMode,
  };
}

/**
 * What a quick question starts with: the choices last made for one, in this folder as it is. The permission
 * mode is the one last picked unless it never asks (bypass, auto, don't ask): a question starts cautious, and
 * a mode that skips prompts is picked again each time.
 */
export function questionStartingChoices(stored: QuestionChoices): Choices {
  return {
    model: stored.model,
    effort: stored.effort,
    permissionMode: linkPermissionMode(stored.permissionMode),
    workspace: 'current',
    baseRef: 'fresh',
    branch: '',
  };
}

/** The part of a change to remember for the next quick question (model, effort and mode; never git). */
export function questionPatch(patch: Partial<Choices>): Partial<QuestionChoices> {
  const out: Partial<QuestionChoices> = {};
  if (patch.model !== undefined) out.model = patch.model;
  if (patch.effort !== undefined) out.effort = patch.effort;
  if (patch.permissionMode !== undefined) out.permissionMode = patch.permissionMode;
  return out;
}
