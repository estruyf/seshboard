// A first cut of the Bash output compressor, to measure what it saves on real transcripts (15-estimate-savings.mjs).
// Lossy on purpose, but never drops a line that looks like an error, a warning or a failure, and always keeps the
// first and last lines. The engine version would live in packages/engine/src/compression/ with tests next to it.

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g;
const IMPORTANT = /\b(error|errors|err!|fail|failed|failure|failing|fatal|panic|exception|traceback|warn|warning|denied|not found|cannot|can't|unable|missing|expected|received|assert|✗|✘|×)\b|^\s*at\s|^\s*[-+]{3}\s|^\s*>\s*\d+\s*\|/i;
// A line's "family": the same line once numbers, hashes, paths' last parts and durations are taken out.
const family = (line) => line.replace(/\d+(\.\d+)?\s*(ms|s|kb|mb|%)?/gi, '#').replace(/\b[0-9a-f]{7,40}\b/g, 'H').replace(/[\w.-]+\.(tsx?|jsx?|mjs|json|md|css|rs|py|go)\b/g, 'F').trim();

const PRINTS_FILES = /^(cat|bat|nl|head|tail|sed|awk|less|more|jq|diff|git\s+(show|diff|blame|cat-file))\b/;
const SEARCHES = /^(grep|rg|ag|git\s+grep|find|fd)\b/;
/**
 * The commands of a shell line that produce its output: the first command of each pipeline, without `cd x &&`,
 * variable assignments and `env`. `cd a && npm test 2>&1 | tail -40` → npm (the tail only trims npm's output).
 */
export const segments = (command) => command.split(/&&|\|\||;|\n/).map((c) => c.split(/\|/)[0]).map((c) => c.trim().replace(/^(\w+=\S*\s+)+/, '').replace(/^(env|time|command)\s+/, '')).filter((c) => c && !/^(cd|export|set)\b/.test(c) && !/^\w+=/.test(c));

/**
 * How a Bash command's output may be compressed: 'verbatim' (file contents and diffs Claude may quote back into an
 * Edit: left alone), 'search' (matches Claude acts on: only capped when huge, never folded) or 'log' (everything).
 */
export function outputKind(command) {
  const parts = segments(command);
  if (parts.some((c) => PRINTS_FILES.test(c))) return 'verbatim';
  if (parts.some((c) => SEARCHES.test(c))) return 'search';
  return 'log';
}

/**
 * Compresses one Bash stdout. Returns the text to send, or null when it isn't worth it (short, or saves < minSave).
 * @param {string} text
 * @param {{ minChars?: number, minSave?: number, keepHead?: number, keepTail?: number, context?: number }} [opts]
 */
export function compressOutput(text, { kind = 'log', minChars = 2000, minSave = 0.3, keepHead = 15, keepTail = 25, context = 2 } = {}) {
  if (kind === 'verbatim' || text.length < minChars) return null;
  if (kind === 'search') return text.length > 20000 ? capSearch(text) : null;
  // 1. Terminal noise: colours, carriage-return progress bars (keep what the last \r wrote), trailing spaces.
  let lines = text.replace(ANSI, '').split('\n').map((l) => (l.includes('\r') ? l.slice(l.lastIndexOf('\r') + 1) : l).trimEnd());
  // 2. Runs of identical lines and of lines of one family (vitest ✓ rows, npm progress, "Compiling x" …).
  const folded = [];
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    const fam = family(lines[i]);
    while (j < lines.length && fam && family(lines[j]) === fam && !IMPORTANT.test(lines[j])) j++;
    const run = j - i;
    if (run >= 4 && !IMPORTANT.test(lines[i])) folded.push(lines[i], `  … ${run - 2} similar lines …`, lines[j - 1]);
    else folded.push(...lines.slice(i, j));
    i = j;
  }
  lines = folded.filter((l, k, a) => !(l === '' && a[k - 1] === ''));
  // 3. Still long: keep the head, the tail, and every important line with a little context around it.
  const budget = keepHead + keepTail + 120;
  if (lines.length > budget) {
    const keep = new Set();
    for (let k = 0; k < keepHead; k++) keep.add(k);
    for (let k = lines.length - keepTail; k < lines.length; k++) keep.add(k);
    lines.forEach((l, k) => { if (IMPORTANT.test(l)) for (let c = k - context; c <= k + context; c++) keep.add(c); });
    const out = [];
    let gap = 0;
    lines.forEach((l, k) => {
      if (keep.has(k)) { if (gap) out.push(`  … ${gap} lines omitted …`); gap = 0; out.push(l); } else gap++;
    });
    lines = out;
  }
  const result = lines.join('\n');
  return result.length <= text.length * (1 - minSave) ? result : null;
}

/** A huge search result: keep the first 150 matches and say how many more there are, so Claude can narrow it. */
function capSearch(text) {
  const lines = text.split('\n');
  if (lines.length <= 200) return null;
  return [...lines.slice(0, 150), `… ${lines.length - 150} more matches omitted; narrow the search to see them …`].join('\n');
}
