import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@seshboard/protocol/client';
import { canToggleMcp, toolsTabs } from './toolsModel.ts';

const claude: Capabilities = { live: true, mcp: [], agents: [], commands: [], plugins: [] };
const codex: Capabilities = { ...claude, hooks: [{ event: 'preToolUse', matcher: 'shell', command: './check.sh', scope: 'user', enabled: true }], mcpToggle: false, reconnectNote: 'Restarts every Codex session here.' };

describe('Tools', () => {
  it('shows Hooks only for capabilities that list them', () => {
    expect(toolsTabs(claude).map((t) => t.id)).toEqual(['mcp', 'commands', 'agents', 'plugins']);
    expect(toolsTabs(codex).map((t) => [t.id, t.count]).at(-1)).toEqual(['hooks', 1]);
    expect(toolsTabs(null).every((t) => t.count === null)).toBe(true);
  });

  it("offers the switch to turn a server on or off unless the provider can't", () => {
    expect(canToggleMcp(claude)).toBe(true);
    expect(canToggleMcp(null)).toBe(true);
    expect(canToggleMcp(codex)).toBe(false);
  });
});
