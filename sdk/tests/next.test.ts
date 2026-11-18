/**
 * 1.803 (the loop): the one `Next:` line `est validate`, `est test`, `est doctor` and `est dev`
 * end with (`sdk/packages/tools/src/next.ts`). One pure function: the first failed check's rule id,
 * where, and its fix in a few words; the first compiler error with its file and line; or the next
 * step. A hint only: it carries the validator's own rule id and never another.
 */
import { describe, expect, it } from 'vitest';
import { EST_RULES, estRule } from '../../src/audio/est/install/rules';
import { DROP_WORDS, NEXT_PREFIX, fewWords, firstCompilerError, nextLine } from '../packages/tools/src/next';
import type { ValidationCheck } from '../packages/tools/src/validate';

const check = (rule: string, status: ValidationCheck['status'], where?: string): ValidationCheck => {
  const r = estRule(rule);
  return { rule, title: r.title, severity: r.severity, status, message: status === 'pass' ? '' : 'what was found', fix: status === 'fail' || status === 'warn' ? r.fix : '', ...(where ? { where } : {}) };
};

const ASC = `est: building (asc assembly/index.ts)
ERROR TS2339: Property 'nxt' does not exist on type '~lib/est/dsp/smoother/Smoother'.
    :
 79 │ const g = this.gain.nxt();
    │                     ~~~
    └─ in assembly/index.ts(79,27)

ERROR TS2304: Cannot find name 'later'.
    └─ in assembly/index.ts(90,1)

FAILURE 2 compile error(s)`;

const RUST = `   Compiling my-fx v1.0.0 (/tmp/my-fx)
warning: unused variable: \`x\`
 --> src/lib.rs:3:9
error[E0425]: cannot find value \`gian\` in this scope
  --> src/lib.rs:61:21
   |
61 |             let g = gian.next();
   |                     ^^^^ help: a local variable with a similar name exists: \`gain\`

error: could not compile \`my-fx\` (lib) due to 1 previous error`;

const CLANG = `In file included from src/plugin.cpp:19:
src/dsp.h:14:10: fatal error: 'cmath' file not found
   14 | #include <cmath>
      |          ^~~~~~~
1 error generated.`;

describe('the first compiler error', () => {
  it('AssemblyScript: the message, its code, the file and the line', () => {
    expect(firstCompilerError(ASC)).toEqual({ file: 'assembly/index.ts', line: 79, message: "Property 'nxt' does not exist on type '~lib/est/dsp/smoother/Smoother'.", code: 'TS2339' });
  });
  it('Rust: the first error (never a warning before it, never "could not compile")', () => {
    expect(firstCompilerError(RUST)).toEqual({ file: 'src/lib.rs', line: 61, message: 'cannot find value `gian` in this scope', code: 'E0425' });
    expect(firstCompilerError('error: could not compile `x` (lib) due to 1 previous error')).toBeNull();
  });
  it('clang: the place comes first', () => {
    expect(firstCompilerError(CLANG)).toEqual({ file: 'src/dsp.h', line: 14, message: "'cmath' file not found", code: null });
  });
  it('colour codes are ignored; output with no error it knows gives null', () => {
    expect(firstCompilerError('\u001b[91mERROR \u001b[0mTS1005: \';\' expected.\n └─ in assembly/a.ts(3,1)')?.line).toBe(3);
    expect(firstCompilerError('Finished release in 2 s')).toBeNull();
  });
});

