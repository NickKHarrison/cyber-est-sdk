/**
 * An instrument's keyboard: two octaves on screen (pointer events: mouse, touch and pen), the
 * computer keys (A to K and the row above, Z and X for the octave; not while typing or on a
 * control) and Web MIDI once allowed. Every note goes through Cyber's `EstNoteMap` (engine.ts).
 */
import { useEffect, useRef, useState } from 'react';
import type { DevEngine, DevLog } from './engine';
import { isBlack, keepsKeys, midiAction, noteForKey, noteName, octaveForKey } from './keys';

export function Keyboard({ engine, disabled, log }: { engine: React.RefObject<DevEngine | null>; disabled: boolean; log: (e: DevLog) => void }) {
  const [octave, setOctave] = useState(4);
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const [midi, setMidi] = useState('');
  const octaveRef = useRef(octave);
  octaveRef.current = octave;
  const heldKeys = useRef(new Map<string, number>());

  const on = (n: number, src: 'keys' | 'screen' | 'midi', velocity = 100) => {
    if (disabled) return;
    engine.current?.noteOn(n, velocity, src);
    setHeld(h => new Set(h).add(n));
  };
  const off = (n: number, src: 'keys' | 'screen' | 'midi') => {
    engine.current?.noteOff(n, src);
    setHeld(h => { const x = new Set(h); x.delete(n); return x; });
  };
  const onRef = useRef(on);
  const offRef = useRef(off);
  onRef.current = on;
  offRef.current = off;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || keepsKeys(e.target)) return;
      const o = octaveForKey(e.code, octaveRef.current);
      if (o !== null) { setOctave(o); e.preventDefault(); return; }
      const n = noteForKey(e.code, octaveRef.current);
      if (n === null || heldKeys.current.has(e.code)) return;
      e.preventDefault();
      heldKeys.current.set(e.code, n);
      onRef.current(n, 'keys');
    };
    const up = (e: KeyboardEvent) => {
      const n = heldKeys.current.get(e.code);
      if (n === undefined) return;
      heldKeys.current.delete(e.code);
      offRef.current(n, 'keys');
    };
    const blur = () => { for (const [code, n] of heldKeys.current) { heldKeys.current.delete(code); offRef.current(n, 'keys'); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  const enableMidi = async () => {
    if (!('requestMIDIAccess' in navigator)) { setMidi('This browser has no Web MIDI.'); return; }
    try {
      const access = await navigator.requestMIDIAccess();
      const attach = () => {
        let n = 0;
        access.inputs.forEach(input => {
          n++;
          input.onmidimessage = (m: MIDIMessageEvent) => {
            const a = m.data ? midiAction(m.data) : null;
            if (!a) return;
            if (a.type === 'on') onRef.current(a.key, 'midi', a.velocity);
            else if (a.type === 'off') offRef.current(a.key, 'midi');
            else if (a.type === 'bend') engine.current?.control({ pitchBend: a.value });
            else if (a.type === 'cc') engine.current?.control(a.num === 1 ? { modWheel: a.value / 127 } : a.num === 64 ? { sustain: a.value >= 64 } : { cc: { num: a.num, value: a.value } });
          };
        });
        setMidi(n ? `MIDI: ${n} input${n === 1 ? '' : 's'}` : 'MIDI: no inputs connected');
      };
      access.onstatechange = attach;
      attach();
      log({ type: 'midi', inputs: access.inputs.size });
    } catch (err) {
      setMidi(`MIDI was not allowed (${err instanceof Error ? err.message : String(err)})`);
    }
  };

  const first = 12 * (octave + 1);
  const notes = Array.from({ length: 25 }, (_, i) => first + i).filter(n => n <= 127);
  return (
    <section aria-labelledby="h-keys" className="card wide">
      <h2 id="h-keys">Keyboard</h2>
      <div className="row">
        <button type="button" onClick={() => setOctave(o => Math.max(-1, o - 1))} disabled={octave <= -1}>Octave down</button>
        <span>Octave {octave} (Z and X)</span>
        <button type="button" onClick={() => setOctave(o => Math.min(8, o + 1))} disabled={octave >= 8}>Octave up</button>
        <button type="button" onClick={() => engine.current?.allNotesOff()} disabled={disabled}>All notes off</button>
        <button type="button" onClick={() => void enableMidi()}>Use MIDI</button>
        <span role="status">{midi}</span>
      </div>
      <div className="piano" role="group" aria-label="Keyboard: the computer keys A to K play it too">
        {notes.map(n => (
          <button
            key={n}
            type="button"
            className={`pkey ${isBlack(n) ? 'black' : 'white'}`}
            aria-label={noteName(n)}
            aria-pressed={held.has(n)}
            disabled={disabled}
            data-note={n}
            onPointerDown={e => { if (e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); on(n, 'screen'); } }}
            onPointerUp={() => held.has(n) && off(n, 'screen')}
            onPointerCancel={() => held.has(n) && off(n, 'screen')}
            onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); on(n, 'screen'); } }}
            onKeyUp={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); off(n, 'screen'); } }}
          >
            <span aria-hidden="true">{n % 12 === 0 ? noteName(n) : ''}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
