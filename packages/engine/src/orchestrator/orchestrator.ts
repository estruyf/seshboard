import {
  inheritedDefault,
  inheritedPermissionMode,
  instructionsBlock,
  ORCHESTRATOR_MAX_WORKING,
  orchestratorSystemText,
  readStartArgs,
  workerState,
  writeSessionUpdate,
  writeWorkerList,
  REMOTE_FEATURE_CLONE,
  type CatchUp,
  type ComputerMethod,
  type LaterDraft,
  type OrchestratorInfo,
  type OrchestratorOwnTool,
  type OrchestratorToolResult,
  type OrchestratorWorker,
  type ProfileDefaults,
  type ProjectDefaults,
  type SessionStartAsk,
  type SessionSummary,
  type StartedChild,
  type StartSessionArgs,
  type WorkerEnd,
  type WorkerLine,
  type WorkerStatus,
  type WorktreePullRequest,
} from '@seshboard/protocol';
import type { OrchestratorStore, StoredWorker } from './orchestratorStore.ts';
import { bringsLines, findComputer, matchProject, NO_COMPUTERS, readProfiles, readProjects, remoteSessionKey, writeComputerList, type ComputerLine, type LocalProject, type PairedComputer } from './remoteStart.ts';

/** A profile a started session can run with: Claude Code's or another provider's (Copilot, Codex). */
export interface OrchestratorAgent {
  profileId: string;
  /** The profile's name, as `start_session`'s `agent` names it. */
  name: string;
  /** The agent's own name ("Claude Code", "GitHub Copilot"), which names its first profile too. */
  agent: string;
  /** It can start in a worktree. */
  worktree: boolean;
}

/** Everything the orchestrator needs from the engine, so tests run it without Claude Code. */
export interface OrchestratorDeps {
  store: OrchestratorStore;
  session(id: string): Pick<SessionSummary, 'projectRoot' | 'profileId'> | null;
  defaults(projectRoot: string): ProjectDefaults;
  /** A profile's defaults, which a started session takes where its project sets none. */
  profileDefaults(profileId: string): ProfileDefaults;
  /** The global model and effort (Settings › General), for a session whose project and profile set none. */
  globals(): { model: string | null; effort: ProjectDefaults['effort'] };
  inRepo(folder: string): boolean;
  /** The profiles a session can start with, the project's own first. */
  agents(projectRoot: string): OrchestratorAgent[];
  /** Why a start has to wait (the focus limit, a usage limit), or null. */
  hold(draft: LaterDraft): { reason: string; detail: string } | null;
  /** Puts a held start in the queue, to start by itself; the item's id. */
  queue(draft: LaterDraft): string;
  /** Starts the session, titled; its id. `instructions` go after its agent's system prompt. */
  start(draft: LaterDraft, title: string, instructions: string | null): Promise<string>;
  /** Puts a started session under its orchestrator in the sidebar. */
  setParent(sessionId: string, orchestratorId: string): void;
  /** Asks you on a card in the session whether it may start another: true when you allowed it. */
  askStart(sessionId: string, ask: SessionStartAsk): Promise<boolean>;
  status(sessionId: string): WorkerStatus | null;
  /** The session's branch and pull request, read from git and gh (it may take a moment). */
  info(sessionId: string): Promise<{ gone: boolean; branch: string | null; pr: WorktreePullRequest | null }>;
  /** The pull request stored for a session, without asking gh. */
  pr(sessionId: string): OrchestratorWorker['pr'];
  catchUp(sessionId: string): CatchUp | null;
  /** A brief of a session, as session linking writes it for `from`. */
  brief(from: string, sessionId: string, label: string): Promise<string>;
  send(sessionId: string, text: string): Promise<void>;
  /** Something the windows show changed. */
  changed(): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /**
   * The other computers paired with this one (docs/remote-access.md), for start_session's `computer`: each with its
   * state, and a request in the remote contract. Left out where there are none (tests).
   */
  computers?: {
    list(): PairedComputer[];
    call(computerId: string, method: ComputerMethod, params: unknown): Promise<unknown>;
    /** The next event of a computer that `match` takes, or null after `timeoutMs`. */
    next(computerId: string, name: string, match: (payload: unknown) => boolean, timeoutMs: number): Promise<unknown>;
  };
  /** Asks on a card in the session whether to start in a clone that brings these (hooks, MCP servers): true when allowed. */
  askBrings?(sessionId: string, computer: string, repo: string, lines: Array<[string, string]>): Promise<boolean>;
  /** The project's name and the GitHub repositories its folder's remotes point at, to find it on another computer. */
  localProject?(projectRoot: string): Promise<LocalProject>;
}

