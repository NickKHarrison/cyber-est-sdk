/**
 * EST Phase 3 (1.283, stream 3-A): the song's position as a CLAP `TRANSPORT` event, for EST
 * instances (instruments and inserts alike: `transportBus.ts`). Pure. Every number comes from the
 * tempo map (`tempoMap.ts`: the tempo at a beat and at the end of the scheduler's window, so a ramp
 * is a `tempo_inc`, never the song's `tempo` field) and the meter map (`meterMap.ts`: the bar a
 * position falls in, the signature there). Beats are the song's (quarter notes), seconds the song's
 * from its first beat.
 */
import { bpmAt, secondsAt, secondsBetween, tempoBreaks, type Tempo } from './tempoMap';
import { barIndexAt, barStartAt, meterAt, type Meter } from './meterMap';
import type { EstTransportEvent } from '../audio/est/transportBus';

export interface EstTransportWindow {
  /** The window's first beat, its end, and the context time (s) its first beat sounds. */
  beat: number;
  toBeat: number;
  when: number;
  /** The window's length (s). */
  duration: number;
  playing: boolean;
  /** The loop brace while it is on, in beats. */
  loop: { start: number; end: number } | null;
}

/** The transport at a window's start: the tempo there and at its end (`until` its length), the bar, the loop. */
export function estTransportAt(clock: Tempo, meter: Meter, w: EstTransportWindow): EstTransportEvent {
  const beat = w.beat;
  const tempo = bpmAt(clock, Math.max(0, beat));
  const tempoEnd = w.duration > 0 && w.toBeat > beat ? bpmAt(clock, Math.max(0, w.toBeat)) : tempo;
  const sig = meterAt(meter, Math.max(0, beat));
  const b = Math.max(0, beat);
  const e: EstTransportEvent = {
    type: 'transport', time: Math.max(0, w.when), tempo, beat, playing: w.playing, num: sig.num, den: sig.den,
    // (A count-in's negative beats: seconds before the first beat, through the clock as every other.)
    seconds: beat >= 0 ? secondsAt(clock, beat) : -secondsBetween(clock, beat, 0),
    barStart: barStartAt(meter, b), barNumber: barIndexAt(meter, b),
  };
  if (Math.abs(tempoEnd - tempo) > 1e-9) { e.tempoEnd = tempoEnd; e.until = w.duration; }
  if (w.loop && w.loop.end > w.loop.start) {
    e.loopStart = w.loop.start;
    e.loopEnd = w.loop.end;
    e.loopStartSeconds = secondsAt(clock, w.loop.start);
    e.loopEndSeconds = secondsAt(clock, w.loop.end);
  }
  return e;
}

/**
 * An offline render's transport events (export, bounce, freeze): one at its start and one at each
 * tempo break up to its end (a step, or every `rampStep` beats inside a ramp, each carrying its
 * ramp to the next), at render seconds `time(beat)`. The render plays once, so no loop.
 */
export function estRenderTransport(clock: Tempo, meter: Meter, r0: number, r1: number, time: (beat: number) => number, rampStep = 1): EstTransportEvent[] {
  const edges = [r0, ...tempoBreaks(clock, r0, r1, rampStep).filter(b => b > r0 + 1e-9 && b < r1 - 1e-9), r1];
  const out: EstTransportEvent[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i]!, b = edges[i + 1]!;
    const when = time(a);
    out.push(estTransportAt(clock, meter, { beat: a, toBeat: b, when, duration: Math.max(0, time(b) - when), playing: true, loop: null }));
  }
  return out;
}
