/**
 * @cyber-est/tools (EST Phase 4, docs/est/EST_Phase4_Work_Order.md §1; MIT; ESM; Node 20): the EST
 * developer kit's API, the same code as Cyber's install (D-37). `est` (sdk/packages/cli) is a
 * command line over it.
 *
 * - `validate(bytes | { dir }, opts) → ValidationReport` (`validation.json`);
 * - `pack(dir, opts) → { bytes, hash, manifest, files }`: a plugin folder's canonical `.est`;
 * - `inspect(bytes, { meter })`: the manifest, the files and the module;
 * - `render(bytes, spec)`, and the golden renders (`renderGoldenBundle`, `compareGolden`,
 *   `goldenBytes`; 4-B's format, `sdk/testing/golden.ts`): renders on the conformance host;
 * - `compareRenders`, `htmlReport`, `readWav`, `writeWav` (DEV-G, 1.326): `est compare`'s measuring;
 * - `readProject(dir)`: a template project's build and module path;
 * - the rules (`EST_RULES`) and the spec's machine-readable files (`SPEC_FILES`).
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packDir } from './pack.mjs';
import { readProject } from './project';

export { validate, reportOf, formatReport, TOOL_NAME, TOOL_VERSION } from './validate';
export type { ValidationReport, ValidationCheck, ValidateOptions, CheckStatus } from './validate';
export { inspect } from './inspect';
export type { Inspection } from './inspect';
export { render, renderGoldenBundle, renderGoldenBundleFull, inputSamples } from './render';
export { compareGolden, compareNotes, goldenBytes, notesJson, goldenFromBytes, goldenInput } from '../../../testing/golden';
export type { GoldenNote, GoldenSpec } from '../../../testing/golden';
export type { RenderSpec, RenderInput, RenderEvent, Rendered } from './render';
export { compareRenders, compareWarnings, formatCompare, htmlReport, readWav, writeWav, bandPower, dbOf, BANDS } from './compare';
export type { CompareResult, CompareOptions, ChannelCompare, Stereo } from './compare';
export { readProject, findAsc, tomlValues, CPP_BUILD } from './project';
export type { EstProject, ProjectKind } from './project';
export { probeUi } from './ui';
export type { UiFinding } from './ui';
export { packBundle, packDir, readPluginDir, storedZip, sha256, crc32, EST_UI_SCRIPT, EST_UI_DIST } from './pack.mjs';
export { EST_RULES, EST_RULES_VERSION, EST_BLOCK_BUDGET_US, EST_UI_MAX_BYTES, estRule } from '../../../../src/audio/est/install/rules';
export type { EstRule, EstRuleSeverity, EstRuleStep } from '../../../../src/audio/est/install/rules';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
/** The specification's machine-readable files, in this repository (D-37: they move with the SDK before Phase 7). */
export const SPEC_FILES = {
  abi: join(ROOT, 'src', 'audio', 'est', 'abi', 'est-abi-1.0.json'),
  /** EST 1.1 (1.327, D-56): 1.0's layout plus the structs and constants 1.1 adds (the host reads this one). */
  abi11: join(ROOT, 'src', 'audio', 'est', 'abi', 'est-abi-1.1.json'),
  schema: join(ROOT, 'src', 'audio', 'est', 'abi', 'est-manifest-1.schema.json'),
  rules: join(ROOT, 'src', 'audio', 'est', 'abi', 'est-validator-rules.json'),
  spec: join(ROOT, 'docs', 'est', 'EST_SPECIFICATION_DRAFT.md'),
} as const;

export interface PackOptions {
  /** The module on disk (default: the project's build output, `readProject(dir).wasm`). */
  module?: string;
  /** A LICENSE to pack when the folder has none. */
  license?: string;
  /** @cyber-est/ui's compiled script, when the UI uses it (default: 4-C's build in this repository). */
  estUi?: string;
}

/** Pack a plugin folder into its canonical `.est` (it does not build: `est pack` builds first). */
export function pack(dir: string, opts: PackOptions = {}): { bytes: Uint8Array; hash: string; manifest: Record<string, unknown>; files: Record<string, Uint8Array> } {
  return packDir(dir, { module: opts.module ?? readProject(dir).wasm, license: opts.license, estUi: opts.estUi });
}
