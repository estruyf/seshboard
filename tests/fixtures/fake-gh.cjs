/**
 * The smoke test's and the website screenshots' gh: it never reaches GitHub. `auth status` says signed in (unless
 * FAKE_GH_SIGNED_OUT names a file that exists); issues and pull requests of the made-up repositories in
 * FAKE_GH_REPOS (comma-separated `owner/name`; by default `smoke-owner/smoke-repo` and `smoke-owner/other-repo`) come from the fixed lists below;
 * everything else is refused, so other lists stay empty as without gh.
 */
const { existsSync } = require('node:fs');
const argv = process.argv.slice(2);
const fail = (text, code = 1) => {
  process.stderr.write(`${text}\n`);
  process.exit(code);
};
if (process.env.FAKE_GH_SIGNED_OUT && existsSync(process.env.FAKE_GH_SIGNED_OUT)) fail('You are not logged into any GitHub hosts. To log in, run: gh auth login', 4);
if (argv[0] === 'auth' && argv[1] === 'status') process.exit(0);
const repos = (process.env.FAKE_GH_REPOS || 'smoke-owner/smoke-repo,smoke-owner/other-repo').split(',').map((r) => r.trim().toLowerCase());
const flag = (name) => {
  const i = argv.indexOf(name);
  return i < 0 ? null : argv[i + 1];
};
// Event triggers' calls, while the triggers step has written its repository (FAKE_GH_TRIGGERS): they run in the
// project's folder without --repo, and the trigger fake answers them from that file (fake-gh-triggers.cjs).
if (process.env.FAKE_GH_TRIGGERS && existsSync(process.env.FAKE_GH_TRIGGERS) && !argv.includes('--repo')) {
  const [a, b, c] = argv;
  const named = (argv.find((x) => x.startsWith('name=')) || '').slice(5).toLowerCase();
  const triggers =
    (a === 'repo' && b === 'view') ||
    (a === 'api' && (b === 'user' || /collaborators/.test(b || ''))) ||
    (a === 'api' && b === 'graphql' && /i\d+: issue/.test(argv.join(' ')) && !repos.some((r) => r.endsWith(`/${named}`))) ||
    (a === 'issue' && (b === 'list' || b === 'edit' || (b === 'view' && /^\d+$/.test(c || '')))) ||
    a === 'label' ||
    a === 'run' ||
    (a === 'workflow' && b === 'list');
  if (triggers) {
    require('./fake-gh-triggers.cjs');
    return;
  }
}
const fromUrl = /github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/.exec(argv[2] || '');
const repo = (flag('--repo') || (fromUrl && fromUrl[1]) || '').toLowerCase();
const graphqlRepo = argv[0] === 'api' ? `${(argv.find((a) => a.startsWith('owner=')) || '').slice(6)}/${(argv.find((a) => a.startsWith('name=')) || '').slice(5)}`.toLowerCase() : '';
if (!repos.includes(repo) && !repos.includes(graphqlRepo)) fail("the smoke test's gh never reaches GitHub");
const owner = (repo || graphqlRepo).split('/')[0];
const DAY = 86_400_000;
const at = (days) => new Date(Date.now() - days * DAY).toISOString();
const url = (kind, n) => `https://github.com/${repo || graphqlRepo}/${kind}/${n}`;
/** Each made-up repository's issues and pull requests: the smoke test's, and the demo world's acme-store for the website. */
const acme = (repo || graphqlRepo).endsWith('/acme-store');
const issues = acme
  ? [
      { number: 57, title: 'Checkout button stays disabled after a failed payment', state: 'OPEN', labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'checkout', color: 'fbca04' }], author: { login: 'mara-k' }, createdAt: at(2), updatedAt: at(1), url: url('issues', 57), body: 'After a declined card, the Pay button stays greyed out until the page is reloaded.\n\nSteps: add an item, pay with 4000 0000 0000 0002, then try another card.', comments: [{}, {}, {}] },
      { number: 52, title: 'Send order emails in dark mode when the customer uses it', state: 'OPEN', labels: [{ name: 'enhancement', color: 'a2eeef' }], author: { login: 'jules-d' }, createdAt: at(6), updatedAt: at(4), url: url('issues', 52), body: 'The emails ignore the theme the customer picked.', comments: [{}] },
    ]
  : [
      { number: 32, title: 'Start a session from a GitHub issue or pull request', state: 'OPEN', labels: [{ name: 'enhancement', color: 'a2eeef' }], author: { login: owner }, createdAt: at(3), updatedAt: at(3), url: url('issues', 32), body: 'Type # in the message box to attach an issue.\n\nStart a session from it with the worktree filled in.', comments: [{}, {}, {}, {}] },
      { number: 118, title: 'Session list loses scroll position after archive', state: 'OPEN', labels: [{ name: 'bug', color: 'd73a4a' }], author: { login: 'a-contributor' }, createdAt: at(7), updatedAt: at(7), url: url('issues', 118), body: 'Archive a session near the bottom of the list: it jumps to the top.', comments: [] },
    ];
