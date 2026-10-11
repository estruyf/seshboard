/**
 * Text that looks like a credential: API keys and tokens by their known prefixes, private keys, and `password = …`
 * style assignments. Used before memory leaves the machine-local folder (sharing with the team, importing). It is a
 * net for mistakes, not a scanner: a hit asks the user to look, it never blocks for good.
 */
const PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'an Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: 'an OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { label: 'a GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { label: 'an AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'a Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { label: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'a Stripe key', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/ },
  { label: 'an npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { label: 'a private key', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { label: 'a JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { label: 'a password or token', pattern: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']?(?![<{$])[^\s"'`]{6,}/i },
  { label: 'credentials in a URL', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@/i },
];

/** What in `text` looks like a secret, one label per kind found (empty when nothing does). */
export function findSecrets(text: string): string[] {
  return PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}
