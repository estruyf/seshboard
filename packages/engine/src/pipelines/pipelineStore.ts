import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { BUILT_IN_PIPELINES, isBuiltInPipeline, isSameOrInside, Pipeline, PipelineScope, PipelineStep, type PipelineSave } from '@switchboard/protocol';
import { z } from 'zod';

interface Row {
  id: string;
  name: string;
  scope_json: string;
  steps_json: string;
  auto_push: number;
  created_at: number;
  updated_at: number;
}

/** The built-ins, as pipelines: never stored, so a new version of Switchboard brings their new version. */
export const builtInPipelines = (): Pipeline[] => BUILT_IN_PIPELINES.map((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s })), builtIn: true, createdAt: 0, updatedAt: 0 }));

/**
 * Your pipelines (#179), kept in `pipelines`, a user choice, so they survive a cache rebuild. The built-ins come first
 * and are not stored: they can't be changed, only duplicated. A row that no longer parses is left out, not dropped.
 */
export class PipelineStore {
  private readonly statements;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      all: db.prepare('SELECT * FROM pipelines ORDER BY created_at, rowid'),
      one: db.prepare('SELECT * FROM pipelines WHERE id = ?'),
      upsert: db.prepare(`
        INSERT INTO pipelines (id, name, scope_json, steps_json, auto_push, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, scope_json = excluded.scope_json, steps_json = excluded.steps_json,
          auto_push = excluded.auto_push, updated_at = excluded.updated_at`),
      remove: db.prepare('DELETE FROM pipelines WHERE id = ?'),
    };
  }

  /** The built-ins, then yours, oldest first. */
  list(): Pipeline[] {
    return [...builtInPipelines(), ...this.own()];
  }

  /** Only yours: what a backup exports. */
  own(): Pipeline[] {
    return (this.statements.all.all() as unknown as Row[]).flatMap((row) => {
      const pipeline = toPipeline(row);
      return pipeline ? [pipeline] : [];
    });
  }

  /** The pipelines a project can run: every project's, and its own. */
  forProject(root: string): Pipeline[] {
    return this.list().filter((p) => p.scope.kind === 'all' || isSameOrInside(p.scope.root, root));
  }

  get(id: string): Pipeline | null {
    if (isBuiltInPipeline(id)) return builtInPipelines().find((p) => p.id === id) ?? null;
    const row = this.statements.one.get(id) as unknown as Row | undefined;
    return row ? toPipeline(row) : null;
  }

  /** Creates a pipeline (no `id`) or changes one of yours. A built-in can't be changed. */
  save(input: PipelineSave): Pipeline {
    if (input.id && isBuiltInPipeline(input.id)) throw new Error('Built-in pipelines can’t be changed. Duplicate one to start.');
    const before = input.id ? this.get(input.id) : null;
    const now = this.now();
    const pipeline: Pipeline = { id: before?.id ?? input.id ?? randomUUID(), name: input.name, scope: input.scope, steps: input.steps, autoPush: input.autoPush, builtIn: false, createdAt: before?.createdAt ?? now, updatedAt: now };
    this.write(pipeline);
    return pipeline;
  }

  /** Puts a pipeline back as it was (Undo, or a backup being restored). */
  restore(pipeline: Pipeline): void {
    if (isBuiltInPipeline(pipeline.id)) return;
    this.write({ ...pipeline, builtIn: false });
  }

  remove(id: string): Pipeline | null {
    const before = isBuiltInPipeline(id) ? null : this.get(id);
    if (before) this.statements.remove.run(id);
    return before;
  }

  private write(p: Pipeline): void {
    this.statements.upsert.run(p.id, p.name, JSON.stringify(p.scope), JSON.stringify(p.steps), p.autoPush ? 1 : 0, p.createdAt, p.updatedAt);
  }
}

const Steps = z.array(PipelineStep);

function toPipeline(row: Row): Pipeline | null {
  try {
    const parsed = Pipeline.safeParse({
      id: row.id,
      name: row.name,
      scope: PipelineScope.parse(JSON.parse(row.scope_json)),
      steps: Steps.parse(JSON.parse(row.steps_json)),
      autoPush: row.auto_push === 1,
      builtIn: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
