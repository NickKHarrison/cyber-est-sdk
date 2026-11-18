/**
 * The generated UI: every shown parameter (not hidden, not the plugin's bypass) as an `@cyber-est/ui`
 * knob, grouped by its module path, as Cyber's window groups them. The knobs read and write the
 * dev host's `ParamModel` (their `source`), so this is also `@cyber-est/ui` running outside a frame.
 */
import { useEffect, useRef } from 'react';
import type { EstParam } from '@/audio/est/EstNode';
import '../../packages/ui/src/index';
import type { EstKnob } from '../../packages/ui/src/controls';
import { FLAGS } from '../../packages/ui/src/protocol';
import type { ParamModel } from './model';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'est-knob': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { param?: string; unit?: string; scale?: string; label?: string; labels?: string };
    }
  }
}

export const shown = (params: readonly EstParam[]) => params.filter(p => !(p.flags & FLAGS.HIDDEN) && !(p.flags & FLAGS.BYPASS));

/**
 * 1.804: a parameter's labels (the plugin's value text, asked once as the instance boots) as the
 * `<est-knob labels>` attribute, or undefined: no labels, or one holds a comma (the attribute's
 * separator), where the number shows as before.
 */
export function knobLabels(p: Pick<EstParam, 'labels'>): string | undefined {
  if (!p.labels?.some(l => l) || p.labels.some(l => l.includes(','))) return undefined;
  return p.labels.join(',');
}

function groups(params: readonly EstParam[]) {
  const out: { module: string; params: EstParam[] }[] = [];
  for (const p of params) {
    const m = p.module.trim();
    const g = out.find(x => x.module === m);
    if (g) g.params.push(p); else out.push({ module: m, params: [p] });
  }
  return out;
}

function Knob({ model, p, unit }: { model: ParamModel; p: EstParam; unit: string }) {
  const ref = useRef<EstKnob | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.source = model;
    return () => { el.source = null; };
  }, [model]);
  // EST tidy (1.286, D-44): the knob follows the parameter's own scale (est.json's hint), as Cyber's generated knobs do.
  // 1.804: a stepped parameter's value text, as Cyber's generated knobs show it (the knob's `labels` attribute is comma-separated).
  const labels = knobLabels(p);
  return <est-knob ref={ref as unknown as React.Ref<HTMLElement>} param={String(p.id)} unit={unit} {...(labels ? { labels } : {})} data-testid={`knob-${p.id}`} />;
}

export function Generated({ model, params, units }: { model: ParamModel; params: readonly EstParam[]; units: Record<number, string> }) {
  const list = shown(params);
  if (!list.length) return <p className="dim">No parameters to show.</p>;
  return (
    <div className="generated" data-testid="generated-ui">
      {groups(list).map(g => (
        <fieldset key={g.module || '(none)'} className="group">
          <legend>{g.module || 'Parameters'}</legend>
          <div className="knobs">
            {g.params.map(p => <Knob key={p.id} model={model} p={p} unit={units[p.id] ?? ''} />)}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