const fail = (text: string): OrchestratorToolResult => ({ text, error: true });
/** A session on another computer, as `remoteSessionKey` writes it. */
const isRemoteKey = (sessionId: string) => sessionId.startsWith('remote:');
const prWord = (pr: Pick<WorktreePullRequest, 'number' | 'state' | 'url'>) => `#${pr.number} ${pr.state}, ${pr.url}`;

/**
 * The orchestrator (docs/orchestrator.md): what its tools do, and what a session of one tells it when a turn ends.
 * A start goes through the same holds as a scheduled run: at the focus limit or a usage limit it waits in the queue.
 */
export class Orchestrator {
  /**
   * Starts other sessions asked for that wait in the queue: which session asked, and the title. In memory: after a
   * restart such a session still starts, but not under the one that asked.
   */
  private readonly childItems = new Map<string, { parentId: string; title: string }>();
  /**
   * Sessions other sessions started, by id: under which and with what title. Sent with the orchestrators, so a window
   * nests one under its session while it starts, before its transcript (and so its summary's parent) exists. In memory:
   * after a restart the summary says it.
   */
  private readonly started = new Map<string, { parentId: string; title: string }>();

  constructor(private readonly deps: OrchestratorDeps) {}

  isOrchestrator(sessionId: string): boolean {
    return this.deps.store.get(sessionId) !== null;
  }

  /** Makes a new session an orchestrator of its project. */
  mark(sessionId: string, projectRoot: string): void {
    this.deps.store.add(sessionId, projectRoot);
    this.deps.changed();
  }

  /** The project's instructions for its orchestrator and the sessions it starts, or null. */
  private instructions(projectRoot: string): string | null {
    return this.deps.defaults(projectRoot).orchestratorInstructions?.trim() || null;
  }

  /** What a new orchestrator of a project reads after its agent's system prompt. */
  systemTextForNew(projectRoot: string): string {
    return orchestratorSystemText(this.instructions(projectRoot));
  }

  /**
   * What a session reads after its agent's system prompt when it resumes: an orchestrator its role and the project's
   * instructions, a session one started the instructions, any other session nothing.
   */
  systemTextFor(sessionId: string): string | null {
    const own = this.deps.store.get(sessionId);
    if (own) return orchestratorSystemText(this.instructions(own.projectRoot));
    const parent = this.deps.store.orchestratorOf(sessionId);
    const orchestrator = parent ? this.deps.store.get(parent) : null;
    return orchestrator ? instructionsBlock(this.instructions(orchestrator.projectRoot)) : null;
  }

  /** The instructions a queued start gets once it starts, when the item is an orchestrator's. */
  itemInstructions(itemId: string): string | null {
    for (const orchestrator of this.deps.store.list()) {
      if (this.deps.store.workersOf(orchestrator.sessionId).some((w) => w.itemId === itemId)) return instructionsBlock(this.instructions(orchestrator.projectRoot));
    }
    return null;
  }

  /** Every orchestrator with what it started, for the windows. */
  /** The sessions other sessions started (start_session on their `seshboard` server), oldest first. */
  startedChildren(): StartedChild[] {
    return [...this.started].map(([sessionId, { parentId, title }]) => ({ sessionId, parentId, title }));
  }

  infos(): OrchestratorInfo[] {
    return this.deps.store.list().map((o) => ({
      ...o,
      workers: this.deps.store.workersOf(o.sessionId).map((w) => ({ sessionId: w.sessionId, itemId: w.itemId, title: w.title, startedAt: w.startedAt, pr: w.sessionId ? (this.deps.pr(w.sessionId) ?? null) : null })),
    }));
  }

