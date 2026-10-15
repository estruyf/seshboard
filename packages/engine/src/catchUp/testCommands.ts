/**
 * Which shell commands run tests, for the catch-up's test signal, and how to read their pass and fail counts. One list,
 * so teaching catch-up another runner is one line here.
 */

/**
 * Test commands, matched against each part of a command line (split at `&&`, `||`, `;` and `|`), after a leading
 * `cd …` part, environment assignments (`CI=1`) and a runner such as `npx` are taken off.
 */
export const TEST_COMMANDS: readonly RegExp[] = [
  // npm test, pnpm test, yarn test, bun test, and `npm run test:unit` and the like.
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?test(\S*)?(\s|$)/,
  /^(npm|pnpm|yarn|bun)\s+run\s+check(\s|$)/,
  /^vitest(\s|$)/,
  /^jest(\s|$)/,
  /^(python3?\s+-m\s+)?pytest(\s|$)/,
  /^go\s+test(\s|$)/,
  /^cargo\s+test(\s|$)/,
  /^dotnet\s+test(\s|$)/,
  /^mvn\s+(\S+\s+)*test(\s|$)/,
  /^(\.\/)?gradlew?\s+(\S+\s+)*test(\s|$)/,
  /^swift\s+test(\s|$)/,
  /^xcodebuild\s+(\S+\s+)*test(\s|$)/,
];

/** Runners that start the real command: `npx vitest`, `pnpm exec jest`, `uv run pytest`. */
const RUNNER = /^(npx|bunx|pnpx|pnpm\s+exec|pnpm\s+dlx|yarn\s+dlx|uv\s+run|poetry\s+run)\s+/;
/** `CI=1 FOO=bar npm test` */
const ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

/** The parts of a command line that run one after the other or in a pipe. */
function parts(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** One part, without what only sets up the real command. */
function core(part: string): string {
  let text = part.replace(ENV_ASSIGNMENT, '');
  // `yarn test` is yarn's own; only take a runner off when something follows that isn't a script name.
  for (let i = 0; i < 2; i++) text = text.replace(RUNNER, '').replace(ENV_ASSIGNMENT, '');
  return text;
}

/** Whether a shell command runs tests. */
export function isTestCommand(command: string): boolean {
  return parts(command).some((part) => !/^cd\s/.test(part) && TEST_COMMANDS.some((pattern) => pattern.test(core(part))));
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** Summary lines of the runners we can count, each with the numbers on it. */
const SUMMARIES: readonly RegExp[] = [
  // vitest: " Tests  2 failed | 7 passed (9)"
  /^\s*Tests\s{2,}.*$/gm,
  // jest: "Tests:       2 failed, 7 passed, 9 total"
  /^\s*Tests:\s+.*$/gm,
  // pytest: "===== 2 failed, 7 passed in 0.12s =====" (also with warnings or skips)
  /^=+ .*\b(passed|failed)\b.* in [\d.]+s.*=+\s*$/gm,
  // cargo: "test result: FAILED. 7 passed; 2 failed; 0 ignored"
  /^test result: \w+\. .*$/gm,
];

/**
 * The pass and fail counts in a test run's output, added up over every summary line (a workspace prints one per
 * project). Null when the output has no summary we know.
 */
export function parseTestCounts(output: string): { passed: number; failed: number } | null {
  const text = output.replace(ANSI, '');
  let passed = 0;
  let failed = 0;
  let found = false;
  for (const summary of SUMMARIES) {
    for (const line of text.match(summary) ?? []) {
      const pass = /(\d+) passed/.exec(line);
      const fail = /(\d+) failed/.exec(line);
      if (!pass && !fail) continue;
      found = true;
      passed += pass ? Number(pass[1]) : 0;
      failed += fail ? Number(fail[1]) : 0;
    }
    // One runner's lines are enough: jest's and vitest's look alike, and must not be counted twice.
    if (found) break;
  }
  return found ? { passed, failed } : null;
}
