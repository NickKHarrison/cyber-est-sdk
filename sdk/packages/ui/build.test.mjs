import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildUi, staleUi } from './build.mjs';
import { EST_UI_FILE, EST_UI_PATH, referencesEstUi, withEstUi } from './copyRule.mjs';

const enc = (s) => new TextEncoder().encode(s);

describe('@cyber-est/ui build and its copy into a bundle', () => {
  it('dist/ is what the sources build (node sdk/packages/ui/build.mjs)', async () => {
    expect(await staleUi()).toEqual([]);
  });

  it('the classic script is small and self-contained', async () => {
    const { 'est-ui.js': text } = await buildUi();
    // The order's budget is "about 10 KB minified": recorded here so it cannot grow unseen (protocol 2, EST Phase 5a: about 16 KB; protocol 3, EST 1.1: about 17.4 KB).
    expect(Buffer.byteLength(text)).toBeLessThan(18_000);
    expect(text).not.toMatch(/\bimport\s*\(|\bimport\s+[\w{*]|\brequire\(|https?:\/\/(?!www\.w3\.org)/);
    expect(text).toContain('window.EstUI');
  });

  it('copies est-ui.js into ui/ when a page there loads it, and only then', () => {
    const lib = new Uint8Array(readFileSync(EST_UI_FILE));
    const named = { 'ui/index.html': enc('<script src="est-ui.js"></script><script src="ui.js"></script>'), 'module.wasm': new Uint8Array(8) };
    expect(referencesEstUi(named)).toBe(true);
    const r = withEstUi(named);
    expect(r.copied).toBe(true);
    expect(r.files[EST_UI_PATH]).toEqual(lib);
    // A stale copy in the sources is replaced by the SDK's build.
    expect(withEstUi({ ...named, [EST_UI_PATH]: enc('old') }).files[EST_UI_PATH]).toEqual(lib);
    for (const html of ['<script src="ui.js"></script>', '<script src="lib/est-ui.js"></script>', '<!-- est-ui.js -->']) {
      expect(withEstUi({ 'ui/index.html': enc(html) }).copied).toBe(false);
    }
    expect(referencesEstUi({ 'ui/sub/page.html': enc('<script src="est-ui.js"></script>') })).toBe(false);
    expect(referencesEstUi({ 'ui/index.html': enc("<script defer src='./est-ui.js'></script>") })).toBe(true);
  });
});
