// The one rule for invisible text (the sandbox attack order, 2026-11: streams B, D and E each found a
// narrower copy of it). A code point that draws nothing or changes the direction text is drawn in, so a
// name can carry hidden text or read as another name: the soft hyphen, the Arabic letter mark, the
// Mongolian vowel separator, the zero-width characters and direction marks, the line and paragraph
// separators, the bidirectional embeddings, overrides and isolates, the word joiner and invisible
// operators, the deprecated format characters, the BOM, and the Tags block (an invisible ASCII string).
// est.json's EST-M018 (src/audio/est/install/bundle.ts), the publish route's display rule
// (shared/estCommunity.mjs) and the public pages' names (listen links, reviews, reports) all read it.
// Pure: no DOM, no Node, no store. In the SDK's export (scripts/sdk-export.mjs' ALLOW).

/** The rule as a character-class body, for a `u`-flag RegExp that adds its own ranges (controls). */
export const HIDDEN_TEXT_CLASS = '\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\ufeff\\u{e0000}-\\u{e007f}';

/** Whether text holds an invisible or direction character. Not global: safe to `.test()` again and again. */
export const HIDDEN_TEXT_RE = new RegExp(`[${HIDDEN_TEXT_CLASS}]`, 'u');

/**
 * Order P (stream P4, P4-1): the rule plus the blank letters and marks drawn as nothing (U+034F the
 * combining grapheme joiner, the Hangul fillers U+115F, U+1160, U+3164, U+FFA0, Khmer's inherent vowels
 * U+17B4, U+17B5), which passed as letters: "Cyber\u3164Official" was drawn as "Cyber Official". For
 * names and text people publish (shared/estCommunity.mjs, shared/storeProfile.mjs); est.json's EST-M018
 * keeps `HIDDEN_TEXT_RE`.
 */
export const HIDDEN_OR_BLANK_RE = new RegExp(`[${HIDDEN_TEXT_CLASS}\\u115f\\u1160\\u3164\\uffa0]|\\u034f|\\u17b4|\\u17b5`, 'u'); // the combining marks apart: never in a class

/** Whether a code point is an invisible or direction character. @param {number} c */
export function isHiddenCodePoint(c) {
  return (
    c === 0x00ad || c === 0x061c || c === 0x180e
    || (c >= 0x200b && c <= 0x200f)
    || (c >= 0x2028 && c <= 0x202e)
    || (c >= 0x2060 && c <= 0x2064)
    || (c >= 0x2066 && c <= 0x206f)
    || c === 0xfeff
    || (c >= 0xe0000 && c <= 0xe007f)
  );
}

/** Whether `s` holds an invisible or direction character. @param {unknown} s */
export const hasHiddenText = (s) => typeof s === 'string' && HIDDEN_TEXT_RE.test(s);
