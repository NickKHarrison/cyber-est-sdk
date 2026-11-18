/**
 * `est doctor` in a plugin folder (1.803): what is wrong with **this folder**, each a line with
 * the exact command or edit that fixes it, and one `Next:` line at the end.
 *
 * Every check here is a **hint computed without building**: it reads est.json, the source's
 * declarations where a plain pattern can find them, the golden spec, the build's settings and what
 * the last `est validate` left in `dist/`. None of them is a validator rule, replaces one or
 * changes an id: the validator is the install code, and `est validate` is still what decides.
 * Where a declaration cannot be read cheaply (parameters made in a loop, an id built from parts)
 * the check is skipped rather than guessed.
 *
 * Pure but for reading the folder: the machine's probes come in (`doctor.ts`), so the tests give
 * their own.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { DROP_WORDS, NEXT_PREFIX, fewWords, readProject, type EstProject, type ProjectKind } from '../../tools/src/index';

export type FolderStatus = 'ok' | 'fix' | 'note';

export interface FolderCheck {
  /** A stable name for the check (`--json`). */
  id: string;
  status: FolderStatus;
  /** What was found, in plain words. */
  text: string;
  /** `fix`: the exact command to run or the edit to make. */
  fix?: string;
  /** `fix`: whether it is a command to run as it is (else an edit to make by hand). */
  command?: boolean;
  /** `fix`: the folder cannot build until this is fixed (the exit code). */
  blocks?: boolean;
}

/** One of the machine's probes (`doctor.ts`'s), as much of it as the folder's checks read. */
export interface MachineProbe { name: string; ok: boolean; fix: string | null; for: 'all' | 'rust' | 'as' | 'cpp' | 'dev' }

export interface FolderInput {
  dir: string;
  probes: readonly MachineProbe[];
  /** This kit's version (the install command names it). */
  version: string;
  /** Running from Cyber's clone: the kit is the repository, so nothing is installed in the folder. */
  clone: boolean;
}

export interface FolderReport {
  dir: string;
  kind: ProjectKind | null;
  checks: FolderCheck[];
  /** False when a check that `blocks` needs fixing first. */
  canBuild: boolean;
  /** The one line to end with. */
  next: string;
}

/** Whether `dir` looks like a plugin folder (so `est doctor` with no argument checks it). */
export function isPluginFolder(dir: string): boolean {
  if (['est.json', 'est-build.json', 'asconfig.json', join('test', 'golden.json')].some(f => existsSync(join(dir, f)))) return true;
  const cargo = join(dir, 'Cargo.toml');
  if (!existsSync(cargo)) return false;
  try { return /^\s*est\s*=|\[package\.metadata\.est\]/m.test(readFileSync(cargo, 'utf8')); } catch { return false; }
}

const LANGUAGE: Record<ProjectKind, string> = { as: 'AssemblyScript', rust: 'Rust', cpp: 'C or C++', prebuilt: 'a module built elsewhere' };

/** A JSON file: its value, or why it could not be read (with the line, where the parser gives a place). */
function readJson(file: string): { value: unknown; error: null } | { value: null; error: string } {
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return { value: null, error: 'it cannot be read' }; }
  try { return { value: JSON.parse(text) as unknown, error: null }; } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const at = /position (\d+)/.exec(message);
    const line = at ? text.slice(0, Number(at[1])).split('\n').length : null;
    return { value: null, error: `${message.replace(/\s+/g, ' ')}${line && !/line \d+/.test(message) ? ` (line ${line})` : ''}` };
  }
}

/** The source files a plain pattern may read: the folder's own, never the vendored library (`est/`) or build output. */
function sources(dir: string, sub: string, ext: RegExp, cap = 200): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let names: string[];
    try { names = readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      if (out.length >= cap) return;
      const p = join(d, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (!['est', 'dsp', 'node_modules', 'target', 'build', 'dist', '.git'].includes(n)) walk(p); } else if (ext.test(n)) out.push(p);
    }
  };
  walk(join(dir, sub));
  return out;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;
