import { describe, expect, it } from 'vitest';
import { isShowLink, linkFromArgv, MAX_LINK_PROMPT, parseDeepLink } from './deepLink.ts';

// macOS unless a test says otherwise, whatever these tests run on.
const link = (url: string, platform = 'darwin') => {
  const parsed = parseDeepLink(url, platform);
  if (!parsed.ok) throw new Error(`refused: ${parsed.error}`);
  return parsed.link;
};
const error = (url: string, platform = 'darwin') => {
  const parsed = parseDeepLink(url, platform);
  if (parsed.ok) throw new Error(`accepted: ${JSON.stringify(parsed.link)}`);
  return parsed.error;
};

describe('parseDeepLink: new-session', () => {
  it('reads the prompt and folder', () => {
    expect(link('seshboard://new-session?prompt=Investigate%20the%20failed%20deploy&cwd=/Users/me/dev/payments')).toEqual({
      action: 'new-session',
      prompt: 'Investigate the failed deploy',
      cwd: '/Users/me/dev/payments',
      project: null,
      repo: null,
      autostart: false,
      question: false,
    });
  });

  it('accepts q as the prompt, new lines, and nothing at all', () => {
    expect(link('seshboard://new-session?q=one%0Atwo%0D%0Athree')).toMatchObject({ prompt: 'one\ntwo\nthree', cwd: null });
    expect(link('seshboard://new-session')).toEqual({ action: 'new-session', prompt: null, cwd: null, project: null, repo: null, autostart: false, question: false });
    expect(link('seshboard://new-session/?prompt=')).toMatchObject({ prompt: null });
    expect(link('switchboard:new-session?prompt=hi')).toMatchObject({ prompt: 'hi' });
    expect(link('SWITCHBOARD://New-Session?prompt=hi')).toMatchObject({ action: 'new-session', prompt: 'hi' });
  });

  it('keeps emoji (with joiners) and plain text intact', () => {
    expect(link(`seshboard://new-session?prompt=${encodeURIComponent('Ship it 👩‍💻 — ok?')}`)).toMatchObject({ prompt: 'Ship it 👩‍💻 — ok?' });
  });

  it('takes repo only without cwd, since cwd wins', () => {
    expect(link('seshboard://new-session?repo=acme/payments&prompt=Review')).toMatchObject({ repo: 'acme/payments', cwd: null });
    expect(link('seshboard://new-session?repo=acme/payments.git')).toMatchObject({ repo: 'acme/payments' });
    expect(link('seshboard://new-session?repo=acme/payments&cwd=/work/pay')).toMatchObject({ repo: null, cwd: '/work/pay' });
  });

  it('takes a project by name, which wins over repo but not over cwd', () => {
    expect(link('seshboard://new-session?project=%20Payments%20&repo=acme/payments')).toMatchObject({ project: 'Payments', repo: null, cwd: null });
    expect(link('seshboard://new-session?project=payments&cwd=/work/pay')).toMatchObject({ project: null, cwd: '/work/pay' });
    expect(link('seshboard://new-session?project=')).toMatchObject({ project: null });
    expect(error('seshboard://new-session?project=pay%E2%80%AEments')).toMatch(/hidden/);
  });

  it('waits by default and starts only when autostart asks for it', () => {
    expect(link('seshboard://new-session?prompt=hi&cwd=/w')).toMatchObject({ autostart: false });
    for (const on of ['1', 'true', 'YES', '']) expect(link(`seshboard://new-session?prompt=hi&autostart=${on}`)).toMatchObject({ autostart: true });
    for (const off of ['0', 'false', 'no']) expect(link(`seshboard://new-session?prompt=hi&autostart=${off}`)).toMatchObject({ autostart: false });
    expect(error('seshboard://new-session?prompt=hi&autostart=later')).toMatch(/autostart/);
  });

  it('asks a quick question, without a folder, project or repository', () => {
    expect(link('seshboard://new-session?question=1&prompt=What%20is%20a%20monad%3F')).toMatchObject({ question: true, prompt: 'What is a monad?', cwd: null });
    expect(link('seshboard://new-session?question&cwd=/work/pay&project=pay&repo=acme/pay')).toMatchObject({ question: true, cwd: null, project: null, repo: null });
    expect(link('seshboard://new-session?question=0&cwd=/work/pay')).toMatchObject({ question: false, cwd: '/work/pay' });
    expect(error('seshboard://new-session?question=maybe')).toMatch(/question/);
  });

  it('drops a trailing slash from the folder and ignores unknown parameters', () => {
    expect(link('seshboard://new-session?cwd=/Users/me/dev/&model=opus&permissionMode=bypassPermissions')).toEqual({
      action: 'new-session',
      prompt: null,
      cwd: '/Users/me/dev',
      project: null,
      repo: null,
      autostart: false,
      question: false,
    });
    expect(link('seshboard://new-session?cwd=/')).toMatchObject({ cwd: '/' });
  });

  it('refuses folders that are relative, remote, climbing or disguised', () => {
    expect(error('seshboard://new-session?cwd=dev/payments')).toMatch(/absolute/);
    expect(error('seshboard://new-session?cwd=~/dev')).toMatch(/absolute/);
    expect(error('seshboard://new-session?cwd=//server/share')).toMatch(/network/);
    expect(error('seshboard://new-session?cwd=%5C%5Cserver%5Cshare')).toMatch(/network/);
    expect(error('seshboard://new-session?cwd=smb://server/share')).toMatch(/network/);
    expect(error('seshboard://new-session?cwd=/Users/me/../other')).toMatch(/\.\./);
    expect(error('seshboard://new-session?cwd=/Users/me/./dev')).toMatch(/\.\./);
    expect(error('seshboard://new-session?cwd=/Users/me/dev%E2%80%AEtxt.exe')).toMatch(/hidden/);
    expect(error('seshboard://new-session?cwd=/Users/me/d%E2%80%8Bev')).toMatch(/hidden/);
    expect(error('seshboard://new-session?cwd=/Users/me%00/dev')).toMatch(/control/);
  });

  it('takes drive paths on Windows, with either slash, and nothing that only looks local', () => {
    const cwd = (url: string) => {
      const parsed = link(url, 'win32');
      return parsed.action === 'new-session' ? parsed.cwd : undefined;
    };
    expect(cwd('seshboard://new-session?cwd=C%3A%5CUsers%5Cme%5Cdev%5Cpayments')).toBe('C:\\Users\\me\\dev\\payments');
    expect(cwd('seshboard://new-session?cwd=C:/Users/me/dev/')).toBe('C:/Users/me/dev');
    expect(cwd('seshboard://new-session?cwd=e%3A%5Crepos%5C')).toBe('e:\\repos');
    expect(cwd('seshboard://new-session?cwd=C%3A%5C')).toBe('C:\\');
    // Extra separators after the drive still mean its root, never `C:` (the current folder on that drive).
    expect(cwd('seshboard://new-session?cwd=C%3A%5C%5C')).toBe('C:\\');
    expect(cwd('seshboard://new-session?cwd=C://')).toBe('C:/');
    const refused = (folder: string) => error(`seshboard://new-session?cwd=${encodeURIComponent(folder)}`, 'win32');
    expect(refused('/Users/me/dev')).toMatch(/absolute/);
    expect(refused('C:dev')).toMatch(/absolute/);
    expect(refused('dev\\payments')).toMatch(/absolute/);
    expect(refused('\\\\server\\share')).toMatch(/network/);
    expect(refused('//server/share')).toMatch(/network/);
    expect(refused('file:///C:/dev')).toMatch(/network/);
    expect(refused('C:\\Users\\me\\..\\other')).toMatch(/\.\./);
    expect(refused('C:\\Users/me/./dev')).toMatch(/\.\./);
    expect(refused('C:\\dev\\file.txt:hidden')).toMatch(/colon/);
    // And a drive path is no folder on macOS.
    expect(error('seshboard://new-session?cwd=C%3A%5Cdev')).toMatch(/network|absolute/);
  });

  it('refuses long prompts and prompts with hidden characters', () => {
    expect(link(`seshboard://new-session?prompt=${'a'.repeat(MAX_LINK_PROMPT)}`)).toMatchObject({ prompt: 'a'.repeat(MAX_LINK_PROMPT) });
    expect(error(`seshboard://new-session?prompt=${'a'.repeat(MAX_LINK_PROMPT + 1)}`)).toMatch(/5,000/);
    expect(error('seshboard://new-session?prompt=run%20this%E2%80%AEtxt')).toMatch(/hidden/);
    expect(error('seshboard://new-session?prompt=bell%07')).toMatch(/control/);
  });

  it('refuses a repo that is not owner/name', () => {
    expect(error('seshboard://new-session?repo=payments')).toMatch(/owner\/name/);
    expect(error('seshboard://new-session?repo=https://github.com/acme/payments')).toMatch(/owner\/name/);
    expect(error('seshboard://new-session?repo=acme/pay/ments')).toMatch(/owner\/name/);
  });
});

