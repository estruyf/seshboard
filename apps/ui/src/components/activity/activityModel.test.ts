import { describe, expect, it } from 'vitest';
import { activityCsv, activityMarkdown, addDays, barHeight, countsByDay, dayOf, dayTitle, exportFileName, formatWorked, inProject, lastActiveDay, lastDayLabel, neighbourLine, projectGroups, projectShare, ribbonOf, rowKey, sessionsOnce, standupText, statsOf, stripDays, summaryExtras, summaryParts, summaryPlain, weekStart, type ActivityRow } from './activityModel.ts';

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  day: '2026-11-02',
  sessionId: 's1',
  title: 'A session',
  projectRoot: '/work/seshboard',
  projectName: 'seshboard',
  firstAt: new Date(2026, 10, 2, 9, 12).getTime(),
  lastAt: new Date(2026, 10, 2, 10, 0).getTime(),
  activeMs: 48 * 60_000,
  turns: 3,
  costUsd: 1.5,
  hours: new Array<number>(24).fill(0),
  commits: 0,
  files: 0,
  prs: [],
  did: [],
  asks: [],
  available: true,
  ...over,
});

describe('days', () => {
  it('steps over months and clock changes', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(dayOf(new Date(2026, 10, 2, 23, 59).getTime())).toBe('2026-11-02');
  });

  it('has a strip of eight days that ends on the last one', () => {
    const days = stripDays('2026-11-02');
    expect(days).toHaveLength(8);
    expect(days[0]).toBe('2026-10-26');
    expect(days[7]).toBe('2026-11-02');
  });

  it('has a week of seven days, so a page of the strip counts no day twice', () => {
    expect(weekStart('2026-11-05')).toBe('2026-10-30');
    expect(addDays(weekStart('2026-11-05'), -1)).toBe(addDays('2026-11-05', -7));
  });

  it('names a day', () => {
    expect(dayTitle('2026-11-02', 'en-GB')).toBe('Monday 2 November');
  });
});

describe('formatWorked', () => {
  it('reads as the design shows it', () => {
    expect(formatWorked(0)).toBe('–');
    expect(formatWorked(20_000)).toBe('<1m');
    expect(formatWorked(48 * 60_000)).toBe('48m');
    expect(formatWorked(125 * 60_000)).toBe('2h 05m');
    expect(formatWorked(13 * 3_600_000)).toBe('13h');
  });
});

describe('statsOf', () => {
  it('counts a session once over its days, and a pull request once', () => {
    const pr = { number: 253, url: 'https://x/pull/253' };
    const stats = statsOf([row({ commits: 2, prs: [pr] }), row({ day: '2026-11-03', commits: 1, prs: [pr], costUsd: null }), row({ sessionId: 's2', costUsd: 2 })]);
    expect(stats).toEqual({ sessions: 2, turns: 9, activeMs: 144 * 60_000, commits: 3, prs: 1, costUsd: 3.5 });
  });

  it('has no cost when none is known', () => {
    expect(statsOf([row({ costUsd: null })]).costUsd).toBeNull();
  });

  it('tells computers apart', () => {
    expect(statsOf([row(), row({ computer: { id: 'c', name: 'Studio' } })]).sessions).toBe(2);
    expect(rowKey(row())).not.toBe(rowKey(row({ computer: { id: 'c', name: 'Studio' } })));
  });
});

describe('the strip and the ribbon', () => {
  it('counts sessions per day', () => {
    expect(countsByDay([row(), row({ sessionId: 's2' }), row({ day: '2026-11-03' })])).toEqual(new Map([['2026-11-02', 2], ['2026-11-03', 1]]));
  });

  it('fills the bar for the busiest day and keeps a stub for an empty one', () => {
    expect(barHeight(11, 11)).toBe(44);
    expect(barHeight(1, 100)).toBe(4);
    expect(barHeight(0, 11)).toBe(3);
  });

  it('adds up the hours in levels', () => {
    const hours = new Array<number>(24).fill(0);
    hours[9] = 40;
    hours[10] = 10;
    const ribbon = ribbonOf([row({ hours }), row({ sessionId: 's2', hours: hours.map((h, i) => (i === 9 ? 40 : 0)) })]);
    expect(ribbon[9]).toEqual({ ms: 80, level: 4 });
    expect(ribbon[10]).toEqual({ ms: 10, level: 1 });
    expect(ribbon[0]).toEqual({ ms: 0, level: 0 });
    expect(ribbonOf([]).every((cell) => cell.level === 0)).toBe(true);
  });
});

