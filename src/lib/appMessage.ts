/**
 * A message for the app's footer from code that has no way to it (1.45: a menu that has closed,
 * Open in Editor and Send to DAW): App listens for these window events and shows the text as an
 * error or a notice.
 */
export const APP_ERROR_EVENT = 'cyber:error';
export const APP_NOTICE_EVENT = 'cyber:notice';

export function showAppError(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(APP_ERROR_EVENT, { detail: text }));
}

/** 1.622: a notice with one action (the headroom warning's Freeze): App shows the text and the button for it. */
export const APP_NOTICE_ACTION_EVENT = 'cyber:notice-action';
export interface AppNoticeAction { text: string; label: string; run: () => void; testId?: string }
export function showAppNoticeAction(a: AppNoticeAction): void {
  window.dispatchEvent(new CustomEvent<AppNoticeAction>(APP_NOTICE_ACTION_EVENT, { detail: a }));
}

export function showAppNotice(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(APP_NOTICE_EVENT, { detail: text }));
}

/** An error's message for the footer. */
export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
