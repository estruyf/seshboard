import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from '../git/gitChanges.ts';
import type { GhCommand } from '../git/pullRequest.ts';
import { attributeLooseEnds, type BranchSession } from './looseEnds.ts';
import { repoFacts } from './looseEndsFacts.ts';
import { mergedMoves } from './mergedDone.ts';

let dir: string;
let repo: string;
let gh: GhCommand;
const run = (cwd: string, ...args: string[]) => git(cwd, args);
const env = () => ({ HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '', FAKE_GH_MODE: mode, FAKE_GH_PRS: JSON.stringify(prs) });
let mode = 'ok';
let prs: Array<Record<string, unknown>> = [];

async function commit(cwd: string, file: string, text: string) {
  writeFileSync(join(cwd, file), text);
  await run(cwd, 'add', file);
  await run(cwd, 'commit', '-qm', `change ${file}`);
}

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-loose-ends-')));
  const origin = join(dir, 'origin.git');
  await git(dir, ['init', '-q', '--bare', '-b', 'main', origin]);
  repo = join(dir, 'repo');
  await git(dir, ['clone', '-q', origin, repo]);
  // The test's own identity, and no signing or hooks from the machine's settings.
  for (const [key, value] of [['user.email', 'test@example.com'], ['user.name', 'Test'], ['commit.gpgsign', 'false'], ['core.hooksPath', '.git/hooks']]) await run(repo, 'config', key!, value!);
  writeFileSync(join(repo, '.gitignore'), '.claude/\n');
  await commit(repo, 'a.txt', 'one\n');
  await run(repo, 'add', '.gitignore');
  await run(repo, 'commit', '-qm', 'ignore');
  await run(repo, 'push', '-q', '-u', 'origin', 'main');
  // Where GitHub would be: never reached, but it makes gh's silence "unknown" rather than "not on GitHub".
  await run(repo, 'remote', 'add', 'github', 'https://github.com/acme/app.git');
  // A fake gh: `pr list` answers with FAKE_GH_PRS (the open ones with their checks for `--state open`), or fails offline.
  const script = join(dir, 'gh.mjs');
  writeFileSync(
    script,
    `const mode = process.env.FAKE_GH_MODE, prs = JSON.parse(process.env.FAKE_GH_PRS || '[]'), argv = process.argv.slice(2);
if (mode === 'offline') { process.stderr.write('error connecting to api.github.com\\n'); process.exit(1); }
if (argv[0] === 'pr' && argv[1] === 'list') {
  const open = argv.includes('open');
  process.stdout.write(JSON.stringify(prs.filter((p) => !open || p.state === 'OPEN')));
  process.exit(0);
}
process.exit(1);
`,
  );
  gh = { file: process.execPath, args: [script] };
  mode = 'ok';
  prs = [];
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const session = (id: string, cwd: string, branch: string, updatedAt: number): BranchSession => ({ id, cwd, branch, updatedAt });

describe('loose ends in a real repository', () => {
  it('finds uncommitted changes, commits not pushed in a shared worktree, and gives them to the newest session there', async () => {
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    const tree = join(repo, '.claude', 'worktrees', 'feat');
    await run(repo, 'worktree', 'add', '-q', '-b', 'feat/x', tree);
    await commit(tree, 'b.txt', 'two\n');
    await commit(tree, 'c.txt', 'three\n');
    writeFileSync(join(tree, 'd.txt'), 'new\n');
    const sessions = [session('on-main', repo, 'main', 1), session('plan', tree, 'feat/x', 2), session('exec', tree, 'feat/x', 3)];

    const { facts, github } = await repoFacts(repo, { env: env(), gh });
    expect(github).toBe(true);
    expect(Object.fromEntries(attributeLooseEnds(facts!, sessions))).toEqual({
      'on-main': [{ kind: 'uncommitted', files: 1 }],
      exec: [{ kind: 'uncommitted', files: 1 }, { kind: 'unpushed', commits: 2 }],
    });
  });

  it('lets a squash-merged pull request cancel "not pushed" once its branch is gone from the remote', async () => {
    await run(repo, 'switch', '-q', '-c', 'feat/squashed');
    await commit(repo, 'b.txt', 'two\n');
    await run(repo, 'push', '-q', '-u', 'origin', 'feat/squashed');
    // GitHub squashes it into main and deletes the branch: the branch's own commit is on no remote any more.
    await run(repo, 'push', '-q', 'origin', '--delete', 'feat/squashed');
    await run(repo, 'fetch', '-q', '--prune', 'origin');
    const sessions = [session('work', repo, 'feat/squashed', 5)];

    const without = await repoFacts(repo, { env: env(), gh });
    expect(Object.fromEntries(attributeLooseEnds(without.facts!, sessions))).toEqual({ work: [{ kind: 'unpushed', commits: 1 }] });

    prs = [{ number: 7, state: 'MERGED', headRefName: 'feat/squashed', url: 'https://github.com/acme/app/pull/7', mergedAt: '2026-11-01T10:00:00Z' }];
    const merged = await repoFacts(repo, { env: env(), gh });
    expect(merged.facts!.pullRequests!.get('feat/squashed')).toMatchObject({ number: 7, state: 'merged' });
    expect(Object.fromEntries(attributeLooseEnds(merged.facts!, sessions))).toEqual({});
    // The merge moves the session to Done when it was quiet since; activity after the merge keeps it where it is.
    const candidate = { id: 'work', branch: 'feat/squashed', listed: true, pinned: false, working: false, attention: false, openInApp: false, restoredAt: null, donePr: null, looseEnds: false };
    expect(mergedMoves(merged.facts!, [{ ...candidate, updatedAt: Date.parse('2026-11-01T09:00:00Z') }])).toEqual([{ sessionId: 'work', pr: 7 }]);
    expect(mergedMoves(merged.facts!, [{ ...candidate, updatedAt: Date.parse('2026-11-01T11:00:00Z') }])).toEqual([]);
  });

  it('reads failing checks of open pull requests from the rollup, and says unknown when gh is offline', async () => {
    await run(repo, 'switch', '-q', '-c', 'feat/ci');
    await commit(repo, 'b.txt', 'two\n');
    await run(repo, 'push', '-q', '-u', 'origin', 'feat/ci');
    prs = [
      {
        number: 9,
        state: 'OPEN',
        headRefName: 'feat/ci',
        url: 'https://github.com/acme/app/pull/9',
        statusCheckRollup: [
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'StatusContext', state: 'ERROR' },
        ],
      },
    ];
    const sessions = [session('ci', repo, 'feat/ci', 1)];
    const found = await repoFacts(repo, { env: env(), gh });
    expect(Object.fromEntries(attributeLooseEnds(found.facts!, sessions))).toEqual({ ci: [{ kind: 'checks-failing', pr: 9, failed: 2 }] });

    mode = 'offline';
    const offline = await repoFacts(repo, { env: env(), gh });
    expect(offline.github).toBe(false);
    expect(offline.facts).not.toBeNull();
  });

  it('has no facts for a folder that is not a repository', async () => {
    expect(await repoFacts(join(dir, 'nowhere'), { env: env(), gh })).toEqual({ facts: null, github: false });
  });
});