  /** One tool call of an orchestrator session. */
  async run(orchestratorId: string, tool: OrchestratorOwnTool, args: Record<string, unknown>): Promise<OrchestratorToolResult> {
    const orchestrator = this.deps.store.get(orchestratorId);
    if (!orchestrator) return fail('This session is not an orchestrator in Seshboard.');
    switch (tool) {
      case 'start_session':
        return this.startSession(orchestratorId, orchestrator.projectRoot, args);
      case 'list_sessions':
        return { text: await this.listSessions(orchestratorId, orchestrator.projectRoot) };
      case 'read_session': {
        const worker = this.workerOf(orchestratorId, args.session);
        if (!worker) return fail('No such session of this orchestrator. list_sessions has their ids.');
        if (isRemoteKey(worker.sessionId!)) return fail(`"${worker.title}" runs on another computer: Seshboard can’t read it from here. Ask the user how it went.`);
        return { text: await this.deps.brief(orchestratorId, worker.sessionId!, worker.title) };
      }
      case 'message_session': {
        const worker = this.workerOf(orchestratorId, args.session);
        if (!worker) return fail('No such session of this orchestrator. list_sessions has their ids.');
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        if (!text) return fail('message_session needs a text.');
        try {
          await this.deps.send(worker.sessionId!, text);
        } catch (error) {
          return fail(`Could not message "${worker.title}": ${(error as Error).message}`);
        }
        this.deps.changed();
        return { text: `Sent to "${worker.title}". While it works, it reads the message when its turn ends.` };
      }
    }
  }

  /** One of the orchestrator's started sessions, by its id. */
  private workerOf(orchestratorId: string, session: unknown): StoredWorker | null {
    if (typeof session !== 'string' || !session.trim()) return null;
    return this.deps.store.workersOf(orchestratorId).find((w) => w.sessionId === session.trim()) ?? null;
  }

  /**
   * What a start runs with, as New session would: the agent asked for, else `ownProfile`'s; the project's model,
   * effort and mode, else the profile's, else the global ones; its own worktree in a git repository.
   */
  plan(ownProfile: string | null, projectRoot: string, args: StartSessionArgs): { draft: LaterDraft; agent: OrchestratorAgent | null; workspace: 'worktree' | 'current' } | { error: string } {
    const agents = this.deps.agents(projectRoot);
    // Without an agent asked for, the session runs with the asking session's own profile, not the project's.
    let agent = agents.find((a) => a.profileId === ownProfile) ?? agents[0] ?? null;
    if (args.agent) {
      const wanted = args.agent.toLowerCase();
      agent = agents.find((a) => a.name.toLowerCase() === wanted) ?? agents.find((a) => a.agent.toLowerCase() === wanted) ?? null;
      if (!agent) return { error: `No agent called "${args.agent}". Pick one of: ${agents.map((a) => a.name).join(', ')}, or leave it out.` };
    }
    const defaults = this.deps.defaults(projectRoot);
    // As in New session: the project's, else the started session's profile's (unless the project skips it), else the global model and effort.
    const profile = agent ? this.deps.profileDefaults(agent.profileId) : null;
    const globals = this.deps.globals();
    // Sessions side by side each get their own worktree, so they never share files; outside git there is one folder.
    const canWorktree = this.deps.inRepo(projectRoot) && (agent?.worktree ?? true);
    const workspace = canWorktree ? (args.workspace ?? 'worktree') : 'current';
    const draft: LaterDraft = {
      cwd: projectRoot,
      prompt: args.prompt,
      model: args.model ?? inheritedDefault('model', defaults, profile) ?? globals.model,
      effort: inheritedDefault('effort', defaults, profile) ?? globals.effort,
      // Without a mode of the project or the profile, edits go through without asking, so a session doesn't stall on each file.
      permissionMode: inheritedPermissionMode(defaults, profile) ?? 'acceptEdits',
      workspace,
      baseRef: defaults.baseRef ?? profile?.baseRef ?? 'fresh',
      profileId: agent?.profileId ?? null,
    };
    return { draft, agent, workspace };
  }

  /** How a started session is described back to the agent: where it runs and with what. */
  private startedText(title: string, sessionId: string, args: StartSessionArgs, workspace: 'worktree' | 'current', agent: OrchestratorAgent | null): string {
    const where = workspace === 'worktree' ? 'in its own worktree' : 'in the project’s folder';
    const noWorktree = args.workspace === 'worktree' && workspace === 'current' ? ' (a worktree is not possible here)' : '';
    return `Started "${title}" as session ${sessionId}, ${where}${noWorktree}${agent ? `, with ${agent.name}` : ''}.`;
  }

