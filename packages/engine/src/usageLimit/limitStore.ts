import type { DatabaseSync } from 'node:sqlite';
import { UsageLimitHit, type LimitResume } from '@seshboard/protocol';

/**
 * The limit each profile is at (`usage_limits`) and the sessions armed to resume when it resets (`limit_resumes`), so
 * both outlive the app. Lists are tiny: a few profiles, a few sessions.
 */
export class LimitStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      limits: db.prepare('SELECT json FROM usage_limits'),
      saveLimit: db.prepare('INSERT INTO usage_limits (profile_id, json) VALUES (?, ?) ON CONFLICT (profile_id) DO UPDATE SET json = excluded.json'),
      deleteLimit: db.prepare('DELETE FROM usage_limits WHERE profile_id = ?'),
      resumes: db.prepare('SELECT session_id AS sessionId, profile_id AS profileId, at, attempts FROM limit_resumes ORDER BY at'),
      saveResume: db.prepare(
        'INSERT INTO limit_resumes (session_id, profile_id, at, attempts) VALUES (?, ?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET profile_id = excluded.profile_id, at = excluded.at, attempts = excluded.attempts',
      ),
      deleteResume: db.prepare('DELETE FROM limit_resumes WHERE session_id = ?'),
    };
  }

  /** Every saved limit; a row that no longer reads as one is skipped. */
  limits(): UsageLimitHit[] {
    return (this.statements.limits.all() as Array<{ json: string }>).flatMap((row) => {
      try {
        const parsed = UsageLimitHit.safeParse(JSON.parse(row.json));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
  }

  saveLimit(limit: UsageLimitHit): void {
    this.statements.saveLimit.run(limit.profileId, JSON.stringify(limit));
  }

  deleteLimit(profileId: string): void {
    this.statements.deleteLimit.run(profileId);
  }

  resumes(): LimitResume[] {
    return (this.statements.resumes.all() as unknown as LimitResume[]).map((r) => ({ ...r }));
  }

  saveResume(resume: LimitResume): void {
    this.statements.saveResume.run(resume.sessionId, resume.profileId, resume.at, resume.attempts);
  }

  deleteResume(sessionId: string): void {
    this.statements.deleteResume.run(sessionId);
  }
}
