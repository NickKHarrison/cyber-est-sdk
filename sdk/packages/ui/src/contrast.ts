/**
 * Colour contrast for the window kit (WCAG 2 relative luminance). Pure: no DOM.
 *
 * A plugin's window picks its own colours; the kit keeps text readable whatever they are:
 * `ensureContrast(fg, bg)` hands back `fg` when it already reaches 4.5:1 on `bg`, else the nearest
 * colour along the line to white or black that does. `onColour(bg)` is the ink for text drawn on a
 * filled colour (the accent): near-white or near-black, whichever reads better.
 */

export type Rgb = [number, number, number];

/** The least contrast the kit leaves text at. */
export const MIN_CONTRAST = 4.5;

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)` or `rgb(r g b / a)` as 0…255 channels; null for anything else. */
export function parseColour(s: string): Rgb | null {
  const t = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1]!;
    if (h.length === 3 || h.length === 4) return [0, 1, 2].map(i => parseInt(h[i]! + h[i]!, 16)) as Rgb;
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb;
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
  if (!m) return null;
  const c = [Number(m[1]), Number(m[2]), Number(m[3])];
  return c.every(x => Number.isFinite(x)) ? (c.map(x => Math.min(255, Math.max(0, x))) as Rgb) : null;
}

export function toHex(c: Rgb): string {
  return `#${c.map(x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`;
}

export function luminance(c: Rgb): number {
  const f = (x: number) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** The contrast ratio of two colours, 1…21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * `fg` when it reads at `min`:1 or better on every colour of `bgs`; else `fg` moved toward white or
 * black (whichever gets there) just far enough. Always returns a colour that passes, since white or
 * black reaches 4.5:1 on any single background; with several backgrounds it returns the best it found.
 */
export function ensureContrast(fg: Rgb, bgs: Rgb | Rgb[], min = MIN_CONTRAST): Rgb {
  const list = (typeof bgs[0] === 'number' ? [bgs] : bgs) as Rgb[];
  const worst = (c: Rgb) => Math.min(...list.map(b => contrast(c, b)));
  // Channels are rounded as they will be written, so what passes here passes as drawn.
  const round = (c: Rgb): Rgb => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
  if (worst(round(fg)) >= min) return fg;
  let best = fg, bestRatio = worst(fg);
  for (const end of [[255, 255, 255], [0, 0, 0]] as Rgb[]) {
    if (worst(end) < bestRatio) continue;
    for (let i = 1; i <= 20; i++) {
      const c = round(mix(fg, end, i / 20));
      const r = worst(c);
      if (r >= min) {
        // The first step that passes toward this end; take it when no closer pass exists.
        if (bestRatio < min || i < 20) { best = c; bestRatio = r; }
        break;
      }
      if (r > bestRatio && bestRatio < min) { best = c; bestRatio = r; }
    }
    if (bestRatio >= min) break;
  }
  return best;
}

/** The ink for text on a filled colour: near-black or near-white, whichever contrasts more. */
export function onColour(bg: Rgb): Rgb {
  const dark: Rgb = [16, 16, 20], light: Rgb = [255, 255, 255];
  return contrast(dark, bg) >= contrast(light, bg) ? dark : light;
}