describe('the Next: line', () => {
  it('always one line that starts "Next: "', () => {
    const lines = [
      nextLine({ kind: 'build', log: ASC, message: 'the build failed (asc exited with 1)' }),
      nextLine({ kind: 'build', log: 'something odd', message: 'the build failed\n(asc exited with 1)' }),
      nextLine({ kind: 'tool', tool: 'cargo' }),
      nextLine({ kind: 'report', report: { ok: true, checks: [check('EST-C001', 'pass')] } }),
      nextLine({ kind: 'report', report: { ok: false, checks: [check('EST-C001', 'fail', 'phase:boot')] } }),
    ];
    for (const l of lines) {
      expect(l.startsWith(NEXT_PREFIX)).toBe(true);
      expect(l).not.toContain('\n');
    }
  });

  it('a build error: the first compiler error with file:line', () => {
    expect(nextLine({ kind: 'build', log: ASC, message: 'x' })).toBe("Next: fix assembly/index.ts:79: Property 'nxt' does not exist on type '~lib/est/dsp/smoother/Smoother'. (TS2339)");
    expect(nextLine({ kind: 'build', log: RUST, message: 'x' })).toBe('Next: fix src/lib.rs:61: cannot find value `gian` in this scope (E0425)');
    expect(nextLine({ kind: 'build', log: CLANG, message: 'x' })).toBe("Next: fix src/dsp.h:14: 'cmath' file not found");
  });

  it('a build that stopped with nothing it can read says so; a tool that is not installed sends to est doctor', () => {
    expect(nextLine({ kind: 'build', log: '', message: 'the build did not write build/module.wasm' })).toBe('Next: fix the build error above (the build did not write build/module.wasm), then run this again');
    expect(nextLine({ kind: 'tool', tool: 'cargo' })).toMatch(/^Next: npx est doctor \(cargo did not start/);
  });

  it('a failed report: the FIRST failed check, by its own rule id, where, and its fix', () => {
    const report = { ok: false, checks: [check('EST-M002', 'pass'), check('EST-P001', 'warn'), check('EST-C008', 'fail', 'phase:params'), check('EST-C013', 'fail', 'phase:process')] };
    const l = nextLine({ kind: 'report', report });
    expect(l.startsWith('Next: fix EST-C008 [phase:params]: ')).toBe(true);
    expect(l).toContain(fewWords(estRule('EST-C008').fix));
    expect(l).not.toContain('EST-C013');
  });

  it('never names a rule the validator does not have, for any rule that fails', () => {
    for (const r of EST_RULES) {
      const l = nextLine({ kind: 'report', report: { ok: false, checks: [check(r.id, 'fail')] } });
      expect(l.startsWith(`Next: fix ${r.id}: `), r.id).toBe(true);
      expect(l.length, r.id).toBeLessThan(200);
      expect(l, r.id).not.toContain('\n');
    }
  });

  it('a warning alone is not a failure: the line is the next step', () => {
    const l = nextLine({ kind: 'report', report: { ok: true, checks: [check('EST-P001', 'warn')] }, bundle: 'dist/com.example.fx-1.0.0.est', from: 'validate' });
    expect(l).toBe(`Next: npx est dev to hear it, or drop dist/com.example.fx-1.0.0.est on Cyber: ${DROP_WORDS}`);
  });

  it('est test: a failed check comes before the render; a render that differs sends to est dev, then --update', () => {
    const pass = { ok: true, checks: [check('EST-C001', 'pass')] };
    expect(nextLine({ kind: 'report', report: pass, goldenDiffers: true, from: 'test' })).toBe('Next: npx est dev to hear what changed; if the new sound is the one you want, npx est test --update');
    expect(nextLine({ kind: 'report', report: { ok: false, checks: [check('EST-C013', 'fail')] }, goldenDiffers: true, from: 'test' })).toMatch(/^Next: fix EST-C013: /);
    expect(nextLine({ kind: 'report', report: pass, goldenError: "a golden render's length is a multiple of 128 frames", from: 'test' })).toBe("Next: fix the golden render (test/golden.json): a golden render's length is a multiple of 128 frames");
  });

  it('est dev does not send the person to est dev: play it at the page, then drop the file', () => {
    const l = nextLine({ kind: 'report', report: { ok: true, checks: [] }, bundle: 'dist/dev.est', from: 'dev', url: 'http://localhost:4430' });
    expect(l).toBe(`Next: play it at http://localhost:4430; when it sounds right, drop dist/dev.est on Cyber: ${DROP_WORDS}`);
  });
});

describe('a fix in a few words', () => {
  it('keeps the first sentence, never cutting inside a file name or a version', () => {
    expect(fewWords('Set `id` in est.json to 1.0 or newer. Then pack again.')).toBe('Set `id` in est.json to 1.0 or newer');
    expect(fewWords('One sentence only.')).toBe('One sentence only');
  });
  it('cuts a long sentence at a word', () => {
    const s = fewWords(`${'word '.repeat(60)}end`, 50);
    expect(s.length).toBeLessThanOrEqual(51);
    expect(s.endsWith('…')).toBe(true);
    expect(s).not.toMatch(/wor…$/);
  });
});
