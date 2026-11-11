// The plugin's window as an app (`est new … --app`): this Vite config builds ui-app/ into ui/, the
// page est.json's "ui" names, in the one shape a plugin's sandboxed frame loads (sdk/docs/ui.md,
// "A whole app as the window"):
//
// - one classic script: the app is one `iife` bundle (no code splitting), and the page's module
//   script tag becomes `<script defer src="assets/app.js">` with no `crossorigin` and no
//   `modulepreload` (the frame's origin is opaque, so those are CORS requests nobody answers:
//   `EST-U005`);
// - relative URLs only (`base: './'`) and no public folder;
// - the engine swap: the app imports `./engine` (a stand-in for a plain browser, `npm run dev:ui`);
//   the build resolves it to `./bridge.ts`, the same shape over `EstUI.connect()`;
// - fonts travel in the script: `import data from './fonts/x.woff2?base64'` gives the file as base64
//   for `registerFonts` (fonts.ts), and the build drops `@font-face` rules and font files from ui/;
// - nothing names another host: URLs at the start of a string in the built script or styles
//   (React's error links, a CSS banner) are cut out, with a warning, so `EST-U002` passes. XML
//   namespace names stay.
//
// Run from the plugin's folder: `npm run build:ui` (or `<cyber>/node_modules/.bin/vite build
// --config ui-app/vite.config.ts` with the Vite of a Cyber clone). Only type imports from 'vite', so
// any Vite 8 runs it.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, UserConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/** In the build, `./engine` (the stand-in) is `./bridge.ts` (the host). */
function engineSwap(): Plugin {
  return {
    name: 'est-engine-swap',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !/^\.\/engine(\.ts)?$/.test(source)) return null;
      return dirname(importer.split('?')[0]!) === here ? resolve(here, 'bridge.ts') : null;
    },
  };
}

/** `import data from './x.woff2?base64'`: the file's bytes as a base64 string, fetched by nothing. */
function base64Import(): Plugin {
  return {
    name: 'est-base64',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('?base64')) return null;
      const file = id.slice(0, -'?base64'.length);
      this.addWatchFile(file);
      return `export default ${JSON.stringify(readFileSync(file).toString('base64'))};`;
    },
  };
}

/** The module script tag Vite writes, made classic: `defer`, no `type="module"`, no `crossorigin`, no `modulepreload`. */
function classicPage(html: string): string {
  return html
    .replace(/<link\b[^>]*\brel\s*=\s*["']?modulepreload\b[^>]*>\s*/gi, '')
    .replace(/<script\b([^>]*)>/gi, (tag, attrs: string) => {
      if (!/\btype\s*=\s*["']?module\b/i.test(attrs)) return tag;
      const rest = attrs.replace(/\s+type\s*=\s*(?:"module"|'module'|module)/i, '');
      return `<script defer${/\bdefer\b/i.test(rest) ? rest.replace(/\s+defer\b/i, '') : rest}>`;
    })
    .replace(/\s+crossorigin(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=[\s/>])/gi, '');
}

function classicScript(): Plugin {
  return { name: 'est-classic-script', apply: 'build', transformIndexHtml: { order: 'post', handler: classicPage } };
}

/** Identifiers that look like URLs but load nothing (the validator lets them be). */
const NAMESPACES = new Set([
  'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace', 'http://www.w3.org/2000/xmlns/', 'http://www.w3.org/1998/Math/MathML',
]);

/** Every URL to a host at the start of a string literal cut out; returns the text and what was cut. */
function stripHosts(text: string): { text: string; cut: string[] } {
  const cut: string[] = [];
  const out = text.replace(/(["'`])((?:https?:|wss?:)?\/\/[^"'`\s\\]+)/gi, (all, quote: string, url: string) => {
    if (NAMESPACES.has(url)) return all;
    cut.push(url);
    return quote;
  });
  return { text: out, cut };
}

/** The built files made frame-safe: hosts cut, `@font-face` rules and font files dropped (the fonts are in the script). */
function frameSafeOutput(): Plugin {
  return {
    name: 'est-frame-safe',
    apply: 'build',
    enforce: 'post', // after Vite's own CSS output
    generateBundle(_options, bundle) {
      for (const [name, file] of Object.entries(bundle)) {
        if (/\.(woff2?|ttf|otf)$/i.test(name)) { delete bundle[name]; continue; }
        if (file.type === 'chunk') {
          const r = stripHosts(file.code);
          file.code = r.text;
          for (const u of r.cut) this.warn(`cut the external URL ${u} from ${name} (a plugin UI reaches no other host: EST-U002)`);
        } else if (/\.css$/i.test(name)) {
          const css = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
          const r = stripHosts(css.replace(/@font-face\s*\{[^}]*\}/gi, '').replace(/\/\*[\s\S]*?\*\//g, ''));
          file.source = r.text;
          for (const u of r.cut) this.warn(`cut the external URL ${u} from ${name} (a plugin UI reaches no other host: EST-U002)`);
        }
      }
    },
  };
}

const config: UserConfig = {
  root: here,
  base: './',
  publicDir: false,
  plugins: [engineSwap(), base64Import(), classicScript(), frameSafeOutput()],
  build: {
    outDir: resolve(here, '../ui'),
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    target: 'es2020',
    rolldownOptions: {
      // One classic script. (On a Vite before 8, Rollup's: `inlineDynamicImports: true`.)
      output: { format: 'iife', codeSplitting: false, entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name][extname]' },
    },
  },
};
export default config;
