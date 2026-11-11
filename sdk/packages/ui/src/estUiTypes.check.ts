/**
 * Type-only: `est-ui.d.ts` (the types `est new` copies into a plugin's folder) describes what
 * `est-ui.js` really puts on `window.EstUI`. `npm run typecheck` fails when they drift. Nothing
 * imports this file, so no build carries it.
 */
import type { EstUIApi } from '../est-ui';
import type { EstUIGlobal } from './global';

type Assignable<T, U extends T> = U;
export type EstUiTypesAgree = Assignable<EstUIApi, EstUIGlobal>;