  private async startSession(orchestratorId: string, projectRoot: string, raw: Record<string, unknown>): Promise<OrchestratorToolResult> {
    const args = readStartArgs(raw);
    if ('error' in args) return fail(args.error);
    if (args.computer) return this.startOn(orchestratorId, projectRoot, { ...args, computer: args.computer }, true);
    const working = this.deps.store.workersOf(orchestratorId).filter((w) => w.sessionId && this.deps.status(w.sessionId) === 'working').length;
    if (working >= ORCHESTRATOR_MAX_WORKING) return fail(`${working} sessions of this orchestrator work already, which is the most at once. Start "${args.title}" when one finishes.`);
    const plan = this.plan(this.deps.session(orchestratorId)?.profileId ?? null, projectRoot, args);
    if ('error' in plan) return fail(plan.error);
    const { draft, agent, workspace } = plan;
    const hold = this.deps.hold(draft);
    if (hold) {
      const itemId = this.deps.queue(draft);
      this.deps.store.addWorker(orchestratorId, { sessionId: null, itemId, title: args.title });
      this.deps.changed();
      return { text: `"${args.title}" waits in the queue: ${hold.detail} Seshboard starts it by itself. Go on with other work; do not start it again.` };
    }
    let sessionId: string;
    try {
      sessionId = await this.deps.start(draft, args.title, instructionsBlock(this.instructions(projectRoot)));
    } catch (error) {
      return fail(`Could not start "${args.title}": ${(error as Error).message}`);
    }
    this.adopt(orchestratorId, sessionId, args.title);
    return { text: `${this.startedText(args.title, sessionId, args, workspace, agent)} Seshboard tells you when it finishes, fails or waits for the user.` };
  }

  /**
   * A session that is not an orchestrator asks to start another (its `seshboard` server's start_session). You decide
   * on a card in that session; the call waits for your answer. Allowed, it starts as an orchestrator's would (or waits
   * in the queue) and goes under the session in the sidebar. It reports back to no one: the asking session has no tools
   * to follow it, and an update would cost it a turn.
   */
  async startChild(parentId: string, raw: Record<string, unknown>): Promise<OrchestratorToolResult> {
    const args = readStartArgs(raw);
    if ('error' in args) return fail(args.error);
    const parent = this.deps.session(parentId);
    if (!parent?.projectRoot) return fail('Seshboard does not know this session’s project yet. Try again in a moment.');
    if (args.computer) return this.startOn(parentId, parent.projectRoot, { ...args, computer: args.computer }, false);
    const plan = this.plan(parent.profileId ?? null, parent.projectRoot, args);
    if ('error' in plan) return fail(plan.error);
    const { draft, agent, workspace } = plan;
    const several = this.deps.agents(parent.projectRoot).length > 1;
    const allowed = await this.deps.askStart(parentId, { title: args.title, prompt: args.prompt, agent: several && agent ? agent.name : null, workspace });
    if (!allowed) return { text: `The user did not start "${args.title}". Do not ask again for it; go on with your own task.` };
    const hold = this.deps.hold(draft);
    if (hold) {
      const itemId = this.deps.queue(draft);
      this.childItems.set(itemId, { parentId, title: args.title });
      return { text: `The user allowed it. "${args.title}" waits in the queue: ${hold.detail} Seshboard starts it by itself, under this session.` };
    }
    let sessionId: string;
    try {
      sessionId = await this.deps.start(draft, args.title, null);
    } catch (error) {
      return fail(`The user allowed it, but "${args.title}" could not start: ${(error as Error).message}`);
    }
    this.child(sessionId, parentId, args.title);
    return { text: `The user allowed it. ${this.startedText(args.title, sessionId, args, workspace, agent)} It runs on its own, under this session in the sidebar.` };
  }

  /** list_computers: the paired computers, and which of them has the asking session's project. */
  async listComputers(sessionId: string): Promise<OrchestratorToolResult> {
    const computers = this.deps.computers?.list() ?? [];
    if (!computers.length) return { text: NO_COMPUTERS };
    const root = this.deps.session(sessionId)?.projectRoot;
    const local = root && this.deps.localProject ? await this.deps.localProject(root) : null;
    const rows = await Promise.all(
      computers.map(async (computer): Promise<ComputerLine> => {
        if (!computer.connected) return { name: computer.name, connected: false };
        const found = local ? await this.projectOn(computer, local).catch(() => null) : null;
        return { name: computer.name, connected: true, project: found?.project.name ?? null };
      }),
    );
    return { text: writeComputerList(rows) };
  }

  /** This project on another computer, from its `projects.list`. */
  private async projectOn(computer: PairedComputer, local: LocalProject) {
    return matchProject(readProjects(await this.deps.computers!.call(computer.id, 'projects.list', {})), local);
  }

