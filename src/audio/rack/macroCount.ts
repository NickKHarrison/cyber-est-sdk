/**
 * 1.600: Live 13's **32-macro racks**, for the Instrument Rack (`rackTypes.ts`) and the Audio
 * Effect Rack (`fxRackTypes.ts`) alike. Pure: how many macros a rack shows (Show macros + and −:
 * 1, 2, 4, 8, 16 or 32; absent: 8, every rack before 1.600), the macro banks of eight the card
 * pages through (A–D, so a card's width never changes), and how long a rack's macro list is kept.
 *
 * The list is never shorter than `MACROS_DEFAULT` (eight, as 1.356 and 1.543 saved) and holds every
 * shown macro; a hidden macro past the eighth is kept while it holds anything (a name, a value, a map,
 * an exclude mark, the chain selector), so it still plays as Live's does, and dropped once it is a
 * default macro again: showing 32 and going back to 8 leaves an untouched rack as it was.
 */

/** The shown count of every rack before 1.600 (and the list's least length). */
export const MACROS_DEFAULT = 8;
/** The most macros a rack holds. */
export const MACROS_MAX = 32;
/** One bank: the card's knobs at a time, a controller's eight knobs. */
export const MACRO_BANK = 8;
/** The counts Show macros + and − step through (Live 13's). */
export const MACRO_COUNTS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** A shown count from anything: the nearest allowed count at or above it (absent or not a number: 8). */
export function sanitiseMacroCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return MACROS_DEFAULT;
  return MACRO_COUNTS.find(c => c >= v) ?? MACROS_MAX;
}

/** Show macros + (`dir` 1) or − (`dir` −1): the next allowed count, kept within 1…32. */
export function stepMacroCount(count: number, dir: 1 | -1): number {
  const at = Math.max(0, MACRO_COUNTS.indexOf(sanitiseMacroCount(count)));
  return MACRO_COUNTS[Math.max(0, Math.min(MACRO_COUNTS.length - 1, at + dir))]!;
}

/** How many banks of eight `count` shown macros fill (at least one). */
export const macroBankCount = (count: number): number => Math.max(1, Math.ceil(sanitiseMacroCount(count) / MACRO_BANK));

/** A bank's letter (0 → A). */
export const macroBankLetter = (bank: number): string => String.fromCharCode(65 + bank);

/** The macro indices bank `bank` shows of `count` (a short rack's one bank holds only its macros). */
export function bankMacros(count: number, bank: number): number[] {
  const n = sanitiseMacroCount(count);
  const b = Math.max(0, Math.min(macroBankCount(n) - 1, Math.round(bank)));
  const from = b * MACRO_BANK;
  return Array.from({ length: Math.max(0, Math.min(MACRO_BANK, n - from)) }, (_, k) => from + k);
}

/** The bank a card shows, kept within the banks `count` fills (a count lowered past the bank). */
export const shownBank = (bank: number, count: number): number => Math.max(0, Math.min(macroBankCount(count) - 1, Math.round(bank)));

/** The bank that holds macro `i` (a card turning to a learnt or chosen macro). */
export const bankOfMacro = (i: number): number => Math.max(0, Math.floor(i / MACRO_BANK));

/**
 * The list's length: at least eight, every shown macro, and every hidden one up to the last that
 * holds anything (`used(i)`).
 */
export function macroListLength(count: number, used: (i: number) => boolean): number {
  let n = Math.max(MACROS_DEFAULT, sanitiseMacroCount(count));
  for (let i = MACROS_MAX - 1; i >= n; i--) if (used(i)) { n = i + 1; break; }
  return n;
}

/** A macro index in a slot key or a path: 0…31 written without leading zeros. */
export const MACRO_INDEX_RE = '([0-9]|[12][0-9]|3[01])';
