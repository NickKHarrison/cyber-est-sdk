/**
 * EST Tidy (ET-B): `est dev --json`'s `{"cmd":"ui-param","id":n,"value":v}`. What runs inside the
 * custom UI's frame (`frameWrite`, headless.mjs) writes through the page's own `@cyber-est/ui` connection
 * (`EstUI.currentConnection()`) as a control's drag does: begin, the value, end; and says why when it
 * cannot. The browser spec (e2e/est-devhost.spec.ts "ui-param") runs it in a real frame against the
 * host's checks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { frameWrite } from './headless.mjs';

/** A stand-in connection with @cyber-est/ui's shape (one parameter, id 3, −18…18, clamping as `set` does). */
function connection(initialised = true) {
  const log = [];
  let value = 0;
  return {
    log,
    initialised,
    param: (id) => (id === 3 ? { id, min: -18, max: 18 } : undefined),
    get: (id) => (id === 3 ? value : undefined),
    set: (id, v) => { log.push(`set:${id}:${v}`); value = Math.max(-18, Math.min(18, v)); },
    begin: (id) => { log.push(`begin:${id}`); },
    end: (id) => { log.push(`end:${id}`); },
  };
}

afterEach(() => { delete globalThis.EstUI; });

describe("est dev --json's ui-param inside the frame", () => {
  it('writes through the page\'s own connection as a gesture: begin, the value, end', () => {
    const c = connection();
    globalThis.EstUI = { currentConnection: () => c };
    expect(frameWrite([3, -6])).toEqual({ ok: true, value: -6, changed: true });
    expect(c.log).toEqual(['begin:3', 'set:3:-6', 'end:3']);
    expect(frameWrite([3, -6])).toEqual({ ok: true, value: -6, changed: false });
    expect(frameWrite([3, 99])).toEqual({ ok: true, value: 18, changed: true });
  });

  it('says why it cannot, and which refusals may pass once the page has come up', () => {
    expect(frameWrite([3, 1])).toEqual({ ok: false, early: true, reason: 'the page does not load est-ui.js (no window.EstUI)' });
    globalThis.EstUI = { currentConnection: () => null };
    expect(frameWrite([3, 1])).toEqual({ ok: false, early: true, reason: 'the page has not called EstUI.connect()' });
    const waiting = connection(false);
    globalThis.EstUI = { currentConnection: () => waiting };
    expect(frameWrite([3, 1])).toEqual({ ok: false, early: true, reason: 'no est:init has arrived yet' });
    const c = connection();
    globalThis.EstUI = { currentConnection: () => c };
    expect(frameWrite([42, 1])).toEqual({ ok: false, reason: 'no parameter with id 42' });
    expect(c.log).toEqual([]);
  });
});
