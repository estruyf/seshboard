/**
 * A gh for event triggers (#180), for the engine's tests and the smoke test: it never reaches GitHub. Its repository
 * lives in the JSON file FAKE_GH_TRIGGERS names, which the test writes and this changes (an issue edit adds and takes
 * off labels, a new label is made), so the next check sees what the last one did. Every call is appended to
 * `<file>.calls` as a JSON line, for the test to look at.
 *
 * The file: { repo, login, defaultBranch, fail: null | 'signed-out' | 'rate-limit' | 'not-found' | 'offline',
 *   issues: [{ number, title, body, labels: [name], assignees: [login], author, association, updatedAt, comments: [{ author, body }] }],
 *   runs: [{ databaseId, number, workflowName, headSha, headBranch, createdAt, displayTitle }], logs: { [runId]: text },
 *   labels: [name], collaborators, workflows: [name] }
 */
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');

const file = process.env.FAKE_GH_TRIGGERS;
const argv = process.argv.slice(2);
const fail = (text, code = 1) => {
  process.stderr.write(`${text}\n`);
  process.exit(code);
};
if (!file) fail('FAKE_GH_TRIGGERS is not set');
appendFileSync(`${file}.calls`, `${JSON.stringify(argv)}\n`);
const state = JSON.parse(readFileSync(file, 'utf8'));
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
const flag = (name) => {
  const i = argv.indexOf(name);
  return i < 0 ? null : argv[i + 1];
};
const flags = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const out = (value) => process.stdout.write(typeof value === 'string' ? `${value}\n` : JSON.stringify(value));
const repo = state.repo || 'smoke-owner/trigger-repo';

if (state.fail === 'signed-out') fail('To get started with GitHub CLI, please run:  gh auth login', 4);
if (state.fail === 'rate-limit') fail('GraphQL: API rate limit exceeded for user ID 1.');
if (state.fail === 'not-found') fail("GraphQL: Could not resolve to a Repository with the name 'nope'.");
if (state.fail === 'offline') fail('error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com');

const issueUrl = (n) => `https://github.com/${repo}/issues/${n}`;
const issueJson = (issue) => ({
  number: issue.number,
  title: issue.title,
  url: issueUrl(issue.number),
  labels: (issue.labels || []).map((name) => ({ name, color: 'ededed' })),
  assignees: (issue.assignees || []).map((login) => ({ login })),
  author: { login: issue.author || state.login },
  body: issue.body || '',
  updatedAt: issue.updatedAt || new Date().toISOString(),
  comments: (issue.comments || []).map((c) => ({ author: { login: c.author }, body: c.body })),
  state: issue.closed ? 'CLOSED' : 'OPEN',
});
const pick = (item) => Object.fromEntries((flag('--json') || '').split(',').map((k) => [k, item[k]]));
const findIssue = (n) => (state.issues || []).find((i) => i.number === Number(n)) || fail(`GraphQL: Could not resolve to an issue or pull request with the number of ${n}.`);

const [a, b] = argv;
if (a === 'repo' && b === 'view') out({ nameWithOwner: repo, defaultBranchRef: { name: state.defaultBranch || 'main' } });
else if (a === 'api' && b === 'user') out(state.login || 'estruyf');
else if (a === 'api' && /collaborators/.test(b || '')) out(String(state.collaborators ?? 1));
else if (a === 'api' && b === 'graphql') {
  const query = argv[argv.indexOf('-f') + 1] || '';
  const repository = {};
  for (const m of query.matchAll(/i(\d+): issue/g)) {
    const issue = (state.issues || []).find((i) => i.number === Number(m[1]));
    repository[`i${m[1]}`] = issue ? { authorAssociation: issue.association || 'OWNER' } : null;
  }
  out({ data: { repository } });
} else if (a === 'issue' && b === 'list') {
  const label = flag('--label');
  const assignee = flag('--assignee');
  const me = state.login || 'estruyf';
  const list = (state.issues || []).filter((i) => !i.closed && (!label || (i.labels || []).includes(label)) && (!assignee || (i.assignees || []).includes(assignee === '@me' ? me : assignee)));
  out(list.slice(0, Number(flag('--limit') || 30)).map(issueJson).map(pick));
} else if (a === 'issue' && b === 'view') out(pick(issueJson(findIssue(argv[2]))));
else if (a === 'issue' && b === 'edit') {
  const issue = findIssue(argv[2]);
  issue.labels = issue.labels || [];
  for (const name of flags('--add-label')) {
    if (!(state.labels || []).includes(name)) fail(`could not add label: '${name}' not found`);
    if (!issue.labels.includes(name)) issue.labels.push(name);
  }
  for (const name of flags('--remove-label')) issue.labels = issue.labels.filter((l) => l !== name);
  for (const login of flags('--add-assignee')) {
    issue.assignees = issue.assignees || [];
    const who = login === '@me' ? state.login || 'estruyf' : login;
    if (!issue.assignees.includes(who)) issue.assignees.push(who);
  }
  save();
  out(issueUrl(issue.number));
} else if (a === 'label' && b === 'list') out((state.labels || []).map((name) => ({ name })));
else if (a === 'label' && b === 'create') {
  state.labels = state.labels || [];
  if (state.labels.includes(argv[2])) fail(`label with name "${argv[2]}" already exists; use \`--force\` to update its color and description`);
  state.labels.push(argv[2]);
  save();
} else if (a === 'run' && b === 'list') {
  const branch = flag('--branch');
  const runs = (state.runs || []).filter((r) => !branch || (r.headBranch || 'main') === branch);
  out(runs.map((r) => ({ headBranch: 'main', url: `https://github.com/${repo}/actions/runs/${r.databaseId}`, ...r })).map(pick));
} else if (a === 'run' && b === 'view') {
  const log = (state.logs || {})[argv[2]];
  if (log === undefined) fail(`run ${argv[2]} not found`);
  out(log);
} else if (a === 'workflow' && b === 'list') out((state.workflows || []).map((name) => ({ name })));
else fail(`the triggers' fake gh doesn't know: gh ${argv.join(' ')}`);
