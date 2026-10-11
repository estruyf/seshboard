// The Windows build's own electron-builder settings (see `windowsBuildConfig`). Pure, so it can be checked against
// electron-builder's own config loading without building.

/**
 * Signing on Windows with Azure Trusted Signing, when the release workflow sets these (docs/building-and-signing.md).
 * The credentials aren't here: the TrustedSigning module electron-builder runs finds them itself (the release
 * workflow's Azure CLI login, or AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET locally). A certificate
 * file (WIN_CSC_LINK) needs nothing here either.
 */
const AZURE_SIGNING = {
  endpoint: 'AZURE_SIGNING_ENDPOINT',
  codeSigningAccountName: 'AZURE_SIGNING_ACCOUNT',
  certificateProfileName: 'AZURE_SIGNING_PROFILE',
  // Also written to the app's update feed settings: an update must be signed by the same publisher to install.
  publisherName: 'AZURE_SIGNING_PUBLISHER',
};

/**
 * The settings a Windows build adds, as a config that extends the one asked for (`--config`, or
 * electron-builder.yml), and the arguments left for electron-builder. Given as `-c.` options instead, electron-builder
 * would load electron-builder.yml on top of `--config electron-builder.preview.yml`, and its update feed would win
 * over the preview's `publish: null`; and it reads `-c.` values as numbers or booleans when they look like one. So
 * every `-c.key=value` passed in (the release workflow's `-c.publish.channel=nightly`) goes into the config too, as
 * written.
 *
 * - `extraMetadata.name`: the per-user installer names its folder after the package (%LOCALAPPDATA%\Programs\<name>),
 *   which would be "@switchboarddesktop". Only the installer sees this name: the data folder comes from productName.
 *   It isn't in electron-builder.yml because on macOS it would also move the updater's download cache.
 * - `win.azureSignOptions`: Azure Trusted Signing, when set up.
 *
 * Throws when only some of Azure Trusted Signing's settings are there.
 */
export function windowsBuildConfig(args, env) {
  let base = 'electron-builder.yml';
  const config = { extraMetadata: { name: 'switchboard' } };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const option = /^-c\.([\w.]+)=(.*)$/s.exec(arg);
    if (arg === '--config' || arg === '-c') base = args[++i];
    else if (arg.startsWith('--config=')) base = arg.slice('--config='.length);
    else if (option) setPath(config, option[1].split('.'), option[2]);
    else rest.push(arg);
  }
  const set = Object.entries(AZURE_SIGNING).filter(([, name]) => env[name]);
  if (set.length) {
    const missing = Object.values(AZURE_SIGNING).filter((name) => !env[name]);
    if (missing.length) throw new Error(`Azure Trusted Signing needs ${missing.join(', ')} too.`);
    setPath(config, ['win', 'azureSignOptions'], Object.fromEntries(set.map(([option, name]) => [option, env[name]])));
  }
  return { base, config, rest };
}

function setPath(target, keys, value) {
  let at = target;
  for (const key of keys.slice(0, -1)) at = at[key] ??= {};
  at[keys.at(-1)] = value;
}
