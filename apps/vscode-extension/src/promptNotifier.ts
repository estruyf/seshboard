import * as vscode from 'vscode';
import type { CompanionSessions, PermissionDecision, PermissionRequest } from '@seshboard/protocol/companion-client';
import type { SeshboardConnection } from './connection.ts';
import { alwaysText, newPrompts, promptKind, promptMessage, promptPlan, promptQuestions, questionAnswers } from './prompts.ts';

const DECLINED = 'The user declined this action.';
/** Plans open read-only in a Markdown preview under this scheme; the query is the prompt's request id. */
const PLAN_SCHEME = 'seshboard-plan';

/**
 * Seshboard's prompts for this workspace (permissions, questions, plans) as notifications you can answer here.
 * Dismissing one leaves the prompt waiting in Seshboard; *Seshboard: Answer Prompts* shows them again.
 */
export class PromptNotifier implements vscode.Disposable {
  private readonly seen = new Set<string>();
  /** Plans being read, by request id, for the preview. */
  private readonly plans = new Map<string, string>();
  private readonly provider: vscode.Disposable;
  private snapshot: CompanionSessions | null = null;

  constructor(
    private readonly connection: SeshboardConnection,
    private readonly enabled: () => boolean,
  ) {
    this.provider = vscode.workspace.registerTextDocumentContentProvider(PLAN_SCHEME, { provideTextDocumentContent: (uri) => this.plans.get(uri.query) ?? '' });
  }

  /** The workspace's sessions changed: announce new prompts. */
  update(snapshot: CompanionSessions | null): void {
    this.snapshot = snapshot;
    if (!snapshot) return;
    const prompts = snapshot.prompts ?? [];
    for (const id of this.plans.keys()) if (!prompts.some((p) => p.requestId === id)) this.plans.delete(id);
    // Marked as seen even while turned off, so turning it on doesn't bring up everything at once.
    const fresh = newPrompts(prompts, this.seen);
    if (this.enabled()) for (const request of fresh) void this.announce(request);
  }

  /** Shows every waiting prompt in a fresh snapshot again (after their notifications were closed), and says how many there are. */
  showAll(snapshot: CompanionSessions): number {
    this.snapshot = snapshot;
    const prompts = snapshot.prompts ?? [];
    newPrompts(prompts, this.seen);
    for (const request of prompts) void this.announce(request);
    return prompts.length;
  }

  dispose(): void {
    this.provider.dispose();
  }

  private waiting(request: PermissionRequest): boolean {
    return this.snapshot?.prompts?.some((p) => p.requestId === request.requestId) ?? false;
  }

  private message(request: PermissionRequest): string {
    return promptMessage(request, this.snapshot?.sessions.find((s) => s.id === request.sessionId)?.title ?? null);
  }

  private async announce(request: PermissionRequest): Promise<void> {
    try {
      const kind = promptKind(request);
      if (kind === 'question') await this.question(request);
      else if (kind === 'plan') await this.plan(request);
      else await this.tool(request);
    } catch (error) {
      void vscode.window.showErrorMessage(`Couldn't answer in Seshboard: ${(error as Error).message}`);
    }
  }

  /** Still waiting? Otherwise say so: it was answered in Seshboard (or the session stopped) in the meantime. */
  private stillWaiting(request: PermissionRequest): boolean {
    if (this.waiting(request)) return true;
    void vscode.window.showInformationMessage('That was already answered in Seshboard.');
    return false;
  }

  private async tool(request: PermissionRequest): Promise<void> {
    const always = request.alwaysLabel ? alwaysText(request.alwaysLabel) : null;
    const choice = await vscode.window.showWarningMessage(this.message(request), 'Allow', ...(always ? [always] : []), 'Deny…', 'Show in Seshboard');
    if (!choice || !this.stillWaiting(request)) return;
    if (choice === 'Show in Seshboard') return this.reveal(request);
    if (choice === 'Allow') return this.respond(request, { behavior: 'allow' });
    if (choice === always) return this.respond(request, { behavior: 'allow', always: true });
    const feedback = await this.feedback(request, 'Tell Claude what to do instead (optional)');
    if (feedback === undefined) return this.tool(request);
    return this.respond(request, { behavior: 'deny', message: feedback || DECLINED });
  }

  private async question(request: PermissionRequest): Promise<void> {
    const choice = await vscode.window.showWarningMessage(this.message(request), 'Answer…', 'Skip', 'Show in Seshboard');
    if (!choice || !this.stillWaiting(request)) return;
    if (choice === 'Show in Seshboard') return this.reveal(request);
    if (choice === 'Skip') return this.respond(request, { behavior: 'deny', message: DECLINED });
    const answers = await this.askQuestions(request);
    if (!answers) return this.question(request);
    if (this.stillWaiting(request)) await this.respond(request, { behavior: 'allow', updatedInput: answers as Record<string, never> });
  }

