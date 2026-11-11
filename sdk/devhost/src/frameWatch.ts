/**
 * The custom UI, seen from outside its frame (`est dev`'s event log and `--json`'s `ui` lines).
 * Cyber's own `EstPluginFrame` runs the frame unchanged; this only watches it: the frame's load
 * (and the `est:init` the frame component sends then), each `est:ready` (and the `est:init` it
 * answers with), and every message the frame component refuses, with the reason, by the same
 * checks (`checkFrameMessage`, `rateGate`). The frame's console, uncaught errors and failed loads
 * are visible only to the browser driver: headless.mjs reports those.
 */
import type { EstParam } from '@/audio/est/EstNode';
import { AUDIO_FFT_SIZES, AUDIO_PER_SECOND, checkFrameMessage, checkKeyMessage, FRAME_KEYS, FRAME_TYPES, MAX_MESSAGE_BYTES, MAX_PER_SECOND, messageSize, rateGate, UI_SIZE_BOUNDS } from '@/components/est/estFrameProtocol';

/**
 * Why `checkFrameMessage` refuses `raw` (null when it takes it). The sender is already checked.
 * `resizable`: the manifest's `ui.resizable` (protocol 2's `est:resize` is refused without it).
 */
export function explainFrameMessage(raw: unknown, nonce: string, params: readonly EstParam[], resizable = false, audio = false): string | null {
  if (checkFrameMessage(raw, nonce, params, resizable, audio)) return null;
  // 1.346: a key the host's frame guard hands back (never the plugin's own message).
  if (checkKeyMessage(raw, nonce)) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not an object';
  if (messageSize(raw) > MAX_MESSAGE_BYTES) return `larger than ${MAX_MESSAGE_BYTES / 1024} KiB as JSON`;
  const m = raw as Record<string, unknown>;
  if (m.v !== 1 && m.v !== 2 && m.v !== 3) return 'v is not 1, 2 or 3 (the protocol versions Cyber takes)';
  if (typeof m.nonce !== 'string' || m.nonce !== nonce) return 'the nonce is not the one in the frame\'s URL fragment (#n=…)';
  const types = FRAME_TYPES[m.v as 1 | 2 | 3] as readonly string[];
  if (typeof m.type !== 'string' || !types.includes(m.type)) {
    if (m.type === 'est:resize') return 'est:resize is protocol version 2: send it with v: 2';
    if (m.type === 'est:audio') return 'est:audio is protocol version 3 (EST 1.1): send it with v: 3';
    return `unknown type ${JSON.stringify(m.type)} (a frame sends ${types.join(', ')})`;
  }
  const want = [...FRAME_KEYS[m.type as keyof typeof FRAME_KEYS]].sort();
  const have = Object.keys(m).sort();
  if (have.join(',') !== want.join(',')) return `${String(m.type)} has exactly the keys ${want.join(', ')} (it has ${have.join(', ')})`;
  if (m.type === 'est:resize') {
    if (!resizable) return 'est:resize is taken only when est.json\'s ui.resizable is true';
    return `w and h are whole pixels within ${UI_SIZE_BOUNDS.w.join('…')} by ${UI_SIZE_BOUNDS.h.join('…')}`;
  }
  if (m.type === 'est:audio') {
    if (!audio) return 'est:audio is answered only when est.json\'s ui.audio is true (an EST 1.1 bundle)';
    return `fftSize is one of ${AUDIO_FFT_SIZES.join(', ')} and rate a whole number from 0 (stop) to ${AUDIO_PER_SECOND}`;
  }
  if (typeof m.id !== 'number' || !Number.isInteger(m.id)) return 'id is not an integer';
  const p = params.find(x => x.id === m.id);
  if (!p) return `no parameter with id ${m.id}`;
  if (m.type === 'est:gesture') return 'phase is not "begin" or "end"';
  if (typeof m.value !== 'number' || !Number.isFinite(m.value)) return 'value is not a finite number';
  return `value ${m.value} is outside ${p.name}'s range ${p.min}…${p.max} (values are in the parameter's own units, as est:init gives them)`;
}

/** The nonce in a frame's address (`#n=…&p=…`, `frameSrc`). */
export function frameNonce(src: string): string {
  const hash = src.split('#')[1] ?? '';
  return new URLSearchParams(hash).get('n') ?? '';
}

/** Refusals logged one by one, then one line in every this many (a flood stays readable). */
const LOG_EVERY = 100;
const LOG_FIRST = 20;

/**
 * Watch the frame inside `host` (the element around Cyber's `EstPluginFrame`). Listeners added
 * after the frame component's own run after them, so `init` is logged once it has been sent.
 */
export function watchFrame(host: HTMLElement, params: () => readonly EstParam[], log: (e: { type: string; [k: string]: unknown }) => void, resizable = false, audio = false): () => void {
  const frame = host.querySelector('iframe');
  if (!frame) return () => {};
  const nonce = frameNonce(frame.src);
  const gate = rateGate(MAX_PER_SECOND);
  let rejected = 0;
  // 1.413: the frame is the plugin origin's frame wrapper (`/est/frame/…`); the page it frames is logged.
  const url = frame.src.split('#')[0]!.replace('/est/frame/', '/est/');
  let origin = 'null';
  try { origin = new URL(frame.src).origin; } catch { /* not a URL: "null" */ }
  const onLoad = () => {
    log({ type: 'ui', event: 'load', url });
    log({ type: 'ui', event: 'init', params: params().length, reason: 'load' });
  };
  const refuse = (reason: string, data: unknown) => {
    rejected++;
    if (rejected <= LOG_FIRST || rejected % LOG_EVERY === 0) {
      let message: string;
      try { message = JSON.stringify(data)?.slice(0, 200) ?? String(data); } catch { message = String(data); }
      log({ type: 'ui', event: 'rejected', count: rejected, reason, message });
    }
  };
  const onMessage = (e: MessageEvent) => {
    if (!frame.contentWindow || e.source !== frame.contentWindow) return;
    if (e.origin !== origin) { refuse(`from origin ${e.origin}, not the plugin origin's frame wrapper ${origin}`, e.data); return; }
    if (!gate()) { refuse(`more than ${MAX_PER_SECOND} messages in a second`, e.data); return; }
    const why = explainFrameMessage(e.data, nonce, params(), resizable, audio);
    if (why) { refuse(why, e.data); return; }
    const d = e.data as { type?: string; v?: number; w?: number; h?: number };
    if (d.type === 'est:resize') log({ type: 'ui', event: 'resize', w: d.w, h: d.h });
    if (d.type === 'est:ready') {
      log({ type: 'ui', event: 'ready', protocol: d.v });
      log({ type: 'ui', event: 'init', params: params().length, reason: 'ready' });
    }
  };
  frame.addEventListener('load', onLoad);
  window.addEventListener('message', onMessage);
  return () => {
    frame.removeEventListener('load', onLoad);
    window.removeEventListener('message', onMessage);
  };
}
