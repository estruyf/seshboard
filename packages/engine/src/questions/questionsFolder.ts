import { mkdirSync } from 'node:fs';
import { isSameOrInside, RpcError } from '@switchboard/protocol';

/**
 * The scratch folder every quick question runs in: one folder in the app's data folder, shared by all
 * of them. Claude Code sees an ordinary folder, so transcripts, resume, fork and search work as for any
 * other; Switchboard only makes sure it never becomes a project.
 */
export class QuestionsFolder {
  constructor(readonly path: string) {}

  /** Creates the folder when it is missing (the first question, or after it was deleted) and returns its path. */
  ensure(): string {
    mkdirSync(this.path, { recursive: true });
    return this.path;
  }

  /** The folder itself, or a folder inside it (Claude may `cd` into one it made). */
  contains(path: string): boolean {
    return isSameOrInside(path, this.path);
  }

  /** Refuses anything that would make the folder a project (add, rename, icon, profile, defaults). */
  assertNotProject(root: string): void {
    if (this.contains(root)) throw new RpcError('INVALID', 'Quick questions are not a project');
  }
}
