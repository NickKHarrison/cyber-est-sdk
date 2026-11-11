/**
 * `@cyber-est/ui`: the library for an EST plugin's own UI (docs: sdk/docs/ui.md).
 *
 *   const est = connect();                 // the handshake: est:ready, then est:init
 *   bind(document.querySelector('#gain')!, 0);
 *   // or in HTML: <est-knob param="0" unit="dB"></est-knob>
 *
 * It speaks the EST UI frame protocol, version 2 (and version 1 to an older host), exactly as Cyber's host checks it
 * (src/components/est/estFrameProtocol.ts). Nothing here loads anything from outside the bundle.
 */
import { defineElements } from './controls';

export { connect, currentConnection, whenConnected } from './connect';
export type { Connection, ConnectOptions, ParamSource, ParamListener, ChangeSource, Transport } from './connect';
export { bind } from './bind';
export type { BindOptions } from './bind';
export { EstKnob, EstSlider, defineElements } from './controls';
export { formatValue, formatNumber, toNorm, fromNorm } from './format';
export type { Scale } from './format';
export {
  EST_UI_PROTOCOL, FLAGS, MAX_MESSAGE_BYTES, HOST_MAX_PER_SECOND, SEND_PER_SECOND, MAX_METER, UI_SIZE_BOUNDS,
  checkHostMessage, clampValue, clampSize, readFragment, paramMessage, gestureMessage, readyMessage, resizeMessage,
  AUDIO_FFT_SIZES, AUDIO_PER_SECOND, SPECTRUM_FLOOR_DB, audioMessage,
} from './protocol';
export type { EstUiParam, EstUiMeter, EstUiSpectrum, EstUiTheme, EstUiVersion, HostMessage, FrameMessage } from './protocol';

defineElements();
