import { describe, expect, it } from 'vitest';
import { CODEX_MODES, codexModeSettings, sandboxPolicy } from './codexModes.ts';

describe('codexModeSettings', () => {
  it('maps each of Seshboard\'s modes to a sandbox and an approval policy', () => {
    expect(codexModeSettings('default')).toEqual({ sandbox: 'read-only', approvalPolicy: 'on-request', plan: false });
    expect(codexModeSettings('acceptEdits')).toEqual({ sandbox: 'workspace-write', approvalPolicy: 'on-request', plan: false });
    expect(codexModeSettings('plan')).toEqual({ sandbox: 'read-only', approvalPolicy: 'on-request', plan: true });
    expect(codexModeSettings('auto')).toEqual({ sandbox: 'workspace-write', approvalPolicy: 'never', plan: false });
  });

  it('has a row for every mode it offers', () => {
    for (const mode of CODEX_MODES) expect(codexModeSettings(mode.value as never)).toBeDefined();
  });

  it("treats Claude Code's other modes as Ask before edits, never as full access", () => {
    expect(codexModeSettings('bypassPermissions')).toEqual(codexModeSettings('default'));
    expect(codexModeSettings('dontAsk')).toEqual(codexModeSettings('default'));
  });

  it('keeps a read-only session read-only whatever its mode, without asking', () => {
    expect(codexModeSettings('auto', true)).toEqual({ sandbox: 'read-only', approvalPolicy: 'never', plan: false });
  });

  it('never gives full access', () => {
    expect(sandboxPolicy('read-only')).toEqual({ type: 'readOnly', networkAccess: false });
    expect(sandboxPolicy('workspace-write').type).toBe('workspaceWrite');
  });
});
