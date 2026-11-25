/**
 * 1.902 (the sandbox review, U-1): the key events the host makes for a key a plugin's window handed
 * back (`EstPluginFrame.tsx`' `playFrameKey`). They are marked here so the shortcut registry can tell
 * them from a person's own keys: a handed-back key **plays** (the computer and pad keys' notes, Space's
 * transport, Escape closing what is open) and runs no other command. Before, a plugin's script posting
 * `0` made the selected clips inactive and active again (a song write each), and any bare key a person
 * had bound ran its command. Light: a WeakSet, no imports.
 */
const made = new WeakSet<object>();

/** Mark `e` as made for a plugin window's handed-back key. */
export function markFrameKey(e: Event): void { made.add(e); }

/** Whether `e` was made for a plugin window's handed-back key. */
export const isFrameKey = (e: unknown): boolean => typeof e === 'object' && e !== null && made.has(e);

/** The commands a handed-back key may run: the transport's (Space, Shift+Space). */
export const FRAME_KEY_COMMANDS: ReadonlySet<string> = new Set(['app.play', 'seq.continue', 'editor.stop']);