  /**
   * start_session with `computer`: the same card, naming the computer, then `session.create` there, as New session's
   * Run on does. That computer applies its own focus and usage limits. A computer without the project can clone it
   * first, from GitHub, on the same card. The new session nests under the asking one here (`started`, keyed by its row
   * id), since a parent only works within one computer. An orchestrator (`asOrchestrator`) starts without a card.
   */
  private async startOn(parentId: string, projectRoot: string, args: StartSessionArgs & { computer: string }, asOrchestrator: boolean): Promise<OrchestratorToolResult> {
    const computers = this.deps.computers?.list() ?? [];
    if (!computers.length) return fail(NO_COMPUTERS);
    const computer = findComputer(computers, args.computer);
    if (!computer) return fail(`No paired computer called "${args.computer}". Pick one of: ${computers.map((c) => c.name).join(', ')}, or leave computer out.`);
    if (!computer.connected) return fail(`${computer.name} is not connected now. Try again when it is back, or leave computer out to start the session here.`);
    const local = this.deps.localProject ? await this.deps.localProject(projectRoot) : null;
    if (!local) return fail('Seshboard can’t tell which project this is on another computer.');
    let match: Awaited<ReturnType<Orchestrator['projectOn']>>;
    try {
      match = await this.projectOn(computer, local);
    } catch (error) {
      return fail(`Could not read ${computer.name}’s projects: ${(error as Error).message}`);
    }
    // Not there: offer to clone it from GitHub first, where that computer can.
    let clone: { url: string; name: string; where: string; repo: string } | null = null;
    if (!match) {
      const repo = local.repos[0];
      if (!repo || !computer.features?.includes(REMOTE_FEATURE_CLONE)) return fail(`${computer.name} does not have this project (${repo ?? local.name}). The user adds it there first; or leave computer out.`);
      const url = `https://github.com/${repo}`;
      const plan = (await this.deps.computers!.call(computer.id, 'projects.clonePlan', { url }).catch(() => null)) as { state?: string; name?: string; where?: string } | null;
      if (!plan?.state || plan.state === 'off') return fail(`${computer.name} does not have this project, and Clone from GitHub is off there. The user adds it there first; or leave computer out.`);
      if (plan.state === 'taken') return fail(`${computer.name} does not have this project, and its clone folder has something else called ${plan.name}. The user clones it there first.`);
      clone = { url, name: plan.name ?? repo.split('/')[1]!, where: plan.where ?? '', repo };
    }
    // An agent by its profile's name there; left out, the project's own there.
    let profile: { id: string; name: string } | null = null;
    if (args.agent) {
      const profiles = readProfiles(await this.deps.computers!.call(computer.id, 'options.get', {}).catch(() => null));
      if (!profiles) return fail(`${computer.name} can’t say its agents. Leave agent out to start with the project’s own there.`);
      const wanted = args.agent.toLowerCase();
      profile = profiles.find((p) => p.name.toLowerCase() === wanted) ?? null;
      if (!profile) return fail(`${computer.name} has no agent called "${args.agent}". Pick one of: ${profiles.map((p) => p.name).join(', ')}, or leave it out.`);
    }
    if (!asOrchestrator) {
      const project = match ? match.project.name : `${clone!.name}, cloned there first${clone!.where ? ` into ${clone!.where}` : ''}`;
      const allowed = await this.deps.askStart(parentId, { title: args.title, prompt: args.prompt, agent: profile?.name ?? null, workspace: args.workspace, computer: computer.name, project });
      if (!allowed) return { text: `The user did not start "${args.title}" on ${computer.name}. Do not ask again for it; go on with your own task.` };
    }
    let projectId = match?.project.id ?? null;
    let projectName = match?.project.name ?? clone?.name ?? '';
    if (clone) {
      const cloned = await this.cloneOn(parentId, computer, clone, asOrchestrator);
      if ('error' in cloned) return fail(cloned.error);
      projectId = cloned.projectId;
      projectName = clone.name;
    }
    const params = {
      projectId,
      prompt: args.prompt,
      title: args.title,
      ...(profile ? { profileId: profile.id } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.workspace ? { worktree: args.workspace === 'worktree' } : {}),
    };
    let sessionId: string;
    try {
      const created = (await this.deps.computers!.call(computer.id, 'session.create', params)) as { sessionId?: unknown } | null;
      if (typeof created?.sessionId !== 'string') throw new Error('it did not say which session');
      sessionId = created.sessionId;
    } catch (error) {
      return fail(`${asOrchestrator ? '' : 'The user allowed it, but '}"${args.title}" could not start on ${computer.name}: ${(error as Error).message}`);
    }
    this.deps.log('info', `Orchestrator: ${parentId} started "${args.title}" on ${computer.name} as ${sessionId}`);
    const key = remoteSessionKey(computer.id, sessionId);
    const byName = match?.by === 'name' ? ', found by its name' : '';
    if (asOrchestrator) {
      // One of its sessions, listed with the rest; it nests under it here. Its turns end on that computer, so no update comes.
      this.deps.store.addWorker(parentId, { sessionId: key, itemId: null, title: args.title });
      this.deps.changed();
      return { text: `Started "${args.title}" on ${computer.name} as session ${key}, in its project "${projectName}"${byName}. It runs with that computer’s limits. Seshboard does not report its turns from another computer: check on it with read_session or ask the user.` };
    }
    this.started.set(key, { parentId, title: args.title });
    this.deps.changed();
    return { text: `The user allowed it. Started "${args.title}" on ${computer.name} as session ${sessionId}, in its project "${projectName}"${byName}. It runs on its own there, with that computer’s limits, under this session in the sidebar here, and does not report back to you.` };
  }

