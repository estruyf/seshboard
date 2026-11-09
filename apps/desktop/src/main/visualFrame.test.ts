import { describe, expect, it } from 'vitest';
import { isVisualFrameUrl, visualFrameCsp, visualFrameHtml, visualFrameResponse } from './visualFrame.ts';

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

  it('tells its pages from others', () => {
    expect(isVisualFrameUrl('seshboard-visual://frame/')).toBe(true);
    expect(isVisualFrameUrl('https://example.com')).toBe(false);
    expect(isVisualFrameUrl('about:blank')).toBe(false);
    expect(isVisualFrameUrl(undefined)).toBe(false);
  });
});
