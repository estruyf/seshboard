import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Main loads before the window does, and runs the top level of every module it imports. The protocol's contract (every
 * request and event of the engine, as zod schemas) is big and runs all its schemas on load, which main has no use for: only
 * the engine does. Rollup puts what main and the engine both import into one shared chunk, so a single import of the
 * protocol's package entry (which re-exports the contract) in main makes main load the contract too (the first window
 * showed about 100 ms later). This walks main's static imports, in source, and fails when one leads there.
 *
 * The protocol files main reaches are listed below: a new one (an entry that pulls in a schema file, say) fails the test
 * until someone looks and adds it. Zod itself still loads in main, through `theme.ts` (the theme file's schema), which the
 * theme store needs; it is the one file here that imports it.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const protocolSrc = join(root, 'packages/protocol/src');
const protocolExports = (JSON.parse(readFileSync(join(root, 'packages/protocol/package.json'), 'utf8')) as { exports: Record<string, string> }).exports;

/** The file a specifier names, for the ones that can reach the contract: relative files and the protocol package. Others (packages, node:) are null. */
function resolveSpecifier(from: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const file = resolve(dirname(from), specifier);
    // A specifier that points nowhere would end the walk there without a word: say so.
    if (!existsSync(file)) throw new Error(`${from.replace(root, '')} imports ${specifier}, which does not resolve`);
    return file;
  }
  if (specifier === '@seshboard/protocol' || specifier.startsWith('@seshboard/protocol/')) {
    const entry = protocolExports[specifier === '@seshboard/protocol' ? '.' : `.${specifier.slice('@seshboard/protocol'.length)}`];
    if (!entry) throw new Error(`${from.replace(root, '')} imports ${specifier}, which the protocol package does not export`);
    return join(root, 'packages/protocol', entry);
  }
  return null;
}

/** The static imports and re-exports of a file that exist at run time: not `import type`, not an import of types only, not `import()`. */
function staticImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const clause = match[1]!.trim();
    if (clause.startsWith('type ')) continue;
    const named = /^\{([\s\S]*)\}$/.exec(clause)?.[1];
    if (named && named.split(',').map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith('type '))) continue;
    found.push(match[2]!);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) found.push(match[1]!);
  return found;
}

/** Every file reached from `entries` by static imports, each with the file that imported it first. */
function reach(entries: string[]): Map<string, string | null> {
  const seen = new Map<string, string | null>(entries.map((entry) => [entry, null]));
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift()!;
    if (!/\.tsx?$/.test(file)) continue;
    for (const specifier of staticImports(file)) {
      const next = resolveSpecifier(file, specifier);
      if (next && !seen.has(next)) {
        seen.set(next, file);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** The protocol files main, the preload and the shared transport reach today. */
const PROTOCOL_FILES_MAIN_REACHES = [
  'accountKey.ts',
  'actionIcons.ts',
  'activityConstants.ts',
  'apiRetry.ts',
  'appIcons.ts',
  'appUpdate.ts',
  'autoModel.ts',
  'backupConstants.ts',
  'bridge.ts',
  'browserProfiles.ts',
  'browserSites.ts',
  'catchUpRules.ts',
  'client.ts',
  'color.ts',
  'commandLabel.ts',
  'companionClient.ts',
  'companionConstants.ts',
  'computerConstants.ts',
  'computerMine.ts',
  'contextBlocks.ts',
  'contextCache.ts',
  'costEstimate.ts',
  'filePreview.ts',
  'focus.ts',
  'githubContext.ts',
  'githubRepo.ts',
  'lineTransport.ts',
  'listContinue.ts',
  'locale.ts',
  'looseEnds.ts',
  'memoryText.ts',
  'modelName.ts',
  'modsConstants.ts',
  'notificationPause.ts',
  'orchestrator.ts',
  'paths.ts',
  'permissionModes.ts',
  'pipelineView.ts',
  'pipelines.ts',
  'profileConstants.ts',
  'projectConstants.ts',
  'promptConstants.ts',
  'providerConstants.ts',
  'pullRequestConstants.ts',
  'queueStates.ts',
  'remoteConstants.ts',
  'remoteOnlyBranches.ts',
  'remoteWorktreeBase.ts',
  'retention.ts',
  'rpc.ts',
  'savedPrompts.ts',
  'schedules.ts',
  'sessionFileLinks.ts',
  'sessionLinks.ts',
  'sessionNote.ts',
  'sideQuestionConstants.ts',
  'skimMarks.ts',
  'theme.ts',
  'themeFormat.ts',
  'toolSteps.ts',
  'triggerOrigin.ts',
  'triggers.ts',
  'usageWeights.ts',
  'visuals.ts',
  'webPreview.ts',
  'wire.ts',
  'workingPanel.ts',
  'worktreeBase.ts',
  'worktreeFacts.ts',
  'worktreeName.ts',
];

describe("main's static imports", () => {
  const mainDir = resolve(dirname(fileURLToPath(import.meta.url)));
  const entries = [join(mainDir, 'index.ts'), join(mainDir, '../preload/index.ts'), join(mainDir, '../shared/mainPortTransport.ts')];

  it('never reach the protocol contract', () => {
    const reached = reach(entries);
    const contract = join(protocolSrc, 'contract.ts');
    const via: string[] = [];
    for (let file: string | null | undefined = contract; reached.has(contract) && file; file = reached.get(file)) via.push(file.replace(root, ''));
    expect(reached.has(contract), `main reaches the contract through: ${via.join(' <- ')}`).toBe(false);
    expect(reached.has(join(protocolSrc, 'index.ts'))).toBe(false);
  });

  it('reach only the protocol files listed above, and only theme.ts among them loads zod', () => {
    const reached = [...reach(entries).keys()].filter((file) => file.startsWith(protocolSrc));
    expect(reached.map((file) => file.slice(protocolSrc.length + 1)).sort()).toEqual([...PROTOCOL_FILES_MAIN_REACHES].sort());
    const withZod = reached.filter((file) => staticImports(file).includes('zod'));
    expect(withZod.map((file) => file.slice(protocolSrc.length + 1))).toEqual(['theme.ts']);
  });

  it('see the files they should (the crawl works)', () => {
    const reached = reach(entries);
    expect(reached.has(join(mainDir, 'filesSmoke.ts'))).toBe(true);
    expect(reached.has(join(protocolSrc, 'paths.ts'))).toBe(true);
    expect(reached.has(join(protocolSrc, 'bridge.ts'))).toBe(true);
  });
});

describe('the crawl', () => {
  it('stops on an import that does not resolve instead of going blind', () => {
    expect(() => resolveSpecifier(join(root, 'apps/desktop/src/main/index.ts'), './nothing-here.ts')).toThrow(/does not resolve/);
    expect(() => resolveSpecifier(join(root, 'apps/desktop/src/main/index.ts'), '@seshboard/protocol/nothing')).toThrow(/does not export/);
    expect(resolveSpecifier(join(root, 'apps/desktop/src/main/index.ts'), 'electron')).toBeNull();
  });
});
