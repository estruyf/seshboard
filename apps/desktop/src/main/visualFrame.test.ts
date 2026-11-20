import { describe, expect, it } from 'vitest';
import { isVisualFrameUrl, mcpAppCsp, McpAppDocuments, visualFrameCsp, visualFrameHtml, visualFrameResponse } from './visualFrame.ts';

describe('visual frame', () => {
  it('allows inline scripts and the CDNs, and nothing of the app', () => {
    const csp = visualFrameCsp();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'unsafe-inline' [^;]*https:\/\/cdnjs\.cloudflare\.com[^;]*https:\/\/esm\.sh/);
    expect(csp).not.toContain("'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toMatch(/style-src [^;]*https:\/\/fonts\.googleapis\.com/);
    expect(csp).toMatch(/font-src [^;]*https:\/\/fonts\.gstatic\.com/);
    expect(csp).not.toMatch(/script-src [^;]*fonts\./);
  });

  it('colours the SVG ramps by stop, in light and dark, on direct children only', () => {
    const html = visualFrameHtml();
    expect(html).toContain('.c-blue { --cf: #E6F1FB; --cs: #185FA5; --ct: #0C447C; --cu: #185FA5; }');
    expect(html).toContain("[data-mode='dark'] .c-blue { --cf: #0C447C; --cs: #85B7EB; --ct: #B5D4F4; --cu: #85B7EB; }");
    expect(html).toMatch(/> :is\(rect, circle, ellipse\) \{ fill: var\(--cf\)/);
    expect(html).toContain('dataset.mode');
  });

  it('puts the policy before anything else on the page, and its script parses', () => {
    const html = visualFrameHtml();
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>'));
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
    expect(script).toContain('sendPrompt');
    expect(() => new Function(script)).not.toThrow();
  });

  it('serves the page at frame/ only', async () => {
    const page = visualFrameResponse(new Request('seshboard-visual://frame/'));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('content-security-policy')).toBe(visualFrameCsp());
    expect(await page.text()).toContain('<div id="root"></div>');
    expect(visualFrameResponse(new Request('seshboard-visual://frame/other.js')).status).toBe(404);
    expect(visualFrameResponse(new Request('seshboard-visual://elsewhere/')).status).toBe(404);
  });

  it("builds an MCP App's policy from the origins it declared, and the restrictive default without them", () => {
    const strict = mcpAppCsp(null);
    expect(strict).toContain("default-src 'none'");
    expect(strict).toContain("script-src 'unsafe-inline'");
    expect(strict).toContain("connect-src 'none'");
    expect(strict).toContain("frame-src 'none'");
    expect(strict).toContain("base-uri 'none'");
    const declared = mcpAppCsp({ resourceDomains: ['https://cdn.jsdelivr.net'], connectDomains: ['https://api.example.com', 'wss://live.example.com'], frameDomains: ['https://www.youtube.com'] });
    expect(declared).toContain("script-src 'unsafe-inline' https://cdn.jsdelivr.net");
    expect(declared).toContain('connect-src https://api.example.com wss://live.example.com');
    expect(declared).toContain('frame-src https://www.youtube.com');
  });

  it('drops anything in a declared list that is not an origin', () => {
    const csp = mcpAppCsp({ resourceDomains: ['*', "'unsafe-eval'", 'https://ok.example.com; script-src *', 'javascript:alert(1)', 'https://*.example.com'], connectDomains: ['*'] });
    expect(csp).toContain("script-src 'unsafe-inline' https://*.example.com;");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('serves an app page at its own address with its policy, and nothing for an unknown one', async () => {
    const apps = new McpAppDocuments();
    const url = apps.add('<p>Weather</p>', { connectDomains: ['https://api.example.com'] });
    expect(url).toMatch(/^seshboard-visual:\/\/app\/[0-9a-f-]{36}$/);
    const page = visualFrameResponse(new Request(url), apps);
    expect(await page.text()).toBe('<p>Weather</p>');
    expect(page.headers.get('content-security-policy')).toContain('connect-src https://api.example.com');
    expect(visualFrameResponse(new Request('seshboard-visual://app/not-there'), apps).status).toBe(404);
    expect(visualFrameResponse(new Request(url)).status).toBe(404);
  });

  it('tells its pages from others', () => {
    expect(isVisualFrameUrl('seshboard-visual://frame/')).toBe(true);
    expect(isVisualFrameUrl('https://example.com')).toBe(false);
    expect(isVisualFrameUrl('about:blank')).toBe(false);
    expect(isVisualFrameUrl(undefined)).toBe(false);
  });
});
