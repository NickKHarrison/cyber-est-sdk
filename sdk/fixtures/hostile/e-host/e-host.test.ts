/**
 * The sandbox attack order (stream E): the hostile fixtures of "the front door" are bundles a plugin
 * maker could really publish, so each must pass the whole validator (every install rule), and what
 * makes it hostile must still be in it. Where its text is then drawn, and that it is drawn as plain
 * text, is e2e/est-hostile-text.spec.ts (the app) and server/hostileText.*.test.mjs (the server's pages).
 */
import { describe, expect, it } from 'vitest';
import { readBundle } from '../../../../src/audio/est/install/bundle';
import { validate } from '../../../packages/tools/src/index';
import { HOSTILE_E, packHostile, PWNED } from './index.mjs';

describe('the hostile fixtures of stream E', () => {
  for (const f of HOSTILE_E) {
    it(`${f.name} (${f.tries}) passes validation: it is what a maker could publish`, async () => {
      const v = await validate(packHostile(f).bytes, { seconds: 2 });
      expect(v.checks.filter(c => c.status === 'fail').map(c => c.rule)).toEqual([]);
      expect(v.ok).toBe(true);
    }, 120_000);
  }

  it('text-everywhere: every text field of est.json and its presets carries markup, at the field\'s longest', async () => {
    const b = await readBundle(packHostile(HOSTILE_E.find(f => f.name === 'text-everywhere')!).bytes);
    const m = b.manifest;
    for (const [field, text, max] of [['name', m.name, 60], ['vendor', m.vendor, 60], ['description', m.description, 400], ['license', m.license, 64], ['parameters[0].name', m.parameters[0]!.name, 255]] as const) {
      expect(text.length, field).toBe(max);
      expect(text, field).toContain(PWNED);
      expect(text, field).toMatch(/[<>"]/);
    }
    expect(m.description).toContain('javascript:');
    expect(m.features).toContain('__proto__');
    expect(m.parameters[1]!.name).toBe('__proto__');
    // The DSP's own names (read from its memory at run time, never validated as est.json's are): markup and control bytes.
    const mod = Buffer.from(b.module).toString('latin1');
    expect(mod).toContain('<img src=x onerror="window.__estPwned=1">\n\x7f\x85\x9b');
    expect(mod).toContain('__proto__/</script><script>');
  });
});
