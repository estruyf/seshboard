import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROMPT, SESSION, sessionJson, sessionJsonl, TOOLS } from './geminiFixtures.ts';
import { geminiProvider } from './geminiProvider.ts';
import { geminiCliHome, geminiDataDir, geminiHome, geminiSessionSource } from './geminiSource.ts';

const OTHER = '781a6b40-1111-4222-8333-444455556666';
const folder = () => realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-gemini-')));

/** A `.gemini` folder with a project `repo` (Gemini 0.4x+: named after the folder) and one older one named by a hash. */
function geminiDir() {
  const home = folder();
  const dir = join(home, '.gemini');
  const repo = join(home, 'code', 'repo');
  const old = join(home, 'code', 'old');
  mkdirSync(join(dir, 'tmp', 'repo', 'chats'), { recursive: true });
  writeFileSync(join(dir, 'tmp', 'repo', '.project_root'), repo);
  const hash = createHash('sha256').update(old).digest('hex');
  mkdirSync(join(dir, 'tmp', hash, 'chats'), { recursive: true });
  writeFileSync(join(dir, 'projects.json'), JSON.stringify({ projects: { [repo]: 'repo', [old]: 'old' } }));
  return { home, dir, repo, old, hash, chats: join(dir, 'tmp', 'repo', 'chats'), oldChats: join(dir, 'tmp', hash, 'chats') };
}

