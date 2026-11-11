// Fonts travel in the script (sdk/docs/ui.md, "Fonts travel in the script"): the sandboxed frame
// cannot fetch a font file (its origin is opaque) and the plugin origin's policy refuses a `data:`
// font, so each font is imported as base64 and registered from its bytes, which fetches nothing.
//
//   import interRegular from './fonts/inter-latin-400.woff2?base64';
//   void registerFonts([{ family: 'Inter', data: interRegular, weight: '400' }]);
//
// then use `font-family: Inter` in style.css. The build drops any `@font-face` rule and font file
// (vite.config.ts), so a font is never loaded twice. A Latin subset keeps the script small.

export interface EmbeddedFont {
  family: string;
  /** The font file's bytes, base64 (an import with `?base64`). */
  data: string;
  weight?: string;
  style?: string;
}

/** Register each font from its bytes; resolves when all are ready (a font that fails is left out). */
export async function registerFonts(fonts: readonly EmbeddedFont[]): Promise<void> {
  if (typeof FontFace === 'undefined') return;
  await Promise.all(fonts.map(async f => {
    const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
    const face = new FontFace(f.family, bytes, { weight: f.weight ?? '400', style: f.style ?? 'normal' });
    try {
      await face.load();
      document.fonts.add(face);
    } catch {
      // A damaged font: the page keeps its fallback.
    }
  }));
}
