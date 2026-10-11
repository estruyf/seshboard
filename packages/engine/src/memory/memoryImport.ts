import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { RpcError } from '@switchboard/protocol';
import { memoryFilesOf, projectOf, type ParsedExport } from './claudeExport.ts';

/** Only these parts of an export are ever read; `conversations` (and everything else) is left in the zip. */
const WANTED = /^(?:memories\/[^/]+\.json|projects\/[^/]+\.json|memories\.json|projects\.json)$/;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Adds one JSON document of the export (by its name inside the export) to what was read. */
function take(out: ParsedExport, name: string, text: string): void {
  const json = parseJson(text);
  if (json === null) return;
  if (name.startsWith('projects')) {
    const list = Array.isArray(json) ? json : [json];
    const fileUuid = name.startsWith('projects/') ? basename(name, '.json') : null;
    for (const item of list) {
      const project = projectOf(item, list.length === 1 ? fileUuid : null);
      if (project) out.projects.set(project.uuid, project.name);
    }
    return;
  }
  out.files.push(...memoryFilesOf(json));
}

function readZip(out: ParsedExport, path: string): void {
  const files = unzipSync(readFileSync(path), { filter: (file) => WANTED.test(file.name) });
  for (const [name, data] of Object.entries(files)) take(out, name, new TextDecoder().decode(data));
}

const listDir = (dir: string) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** An unzipped export (or a folder holding the zips): `memories/*.json`, `projects/*.json`, and any memories/projects zips. */
function readFolder(out: ParsedExport, dir: string): void {
  for (const sub of ['memories', 'projects']) {
    for (const file of listDir(join(dir, sub))) if (file.endsWith('.json')) take(out, `${sub}/${file}`, readFileSync(join(dir, sub, file), 'utf8'));
  }
  for (const file of listDir(dir)) {
    if (file === 'memories.json' || file === 'projects.json') take(out, file, readFileSync(join(dir, file), 'utf8'));
    if (/^(memories|projects)(-\d+)?\.zip$/.test(file)) readZip(out, join(dir, file));
  }
}

/**
 * Reads what an import needs from the paths picked: `memories-000.zip` (and `projects-000.zip`), an unzipped folder,
 * `memories/<uuid>.json` itself, or the manifest JSON. For a manifest, the memories and projects zips it names are
 * looked for next to it: its links need your claude.ai login, so Switchboard asks you to download them (EXPORT_DOWNLOAD).
 */
export function readExport(paths: readonly string[]): ParsedExport {
  const out: ParsedExport = { files: [], projects: new Map() };
  for (const path of paths) {
    let isDir: boolean;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      throw new RpcError('NOT_FOUND', `${basename(path)} isn't there`);
    }
    if (isDir) {
      readFolder(out, path);
      continue;
    }
    if (path.toLowerCase().endsWith('.zip')) {
      try {
        readZip(out, path);
      } catch (error) {
        throw new RpcError('BAD_EXPORT', `${basename(path)} isn't a zip Switchboard can read: ${(error as Error).message}`);
      }
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const manifest = parseJson(text) as { data_files?: Array<{ category?: unknown; filename?: unknown }> } | null;
    if (manifest && Array.isArray(manifest.data_files)) {
      const wanted = manifest.data_files.filter((f) => f.category === 'memories' || f.category === 'projects').map((f) => String(f.filename ?? ''));
      const missing: string[] = [];
      for (const name of wanted) {
        const zip = join(dirname(path), basename(name));
        try {
          readZip(out, zip);
        } catch {
          missing.push(basename(name));
        }
      }
      if (missing.length && out.files.length === 0) {
        throw new RpcError('EXPORT_DOWNLOAD', `Download ${missing.join(' and ')} from the links in the export email (they need your claude.ai login), then pick ${missing.length > 1 ? 'them' : 'it'} here.`);
      }
      continue;
    }
    take(out, /projects?/i.test(basename(path)) && !/memor/i.test(basename(path)) ? `projects/${basename(path)}` : 'memories/file.json', text);
  }
  if (out.files.length === 0) throw new RpcError('EMPTY_EXPORT', 'No memories found in what you picked. Pick memories-000.zip from your Claude export.');
  return out;
}
