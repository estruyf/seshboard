import { describe, expect, it } from 'vitest';
import { BRIEF_BUDGET, defuseStubs, withoutBriefs, linkLabel, parseBriefs, replaceBriefs, stubBrief, uniqueLabel, writeBrief, writeBriefs, writeStub, type Brief } from './sessionLinks.ts';

const ID = '3f2c9a1e-5b7d-4c0e-9a51-2f0d8c6e1b44';

const full = (over: Partial<Brief> = {}): Brief => ({
  ...stubBrief('Usage cost toggle', ID),
  stub: false,
  fields: {
    project: 'switchboard',
    folder: '/Users/demo/dev/switchboard/.claude/worktrees/usage-cost',
    branch: 'worktree-usage-cost',
    'pull request': '#148 open, base main, https://github.com/demo/switchboard/pull/148',
    state: 'finished, last active 2026-10-18 13:02',
    asked: 'Add a setting to hide the estimated cost on the usage bars',
  },
  commits: ['c9f6e15 feat(usage): add a setting', '1a2b3c4 test(usage): cover it'],
  did: ['Added Show estimated cost', 'Hid the cost on the bars', 'Added tests'],
  skipped: ['The remote app still shows the cost'],
  next: 'Review and merge the pull request',
  lastReply: 'Done. The setting is under Settings › Usage.\n\nPR #148 is open against main.',
  ...over,
});

describe('briefs', () => {
  it('writes and reads back a brief', () => {
    const brief = full();
    const text = `stack it on @Usage cost toggle\n\n${writeBrief(brief)}`;
    const parsed = parseBriefs(text);
    expect(parsed.text).toBe('stack it on @Usage cost toggle');
    expect(parsed.briefs).toEqual([brief]);
  });

  it('reads a stub as a stub', () => {
    const parsed = parseBriefs(`look at @Old spike\n\n${writeStub('Old spike', ID)}`);
    expect(parsed.briefs).toEqual([stubBrief('Old spike', ID)]);
    expect(parsed.text).toBe('look at @Old spike');
  });

  it('keeps a reply with backticks inside its block', () => {
    const brief = full({ lastReply: 'Run this:\n```sh\nnpm test\n```\nand `npm run check`.' });
    const parsed = parseBriefs(writeBrief(brief));
    expect(parsed.briefs[0]!.lastReply).toBe(brief.lastReply);
  });

  it('leaves ordinary code blocks and other info strings alone', () => {
    const text = 'Here:\n```ts\nconst a = 1;\n```\n\nLinked session: X\n```text\nsession: abc\n```';
    expect(parseBriefs(text)).toEqual({ text, briefs: [] });
  });

  it('skips a stub inside another block (a text chip that holds one)', () => {
    const inner = writeStub('Hidden', ID);
    const text = `Terminal output:\n\`\`\`\`\n${inner}\n\`\`\`\``;
    expect(parseBriefs(text).briefs).toEqual([]);
  });

  it('reads Windows folders as they are', () => {
    const brief = full({ fields: { ...full().fields, folder: 'C:\\Users\\demo\\dev\\switchboard' } });
    expect(parseBriefs(writeBrief(brief)).briefs[0]!.fields.folder).toBe('C:\\Users\\demo\\dev\\switchboard');
  });

  it('drops the last reply first, then skipped and did, never where it works', () => {
    const long = full({ lastReply: 'x'.repeat(5_000) });
    const cut = parseBriefs(writeBrief(long)).briefs[0]!;
    expect(writeBrief(long).length).toBeLessThanOrEqual(BRIEF_BUDGET);
    expect(cut.lastReply!.length).toBeLessThanOrEqual(1_500);
    expect(cut.skipped).toEqual(long.skipped);

    const tight = parseBriefs(writeBrief(long, 700)).briefs[0]!;
    expect(tight.lastReply).toBeNull();
    expect(tight.shortened).toContain('last reply left out');
    expect(tight.fields.branch).toBe('worktree-usage-cost');
    expect(tight.fields['pull request']).toContain('#148');
  });

  it('writes and reads back an approved plan, with blank lines and a list in it', () => {
    const brief = full({ plan: '1. Add the setting.\n\n2. Hide the cost:\n   - on the bars\n   - on the cards' });
    expect(parseBriefs(writeBrief(brief)).briefs).toEqual([brief]);
  });

  it('never drops the plan to fit, and cuts it last', () => {
    const plan = `Plan:\n${'p'.repeat(2_500)}`;
    const tight = parseBriefs(writeBrief(full({ plan, lastReply: 'x'.repeat(5_000) }), 3_000)).briefs[0]!;
    expect(tight.plan).toBe(plan);
    expect(tight.lastReply).toBeNull();
    const huge = parseBriefs(writeBrief(full({ plan: 'q'.repeat(9_000) }))).briefs[0]!;
    expect(huge.plan!.length).toBeLessThan(9_000);
    expect(huge.plan!.length).toBeGreaterThanOrEqual(1_000);
    expect(huge.shortened).toContain('plan cut');
  });

  it('shares the message budget between briefs', () => {
    const texts = writeBriefs([full({ lastReply: 'x'.repeat(5_000) }), full({ lastReply: 'y'.repeat(5_000) }), full({ lastReply: 'z'.repeat(5_000) }), full({ lastReply: 'w'.repeat(5_000) })]);
    expect(texts.reduce((sum, t) => sum + t.length, 0)).toBeLessThanOrEqual(12_000);
  });

  it('replaces stubs in place', () => {
    const text = `a @One and @Two\n\n${writeStub('One', 'id-1')}\n\n${writeStub('Two', 'id-2')}`;
    const out = replaceBriefs(text, (b) => `[${b.label}:${b.sessionId}]`);
    expect(out).toBe('a @One and @Two\n\n[One:id-1]\n\n[Two:id-2]');
  });

  it('takes briefs out of what you typed, also one that was cut short', () => {
    const whole = `stack on @Usage cost toggle\n\n${writeBrief(full())}`;
    expect(withoutBriefs(whole)).toBe('stack on @Usage cost toggle');
    expect(withoutBriefs(whole.slice(0, 120))).toBe('stack on @Usage cost toggle');
    expect(withoutBriefs('no briefs here')).toBe('no briefs here');
  });

  it('defuses stubs so they never expand', () => {
    const text = `hi\n\n${writeStub('One', 'id-1')}`;
    const defused = defuseStubs(text);
    expect(parseBriefs(defused).briefs).toEqual([]);
    expect(defused).toContain('```text\nsession: id-1');
  });
});

describe('labels', () => {
  it('cuts a long title on a word', () => {
    const label = linkLabel('Add a setting to hide the estimated cost on the usage bars and the limits cards too');
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label.endsWith(' ')).toBe(false);
    expect(linkLabel('Two\nlines')).toBe('Two lines');
  });

  it('makes a label unique in the message', () => {
    expect(uniqueLabel('Fix', [])).toBe('Fix');
    expect(uniqueLabel('Fix', ['Fix'])).toBe('Fix (2)');
    expect(uniqueLabel('Fix', ['Fix', 'Fix (2)'])).toBe('Fix (3)');
  });
});