const closed = [{ number: 97, title: 'Old crash on wake', state: 'CLOSED', labels: [], author: { login: owner }, createdAt: at(40), updatedAt: at(30), url: url('issues', 97), body: 'Fixed in 0.0.12.', comments: [] }];
const pr = (number, title, branch, extra) => ({ number, title, state: 'OPEN', labels: [], author: { login: owner }, createdAt: at(1), updatedAt: at(1), url: url('pull', number), headRefName: branch, isDraft: false, isCrossRepository: false, headRepositoryOwner: { login: owner }, body: '', comments: [], baseRefName: 'main', headRefOid: '1111111111111111111111111111111111111111', maintainerCanModify: false, ...extra });
const prs = acme
  ? [
      pr(61, 'Keep the Pay button active after a declined card', 'fix/pay-after-decline', { labels: [{ name: 'bug', color: 'd73a4a' }], updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), body: 'Fixes #57.' }),
      pr(59, 'Fix typo in the README', 'patch-1', { author: { login: 'someone' }, isCrossRepository: true, headRepositoryOwner: { login: 'someone' }, headRefOid: '2222222222222222222222222222222222222222', body: 'One typo.' }),
    ]
  : [
      pr(151, 'Start sessions from issues', 'feat/issue-start', { labels: [{ name: 'enhancement', color: 'a2eeef' }], updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), body: 'Adds the # list and New session from an issue.' }),
      pr(149, 'Fix typo in deep-links docs', 'patch-1', { author: { login: 'someone' }, isCrossRepository: true, headRepositoryOwner: { login: 'someone' }, headRefOid: '2222222222222222222222222222222222222222', body: 'One typo.' }),
    ];
const thread = (isResolved, path, line, body) => ({ isResolved, path, line, originalLine: line, comments: { nodes: [{ author: { login: 'reviewer' }, body }] } });
const threads = {
  151: [thread(false, 'apps/ui/src/composer/hash.ts', 42, 'Debounce this.'), thread(false, 'README.md', 12, 'Say it shorter.'), thread(true, 'README.md', 3, 'Done.')],
  61: [thread(false, 'src/pages/Checkout.tsx', 88, 'Reset the error too, not only the button.'), thread(false, 'src/pages/Checkout.test.tsx', 14, 'Add the declined card case.')],
};
const pick = (item) => Object.fromEntries((flag('--json') || '').split(',').map((k) => [k, item[k]]));
const matches = (item) => {
  const q = flag('--search');
  return !q || q === 'sort:updated-desc' || q.toLowerCase().split(/\s+/).every((w) => item.title.toLowerCase().includes(w));
};
if (argv[1] === 'list') process.stdout.write(JSON.stringify((argv[0] === 'pr' ? prs : issues).filter(matches).map(pick)));
else if (argv[1] === 'view') {
  const n = Number(String(argv[2]).split('/').pop());
  const item = (argv[0] === 'pr' ? prs : [...issues, ...closed]).find((i) => i.number === n);
  if (!item) fail(`GraphQL: Could not resolve to an issue or pull request with the number of ${n}.`);
  process.stdout.write(JSON.stringify(pick(item)));
} else if (argv[0] === 'api' && argv[1] === 'graphql') {
  const query = argv[argv.indexOf('-f') + 1] || '';
  if (query.includes('viewer')) {
    const n = Number((argv.find((a) => a.startsWith('number=')) || '').slice(7));
    process.stdout.write(JSON.stringify({ data: { viewer: { login: owner }, repository: { viewerPermission: 'ADMIN', pullRequest: { reviewThreads: { nodes: threads[n] || [] } } } } }));
  } else {
    const repository = {};
    for (const m of query.matchAll(/p(\d+):/g)) repository[`p${m[1]}`] = { reviewThreads: { nodes: (threads[m[1]] || []).map((t) => ({ isResolved: t.isResolved })) } };
    process.stdout.write(JSON.stringify({ data: { repository } }));
  }
} else fail("the smoke test's gh never reaches GitHub");