  /** One quick pick per question (several picks for a multi-select one), with your own answer as the last choice. */
  private async askQuestions(request: PermissionRequest): Promise<Record<string, unknown> | null> {
    type Item = vscode.QuickPickItem & { own?: true };
    const questions = promptQuestions(request);
    const picks: Record<string, string[]> = {};
    for (const [i, q] of questions.entries()) {
      const items: Item[] = [...q.options.map((o): Item => ({ label: o.label, ...(o.description ? { detail: o.description } : {}) })), { label: '$(edit) Type your own answer…', own: true, alwaysShow: true }];
      const options = { title: questions.length > 1 ? `Question ${i + 1} of ${questions.length}${q.header ? `: ${q.header}` : ''}` : (q.header ?? 'Claude has a question'), placeHolder: q.question, ignoreFocusOut: true, matchOnDetail: true };
      for (;;) {
        const picked = q.multiSelect ? await vscode.window.showQuickPick(items, { ...options, canPickMany: true }) : await vscode.window.showQuickPick(items, options).then((item) => item && [item]);
        if (!picked) return null;
        const labels = picked.filter((item) => !item.own).map((item) => item.label);
        if (picked.some((item) => item.own)) {
          const own = await vscode.window.showInputBox({ title: options.title, prompt: q.question, placeHolder: 'Your answer', ignoreFocusOut: true });
          if (own === undefined) continue;
          if (own.trim()) labels.push(own.trim());
        }
        if (labels.length) {
          picks[q.question] = labels;
          break;
        }
      }
    }
    return questionAnswers(request, picks);
  }

  private async plan(request: PermissionRequest): Promise<void> {
    const choice = await vscode.window.showWarningMessage(this.message(request), 'Read the plan', 'Show in Seshboard');
    if (!choice || !this.stillWaiting(request)) return;
    if (choice === 'Show in Seshboard') return this.reveal(request);
    this.plans.set(request.requestId, promptPlan(request));
    const uri = vscode.Uri.from({ scheme: PLAN_SCHEME, path: '/Plan.md', query: request.requestId });
    await vscode.commands.executeCommand('markdown.showPreview', uri).then(undefined, () => vscode.window.showTextDocument(uri, { preview: true }));
    await this.approve(request);
  }

  /** The plan is on screen: approve it, or keep planning with what to change. */
  private async approve(request: PermissionRequest): Promise<void> {
    const choice = await vscode.window.showWarningMessage(this.message(request), 'Approve and accept edits', 'Approve, ask before edits', 'Keep planning…');
    if (!choice || !this.stillWaiting(request)) return;
    if (choice === 'Approve and accept edits') return this.respond(request, { behavior: 'allow' }, true);
    if (choice === 'Approve, ask before edits') return this.respond(request, { behavior: 'allow' });
    const feedback = await this.feedback(request, 'What should Claude change in the plan? (optional)');
    if (feedback === undefined) return this.approve(request);
    return this.respond(request, { behavior: 'deny', message: feedback || DECLINED });
  }

  /** What to tell Claude with a denial: '' for nothing, undefined when you backed out. */
  private async feedback(request: PermissionRequest, prompt: string): Promise<string | undefined> {
    const text = await vscode.window.showInputBox({ title: this.message(request), prompt, placeHolder: 'Or tell Claude what to do instead…', ignoreFocusOut: true });
    return text?.trim();
  }

  private async respond(request: PermissionRequest, decision: PermissionDecision, acceptEdits = false): Promise<void> {
    const client = this.connection.client;
    if (!client) return void vscode.window.showErrorMessage("Seshboard isn't running anymore.");
    try {
      await client.call('prompt.respond', { requestId: request.requestId, decision, acceptEdits });
      vscode.window.setStatusBarMessage(`$(check) ${decision.behavior === 'allow' ? 'Answered' : 'Denied'} in Seshboard`, 3_000);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'NOT_FOUND') return void vscode.window.showInformationMessage('That was already answered in Seshboard.');
      if (code === 'METHOD_NOT_FOUND') return void vscode.window.showErrorMessage('Update Seshboard to answer it from VS Code.');
      throw error;
    }
  }

  private async reveal(request: PermissionRequest): Promise<void> {
    await this.connection.client?.call('session.reveal', { sessionId: request.sessionId });
  }
}
