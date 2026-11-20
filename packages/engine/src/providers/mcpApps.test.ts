import { describe, expect, it } from 'vitest';
import { mcpAppToolPolicy } from './mcpApps.ts';

describe('mcpAppToolPolicy', () => {
  it('lets apps call a tool unless its visibility leaves them out', () => {
    expect(mcpAppToolPolicy('refresh', { name: 'refresh' })?.callable).toBe(true);
    expect(mcpAppToolPolicy('refresh', { _meta: { ui: { visibility: ['model', 'app'] } } })?.callable).toBe(true);
    expect(mcpAppToolPolicy('refresh', { _meta: { ui: { visibility: ['app'] } } })?.callable).toBe(true);
    expect(mcpAppToolPolicy('delete_all', { _meta: { ui: { visibility: ['model'] } } })?.callable).toBe(false);
  });

  it('runs only a tool that says it is read-only without asking', () => {
    expect(mcpAppToolPolicy('list', { annotations: { readOnlyHint: true } })?.readOnly).toBe(true);
    expect(mcpAppToolPolicy('create', { annotations: { readOnlyHint: false } })?.readOnly).toBe(false);
    expect(mcpAppToolPolicy('create', {})?.readOnly).toBe(false);
  });

  it('names a tool by its title, else its name, and knows no tool it was not given', () => {
    expect(mcpAppToolPolicy('create_pr', { annotations: { title: 'Create pull request' } })?.title).toBe('Create pull request');
    expect(mcpAppToolPolicy('create_pr', { title: ' ' })?.title).toBe('create_pr');
    expect(mcpAppToolPolicy('create_pr', undefined)).toBeNull();
  });
});
