// shared/estSharedPlugins.mjs — the contract of D-64 (Cyber_EST_Shared_Plugins_Work_Order.md §4,
// stream 0): your own EST plugins for everyone, travelling with the project. Pure: no DOM, no Node
// API, read by the server and the app alike. Each stream of the order builds on these names and
// numbers; one that needs a change here says so first.
//
// Words (§3.1):
// - an **own plugin** is a bundle the account added itself (`source: 'developer'`);
// - a **shared plugin** is a bundle this device holds because a project it opened names it
//   (`source: 'shared'`): in no library, counted against none of the person's limits, offered nowhere
//   but in the projects that name it.
//
// The two kill switches (§3.2, §3.7) are read on the server at each request by
// server/estSwitches.mjs' `ownPluginsOpen()` (EST_OWN_PLUGINS) and `sharedPluginsOpen()`
// (EST_SHARED_PLUGINS): both on unless exactly '0'.

/** §3.3: the largest `.est` the server stores as an upload (32 MB). */
export const SHARED_BUNDLE_MAX_BYTES = 32 * 1024 * 1024;

/** §3.3: the upload type of a stored bundle (content-addressed, counted in the owner's storage). */
export const EST_BUNDLE_UPLOAD_TYPE = 'application/x-est-bundle';

/** §3.4: a device holds at most this many shared bundles (least recently used first goes). */
export const SHARED_DEVICE_MAX_BUNDLES = 40;
/** §3.4: and at most this many bytes of them (400 MB). */
export const SHARED_DEVICE_MAX_BYTES = 400 * 1024 * 1024;

/** §3.1: the library record's source of a shared plugin. */
export const SHARED_SOURCE = 'shared';

/** §3.5: the window ticket's kind (`k`) for a shared plugin's UI. */
export const SHARED_TICKET_KIND = 'shared';

/** A bundle hash: 64 lowercase hex characters (SHA-256). */
export const BUNDLE_HASH_RE = /^[0-9a-f]{64}$/;
/** A project id, as server/workspace.mjs' `ID_RE`. */
export const PROJECT_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

/**
 * §3.4: GET the bytes of a bundle a project names, for whoever may read that project now.
 * @param {string} projectId @param {string} hash
 */
export const projectBundlePath = (projectId, hash) => `/workspace/projects/${projectId}/est-bundle/${hash}`;
/** §3.4: the route's pattern; groups: the project id, the hash. */
export const PROJECT_BUNDLE_RE = /^\/workspace\/projects\/([A-Za-z0-9_-]{8,32})\/est-bundle\/([0-9a-f]{64})$/;

/**
 * §3.5: POST a shared window's ticket, `{ projectId, hash }` → `{ ticket, url, expiresAt }` (as
 * /account/est-dev-ui's answer), for an account that may read a project naming the hash.
 */
export const SHARED_UI_TICKET_PATH = '/account/est-shared-ui';

/**
 * §3.5: the plugin origin's folder of a shared plugin's UI.
 * @param {string} hash
 */
export const sharedUiPath = (hash) => `/est/shared/${hash}/`;
/** §3.5: the plugin origin's shared UI files; groups: the hash, the path inside (may be empty). */
export const SHARED_UI_RE = /^\/est\/shared\/([0-9a-f]{64})\/(.*)$/;
/**
 * §3.5: the frame wrapper of a shared UI page (server/estFrameWrap.mjs' kind `shared`).
 * @param {string} hash @param {string} uiPath
 */
export const sharedFramePath = (hash, uiPath) => `/est/frame/shared/${hash}/${uiPath}`;

/**
 * §3.1: a shared plugin's record on a device (IndexedDB, beside the library's records, never in
 * them). The fields a stream may rely on:
 * @typedef {object} SharedBundleRecord
 * @property {'shared'} source
 * @property {string} hash        the bundle's SHA-256 (BUNDLE_HASH_RE)
 * @property {string} pluginId    the manifest's id
 * @property {string} version     the manifest's version
 * @property {string} name        the manifest's name (shown escaped, through shared/estHiddenText.mjs)
 * @property {'instrument' | 'effect'} kind
 * @property {number} sizeBytes   the bundle's size, at most SHARED_BUNDLE_MAX_BYTES
 * @property {string} projectId   the project it was first fetched for
 * @property {number} at          when it was fetched (ms)
 * @property {number} usedAt      when an instance last used it (ms; the LRU order)
 */

/**
 * §3.5: a shared window ticket's claims (signed as the developer UI tickets are).
 * @typedef {object} SharedTicketClaims
 * @property {'shared'} k
 * @property {string} h           the bundle hash
 * @property {string} a           the project owner's account tag (server/estDevUi.mjs' accountTagOf), charged for the cache
 * @property {number} exp         expiry (ms)
 */

/** @typedef {'switched-off' | 'not-named' | 'no-access' | 'blocked' | 'too-large' | 'hash-mismatch' | 'not-claimed' | 'lax-archive' | 'class-off' | 'signed-out' | 'own-off' | 'device-full'} SharedRefusalCode */

/** The words of each refusal, shown as they are (plain text). */
const WORDS = Object.freeze({
  'switched-off': 'Shared plugins are switched off for now. This plugin plays for the person who added it.',
  'not-named': 'This project does not use that plugin.',
  'no-access': 'You no longer have access to this project, so its plugin cannot be loaded.',
  blocked: 'This plugin has been blocked by Cyber and will not play.',
  'too-large': 'This plugin file is too large: a plugin may be at most 32 MB.',
  'hash-mismatch': 'This plugin file does not match the plugin the project names.',
  'not-claimed': 'Add this plugin to your account (Home → EST PLUGINS → Add a plugin) before saving it with a project.',
  'lax-archive': 'This plugin file is not a valid plugin bundle.',
  'class-off': 'Your class keeps plugins from outside the class off, so this plugin does not load here.',
  'signed-out': 'Sign in or try Cyber to hear this plugin.',
  'own-off': 'Adding your own plugins is switched off for now. Plugins you added keep playing.',
  'device-full': 'This device holds as many shared plugins as it can. Close a project that uses one and try again.',
});

/** The refusal codes, in a fixed order. */
export const SHARED_REFUSAL_CODES = Object.freeze(/** @type {SharedRefusalCode[]} */ (Object.keys(WORDS)));

/**
 * The words for a refusal code; an unknown code gets a general sentence.
 * @param {string} code
 */
export function sharedRefusal(code) {
  return Object.prototype.hasOwnProperty.call(WORDS, code) ? WORDS[/** @type {SharedRefusalCode} */ (code)] : 'This plugin could not be loaded.';
}

/** §3.5: the shield over an untouched shared window. */
export const SHARED_SHIELD_WORDS = 'Press to use · shared plugin, not reviewed by Cyber';
/** §3.7: the label on a shared plugin's chip, card and window strip. */
export const SHARED_LABEL = 'Shared plugin, not reviewed by Cyber';
