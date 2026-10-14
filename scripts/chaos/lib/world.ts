/**
 * The sandbox a chaos run plays in: the README screenshots' demo home (createDemoWorld), with a remote, branches,
 * worktrees and shared actions on acme-store, a fake `gh` that never reaches GitHub, and a fake `claude` that never
 * reaches a model (it fails like Claude Code without a login, or hangs, or prints garbage, by the file
 * `.chaos/claude-mode`). A `git` wrapper in `.chaos/bin` passes through to the real git, sleeping first when
 * `.chaos/git-delay` holds a number of seconds. `open`, `code` and other editors only log.
 *
 * Everything lives in one folder per run (`root`): home/, the app profile, tmp/, exports/ and trash/.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createDemoWorld, type DemoWorld } from '../../../apps/desktop/scripts/screenshot-demo.ts';

export interface ChaosWorld extends DemoWorld {
  /** The run's own folder (`sbc-*` in the temporary folder). Everything the run may change is in it. */
  root: string;
  /** The demo's acme-store repository, the one with branches, worktrees and actions. */
  acme: string;
  /** Folders the run may change: just `root`. */
  sandboxes: string[];
  ghPath: string;
  claudeMode(mode: 'fail' | 'hang' | 'garbage' | 'slow-fail'): void;
  gitDelay(seconds: number): void;
  ghMode(mode: 'signed-in' | 'signed-out' | 'garbage' | 'hang' | 'exit-2'): void;
}

const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();

