import type { CopilotSdkClient, CreateCopilotClient } from './copilotDriver.ts';

/**
 * A made-up Copilot CLI for the demo home (the smoke test and the screenshots): installed, signed in, with two models
 * and premium requests, and no process behind it. Starting a session refuses, so nothing ever reaches a real Copilot.
 */
export function demoCopilot(): { createClient: CreateCopilotClient; binary: () => Promise<{ path: string; version: string | null }> } {
  const client: CopilotSdkClient = {
    start: async () => {},
    stop: async () => {},
    getAuthStatus: async () => ({ isAuthenticated: true, login: 'demo-user', statusMessage: 'demo-user' }),
    listModels: async () => [
      { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
      { id: 'gpt-5', name: 'GPT-5' },
    ],
    createSession: () => Promise.reject(new Error('The demo has no Copilot CLI to run sessions')),
    resumeSession: () => Promise.reject(new Error('The demo has no Copilot CLI to run sessions')),
    cliProcess: null,
    rpc: {
      commands: { list: async () => ({ commands: [] }) },
      account: {
        getQuota: async () => ({
          quotaSnapshots: { premium_interactions: { isUnlimitedEntitlement: false, entitlementRequests: 1500, usedRequests: 212, remainingPercentage: 85.87, resetDate: '2026-12-01' } },
        }),
      },
    },
  };
  return { createClient: async () => client, binary: async () => ({ path: '/usr/local/bin/copilot', version: '1.0.4' }) };
}
