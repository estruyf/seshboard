import { RpcError, type BrowserTool, type Capabilities, type Effort, type ImageAttachment, type PermissionDecision, type PermissionMode, type PermissionRequest, type QueuedMessage, type RewindResult, type SendMode, type SessionHostInfo, type SlashCommand } from '@seshboard/protocol';
import { HostManager } from '../host/hostManager.ts';
import type { AskResult, AskText } from '../host/sideQuestions.ts';
import type { ProviderHosts } from './providerHosts.ts';
import type { McpStdioServer } from './provider.ts';

/**
 * Claude Code's host manager, with the session-level methods routed: a provider's session (GitHub Copilot) goes to
 * `ProviderHosts`, every other to Claude Code's. The engine's many ways to a session (the message box, the phone, Up
 * next, schedules, usage limits, project actions, pipelines) all go through these methods, so each reaches a provider's
 * sessions without knowing about providers. Effort, rewind, Ask and stopping a background task are routed too.
 */
export class RoutedHostManager extends HostManager {
  /** Set once both exist (ProviderHosts reports through the same handlers as this). */
  providers: ProviderHosts | null = null;

  private providerFor(sessionId: string): ProviderHosts | null {
    return this.providers?.handles(sessionId) ? this.providers : null;
  }

  private providerRunning(sessionId: string): ProviderHosts | null {
    return this.providers?.has(sessionId) ? this.providers : null;
  }

  override list(): { hosts: SessionHostInfo[]; permissions: PermissionRequest[] } {
    const own = super.list();
    const other = this.providers?.list();
    return other ? { hosts: [...own.hosts, ...other.hosts], permissions: [...own.permissions, ...other.permissions] } : own;
  }

  override async send(params: { sessionId: string; text: string; attachments: ImageAttachment[]; fork: boolean; mode?: SendMode }): Promise<{ sessionId: string; messageUuid: string; queued: boolean }> {
    const other = this.providerFor(params.sessionId);
    if (!other) return super.send(params);
    if (params.fork) throw new RpcError('READ_ONLY_SESSION', 'Forking is only available for Claude Code sessions');
    return other.send(params);
  }

  override async interrupt(sessionId: string, upNext: 'hold' | 'continue' = 'hold'): Promise<void> {
    const other = this.providerRunning(sessionId);
    return other ? other.interrupt(sessionId, upNext) : super.interrupt(sessionId, upNext);
  }

  override respond(requestId: string, decision: PermissionDecision): void {
    if (!this.providers?.respond(requestId, decision)) super.respond(requestId, decision);
  }

  override askBrowserSite(sessionId: string, site: string, tool: BrowserTool, input: Record<string, unknown>): Promise<boolean> {
    const other = this.providerRunning(sessionId);
    return other ? other.askBrowserSite(sessionId, site, tool, input) : super.askBrowserSite(sessionId, site, tool, input);
  }

