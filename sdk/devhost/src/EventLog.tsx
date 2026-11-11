/** The event log: what the page did and what the instance said, newest last (the last 100 shown). */
import type { DevLog } from './engine';

export type LogLine = DevLog & { n: number; t: number };

const describe = (l: LogLine) => {
  const { n: _n, t: _t, type: _type, ...rest } = l;
  const s = JSON.stringify(rest);
  return s === '{}' ? '' : s;
};

export function EventLog({ lines }: { lines: readonly LogLine[] }) {
  const shown = lines.filter(l => l.type !== 'stats').slice(-100);
  const stats = [...lines].reverse().find(l => l.type === 'stats');
  return (
    <section aria-labelledby="h-log" className="card wide">
      <h2 id="h-log">Event log</h2>
      {stats && <p data-testid="stats">Processor: {String(stats.blocks)} blocks, {String(stats.meanUs)} µs mean, {String(stats.maxUs)} µs at most a block.</p>}
      <div className="log" role="log" aria-label="Events" data-testid="event-log" tabIndex={0}>
        <ol>
          {shown.map(l => (
            <li key={l.n} data-type={l.type}><span className="dim">{(l.t / 1000).toFixed(2)} s</span> <strong>{l.type}</strong> {describe(l)}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