export function git(cwd: string, args: string[], date?: Date): string {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', ...(date ? { GIT_AUTHOR_DATE: date.toISOString(), GIT_COMMITTER_DATE: date.toISOString() } : {}) };
  return execFileSync(realGit, ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commitFile(cwd: string, path: string, content: string, message: string): void {
  mkdirSync(join(cwd, path, '..'), { recursive: true });
  writeFileSync(join(cwd, path), content);
  git(cwd, ['add', path]);
  git(cwd, ['commit', '-q', '-m', message]);
}

function script(path: string, body: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

/** True when `path` is one of the sandboxes or inside one (resolved, so `..` can't escape). */
export function insideSandbox(path: string, sandboxes: string[]): boolean {
  const p = resolve(path);
  return sandboxes.some((s) => p === s || p.startsWith(s.endsWith(sep) ? s : s + sep));
}

/** Where sandboxes go: short, so the companion's Unix socket path (TMPDIR/switchboard-XXXXXX/engine.sock) stays under 104 bytes. */
export const SANDBOX_PARENT = process.platform === 'darwin' ? '/private/tmp' : realpathSync(tmpdir());
/** A sandbox root as `createChaosWorld` names it, which is the only kind of folder `destroy` removes. */
export const isSandboxRoot = (path: string) => path.startsWith(join(SANDBOX_PARENT, 'sbc-'));

export function createChaosWorld(): ChaosWorld {
  const root = realpathSync(mkdtempSync(join(SANDBOX_PARENT, 'sbc-')));
  mkdirSync(join(root, 'home'));
  const world = createDemoWorld(join(root, 'home'));
  const home = world.home;
  const acme = join(home, 'Developer', 'acme-store');
  const chaos = join(home, '.chaos');
  mkdirSync(join(chaos, 'bin'), { recursive: true });

  // A remote, a few branches and worktrees, as the website's screenshots set them up.
  const remote = join(home, 'remotes', 'acme-store.git');
  mkdirSync(remote, { recursive: true });
  git(remote, ['init', '-q', '--bare', '-b', 'main']);
  git(acme, ['remote', 'add', 'origin', remote]);
  git(acme, ['push', '-q', '-u', 'origin', 'main']);
  const branch = (name: string, path: string, content: string) => {
    const tree = join(home, '.tmp-branches', name.replace(/\//g, '-'));
    git(acme, ['worktree', 'add', '-q', '-b', name, tree, 'main']);
    commitFile(tree, path, content, `Work on ${name}`);
    git(acme, ['worktree', 'remove', '--force', tree]);
  };
  branch('feat/product-reviews', 'src/reviews.ts', 'export const reviews = [];\n');
  git(acme, ['push', '-q', 'origin', 'feat/product-reviews']);
  branch('feat/wishlist', 'src/wishlist.ts', 'export const wishlist = new Set<string>();\n');
  const worktrees = join(acme, '.claude', 'worktrees');
  git(acme, ['worktree', 'add', '-q', '-b', 'worktree-brave-humming-otter', join(worktrees, 'brave-humming-otter'), 'main']);
  git(acme, ['worktree', 'add', '-q', '-b', 'worktree-tidy-silver-heron', join(worktrees, 'tidy-silver-heron'), 'main']);
  writeFileSync(join(worktrees, 'tidy-silver-heron', 'src', 'checkout.ts'), 'export const checkout = () => "todo";\n');
  writeFileSync(join(acme, '.git', 'info', 'exclude'), '.claude/worktrees/\n.switchboard.json\n');
  writeFileSync(
    join(acme, '.switchboard.json'),
    `${JSON.stringify(
      {
        actions: [
          { name: 'Test', icon: 'flask', command: 'sleep 30; echo done', shortcut: 'cmd+shift+t' },
          { name: 'Echo', icon: 'play', command: 'echo hello from chaos' },
          { name: 'Review', icon: 'sparkles', type: 'prompt', command: 'Review the changes on ${branch}.' },
        ],
      },
      null,
      2,
    )}\n`,
  );

  // The shell the app reads its PATH from: the chaos bin first (the git wrapper), then the fake claude.
  writeFileSync(join(home, '.zshrc'), `PROMPT='%1~ %# '\nunsetopt PROMPT_SP\nexport PATH="$HOME/.chaos/bin:$HOME/.local/bin:$PATH"\n`);
  writeFileSync(join(home, '.bashrc'), "PS1='\\W $ '\nexport PATH=\"$HOME/.chaos/bin:$HOME/.local/bin:$PATH\"\n");
  writeFileSync(join(home, '.bash_profile'), 'source ~/.bashrc\n');

  script(
    join(chaos, 'bin', 'git'),
    `#!/bin/sh\nd=$(cat "${chaos}/git-delay" 2>/dev/null)\nif [ -n "$d" ] && [ "$d" != "0" ]; then sleep "$d"; fi\nexec "${realGit}" "$@"\n`,
  );
  writeFileSync(join(chaos, 'git-delay'), '0');

  // Editors, Finder and URLs: the engine starts them by name (`open -a …`, `code`); here they only log.
  for (const name of ['open', 'code', 'cursor', 'xdg-open', 'zed', 'subl', 'idea', 'webstorm']) {
    script(join(chaos, 'bin', name), `#!/bin/sh\necho "$(date +%s) ${name} $*" >> "${chaos}/opened.log"\nexit 0\n`);
  }

  // Never the real claude: nothing here may reach a model, whatever the keychain holds.
  writeFileSync(join(chaos, 'claude-mode'), 'fail');
  script(
    join(home, '.local', 'bin', 'claude'),
    `#!/bin/sh
case "$1" in --version|-v) echo "2.1.287 (Claude Code)"; exit 0;; esac
mode=$(cat "${chaos}/claude-mode" 2>/dev/null)
echo "$(date +%s) $$ $*" >> "${chaos}/claude-calls.log"
case "$mode" in
  hang) exec sleep 600;;
  garbage) printf '{"type":"nonsense"\\n\\x00\\xff not json at all\\n{"type":"system","subtype":"init"}\\n'; exit 3;;
  slow-fail) sleep 8; echo "Not logged in · Please run /login" >&2; exit 1;;
  *) echo "Not logged in · Please run /login" >&2; exit 1;;
esac
`,
  );

  // gh: signed in by default, and nothing else works; other modes for the "gh fails" chaos.
  writeFileSync(join(chaos, 'gh-mode'), 'signed-in');
  const ghPath = script(
    join(chaos, 'fake-gh'),
    `#!/bin/sh
mode=$(cat "${chaos}/gh-mode" 2>/dev/null)
case "$mode" in
  hang) exec sleep 600;;
  garbage) printf '\\x00\\x01{{{not json'; exit 0;;
  exit-2) echo "gh: something broke" >&2; exit 2;;
esac
if [ "$1 $2" = "auth status" ]; then
  if [ "$mode" = "signed-out" ]; then echo 'You are not logged into any GitHub hosts.' >&2; exit 1; fi
  exit 0
fi
echo "the chaos harness's gh never reaches GitHub" >&2
exit 1
`,
  );

  return {
    ...world,
    home,
    root,
    acme,
    sandboxes: [root],
    ghPath,
    claudeMode: (mode) => writeFileSync(join(chaos, 'claude-mode'), mode),
    gitDelay: (seconds) => writeFileSync(join(chaos, 'git-delay'), String(seconds)),
    ghMode: (mode) => writeFileSync(join(chaos, 'gh-mode'), mode),
  };
}