describe('parseDeepLink: session and others', () => {
  it('reads a session id', () => {
    expect(link('seshboard://session/0b9a7c1e-1234-4abc-9def-001122334455')).toEqual({ action: 'session', sessionId: '0b9a7c1e-1234-4abc-9def-001122334455' });
  });

  it('refuses a missing or odd session id', () => {
    expect(error('seshboard://session')).toMatch(/session/);
    expect(error('seshboard://session/a/b')).toMatch(/session/);
    expect(error('seshboard://session/%3Cscript%3E')).toMatch(/session/);
  });

  it('refuses other schemes, unknown actions and garbage', () => {
    expect(error('claude-cli://open?q=hi')).toMatch(/not a Seshboard link/);
    expect(error('seshboard://delete-everything')).toMatch(/can't do "delete-everything"/);
    expect(error('seshboard://')).toMatch(/no action/);
    expect(error('not a url')).toMatch(/not a valid/);
    expect(error('seshboard://session/%E0%A4%A')).toMatch(/not a valid|session/);
    expect(error(`seshboard://new-session?prompt=${'a'.repeat(40_000)}`)).toMatch(/too long/);
  });
});

describe('linkFromArgv', () => {
  it('finds the link among the arguments', () => {
    expect(linkFromArgv(['/Applications/Seshboard.app/Contents/MacOS/Seshboard', '--flag', 'seshboard://session/abc'])).toBe('seshboard://session/abc');
    expect(linkFromArgv(['electron', '.'])).toBeNull();
  });

  it('also finds a switchboard:// link, the scheme from before the rename', () => {
    expect(linkFromArgv(['Seshboard.exe', 'switchboard://new-session?cwd=C%3A%5Crepo'])).toBe('switchboard://new-session?cwd=C%3A%5Crepo');
  });
});

describe('switchboard:// links, from before the rename', () => {
  it('read like seshboard:// ones (the VS Code companion and saved links send them)', () => {
    expect(link('switchboard://new-session?prompt=hi&cwd=/Users/me/dev/payments')).toEqual(link('seshboard://new-session?prompt=hi&cwd=/Users/me/dev/payments'));
    expect(isShowLink('switchboard://show')).toBe(true);
    expect(parseDeepLink('https://new-session')).toMatchObject({ ok: false });
  });
});

describe('isShowLink', () => {
  it('knows seshboard://show, and nothing else, as only showing the window', () => {
    for (const link of ['seshboard://show', 'seshboard://show/', 'seshboard:show', 'SESHBOARD://SHOW']) expect(isShowLink(link)).toBe(true);
    for (const link of ['seshboard://show?cwd=/x', 'seshboard://show/more', 'seshboard://new-session', 'https://show', 'show', 'seshboard://showx']) expect(isShowLink(link)).toBe(false);
  });
});

describe('parseDeepLink: an issue or pull request', () => {
  it('takes a number, #123 or its link on GitHub, in a project the link names', () => {
    expect(link('seshboard://new-session?project=switchboard&issue=32')).toMatchObject({ project: 'switchboard', issue: '32' });
    expect(link('seshboard://new-session?project=switchboard&issue=%2332')).toMatchObject({ issue: '32' });
    expect(link('seshboard://new-session?repo=estruyf/switchboard&pr=151')).toMatchObject({ repo: 'estruyf/switchboard', pr: '151' });
    expect(link(`seshboard://new-session?cwd=/Users/me/dev/app&pr=${encodeURIComponent('https://github.com/estruyf/switchboard/pull/151')}`)).toMatchObject({ pr: 'https://github.com/estruyf/switchboard/pull/151' });
    expect(link(`seshboard://new-session?project=app&issue=${encodeURIComponent('https://github.com/o/r/issues/7/')}`)).toMatchObject({ issue: 'https://github.com/o/r/issues/7' });
    // Without one, nothing about it is passed on.
    expect(link('seshboard://new-session?project=app')).not.toHaveProperty('issue');
  });

  it('keeps autostart as asked, for New session to refuse it with a reason', () => {
    expect(link('seshboard://new-session?project=switchboard&issue=32&autostart=1')).toMatchObject({ issue: '32', autostart: true });
  });

  it('refuses bad numbers, other sites, both at once, and a link without a project', () => {
    expect(error('seshboard://new-session?project=a&issue=0')).toBe('The issue in the link must be a number, #123, or its link on GitHub.');
    expect(error('seshboard://new-session?project=a&issue=-3')).toBe('The issue in the link must be a number, #123, or its link on GitHub.');
    expect(error('seshboard://new-session?project=a&issue=12abc')).toBe('The issue in the link must be a number, #123, or its link on GitHub.');
    expect(error('seshboard://new-session?project=a&pr=1234567890')).toBe('The pull request in the link must be a number, #123, or its link on GitHub.');
    expect(error(`seshboard://new-session?project=a&issue=${encodeURIComponent('https://example.com/o/r/issues/1')}`)).toBe('The issue in the link must be a number, #123, or its link on GitHub.');
    expect(error(`seshboard://new-session?project=a&issue=${encodeURIComponent('http://github.com/o/r/issues/1')}`)).toBe('The issue in the link must be a number, #123, or its link on GitHub.');
    expect(error('seshboard://new-session?project=a&issue=1&pr=2')).toBe('A link can have an issue or a pull request, not both.');
    expect(error('seshboard://new-session?issue=32')).toBe('A link with an issue or pull request needs project, repo or cwd.');
    expect(error('seshboard://new-session?question=1&issue=32')).toBe('A quick question has no issue or pull request.');
  });
});
