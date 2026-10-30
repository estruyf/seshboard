import { RpcError, type ImageAttachment, type PermissionDecision, type PermissionMode, type PermissionRequest, type QueuedMessage, type SendMode, type SessionHostInfo } from '@seshboard/protocol';
import { HostManager } from '../host/hostManager.ts';
import type { ProviderHosts } from './providerHosts.ts';

/**
 * Claude Code's host manager, with the session-level methods routed: a provider's session (GitHub Copilot) goes to
 * `ProviderHosts`, every other to Claude Code's. The engine's many ways to a session (the message box, the phone, Up
 * next, schedules, usage limits, project actions, pipelines) all go through these methods, so each reaches a provider's
 * sessions without knowing about providers. Claude Code's own features (fork, rewind, Ask, commands) stay as they are.
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

  override async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const other = this.providerFor(sessionId);
    return other ? other.setPermissionMode(sessionId, mode) : super.setPermissionMode(sessionId, mode);
  }

  override async setModel(sessionId: string, model: string | null): Promise<void> {
    const other = this.providerRunning(sessionId);
    return other ? other.setModel(sessionId, model) : super.setModel(sessionId, model);
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
