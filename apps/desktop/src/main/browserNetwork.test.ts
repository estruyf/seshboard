import { describe, expect, it } from 'vitest';
import { bodyText, NETWORK_KEEP, NetworkLog, networkText } from './browserNetwork.ts';

const sent = (log: NetworkLog, requestId: string, url: string, extra: Record<string, unknown> = {}) =>
  log.onEvent('Network.requestWillBeSent', { requestId, type: 'Fetch', request: { method: 'GET', url, headers: { Authorization: 'Bearer secret' } }, ...extra });

describe('the network log', () => {
  it('keeps what a request is, never its headers, and follows it to the end', () => {
    const log = new NetworkLog();
    sent(log, '1.1', 'https://contoso.sharepoint.com/_api/web');
    log.onEvent('Network.responseReceived', { requestId: '1.1', type: 'XHR', response: { status: 200, mimeType: 'application/json', headers: { 'set-cookie': 'x' } } });
    log.onEvent('Network.loadingFinished', { requestId: '1.1', encodedDataLength: 1234 });
    sent(log, '1.2', 'https://contoso.sharepoint.com/missing');
    log.onEvent('Network.loadingFailed', { requestId: '1.2', errorText: 'net::ERR_FAILED' });
    sent(log, '1.3', 'https://contoso.sharepoint.com/slow');
    expect(log.list()).toEqual([
      { id: 'r1', requestId: '1.1', method: 'GET', url: 'https://contoso.sharepoint.com/_api/web', type: 'XHR', status: 200, mimeType: 'application/json', size: 1234, state: 'done', error: null },
      expect.objectContaining({ id: 'r2', state: 'failed', error: 'net::ERR_FAILED' }),
      expect.objectContaining({ id: 'r3', state: 'pending' }),
    ]);
    const text = networkText(log.list(), 'https://contoso.sharepoint.com/');
    expect(text).toContain('r1 GET 200 XHR application/json, 1,234 bytes https://contoso.sharepoint.com/_api/web');
    expect(text).toContain('r2 GET failed (net::ERR_FAILED)');
    expect(text).toContain('r3 GET pending');
    expect(text).not.toMatch(/Bearer|cookie/i);
    expect(log.find('r1')?.requestId).toBe('1.1');
    expect(log.list('_API')).toHaveLength(1);
  });

  it('gives a redirect its own entry, without a body to read', () => {
    const log = new NetworkLog();
    sent(log, '7', 'http://localhost/old');
    sent(log, '7', 'http://localhost/new', { redirectResponse: { status: 302 } });
    log.onEvent('Network.responseReceived', { requestId: '7', response: { status: 200 } });
    log.onEvent('Network.loadingFinished', { requestId: '7', encodedDataLength: 10 });
    expect(log.list().map((e) => [e.id, e.status, e.requestId])).toEqual([
      ['r1', 302, '7:redirect'],
      ['r2', 200, '7'],
    ]);
  });

  it('keeps a bounded list, newest last', () => {
    const log = new NetworkLog();
    for (let i = 0; i < NETWORK_KEEP + 20; i++) sent(log, String(i), `http://localhost/${i}`);
    const list = log.list();
    expect(list).toHaveLength(NETWORK_KEEP);
    expect(list[0]!.url).toBe('http://localhost/20');
    const text = networkText(list, 'http://localhost/');
    expect(text).toContain(`(${NETWORK_KEEP - 100} older not shown.)`);
    expect(networkText([], 'http://localhost/')).toContain('load the page again');
    expect(networkText([], 'http://localhost/', 'api')).toContain('has “api” in its address');
  });

  it('decodes a text body and describes a binary one', () => {
    expect(bodyText({ body: 'plain', base64Encoded: false }, 'text/html')).toEqual({ text: 'plain', binary: false });
    expect(bodyText({ body: Buffer.from('{"a":1}').toString('base64'), base64Encoded: true }, 'application/json')).toEqual({ text: '{"a":1}', binary: false });
    expect(bodyText({ body: Buffer.from('<feed/>').toString('base64'), base64Encoded: true }, 'application/atom+xml')).toMatchObject({ text: '<feed/>' });
    expect(bodyText({ body: Buffer.from([1, 2, 3]).toString('base64'), base64Encoded: true }, 'image/png')).toEqual({ text: '(A binary body of type image/png, 3 bytes: not shown.)', binary: true });
  });
});
