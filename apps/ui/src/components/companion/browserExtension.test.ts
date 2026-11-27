import { describe, expect, it } from 'vitest';
import { browserExtensionLabel } from './browserExtension.ts';

const chrome = { id: 'chrome', name: 'Google Chrome', family: 'chromium' as const, found: true, registered: true };

describe('browserExtensionLabel', () => {
  it('says what is connected, or what is left to do', () => {
    expect(browserExtensionLabel({ installed: true, browsers: [chrome] }, 2)).toBe('Connected to 2 browsers');
    expect(browserExtensionLabel({ installed: true, browsers: [chrome] }, 1)).toBe('Connected to 1 browser');
    expect(browserExtensionLabel({ installed: true, browsers: [chrome] }, 0)).toMatch(/waits for the extension/);
    expect(browserExtensionLabel({ installed: false, browsers: [] }, 0)).toMatch(/No supported browser/);
    expect(browserExtensionLabel({ installed: false, browsers: [{ ...chrome, registered: false }] }, 0)).toMatch(/^Connect your browsers/);
  });
});
