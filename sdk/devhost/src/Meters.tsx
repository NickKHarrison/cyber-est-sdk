/**
 * The output meters: peak and RMS per channel in dBFS, drawn every animation frame through refs
 * (no React state per frame), their ARIA values written at most twice a second.
 */
import { useEffect, useRef } from 'react';
import type { DevEngine } from './engine';

const FLOOR = -60;
const pct = (db: number) => `${Math.max(0, Math.min(100, ((Math.max(FLOOR, db) - FLOOR) / -FLOOR) * 100)).toFixed(1)}%`;
const text = (db: number) => (Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : '−∞');

const ROWS = [
  { key: 'peak-0', label: 'Left peak' },
  { key: 'peak-1', label: 'Right peak' },
  { key: 'rms-0', label: 'Left RMS' },
  { key: 'rms-1', label: 'Right RMS' },
] as const;

export function Meters({ engine, running }: { engine: React.RefObject<DevEngine | null>; running: boolean }) {
  const bars = useRef<Record<string, HTMLDivElement | null>>({});
  const outs = useRef<Record<string, HTMLSpanElement | null>>({});
  const meters = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastAria = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const m = engine.current?.est ? engine.current.meters() : null;
      if (!m) return;
      const now = performance.now();
      const aria = now - lastAria > 500;
      if (aria) lastAria = now;
      for (const r of ROWS) {
        const [kind, ch] = r.key.split('-') as ['peak' | 'rms', string];
        const db = m[kind][Number(ch)]!;
        const bar = bars.current[r.key];
        if (bar) bar.style.width = pct(db);
        const out = outs.current[r.key];
        if (out) out.textContent = text(db);
        const el = meters.current[r.key];
        if (aria && el) {
          el.setAttribute('aria-valuenow', String(Number.isFinite(db) ? Math.max(FLOOR, Math.round(db * 10) / 10) : FLOOR));
          el.setAttribute('aria-valuetext', text(db));
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, running]);

  return (
    <section aria-labelledby="h-meters" className="card">
      <h2 id="h-meters">Output</h2>
      <div className="meters">
        {ROWS.map(r => (
          <div key={r.key} className="meter-row">
            <span className="meter-label" id={`m-${r.key}`}>{r.label}</span>
            <div
              className="meter" role="meter" aria-labelledby={`m-${r.key}`} aria-valuemin={FLOOR} aria-valuemax={0} aria-valuenow={FLOOR}
              data-testid={`meter-${r.key}`} ref={el => { meters.current[r.key] = el; }}
            >
              <div className="meter-fill" ref={el => { bars.current[r.key] = el; }} />
            </div>
            <span className="meter-out" ref={el => { outs.current[r.key] = el; }}>−∞</span>
          </div>
        ))}
      </div>
    </section>
  );
}
