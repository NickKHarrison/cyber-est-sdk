/** Value tapers and the text a control shows and announces. Pure. */
import { FLAGS, type EstUiParam } from './protocol';

export type Scale = 'linear' | 'log';

type Range = Pick<EstUiParam, 'min' | 'max' | 'flags'>;

const logOk = (p: Range) => p.min > 0 && p.max > p.min;

/** A value as 0…1 along the control (logarithmic when `scale` is 'log' and the range is positive). */
export function toNorm(p: Range, v: number, scale: Scale = 'linear'): number {
  if (p.max <= p.min) return 0;
  const x = Math.min(p.max, Math.max(p.min, v));
  if (scale === 'log' && logOk(p)) return Math.log(x / p.min) / Math.log(p.max / p.min);
  return (x - p.min) / (p.max - p.min);
}

/** 0…1 along the control as a value (whole for a stepped parameter). */
export function fromNorm(p: Range, u: number, scale: Scale = 'linear'): number {
  const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0));
  let v = scale === 'log' && logOk(p) ? p.min * Math.pow(p.max / p.min, t) : p.min + t * (p.max - p.min);
  if (p.flags & FLAGS.STEPPED) v = Math.round(v);
  return Math.min(p.max, Math.max(p.min, v));
}

const trim = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

/** A number as a control prints it: about three significant figures. */
export function formatNumber(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return trim(v.toFixed(1));
  return trim(v.toFixed(2));
}

/**
 * A value with its unit, as the control prints and announces it (`aria-valuetext`): Hz past 1000
 * as kHz, dB with a sign, a stepped value whole, `labels` for a stepped parameter's choices.
 */
export function formatValue(p: Range, v: number, unit = '', labels?: readonly string[]): string {
  if (p.flags & FLAGS.STEPPED) {
    const i = Math.round(v);
    const label = labels?.[i - Math.round(p.min)];
    if (label) return label;
    return unit ? `${i} ${unit}` : String(i);
  }
  const u = unit.trim();
  if (/^hz$/i.test(u) && Math.abs(v) >= 1000) return `${formatNumber(v / 1000)} kHz`;
  if (/^db$/i.test(u)) return `${v > 0 ? '+' : ''}${formatNumber(v)} dB`;
  if (u === '%') return `${formatNumber(v)} %`;
  return u ? `${formatNumber(v)} ${u}` : formatNumber(v);
}