  /** Clones a project on another computer and waits for it; asks again when the repository brings hooks or servers. */
  private async cloneOn(parentId: string, computer: PairedComputer, clone: { url: string; name: string; repo: string }, asOrchestrator: boolean): Promise<{ projectId: string } | { error: string }> {
    const jobId = `tool-${Math.random().toString(36).slice(2, 10)}`;
    const done = this.deps.computers!.next(computer.id, 'projects.cloneProgress', (p) => (p as { jobId?: string; state?: string }).jobId === jobId && (p as { state?: string }).state !== 'running', 15 * 60_000);
    try {
      await this.deps.computers!.call(computer.id, 'projects.clone', { jobId, url: clone.url, name: clone.name });
    } catch (error) {
      return { error: `Could not clone ${clone.repo} on ${computer.name}: ${(error as Error).message}` };
    }
    const progress = (await done) as { state?: string; projectId?: string | null; error?: string | null; brings?: Parameters<typeof bringsLines>[0] } | null;
    if (!progress) return { error: `The clone of ${clone.repo} on ${computer.name} takes too long. The user starts the session there once it is done.` };
    if (progress.state !== 'done' || !progress.projectId) return { error: `The clone of ${clone.repo} on ${computer.name} ${progress.state === 'cancelled' ? 'was cancelled' : `failed: ${progress.error ?? 'no reason given'}`}.` };
    // As New session on that computer asks before Start: what the repository brings runs without asking.
    const lines = bringsLines(progress.brings ?? null);
    if (lines.length) {
      if (asOrchestrator || !this.deps.askBrings) return { error: `${clone.repo} is cloned on ${computer.name}, but it brings hooks or servers that run without asking. The user starts the first session there.` };
      if (!(await this.deps.askBrings(parentId, computer.name, clone.repo, lines))) return { error: `${clone.repo} is cloned on ${computer.name}, but the user did not start a session in it. Do not ask again.` };
    }
    return { projectId: progress.projectId };
  }

  /** What a start asked for by a session (start_later) runs with: as start_session plans it, in its project. */
  draftFor(sessionId: string, args: StartSessionArgs): { draft: LaterDraft } | { error: string } {
    const session = this.deps.session(sessionId);
    if (!session?.projectRoot) return { error: 'Seshboard does not know this session’s project yet. Try again in a moment.' };
    const plan = this.plan(session.profileId ?? null, session.projectRoot, args);
    return 'error' in plan ? plan : { draft: plan.draft };
  }

  /** Queues a start for when the usage limit lets it (start_later): it goes under the session that asked once it starts. */
  queueChild(parentId: string, draft: LaterDraft, title: string): string {
    const itemId = this.deps.queue(draft);
    this.childItems.set(itemId, { parentId, title });
    return itemId;
  }

  /** A session another one started: under it in the sidebar, and in what the windows hear, so it shows there now. */
  child(sessionId: string, parentId: string, title: string): void {
    this.started.set(sessionId, { parentId, title });
    this.deps.setParent(sessionId, parentId);
    this.deps.changed();
  }

