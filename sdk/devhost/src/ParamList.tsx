/** Every parameter the instance reports, with its range, default, flags and a value to type. */
import { useState } from 'react';
import type { EstParam } from '@/audio/est/EstNode';
import { FLAGS } from '../../packages/ui/src/protocol';
import { formatValue } from '../../packages/ui/src/format';
import type { ParamModel } from './model';

const FLAG_NAMES: [number, string][] = [[FLAGS.STEPPED, 'stepped'], [FLAGS.PERIODIC, 'periodic'], [FLAGS.HIDDEN, 'hidden'], [FLAGS.READONLY, 'read-only'], [FLAGS.BYPASS, 'bypass'], [FLAGS.AUTOMATABLE, 'automatable']];
export const flagNames = (flags: number) => FLAG_NAMES.filter(([f]) => flags & f).map(([, n]) => n).join(', ') || 'none';

function ValueField({ model, p, disabled }: { model: ParamModel; p: EstParam; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    if (Number.isFinite(v)) model.apply(p.id, v, 'list');
    setDraft(null);
  };
  return (
    <input
      type="number" className="num" aria-label={`${p.name} value`} data-testid={`param-${p.id}`}
      min={p.min} max={p.max} step={p.flags & FLAGS.STEPPED ? 1 : 'any'} disabled={disabled || !!(p.flags & FLAGS.READONLY)}
      value={draft ?? String(Math.round(p.value * 10000) / 10000)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(null); }}
    />
  );
}

export function ParamList({ model, params, units, disabled }: { model: ParamModel; params: readonly EstParam[]; units: Record<number, string>; disabled: boolean }) {
  return (
    <section aria-labelledby="h-params" className="card wide">
      <h2 id="h-params">Parameters</h2>
      {params.length === 0 ? <p className="dim">None yet.</p> : (
        <div className="scroll">
          <table className="params" data-testid="param-list">
            <thead>
              <tr><th scope="col">Id</th><th scope="col">Name</th><th scope="col">Module</th><th scope="col">Range</th><th scope="col">Default</th><th scope="col">Flags</th><th scope="col">Value</th><th scope="col">Shown as</th></tr>
            </thead>
            <tbody>
              {params.map(p => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.name}</td>
                  <td>{p.module || '—'}</td>
                  <td>{p.min} to {p.max}{p.scale === 'log' ? ' (log)' : ''}</td>
                  <td>{p.def}</td>
                  <td>{flagNames(p.flags)}</td>
                  <td><ValueField model={model} p={p} disabled={disabled} /></td>
                  <td>{formatValue(p, p.value, units[p.id] ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
