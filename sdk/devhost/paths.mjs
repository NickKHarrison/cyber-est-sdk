import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The dev host's folder and the repository's root (D-37: the SDK lives in the repository). */
export const DEVHOST = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(DEVHOST, '..', '..');