  /** A session joins the orchestrator's: stored, and under it in the sidebar. */
  private adopt(orchestratorId: string, sessionId: string, title: string): void {
    this.deps.store.addWorker(orchestratorId, { sessionId, itemId: null, title });
    this.deps.setParent(sessionId, orchestratorId);
    this.deps.changed();
  }

  /** A queued item started: when it was an orchestrator's, the session goes under it. Its title, or null. */
  itemStarted(itemId: string, sessionId: string): string | null {
    const child = this.childItems.get(itemId);
    if (child) {
      this.childItems.delete(itemId);
      this.child(sessionId, child.parentId, child.title);
      return child.title;
    }
    const started = this.deps.store.itemStarted(itemId, sessionId);
    if (!started) return null;
    this.deps.setParent(sessionId, started.orchestratorId);
    this.deps.changed();
    return started.title;
  }

  /** A queued item left the queue without starting. */
  itemRemoved(itemId: string): void {
    this.childItems.delete(itemId);
    if (this.deps.store.itemRemoved(itemId)) this.deps.changed();
  }

  /** A session was deleted: an orchestrator stops being one, a started session leaves its orchestrator's list. */
  sessionRemoved(sessionId: string): void {
    const own = this.deps.store.get(sessionId) !== null;
    if (own) this.deps.store.remove(sessionId);
    const child = this.started.delete(sessionId);
    if (this.deps.store.workerRemoved(sessionId) || own || child) this.deps.changed();
  }

  private async listSessions(orchestratorId: string, projectRoot: string): Promise<string> {
    const workers = this.deps.store.workersOf(orchestratorId);
    const agents = this.deps.agents(projectRoot);
    const lines = await Promise.all(
      workers.map(async (worker): Promise<WorkerLine> => {
        if (!worker.sessionId) return { sessionId: null, title: worker.title, state: 'queued', agent: null, branch: null, pr: null, note: 'waits in the queue for a free slot or the usage limit' };
        if (isRemoteKey(worker.sessionId)) return { sessionId: worker.sessionId, title: worker.title, state: 'idle', agent: null, branch: null, pr: null, note: 'runs on another computer; Seshboard does not follow it from here' };
        const [info, card] = [await this.deps.info(worker.sessionId).catch(() => ({ gone: false, branch: null, pr: null })), this.deps.catchUp(worker.sessionId)];
        const status = this.deps.status(worker.sessionId);
        const state = workerState({ sessionId: worker.sessionId, pr: info.pr ? { number: info.pr.number, url: info.pr.url, state: info.pr.state } : null }, status);
        const profileId = this.deps.session(worker.sessionId)?.profileId ?? null;
        const note = info.gone ? 'this session no longer exists' : state === 'working' ? null : card?.state === 'waiting' ? `asks: ${card.need.title}` : (card?.did[0] ?? null);
        return { sessionId: worker.sessionId, title: worker.title, state, agent: agents.find((a) => a.profileId === profileId)?.name ?? null, branch: info.branch, pr: info.pr ? prWord(info.pr) : null, note };
      }),
    );
    return writeWorkerList(
      lines,
      agents.map((a) => a.name),
    );
  }

  /**
   * A turn of a session ended: when an orchestrator started it, the orchestrator gets an update, as a message of its
   * own. A turn you stopped says nothing: you were there.
   */
  turnEnded(sessionId: string, ended: 'clean' | 'error' | 'stopped', card: CatchUp | null): void {
    const orchestratorId = this.deps.store.orchestratorOf(sessionId);
    if (!orchestratorId) return;
    this.deps.changed();
    if (ended === 'stopped') return;
    const worker = this.deps.store.workersOf(orchestratorId).find((w) => w.sessionId === sessionId)!;
    const end: WorkerEnd = ended === 'error' || card?.state === 'error' ? 'failed' : card?.state === 'waiting' ? 'waiting' : 'finished';
    const pr = this.deps.pr(sessionId);
    const update = writeSessionUpdate({ sessionId, title: worker.title, end, did: card?.did ?? [], need: end === 'waiting' ? (card?.need.text || card?.need.title || null) : null, pr: pr ? prWord(pr) : null });
    void this.deps.send(orchestratorId, update).catch((error: Error) => this.deps.log('warn', `Orchestrator ${orchestratorId}: the update about ${sessionId} did not go: ${error.message}`));
  }
}
