import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseFetches, fetchBranch } from './baseFetches.ts';
import { git } from './gitChanges.ts';

const commit = (cwd: string, message: string) => git(cwd, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message]);
const head = async (cwd: string, ref: string) => (await git(cwd, ['rev-parse', ref])).trim();

describe('BaseFetches', () => {
  let scratch: string;
  let origin: string;
  let repo: string;

  beforeEach(async () => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-base-fetch-')));
    origin = join(scratch, 'origin');
    mkdirSync(origin);
    await git(origin, ['init', '-q', '-b', 'dev']);
    await commit(origin, 'first');
    repo = join(scratch, 'repo');
    await git(scratch, ['clone', '-q', origin, repo]);
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it('fetches the branch into its remote-tracking ref', async () => {
    await commit(origin, 'second');
    await new BaseFetches().ensure(repo, 'origin', 'dev');
    expect(await head(repo, 'refs/remotes/origin/dev')).toBe(await head(origin, 'dev'));
  });

  it('skips a fetch while the last one is fresh, and fetches again after', async () => {
    let now = 0;
    let fetches = 0;
    const fetches_ = new BaseFetches({ now: () => now, freshMs: 1_000, fetch: (...args) => (fetches++, fetchBranch(...args)) });
    await fetches_.ensure(repo, 'origin', 'dev');
    await commit(origin, 'second');
    now = 500;
    await fetches_.ensure(repo, 'origin', 'dev');
    expect(fetches).toBe(1);
    expect(await head(repo, 'refs/remotes/origin/dev')).not.toBe(await head(origin, 'dev'));
    now = 1_500;
    await fetches_.ensure(repo, 'origin', 'dev');
    expect(fetches).toBe(2);
    expect(await head(repo, 'refs/remotes/origin/dev')).toBe(await head(origin, 'dev'));
  });

  it('joins a fetch that is running instead of starting another', async () => {
    let fetches = 0;
    const fetches_ = new BaseFetches({ fetch: (...args) => (fetches++, fetchBranch(...args)) });
    await Promise.all([fetches_.ensure(repo, 'origin', 'dev'), fetches_.ensure(repo, 'origin', 'dev')]);
    expect(fetches).toBe(1);
  });

  it('never throws, and tries again after a failed fetch', async () => {
    let fetches = 0;
    const fetches_ = new BaseFetches({ fetch: (...args) => (fetches++, fetchBranch(...args)) });
    await expect(fetches_.ensure(repo, 'origin', 'no-such-branch')).resolves.toBeUndefined();
    await fetches_.ensure(repo, 'origin', 'no-such-branch');
    expect(fetches).toBe(2);
  });
});
