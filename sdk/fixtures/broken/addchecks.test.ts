/**
 * 1.914: the add-time checks' planted faults (`addchecks.json`, src/audio/est/review/addChecks.ts) through the
 * validator (Node) and Cyber's compiling Worker (its message handler on a stand-in `self`, as broken.test.ts
 * runs it). Unlike the broken fixtures, every one **installs**: its rule is a warning, the plugin is the
 * person's own. Each is proved at the install check's real length (10 s of signal: a shorter run misses
 * what the install's own limits catch, a level past +18 dBFS or the slow stop, and a fixture they catch
 * proves nothing here), warned under its rule by `validate`, and found by the Worker's `checks` request.
 * Its own file: the heavy fixture takes most of a block's time by design.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorkerReply, WorkerRequest } from '../../../src/audio/est/install/workerProtocol';
import { validate } from '../../packages/tools/src/index';
import { ADDCHECKS, PASSING, packFixture } from './index.mjs';

let handler: (e: { data: WorkerRequest }) => void;
const posted: WorkerReply[] = [];
beforeAll(async () => {
  const self: { onmessage: unknown; postMessage(m: WorkerReply): void } = { onmessage: null, postMessage: m => { posted.push(m); } };
  (globalThis as unknown as { self: unknown }).self = self;
  await import('../../../src/audio/est/install/estWorker');
  handler = self.onmessage as typeof handler;
}, 60_000);

let nextId = 1;
async function install(bytes: Uint8Array, seconds = 10): Promise<WorkerReply> {
  const before = posted.length;
  handler({ data: { type: 'install', id: nextId++, bytes: bytes.slice().buffer, expectHash: null, seconds } });
  for (let i = 0; i < 2400 && posted.length === before; i++) await new Promise(r => setTimeout(r, 25));
  return posted[before]!;
}

describe('the add-time checks\' planted faults (1.914)', () => {
  /** The Worker's `checks` request: the report the Add a plugin dialog shows. */
  async function checked(bytes: Uint8Array): Promise<WorkerReply> {
    const before = posted.length;
    handler({ data: { type: 'checks', id: nextId++, bytes: bytes.slice().buffer, expectHash: null, budgetMs: 60_000 } });
    for (let i = 0; i < 2400 && posted.length === before; i++) await new Promise(r => setTimeout(r, 25));
    return posted[before]!;
  }

  for (const f of ADDCHECKS) {
    it(`${f.name}: installs, and ${f.rule} is a warning in validate and a finding in the Worker's checks`, async () => {
      const bytes = packFixture(f).bytes;
      const v = await validate(bytes, { behaviour: false });
      // A warning never fails the validator, and the install takes it: it is the person's own plugin.
      expect(v.checks.filter(c => c.status === 'fail').map(c => `${c.rule}: ${c.message}`), f.name).toEqual([]);
      expect(v.ok, f.name).toBe(true);
      // (EST-C024's cheap form is the add-time report's alone: in the validator the behaviour check itself, left out here, is that rule.)
      if (f.rule !== 'EST-C024') {
        const warned = v.checks.filter(c => c.status === 'warn' && c.rule === f.rule);
        expect(warned.length, f.name).toBeGreaterThan(0);
        expect(warned[0]!.message.length, f.name).toBeGreaterThan(40);
        expect(warned[0]!.fix.length, f.name).toBeGreaterThan(10);
      }
      // The heavy fixture takes most of a block's time by design: the validator above ran the install's own code on
      // it at full length, and the checks' own tests (addChecks.test.ts) run it; the Worker is not made to do both again.
      if (f.rule === 'EST-C037') return;
      expect((await install(bytes, 10)).type, f.name).toBe('installed');
      const reply = await checked(bytes);
      expect(reply.type, f.name).toBe('checked');
      if (reply.type !== 'checked') return;
      expect(reply.report.findings.map(x => x.rule), f.name).toContain(f.rule);
    }, 300_000);
  }

  it('the plugins done right get no add-time warning from validate', async () => {
    for (const f of PASSING.filter(p => p.name !== 'rate-frames')) {
      const v = await validate(packFixture(f).bytes, { seconds: 2, behaviour: false });
      expect(v.checks.filter(c => c.status === 'warn' && /^EST-C03[1-9]|^EST-C040|^EST-U006/.test(c.rule)).map(c => `${f.name} ${c.rule}: ${c.message}`)).toEqual([]);
    }
  }, 120_000);

  it('the Worker refuses to check a bundle other than the one asked for, and reports nothing for one it cannot read', async () => {
    const bytes = packFixture(PASSING.find(p => p.name === 'addcheck-ok')!).bytes;
    const before = posted.length;
    handler({ data: { type: 'checks', id: nextId++, bytes: bytes.slice().buffer, expectHash: 'f'.repeat(64) } });
    for (let i = 0; i < 400 && posted.length === before; i++) await new Promise(r => setTimeout(r, 25));
    expect(posted[before]).toMatchObject({ type: 'refused', code: 'hash', rule: 'EST-B015' });
    const again = posted.length;
    handler({ data: { type: 'checks', id: nextId++, bytes: new Uint8Array([1, 2, 3]).buffer, expectHash: null } });
    for (let i = 0; i < 400 && posted.length === again; i++) await new Promise(r => setTimeout(r, 25));
    expect(posted[again]!.type).toBe('refused');
  }, 60_000);
});