  override async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const other = this.providerFor(sessionId);
    return other ? other.setPermissionMode(sessionId, mode) : super.setPermissionMode(sessionId, mode);
  }

  override async setModel(sessionId: string, model: string | null): Promise<void> {
    const other = this.providerRunning(sessionId);
    return other ? other.setModel(sessionId, model) : super.setModel(sessionId, model);
  }

  override async setEffort(sessionId: string, effort: Effort | null): Promise<void> {
    const other = this.providerFor(sessionId);
    return other ? other.setEffort(sessionId, effort) : super.setEffort(sessionId, effort);
  }

  override async setFastMode(sessionId: string, on: boolean): Promise<void> {
    if (this.providerFor(sessionId)) throw new RpcError('UNSUPPORTED', 'Fast mode is only available for Claude Code sessions');
    return super.setFastMode(sessionId, on);
  }

  override async rewind(sessionId: string, userMessageId: string, dryRun: boolean): Promise<RewindResult> {
    const other = this.providerFor(sessionId);
    return other ? other.rewind(sessionId, userMessageId, dryRun) : super.rewind(sessionId, userMessageId, dryRun);
  }

  override async askAbout(sessionId: string, prompt: string, onText: (text: AskText) => void): Promise<AskResult> {
    const other = this.providerFor(sessionId);
    return other ? other.askAbout(sessionId, prompt, onText) : super.askAbout(sessionId, prompt, onText);
  }

  override stopTask(sessionId: string, taskId: string): Promise<void> {
    const other = this.providerRunning(sessionId);
    return other ? other.stopTask(sessionId, taskId) : super.stopTask(sessionId, taskId);
  }

  override async release(sessionId: string): Promise<void> {
    const other = this.providerRunning(sessionId);
    return other ? other.close(sessionId) : super.release(sessionId);
  }

  override dequeue(sessionId: string, id: string): { text: string; attachments: ImageAttachment[] } | null {
    const other = this.providerRunning(sessionId);
    return other ? other.dequeue(sessionId, id) : super.dequeue(sessionId, id);
  }

  override moveQueued(sessionId: string, id: string, toIndex: number): void {
    const other = this.providerRunning(sessionId);
    if (other) other.moveQueued(sessionId, id, toIndex);
    else super.moveQueued(sessionId, id, toIndex);
  }

  override async sendQueuedNow(sessionId: string, id: string): Promise<void> {
    const other = this.providerRunning(sessionId);
    return other ? other.sendQueuedNow(sessionId, id) : super.sendQueuedNow(sessionId, id);
  }

  override async resumeQueue(sessionId: string): Promise<void> {
    const other = this.providerFor(sessionId);
    return other ? other.resumeQueue(sessionId) : super.resumeQueue(sessionId);
  }

  override async commands(sessionId: string | undefined, cwd: string | undefined, profileId: string): Promise<SlashCommand[]> {
    const other = sessionId ? this.providerFor(sessionId) : null;
    return other ? other.commands(sessionId!) : super.commands(sessionId, cwd, profileId);
  }

  override async capabilities(sessionId: string | undefined, cwd: string, refresh: boolean, profileId: string, reload = false): Promise<Capabilities> {
    const other = sessionId ? this.providerFor(sessionId) : null;
    return other ? other.capabilities(sessionId!, cwd) : super.capabilities(sessionId, cwd, refresh, profileId, reload);
  }

  override async mcp(sessionId: string, server: string, action: 'enable' | 'disable' | 'reconnect'): Promise<void> {
    const other = this.providerRunning(sessionId);
    return other ? other.mcp(sessionId, server, action) : super.mcp(sessionId, server, action);
  }

  /** Visuals in replies: Claude Code's sessions and the providers' get the server alike. */
  override setVisuals(server: McpStdioServer | null): void {
    super.setVisuals(server);
    this.providers?.setVisuals(server);
  }

  /** MCP Apps are a provider's (Codex's): Claude Code's sessions have none yet. */
  mcpAppResource(sessionId: string, server: string, uri: string, callId: string | null): Promise<unknown[]> {
    const other = this.providerFor(sessionId);
    if (!other) throw new RpcError('UNSUPPORTED', 'This session has no MCP Apps');
    return other.mcpAppResource(sessionId, server, uri, callId);
  }

  mcpAppCall(sessionId: string, server: string, tool: string, args: unknown, confirmed: boolean): Promise<unknown> {
    const other = this.providerFor(sessionId);
    if (!other) throw new RpcError('UNSUPPORTED', 'This session has no MCP Apps');
    return other.mcpAppCall(sessionId, server, tool, args, confirmed);
  }

  override upNextLists(): Array<{ sessionId: string; queue: QueuedMessage[] }> {
    return [...super.upNextLists(), ...(this.providers?.upNextLists() ?? [])];
  }

  override close(sessionId: string): void {
    const other = this.providerRunning(sessionId);
    if (other) void other.close(sessionId);
    else super.close(sessionId);
  }

  override closeAll(): void {
    void this.providers?.closeAll();
    super.closeAll();
  }
}