describe('projects', () => {
  const other = (over: Partial<ActivityRow>) => row({ projectRoot: null, computer: { id: 'c', name: 'Studio' }, ...over });

  it('groups by project, the most time first, sessions by when they started', () => {
    const groups = projectGroups([
      row({ sessionId: 'late', firstAt: 20, activeMs: 10 }),
      row({ sessionId: 'early', firstAt: 10, activeMs: 10 }),
      row({ sessionId: 'big', projectRoot: '/work/other', projectName: 'other', activeMs: 100 }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['other', 'seshboard']);
    expect(groups[1]!.rows.map((r) => r.sessionId)).toEqual(['early', 'late']);
    expect(groups[1]).toMatchObject({ activeMs: 20, sessions: 2 });
  });

  it('joins the same project on another computer, and keeps one that is only there apart', () => {
    const groups = projectGroups([row(), other({ sessionId: 'there' }), other({ sessionId: 'far', projectName: 'far-away' })]);
    expect(groups.find((g) => g.name === 'seshboard')).toMatchObject({ root: '/work/seshboard', sessions: 2, computerId: null });
    expect(groups.find((g) => g.name === 'far-away')).toMatchObject({ root: null, computerId: 'c', key: 'name:far-away' });
  });

  it('filters to a project, with its rows from other computers', () => {
    const rows = [row(), other({ sessionId: 'there' }), row({ sessionId: 'x', projectRoot: '/work/other', projectName: 'other' })];
    expect(inProject(rows, '/work/seshboard').map((r) => r.sessionId)).toEqual(['s1', 'there']);
    expect(inProject(rows, null)).toHaveLength(3);
  });

  it('shares the bars by time, or by sessions when no time is known', () => {
    const groups = projectGroups([row({ activeMs: 75 }), row({ sessionId: 'x', projectRoot: '/o', projectName: 'o', activeMs: 25 })]);
    expect(projectShare(groups[0]!, groups)).toBe(0.75);
    const copilot = projectGroups([row({ activeMs: 0 }), row({ sessionId: 'x', projectRoot: '/o', projectName: 'o', activeMs: 0 })]);
    expect(projectShare(copilot[0]!, copilot)).toBe(0.5);
  });
});

describe('a project across the strip and a day', () => {
  it('keeps the key the whole strip gives it, on a day with only another computer\'s session', () => {
    const here = row();
    const there = row({ day: '2026-11-03', sessionId: 's2', projectRoot: null, computer: { id: 'c', name: 'Mini' } });
    expect(projectGroups([there])[0]!.key).toBe('name:seshboard');
    const [group] = projectGroups([there], [here, there]);
    expect(group!.key).toBe('/work/seshboard');
    expect(inProject([here, there], group!.key)).toHaveLength(2);
  });
});

describe('sessions over days', () => {
  it('shows a session once, on its first day, with its numbers added up', () => {
    const pr = { number: 1, url: 'a' };
    const first = row({ title: 'Old title', commits: 1, files: 2, prs: [pr], did: ['First'], asks: ['Ask one'], available: false, hours: Array.from({ length: 24 }, (_, h) => (h === 9 ? 60 : 0)) });
    const second = row({ day: '2026-11-03', title: 'New title', firstAt: new Date(2026, 10, 3, 8).getTime(), lastAt: new Date(2026, 10, 3, 9).getTime(), commits: 2, files: 1, costUsd: null, prs: [pr, { number: 2, url: 'b' }], did: ['Second'], asks: [], hours: Array.from({ length: 24 }, (_, h) => (h === 9 ? 30 : 0)) });
    const [once, ...rest] = sessionsOnce([second, first]);
    expect(rest).toEqual([]);
    expect(once).toMatchObject({ day: '2026-11-02', title: 'New title', firstAt: first.firstAt, lastAt: second.lastAt, activeMs: 96 * 60_000, turns: 6, costUsd: 1.5, commits: 3, files: 3, did: ['First', 'Second'], asks: ['Ask one'], available: true });
    expect(once!.prs.map((p) => p.number)).toEqual([1, 2]);
    expect(once!.hours[9]).toBe(90);
  });

  it('keeps sessions apart per computer, and a cost nobody knows unknown', () => {
    const rows = sessionsOnce([row({ costUsd: null }), row({ costUsd: null, day: '2026-11-03' }), row({ computer: { id: 'c', name: 'Mini' } })]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.costUsd).toBeNull();
  });
});

describe('an empty day', () => {
  const counts = new Map([['2026-10-31', 1], ['2026-11-02', 8]]);

  it('says what the days around it had', () => {
    expect(neighbourLine('2026-11-01', '2026-11-05', counts, 'en-GB')).toBe('← Saturday had 1 · Monday had 8 →');
  });

  it('has no day after today', () => {
    expect(neighbourLine('2026-11-02', '2026-11-02', new Map(), 'en-GB')).toBe('← Sunday had 0');
  });
});

describe('the last day with sessions', () => {
  it('is yesterday, or further back after a weekend', () => {
    expect(lastActiveDay('2026-11-03', new Map([['2026-11-02', 1]]))).toBe('2026-11-02');
    expect(lastActiveDay('2026-11-02', new Map([['2026-10-30', 4]]))).toBe('2026-10-30');
    expect(lastActiveDay('2026-11-02', new Map([['2026-11-02', 4]]))).toBeNull();
  });

  it('is called yesterday only when it is', () => {
    expect(lastDayLabel('2026-11-02', '2026-11-03', 'en-GB')).toBe('Yesterday');
    expect(lastDayLabel('2026-10-30', '2026-11-02', 'en-GB')).toBe('Friday');
  });
});

describe('the day in short', () => {
  it('splits out the bold project names', () => {
    expect(summaryParts('Mostly **Seshboard**: done. In **worklog**: fixed.')).toEqual([
      { text: 'Mostly ', bold: false },
      { text: 'Seshboard', bold: true },
      { text: ': done. In ', bold: false },
      { text: 'worklog', bold: true },
      { text: ': fixed.', bold: false },
    ]);
    expect(summaryParts('A stray ** stays plain')).toEqual([{ text: 'A stray ', bold: false }, { text: ' stays plain', bold: false }]);
    expect(summaryPlain('Mostly **x**.')).toBe('Mostly x.');
  });

  it('sends only other computers\' sessions along', () => {
    expect(summaryExtras([row(), row({ title: 'There', computer: { id: 'c', name: 'Studio' }, did: ['Did it'] })])).toEqual([{ title: 'There', projectName: 'seshboard', activeMs: 48 * 60_000, did: ['Did it'], asks: [] }]);
  });
});

describe('Copy for standup', () => {
  const rows = [
    row({ title: 'Composer tray', prs: [{ number: 253, url: 'https://x/pull/253' }], activeMs: 100 }),
    row({ sessionId: 's2', title: 'Copilot: fork', firstAt: 1 }),
    row({ sessionId: 's3', title: 'Worker limit', projectRoot: '/work/worklog', projectName: 'worklog-web', activeMs: 1 }),
  ];

  it('writes Markdown, one line per session, grouped by project', () => {
    expect(standupText(rows, 'markdown')).toBe('**seshboard**\n- Copilot: fork\n- Composer tray (PR #253)\n**worklog-web**\n- Worker limit');
  });

  it('writes plain text without the marks', () => {
    expect(standupText(rows, 'plain')).toBe('seshboard\n- Copilot: fork\n- Composer tray (PR #253)\nworklog-web\n- Worker limit');
  });

  it('lists a session of several days once, with all its pull requests', () => {
    const week = [row({ prs: [{ number: 1, url: 'a' }], title: 'Old title' }), row({ day: '2026-11-03', firstAt: new Date(2026, 10, 3).getTime(), prs: [{ number: 2, url: 'b' }], title: 'New title' })];
    expect(standupText(week, 'plain')).toBe('seshboard\n- New title (PR #1, #2)');
  });
});

describe('Export', () => {
  it('writes CSV a spreadsheet reads safely', () => {
    const csv = activityCsv([row({ title: '=HYPERLINK("x"), danger', commits: 2, files: 5, prs: [{ number: 7, url: 'u' }] })]);
    const [head, line] = csv.trim().split('\n');
    expect(head).toBe('Date,Project,Session,Computer,Start,End,Minutes,Turns,Commits,Files,Pull requests,Cost (USD)');
    expect(line).toBe(`2026-11-02,seshboard,"'=HYPERLINK(""x""), danger",,09:12,10:00,48,3,2,5,#7,1.50`);
  });

  it('writes Markdown by day and project, with what it did', () => {
    const markdown = activityMarkdown([row({ did: ['Fixed the bug'] }), row({ sessionId: 's2', title: 'No catch-up', asks: ['What was asked'] })], 'en-GB');
    expect(markdown).toContain('## Monday 2 November');
    expect(markdown).toContain('2 sessions, 1h 36m, 0 commits');
    expect(markdown).toContain('### seshboard');
    expect(markdown).toContain('- A session (09:12, 48m)\n  - Fixed the bug');
    expect(markdown).toContain('  - What was asked');
  });

  it('names the file after its days', () => {
    expect(exportFileName('2026-11-02', '2026-11-02', 'md')).toBe('activity-2026-11-02.md');
    expect(exportFileName('2026-10-26', '2026-11-02', 'csv')).toBe('activity-2026-10-26-to-2026-11-02.csv');
  });
});
