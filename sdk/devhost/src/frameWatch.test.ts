/**
 * The dev host's view of a custom UI (frameWatch.ts): a refusal's reason agrees with Cyber's own
 * check (`checkFrameMessage`) on every message, and the watcher logs the frame's load, its
 * est:ready and every refusal.
 */
import { describe, expect, it } from 'vitest';
import type { EstParam } from '@/audio/est/EstNode';
import { checkFrameMessage } from '@/components/est/estFrameProtocol';
import { explainFrameMessage, frameNonce, watchFrame } from './frameWatch';

const P: EstParam[] = [{ id: 3, name: 'Mix', module: '', min: 0, max: 1, def: 0.5, flags: 0, value: 0.5 }];
const N = 'abc123';

const CASES: [unknown, RegExp | null][] = [
  [{ v: 1, type: 'est:ready', nonce: N }, null],
  [{ v: 1, type: 'est:param', nonce: N, id: 3, value: 0.2 }, null],
  [{ v: 1, type: 'est:gesture', nonce: N, id: 3, phase: 'begin' }, null],
  ['est:ready', /not an object/],
  [[1], /not an object/],
  [{ v: 4, type: 'est:ready', nonce: N }, /v is not 1, 2 or 3/],
  [{ v: 2, type: 'est:audio', nonce: N, fftSize: 1024, rate: 30 }, /est:audio is protocol version 3/],
  [{ v: 3, type: 'est:audio', nonce: N, fftSize: 1024, rate: 30 }, /only when est\.json's ui\.audio is true/],
  [{ v: 2, type: 'est:ready', nonce: N }, null],
  [{ v: 1, type: 'est:resize', nonce: N, w: 300, h: 200 }, /protocol version 2/],
  [{ v: 2, type: 'est:resize', nonce: N, w: 300, h: 200 }, /ui.resizable/],
  [{ v: 1, type: 'est:ready', nonce: 'x' }, /nonce/],
  [{ v: 1, type: 'est:hello', nonce: N }, /unknown type/],
  [{ v: 1, type: 'est:ready', nonce: N, extra: 1 }, /exactly the keys nonce, type, v/],
  [{ v: 1, type: 'est:param', nonce: N, id: 9, value: 0.2 }, /no parameter with id 9/],
  [{ v: 1, type: 'est:param', nonce: N, id: 3.5, value: 0.2 }, /id is not an integer/],
  [{ v: 1, type: 'est:param', nonce: N, id: 3, value: 5 }, /outside Mix's range 0…1/],
  [{ v: 1, type: 'est:param', nonce: N, id: 3, value: Number.NaN }, /not a finite number/],
  [{ v: 1, type: 'est:gesture', nonce: N, id: 3, phase: 'middle' }, /phase/],
  [{ v: 1, type: 'est:param', nonce: N, id: 3, value: 'x'.repeat(70_000) }, /larger than 64 KiB/],
];

describe('the dev host watching a custom UI', () => {
  it('gives a reason exactly when Cyber refuses a message', () => {
    for (const [m, why] of CASES) {
      const got = explainFrameMessage(m, N, P);
      expect(got === null, JSON.stringify(m).slice(0, 80)).toBe(checkFrameMessage(m, N, P) !== null);
      if (why) expect(got).toMatch(why);
      else expect(got).toBeNull();
    }
  });

  it('reads the nonce from the frame\'s address', () => {
    expect(frameNonce('http://x/est/b/h/ui/index.html#n=abc&p=http%3A%2F%2Fy')).toBe('abc');
    expect(frameNonce('http://x/')).toBe('');
  });

  it('logs the load, est:ready and the refusals of its own frame only', () => {
    const host = document.createElement('div');
    const frame = document.createElement('iframe');
    frame.src = `about:blank#n=${N}&p=x`;
    host.append(frame);
    document.body.append(host);
    const lines: Record<string, unknown>[] = [];
    const stop = watchFrame(host, () => P, e => lines.push(e));
    frame.dispatchEvent(new Event('load'));
    const send = (data: unknown, source: unknown = frame.contentWindow, origin = 'null') => window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }));
    send({ v: 1, type: 'est:ready', nonce: N });
    send({ v: 1, type: 'est:param', nonce: N, id: 3, value: 7 });
    send({ v: 1, type: 'est:ready', nonce: N }, window); // another window's: not counted
    send({ v: 1, type: 'est:ready', nonce: N }, frame.contentWindow, 'http://evil.example');
    stop();
    send({ v: 1, type: 'est:ready', nonce: 'x' });
    expect(lines.map(l => `${String(l.event)}${l.reason ? `:${String(l.reason).slice(0, 20)}` : ''}`)).toEqual([
      'load', 'init:load', 'ready', 'init:ready', 'rejected:value 7 is outside M', 'rejected:from origin http://e',
    ]);
    expect(lines.every(l => l.type === 'ui')).toBe(true);
    expect(lines.filter(l => l.event === 'rejected').map(l => l.count)).toEqual([1, 2]);
    host.remove();
  });
});
