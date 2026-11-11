/**
 * The classic-script build (`est-ui.js`): the library on `window.EstUI`. A plugin's page is in a
 * sandboxed frame with an opaque origin, where a module script would need CORS from the plugin
 * origin, so a bundle's UI loads this with a plain `<script src="est-ui.js">`. It carries what a
 * page uses; the message builders and checkers are in the module build (`index.ts`) only.
 */
import { bind } from './bind';
import { connect, currentConnection, whenConnected } from './connect';
import { defineElements, EstKnob, EstSlider } from './controls';
import { formatNumber, formatValue, fromNorm, toNorm } from './format';
import { EST_UI_PROTOCOL, FLAGS } from './protocol';

export const EstUI = { connect, currentConnection, whenConnected, bind, defineElements, EstKnob, EstSlider, formatValue, formatNumber, toNorm, fromNorm, FLAGS, EST_UI_PROTOCOL };

export type EstUIGlobal = typeof EstUI;

declare global {
  interface Window { EstUI: typeof EstUI }
}

defineElements();
window.EstUI = EstUI;
