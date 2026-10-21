// The pipeline last run from New session in each project (#179), so the Run as menu lists it first. A UI preference:
// kept in localStorage, read and written only when asked, so nothing touches storage at load.

const STORAGE_KEY = 'ui.lastPipeline';

function read(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

/** The pipeline last run in a project, or null. */
export function lastPipelineIn(root: string | null): string | null {
  return root ? (read()[root] ?? null) : null;
}

/** Remembers the pipeline just run in a project. */
export function rememberPipeline(root: string, pipelineId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), [root]: pipelineId }));
  } catch {
    // Private storage can be full or off: the menu keeps its usual order.
  }
}
