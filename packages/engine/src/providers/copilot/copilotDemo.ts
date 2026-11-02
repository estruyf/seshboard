import type { CopilotSdkClient, CreateCopilotClient } from './copilotDriver.ts';
import type { CopilotVersionCommand } from './copilotUpdate.ts';

/**
 * A made-up Copilot CLI for the demo home (the smoke test and the screenshots): installed, signed in, with two models,
 * Copilot Fusion and premium requests, and no process behind it. Starting a session refuses, so nothing ever reaches a real Copilot.
 */
export function demoCopilot(): { createClient: CreateCopilotClient; binary: () => Promise<{ path: string; version: string | null }>; version: CopilotVersionCommand } {
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
      // Copilot Fusion's tiers, which the model menu lists as models.
      models: {
        list: async () => ({
          auto: {
            tiers: [
              { id: 'fusion-standard', displayName: 'Copilot Fusion Standard', description: 'Balances quality, speed and cost', type: 'fusion', status: { enabled: true } },
              { id: 'fusion-max', displayName: 'Copilot Fusion Max', description: 'Prioritizes quality', type: 'fusion', status: { enabled: true } },
            ],
          },
        }),
      },
      account: {
        getQuota: async () => ({
          quotaSnapshots: { premium_interactions: { isUnlimitedEntitlement: false, entitlementRequests: 1500, usedRequests: 212, remainingPercentage: 85.87, resetDate: '2026-12-01' } },
        }),
      },
    },
  };
  return {
    createClient: async () => client,
    binary: async () => ({ path: '/usr/local/bin/copilot', version: '1.0.4' }),
    // Up to date: Settings › About shows the check without a toast over the other steps.
    version: async () => 'GitHub Copilot CLI 1.0.4\n',
  };
}
