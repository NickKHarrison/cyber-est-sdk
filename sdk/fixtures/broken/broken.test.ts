/**
 * EST Phase 4 (4-A): every broken fixture through both of the validator's callers, the SDK's
 * `validate` (Node) and Cyber's compiling Worker (its message handler, on a stand-in `self`, as
 * src/audio/est/install/worker.test.ts runs it): each fails the rule it was made to break, and the
 * two name **the same rule**. A fixture only the validator refuses (`install: false`) installs in
 * the Worker and fails that rule in `validate`, with every install rule passed or not applicable.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { EST_RULES } from '../../../src/audio/est/install/rules';
import type { WorkerReply, WorkerRequest } from '../../../src/audio/est/install/workerProtocol';
import { validate, type ValidationReport } from '../../packages/tools/src/index';
import { BROKEN, PASSING, packFixture } from './index.mjs';

let handler: (e: { data: WorkerRequest }) => void;
const posted: WorkerReply[] = [];
beforeAll(async () => {
  const self: { onmessage: unknown; postMessage(m: WorkerReply): void } = { onmessage: null, postMessage: m => { posted.push(m); } };
  (globalThis as unknown as { self: unknown }).self = self;
  await import('../../../src/audio/est/install/estWorker');
  handler = self.onmessage as typeof handler;
}, 60_000);

let nextId = 1;
async function install(bytes: Uint8Array): Promise<WorkerReply> {
  const before = posted.length;
  handler({ data: { type: 'install', id: nextId++, bytes: bytes.slice().buffer, expectHash: null, seconds: 2 } });
  for (let i = 0; i < 800 && posted.length === before; i++) await new Promise(r => setTimeout(r, 25));
  return posted[before]!;
}

const install_ = new Set(EST_RULES.filter(r => r.install).map(r => r.id));
const estRuleSeverity = (id: string) => EST_RULES.find(r => r.id === id)?.severity;
const firstFail = (v: ValidationReport, installOnly: boolean) => v.checks.find(c => c.status === 'fail' && (!installOnly || install_.has(c.rule)))?.rule ?? null;

describe('the broken fixtures', () => {
  it('cover the work order\'s cases: a forbidden import, a memory cap, an instrument without notes, a state that drifts, randomness, an external UI, Trap and Spin', () => {
    const rules = BROKEN.map(f => f.rule);
    for (const r of ['EST-W004', 'EST-W009', 'EST-M012', 'EST-C004', 'EST-C010', 'EST-C018', 'EST-U002', 'EST-C013']) expect(rules).toContain(r);
    // 1.652: one planted fault for each behaviour check (EST-C024 to EST-C030), every one validator-only.
    for (const r of ['EST-C024', 'EST-C025', 'EST-C026', 'EST-C027', 'EST-C028', 'EST-C029', 'EST-C030']) {
      expect(BROKEN.filter(f => f.rule === r).map(f => f.install), r).toEqual([false]);
    }
    expect(BROKEN.filter(f => f.rule === 'EST-C013').map(f => f.name)).toEqual(['trap', 'spin']);
    for (const f of BROKEN) expect(EST_RULES.some(r => r.id === f.rule), f.name).toBe(true);
  });

  for (const f of BROKEN) {
    it(`${f.name}: ${f.rule} in validate and ${f.install ? 'in the Worker\'s refusal' : 'not at install'}`, async () => {
      const bytes = packFixture(f).bytes;
      const v = await validate(bytes, { seconds: 2 });
      // 1.652: a behaviour check of warning severity (EST-C026, C027, C029, C030) flags its fixture as `warn`, which
      // leaves `ok` true; the fixture must still be flagged by exactly that rule first.
      const warning = estRuleSeverity(f.rule) === 'warning';
      if (warning) {
        expect(v.checks.find(c => c.rule === f.rule)?.status, f.name).toBe('warn');
        expect(v.checks.find(c => c.status === 'fail' || c.status === 'warn')?.rule, f.name).toBe(f.rule);
        expect(v.checks.find(c => c.rule === f.rule)!.fix.length, f.name).toBeGreaterThan(10);
        expect(f.install, f.name).toBe(false);
        expect((await install(bytes)).type, f.name).toBe('installed');
        return;
      }
      expect(v.ok, f.name).toBe(false);
      const failing = v.checks.filter(c => c.status === 'fail');
      expect(failing.map(c => c.rule), f.name).toContain(f.rule);
      const reply = await install(bytes);
      if (f.install) {
        expect(reply.type, f.name).toBe('refused');
        if (reply.type !== 'refused') return;
        expect(reply.rule, `${f.name}: ${reply.message}`).toBe(f.rule);
        // The validator's install rules fail exactly where the Worker refused.
        expect(firstFail(v, true), f.name).toBe(reply.rule);
        expect(failing.find(c => c.rule === f.rule)!.message).toBe(reply.message);
      } else {
        expect(reply.type, f.name).toBe('installed');
        expect(firstFail(v, true), f.name).toBeNull();
        expect(firstFail(v, false), f.name).toBe(f.rule);
      }
      const check = failing.find(c => c.rule === f.rule)!;
      expect(check.fix.length, f.name).toBeGreaterThan(10);
    }, 60_000);
  }
});

describe('the passing fixtures (EST tidy, 1.286)', () => {
  it('include init-ok, whose output is NaN unless the host ran its _initialize', () => {
    expect(PASSING.map(f => f.name)).toContain('init-ok');
  });
  it('include behave-ok, the behaviour fixtures\' plugin done right (1.652)', () => {
    expect(PASSING.map(f => f.name)).toContain('behave-ok');
  });
  for (const f of PASSING) {
    it(`${f.name}: passes validate and installs in the Worker`, async () => {
      const bytes = packFixture(f).bytes;
      const v = await validate(bytes, { seconds: 2 });
      expect(v.checks.filter(c => c.status === 'fail').map(c => `${c.rule}: ${c.message}`), f.name).toEqual([]);
      // 1.652: and no behaviour check flags it, a warning either.
      expect(v.checks.filter(c => c.status === 'warn' && /^EST-C02[4-9]|^EST-C030/.test(c.rule)).map(c => `${c.rule}: ${c.message}`), f.name).toEqual([]);
      expect(v.ok, f.name).toBe(true);
      const reply = await install(bytes);
      expect(reply.type, f.name).toBe('installed');
    }, 60_000);
  }
});