describe('geminiSessionSource', () => {
  it('lists sessions with a prompt, titled by Gemini’s summary else the first prompt, in their project’s folder', async () => {
    const { dir, repo, old, chats, oldChats } = geminiDir();
    writeFileSync(join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl'), sessionJsonl({ summary: 'Round the cart total' }));
    writeFileSync(join(oldChats, 'session-2026-02-20T16-12-781a6b40.json'), sessionJson(OTHER));
    // A session that never got a prompt (Gemini writes the file when a session starts), and a subagent's own file.
    writeFileSync(join(chats, 'session-2026-11-07T11-00-aaaaaaaa.jsonl'), `${JSON.stringify({ sessionId: 'aaaaaaaa-0000-4000-8000-000000000000', projectHash: 'x', startTime: '2026-11-07T11:00:00.000Z', kind: 'main' })}\n`);
    mkdirSync(join(chats, SESSION));
    writeFileSync(join(chats, SESSION, 'bbbbbbbb-0000-4000-8000-000000000000.jsonl'), sessionJsonl({ sessionId: 'bbbbbbbb-0000-4000-8000-000000000000' }));
    const source = geminiSessionSource(dir);
    const list = (await source.list()).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    expect(list).toEqual([
      expect.objectContaining({ sessionId: OTHER, summary: 'Make app appear in Dock & show bookmarks on click.', firstPrompt: 'Round the total to cents', cwd: old, provider: 'gemini', origin: 'unknown' }),
      expect.objectContaining({ sessionId: SESSION, summary: 'Round the cart total', firstPrompt: 'Round the total to cents', cwd: repo, createdAt: Date.parse('2026-11-07T10:00:00.000Z'), lastModified: Date.parse('2026-11-07T10:00:20.000Z') }),
    ]);
    expect((await source.messages(SESSION))[0]).toMatchObject({ uuid: PROMPT.id });
  });

  it('reads the `.jsonl` Gemini moved an older `.json` to, not both', async () => {
    const { dir, chats } = geminiDir();
    writeFileSync(join(chats, 'session-2026-11-07T10-00-8e189f48.json'), sessionJson());
    writeFileSync(join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl'), sessionJsonl());
    const source = geminiSessionSource(dir);
    expect(source.files.files()).toEqual(new Map([[SESSION, join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl')]]));
    expect(source.files.sessionOf(join('repo', 'chats', 'session-2026-11-07T10-00-8e189f48.json'))).toEqual({ sessionId: SESSION, file: join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl') });
  });

  it("maps a changed file to its session by the id in its header, and nothing else (a subagent's, a backup)", () => {
    const { dir, chats } = geminiDir();
    writeFileSync(join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl'), sessionJsonl());
    const source = geminiSessionSource(dir);
    expect(source.files.sessionOf(join('repo', 'chats', 'session-2026-11-07T10-00-8e189f48.jsonl'))).toEqual({ sessionId: SESSION, file: join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl') });
    expect(source.files.sessionOf(join('repo', 'chats', SESSION, 'bbbbbbbb.jsonl'))).toBeNull();
    expect(source.files.sessionOf(join('repo', 'chats', 'session-2026-11-07T10-00-8e189f48.jsonl.unreadable-1'))).toBeNull();
    expect(source.files.sessionOf(join('repo', 'logs', 'session-x.jsonl'))).toBeNull();
  });

  it("reads a subagent's conversation from its parent's folder, by the call that started it", async () => {
    const { dir, chats } = geminiDir();
    const agent = 'cccccccc-0000-4000-8000-000000000000';
    const call = { id: 'invoke_agent_1_0', name: 'invoke_agent', args: { agent_name: 'codebase_investigator', prompt: 'Map it' }, status: 'success', agentId: agent, result: [] };
    const parent = `${sessionJsonl().trimEnd()}\n${JSON.stringify({ ...TOOLS, id: 'g9', toolCalls: [call] })}\n`;
    writeFileSync(join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl'), parent);
    mkdirSync(join(chats, SESSION));
    writeFileSync(join(chats, SESSION, `${agent}.jsonl`), sessionJsonl({ sessionId: agent }));
    const source = geminiSessionSource(dir);
    const subagent = await source.subagent(SESSION, 'invoke_agent_1_0');
    expect(subagent.agentType).toBe('codebase_investigator');
    expect(subagent.messages[0]).toMatchObject({ uuid: PROMPT.id });
    expect(await source.subagent(SESSION, 'nope')).toEqual({ agentType: null, messages: [] });
  });

  it('reads nothing from a folder that is missing', async () => {
    const source = geminiSessionSource(join(folder(), 'missing'));
    expect(await source.list()).toEqual([]);
    expect(await source.messages(SESSION)).toEqual([]);
  });
});

describe('Gemini folders', () => {
  it("is Gemini's `.gemini`, inside `GEMINI_CLI_HOME` when it is set", () => {
    expect(geminiHome({}, '/Users/me')).toBe(join('/Users/me', '.gemini'));
    expect(geminiHome({ GEMINI_CLI_HOME: '/work' }, '/Users/me')).toBe(join('/work', '.gemini'));
  });

  it("runs a profile's Gemini with the folder its `.gemini` is in, and the default one without", () => {
    expect(geminiDataDir(join('/Users/me', '.gemini'))).toBe(join('/Users/me', '.gemini'));
    expect(geminiDataDir('/profiles/work')).toBe(join('/profiles/work', '.gemini'));
    expect(geminiCliHome(join('/Users/me', '.gemini'), '/Users/me')).toBeNull();
    expect(geminiCliHome(join('/work', '.gemini'), '/Users/me')).toBe('/work');
    expect(geminiCliHome('/profiles/work', '/Users/me')).toBe('/profiles/work');
  });
});

describe('geminiProvider', () => {
  it('trashes what Gemini’s own delete removes, and points its CLI at the profile’s folder', async () => {
    const { home, dir, chats } = geminiDir();
    writeFileSync(join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl'), sessionJsonl());
    const adapter = geminiProvider({ profileId: 'p', geminiHome: dir, userHome: folder(), binary: async () => null });
    await adapter.source.list();
    const project = join(dir, 'tmp', 'repo');
    // The engine leaves out what isn't there: the older `.json` Gemini moves to `.jsonl`, a folder of a session without one.
    expect(adapter.trashPaths!(SESSION)).toEqual([
      join(chats, 'session-2026-11-07T10-00-8e189f48.jsonl'),
      join(chats, 'session-2026-11-07T10-00-8e189f48.json'),
      join(chats, SESSION),
      join(project, 'logs', `session-${SESSION}.jsonl`),
      join(project, 'tool-outputs', `session-${SESSION}`),
      join(project, SESSION),
    ]);
    expect(adapter.trashPaths!('../etc')).toEqual([]);
    expect(adapter.homeEnv).toEqual({ GEMINI_CLI_HOME: home });
    expect(adapter.folder).toBe(join(dir, 'tmp'));
    expect(existsSync(adapter.folder)).toBe(true);
    await adapter.driver?.dispose();
  });

  it('says Gemini CLI is missing, without starting anything', async () => {
    const { dir } = geminiDir();
    const adapter = geminiProvider({ profileId: 'p', geminiHome: dir, userHome: folder(), binary: async () => null });
    expect(await adapter.driver!.status()).toMatchObject({ binary: null, signedIn: false, problem: expect.stringContaining('Install Gemini CLI') });
    await adapter.driver?.dispose();
  });
});