const rel = (dir: string, p: string) => relative(dir, p).split(sep).join('/');
/** Source with its comments blanked (same length, so an index still names its line). */
const blankComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '));

export interface CodeId { id: string; file: string; line: number }

/** The plugin id the code declares, where a plain pattern finds exactly one: AssemblyScript's `new Descriptor("…"`, Rust's `export_…!(…, id: "…"`. */
export function codeId(dir: string, kind: ProjectKind): CodeId | null {
  const found: CodeId[] = [];
  const files = kind === 'as' ? sources(dir, 'assembly', /\.ts$/) : kind === 'rust' ? sources(dir, 'src', /\.rs$/) : [];
  const re = kind === 'as' ? /new\s+Descriptor\s*\(\s*"([^"\\]+)"/g : /export_(?:effect|instrument|note_effect)!\s*\([^;]*?\bid:\s*"([^"\\]+)"/g;
  for (const f of files) {
    let text: string;
    try { text = blankComments(readFileSync(f, 'utf8')); } catch { continue; }
    for (const m of text.matchAll(re)) found.push({ id: m[1]!, file: rel(dir, f), line: lineOf(text, m.index + m[0].length - 1) });
  }
  return found.length === 1 ? found[0]! : null;
}

/**
 * The parameter ids the code declares, or null when any of them is not a number or a constant
 * declared with a number in the same folder (then nothing is compared: a guess would be worse).
 */
export function codeParamIds(dir: string, kind: ProjectKind): number[] | null {
  const files = kind === 'as' ? sources(dir, 'assembly', /\.ts$/) : kind === 'rust' ? sources(dir, 'src', /\.rs$/) : [];
  if (!files.length) return null;
  const decl = kind === 'as' ? /new\s+Param\s*\(\s*([^,()]+?)\s*,/g : /Param::new\s*\(\s*([^,()]+?)\s*,/g;
  const constant = kind === 'as' ? /\bconst\s+([A-Za-z_]\w*)\s*(?::\s*\w+)?\s*=\s*(\d+)\s*;/g : /\bconst\s+([A-Za-z_]\w*)\s*:\s*\w+\s*=\s*(\d+)\s*;/g;
  const consts = new Map<string, number>();
  const args: string[] = [];
  for (const f of files) {
    let text: string;
    try { text = blankComments(readFileSync(f, 'utf8')); } catch { return null; }
    for (const m of text.matchAll(constant)) consts.set(m[1]!, Number(m[2]));
    for (const m of text.matchAll(decl)) args.push(m[1]!);
  }
  if (!args.length) return null;
  const ids: number[] = [];
  for (const a of args) {
    const n = /^\d+$/.test(a) ? Number(a) : consts.get(a);
    if (n === undefined) return null;
    ids.push(n);
  }
  return ids;
}

/** The newest file time under the folder's own sources (est.json, the code, the UI, the presets, the golden spec). */
function newestSource(dir: string): number {
  let newest = 0;
  const see = (p: string) => { try { const t = statSync(p).mtimeMs; if (t > newest) newest = t; } catch { /* not there */ } };
  for (const f of ['est.json', 'asconfig.json', 'Cargo.toml', 'est-build.json']) see(join(dir, f));
  for (const sub of ['assembly', 'src', 'ui', 'presets']) for (const f of sources(dir, sub, /./)) see(f);
  return newest;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (ids: readonly number[]) => ids.join(', ');

/** The folder's checks, in the order they matter: what stops a build first. */
export function folderChecks(input: FolderInput): FolderReport {
  const { dir, probes } = input;
  const checks: FolderCheck[] = [];
  const ok = (id: string, text: string) => checks.push({ id, status: 'ok', text });
  const note = (id: string, text: string) => checks.push({ id, status: 'note', text });
  const fix = (id: string, text: string, how: string, o: { command?: boolean; blocks?: boolean } = {}) => checks.push({ id, status: 'fix', text, fix: how, ...(o.command ? { command: true } : {}), ...(o.blocks ? { blocks: true } : {}) });

  // 1. est.json: there, and JSON.
  let manifest: Record<string, unknown> | null = null;
  const manifestFile = join(dir, 'est.json');
  if (!existsSync(manifestFile)) {
    fix('manifest', 'est.json is missing: this is not a plugin folder yet', `npx @cyber-est/cli@${input.version} new effect-as my-plugin   (makes a new plugin folder, my-plugin)`, { command: true, blocks: true });
  } else {
    const r = readJson(manifestFile);
    if (r.error !== null) fix('manifest', `est.json is not valid JSON: ${r.error}`, 'edit est.json there (a missing comma or quote is the usual cause)', { blocks: true });
    else if (!r.value || typeof r.value !== 'object' || Array.isArray(r.value)) fix('manifest', 'est.json is not an object', 'edit est.json: it holds one { … } with "id", "version", "name" and the rest', { blocks: true });
    else {
      manifest = r.value as Record<string, unknown>;
      if (typeof manifest.id !== 'string' || !manifest.id) fix('manifest', 'est.json has no "id"', 'edit est.json: add "id": "com.example.my-plugin" (a reverse-DNS name)');
      else ok('manifest', `est.json: ${manifest.id} ${typeof manifest.version === 'string' ? manifest.version : ''} (${typeof manifest.kind === 'string' ? manifest.kind : 'no kind'})`.replace(/\s+/g, ' '));
    }
  }

  // 2. The build this folder uses, and only its toolchain.
  let project: EstProject | null = null;
  try { project = readProject(dir); } catch (err) {
    fix('build-settings', `the build's settings cannot be read (${err instanceof Error ? err.message.replace(/\s+/g, ' ') : String(err)})`, 'edit asconfig.json, Cargo.toml or est-build.json: it is not valid', { blocks: true });
  }
  const kind = project?.kind ?? null;
  if (project && kind) {
    const mine = probes.filter(p => p.for === kind);
    const everyone = probes.filter(p => p.for === 'all');
    for (const p of [...everyone, ...mine]) {
      if (p.ok) continue;
      fix('toolchain', `${p.name} is missing, and this ${LANGUAGE[kind]} folder needs it`, (p.fix ?? 'npx est doctor').split('\n')[0]!.trim(), { command: true, blocks: true });
    }
    if (kind === 'prebuilt') {
      if (manifest && !existsSync(project.wasm)) fix('toolchain', `no build is set up here (no asconfig.json, Cargo.toml or est-build.json) and the module est.json names, ${rel(dir, project.wasm)}, is not there`, `put the built module at ${rel(dir, project.wasm)}, or start from a template: npx @cyber-est/cli@${input.version} new effect-as my-plugin`, { blocks: true });
      else if (manifest) ok('toolchain', `a module built elsewhere (${rel(dir, project.wasm)}): nothing to build here`);
    } else if (![...everyone, ...mine].some(p => !p.ok)) ok('toolchain', `${LANGUAGE[kind]}: its build tools are here`);
    const others = (['as', 'rust', 'cpp'] as const).filter(k => k !== kind).map(k => `${LANGUAGE[k]} ${probes.filter(p => p.for === k).every(p => p.ok) ? 'ready' : 'not set up'}`);
    note('other-toolchains', `not needed by this folder: ${others.join('; ')}`);
  }

  // 3. The kit, installed in the folder (so `npx est` is this version, here and for anyone else).
  if (input.clone) note('kit', "running from Cyber's clone: the kit is the repository, nothing to install in the folder");
  else {
    let at: string | null = null;
    for (let d = dir; ; d = dirname(d)) {
      const p = join(d, 'node_modules', '@cyber-est', 'cli', 'package.json');
      if (existsSync(p)) { at = p; break; }
      if (dirname(d) === d) break;
    }
    const installed = at ? (readJson(at).value as { version?: unknown } | null)?.version : null;
    if (!at) fix('kit', "the kit is not installed in this folder (a bare npx est here would fetch npm's unrelated package called est)", `npm install --save-dev --save-exact @cyber-est/cli@${input.version}`, { command: true });
    else if (typeof installed === 'string' && installed !== input.version) note('kit', `the folder has @cyber-est/cli ${installed}; this is ${input.version} (npx est runs the folder's)`);
    else ok('kit', `@cyber-est/cli ${input.version} is installed in the folder`);
  }

  // 4. The id the code declares against est.json's.
  const manifestId = typeof manifest?.id === 'string' ? manifest.id : null;
  if (kind && manifestId && (kind === 'as' || kind === 'rust')) {
    const c = codeId(dir, kind);
    if (c && c.id !== manifestId) fix('id', `the code says the id is "${c.id}" (${c.file}:${c.line}) and est.json says "${manifestId}"`, `edit ${c.file}:${c.line}: make the id "${manifestId}" (or change est.json's "id"; they must be the same)`);
    else if (c) ok('id', `the code and est.json agree on the id (${c.file}:${c.line})`);
  }

  // 5. The parameters the code declares against est.json's list.
  const listed = Array.isArray(manifest?.parameters) ? (manifest.parameters as unknown[]).map(p => num((p as { id?: unknown } | null)?.id)).filter((x): x is number => x !== null) : null;
  if (kind && listed && (kind === 'as' || kind === 'rust')) {
    const declared = codeParamIds(dir, kind);
    if (declared) {
      const onlyCode = [...new Set(declared)].filter(id => !listed.includes(id)).sort((a, b) => a - b);
      const onlyManifest = listed.filter(id => !declared.includes(id)).sort((a, b) => a - b);
      const twice = declared.filter((id, i) => declared.indexOf(id) !== i);
      if (twice.length) fix('parameters', `the code declares parameter id ${list([...new Set(twice)])} more than once`, 'edit the source: every parameter has its own id, never reused');
      else if (onlyCode.length || onlyManifest.length) {
        const parts = [onlyCode.length ? `the code declares id ${list(onlyCode)} that est.json does not list` : '', onlyManifest.length ? `est.json lists id ${list(onlyManifest)} that the code does not declare` : ''].filter(Boolean);
        fix('parameters', parts.join(', and '), 'edit est.json\'s "parameters": one { "id", "name" } for each parameter the code declares, and no others');
      } else ok('parameters', `the code and est.json list the same ${listed.length} parameter${listed.length === 1 ? '' : 's'}`);
    }
  }

  // 6. AssemblyScript: the memory the build may grow to against est.json's limit.
  if (kind === 'as' && manifest) {
    const cfg = readJson(join(dir, 'asconfig.json')).value as { options?: { maximumMemory?: unknown } } | null;
    const built = num(cfg?.options?.maximumMemory);
    const limit = num((manifest.limits as { memoryPagesMax?: unknown } | undefined)?.memoryPagesMax);
    if (built !== null && limit !== null) {
      if (built !== limit) fix('memory', `asconfig.json lets the module grow to ${built} pages ("maximumMemory") and est.json allows ${limit} ("limits.memoryPagesMax")`, `edit the smaller to ${Math.max(built, limit)}: the two numbers are the same (a page is 64 KiB)`);
      else ok('memory', `the memory limit is the same in asconfig.json and est.json (${limit} pages)`);
    }
  }

  // 7. The golden spec: JSON, a whole number of blocks, and only parameters est.json lists.
  if (project && existsSync(project.golden)) {
    const g = readJson(project.golden);
    const name = rel(dir, project.golden);
    if (g.error !== null) fix('golden', `${name} is not valid JSON: ${g.error}`, `edit ${name} there`);
    else {
      const spec = g.value as { frames?: unknown; events?: unknown } | null;
      const events = Array.isArray(spec?.events) ? (spec.events as { type?: unknown; id?: unknown }[]) : [];
      const unknown = listed ? [...new Set(events.filter(e => e?.type === 'param').map(e => num(e.id)).filter((x): x is number => x !== null && !listed.includes(x)))].sort((a, b) => a - b) : [];
      const frames = num(spec?.frames);
      if (frames !== null && frames % 128) fix('golden', `${name}'s "frames" is ${frames}, not a multiple of 128`, `edit ${name}: set "frames" to ${Math.ceil(frames / 128) * 128}`);
      else if (unknown.length) fix('golden', `${name} sets parameter id ${list(unknown)}, which est.json does not list`, `edit ${name}'s "events": use the ids in est.json's "parameters" (${listed?.length ? list(listed) : 'none yet'}), then npx est test --update`);
      else ok('golden', `${name}: ${events.length} event${events.length === 1 ? '' : 's'}, every parameter it sets is in est.json`);
    }
  } else if (project && manifest) note('golden', `no ${rel(dir, project.golden)}: est test then runs the conformance checks only`);

  // 8. What the last build and validate left in dist/.
  let bundle: string | null = null;
  if (manifest) {
    const dist = join(dir, 'dist');
    let bundles: { name: string; at: number }[] = [];
    try { bundles = readdirSync(dist).filter(n => n.endsWith('.est')).map(n => ({ name: n, at: statSync(join(dist, n)).mtimeMs })).sort((a, b) => b.at - a.at); } catch { /* no dist yet */ }
    if (!bundles.length) fix('bundle', 'nothing is built yet (no dist/*.est)', 'npx est validate', { command: true });
    else {
      bundle = `dist/${bundles[0]!.name}`;
      const stale = newestSource(dir) > bundles[0]!.at;
      const v = existsSync(join(dist, 'validation.json')) ? readJson(join(dist, 'validation.json')).value as { ok?: unknown; checks?: { rule?: unknown; status?: unknown; fix?: unknown; message?: unknown; where?: unknown }[] } | null : null;
      const failed = v && v.ok === false && Array.isArray(v.checks) ? v.checks.find(c => c?.status === 'fail') : null;
      if (failed && !stale) {
        const how = fewWords(String(failed.fix || failed.message || ''));
        fix('validation', `the last validate failed ${String(failed.rule)}${typeof failed.where === 'string' ? ` [${failed.where}]` : ''}: ${String(failed.message ?? '').replace(/\s+/g, ' ')}`, `${how}; then npx est validate`);
      } else if (stale) fix('bundle', `${bundle} is older than your last change`, 'npx est validate', { command: true });
      else if (v && v.ok === true) ok('validation', `${bundle} passed its last validate`);
      else fix('validation', `${bundle} has not been validated (no dist/validation.json)`, 'npx est validate', { command: true });
    }
  }

  // 9. est dev --json's browser: never a problem, only said.
  const dev = probes.filter(p => p.for === 'dev');
  if (dev.length) note('dev-json', dev.every(p => p.ok) ? "Playwright's Chromium is here: est dev --json can run" : "Playwright's Chromium is absent: only est dev --json needs it (est dev in your own browser does not)");

  const canBuild = !checks.some(c => c.status === 'fix' && c.blocks);
  const first = checks.find(c => c.status === 'fix' && c.blocks) ?? checks.find(c => c.status === 'fix');
  let next: string;
  if (first) next = `${NEXT_PREFIX}${first.command ? first.fix!.split('   (')[0]! : first.fix!}`;
  else next = `${NEXT_PREFIX}npx est dev to hear it, or drop ${bundle ?? 'dist/<id>-<version>.est'} on Cyber: ${DROP_WORDS}`;
  return { dir, kind, checks, canBuild, next };
}

/** A check as its one line. */
export function checkLine(c: FolderCheck): string {
  const mark = c.status === 'ok' ? 'ok  ' : c.status === 'fix' ? 'fix ' : 'note';
  return `${mark}  ${c.text}${c.fix ? `: ${c.command ? 'run ' : ''}${c.fix}` : ''}`;
}
