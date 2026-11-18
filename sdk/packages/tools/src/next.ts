/**
 * @cyber-est/tools: **the next thing to do, in one line** (1.803). `est validate`, `est test`,
 * `est doctor` in a plugin folder and `est dev`'s rebuild each end with one line that starts
 * `Next:`. This file decides that line, and nothing else does: one pure function, so the four say
 * the same thing about the same folder.
 *
 * It is a hint. It reads what the build and the validator already said (the compiler's output, the
 * report's first failed check with the rule's own id and fix) and never changes a rule, its id or
 * its result: the validator is the install code.
 */
import type { ValidationCheck, ValidationReport } from './validate';

export const NEXT_PREFIX = 'Next: ';
/** The longest fix text a line carries before it is cut at a word (the full text is in the report above it). */
export const NEXT_FIX_CHARS = 140;

/** Where Cyber takes a plugin file (the words every success line ends with). */
export const DROP_WORDS = 'Home → EST PLUGINS → Add a plugin';

export interface CompilerError {
  /** The file as the compiler named it (relative to the plugin folder where it can be). */
  file: string | null;
  line: number | null;
  /** The compiler's message, one line. */
  message: string;
  /** The compiler's own code (`TS2304`, `E0425`), when it gave one. */
  code: string | null;
}

/** ANSI colour codes, which a compiler writes when it thinks it has a terminal. */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The first error in a build's output, for the three compilers the kit drives:
 * - AssemblyScript: `ERROR TS2304: Cannot find name 'x'.` … ` └─ in assembly/index.ts(12,5)`;
 * - Rust: `error[E0425]: cannot find value …` … `  --> src/lib.rs:12:5`;
 * - clang: `src/plugin.cpp:12:5: error: …` (and `fatal error:`).
 * Null when the output has none it knows.
 */
export function firstCompilerError(log: string): CompilerError | null {
  const lines = log.replace(ANSI, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // clang (and anything gcc-shaped): the place comes first.
    const c = /^\s*(.+?):(\d+):(?:\d+:)?\s*(?:fatal )?error:\s*(.+)$/.exec(line);
    if (c) return { file: c[1]!, line: Number(c[2]), message: c[3]!.trim(), code: null };
    const as = /^\s*ERROR\s+(?:(TS\d+|AS\d+):\s*)?(.+)$/.exec(line);
    if (as) {
      let file: string | null = null, at: number | null = null;
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const w = /in\s+(.+?)\((\d+),\d+\)\s*$/.exec(lines[j]!);
        if (w) { file = w[1]!; at = Number(w[2]); break; }
        if (/^\s*(ERROR|WARNING)\b/.test(lines[j]!)) break;
      }
      return { file, line: at, message: as[2]!.trim(), code: as[1] ?? null };
    }
    const rs = /^\s*error(?:\[(E\d+)\])?:\s*(.+)$/.exec(line);
    if (rs && !/^(could not compile|aborting due to)/.test(rs[2]!)) {
      let file: string | null = null, at: number | null = null;
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const w = /^\s*-->\s*(.+?):(\d+):\d+\s*$/.exec(lines[j]!);
        if (w) { file = w[1]!; at = Number(w[2]); break; }
      }
      return { file, line: at, message: rs[2]!.trim(), code: rs[1] ?? null };
    }
  }
  return null;
}

/** A fix in a few words: its first sentence, cut at a word when that is still long. */
export function fewWords(fix: string, max = NEXT_FIX_CHARS): string {
  const flat = fix.replace(/\s+/g, ' ').trim();
  // A sentence ends at a full stop followed by a space and a capital (never inside `est.json` or `1.0`).
  const end = /[.:;]\s+(?=[A-Z`(])/.exec(flat);
  let s = end ? flat.slice(0, end.index) : flat.replace(/[.]$/, '');
  if (s.length > max) s = `${s.slice(0, s.lastIndexOf(' ', max))}…`;
  return s;
}

const failedFirst = (v: Pick<ValidationReport, 'checks'>): ValidationCheck | null => v.checks.find(c => c.status === 'fail') ?? null;

export type NextInput =
  /** The build stopped: its output (the compiler's), and the error the build step raised. */
  | { kind: 'build'; log: string; message: string }
  /** A tool the build needs did not start (it is not installed). */
  | { kind: 'tool'; tool: string }
  /** A validation report (and, for `est test`, whether the golden render differed). */
  | {
      kind: 'report';
      report: Pick<ValidationReport, 'ok' | 'checks'>;
      /** The packed file as the person would type it (`dist/com.example.fx-1.0.0.est`). */
      bundle?: string;
      /** `est test`: the golden render differed (or its notes did) though every check passed. */
      goldenDiffers?: boolean;
      /** `est test`: the golden render could not be played (its spec is wrong, or the plugin stopped). */
      goldenError?: string;
      /** Which command asks: `est dev` is already playing it, so its line does not send the person to itself. */
      from?: 'validate' | 'test' | 'dev';
      /** `est dev`: the page's address. */
      url?: string;
    };

/**
 * The line. On a failure: the first failed check's rule id, where, and its fix in a few words. On a
 * build error: the first compiler error with its file and line. On success: the next step.
 */
export function nextLine(input: NextInput): string {
  if (input.kind === 'tool') return `${NEXT_PREFIX}npx est doctor (${input.tool} did not start; doctor prints the command that installs it)`;
  if (input.kind === 'build') {
    const e = firstCompilerError(input.log);
    if (!e) return `${NEXT_PREFIX}fix the build error above (${input.message.replace(/\s+/g, ' ').trim()}), then run this again`;
    const where = e.file ? `${e.file}${e.line !== null ? `:${e.line}` : ''}` : 'the source';
    return `${NEXT_PREFIX}fix ${where}: ${e.message}${e.code ? ` (${e.code})` : ''}`;
  }
  const { report } = input;
  const failed = failedFirst(report);
  if (failed) {
    const fix = fewWords(failed.fix || failed.message || failed.title);
    return `${NEXT_PREFIX}fix ${failed.rule}${failed.where ? ` [${failed.where}]` : ''}: ${fix}`;
  }
  if (input.goldenError) return `${NEXT_PREFIX}fix the golden render (test/golden.json): ${fewWords(input.goldenError)}`;
  if (input.goldenDiffers) {
    return `${NEXT_PREFIX}npx est dev to hear what changed; if the new sound is the one you want, npx est test --update`;
  }
  const file = input.bundle ?? 'dist/<id>-<version>.est';
  if (input.from === 'dev') return `${NEXT_PREFIX}play it${input.url ? ` at ${input.url}` : ''}; when it sounds right, drop ${file} on Cyber: ${DROP_WORDS}`;
  return `${NEXT_PREFIX}npx est dev to hear it, or drop ${file} on Cyber: ${DROP_WORDS}`;
}
