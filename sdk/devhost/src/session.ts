/** The dev host server's API (`server.mjs`): the session, the bundle, its events. */
import type { EstParam } from '@/audio/est/EstNode';

export interface Build { n: number; ok: boolean; at: string; via: string; message: string; log: string }

export interface ManifestLite {
  id: string; version: string; name: string; kind: 'effect' | 'instrument'; vendor?: string; description?: string;
  ui: { path: string; size: { w: number; h: number }; resizable?: boolean } | null;
  parameters: { id: number; name: string; unit: string; scale?: 'linear' | 'log' }[];
  limits: { maxLatencyFrames: number; memoryPagesMax: number; tailSeconds: number };
  /** DEV-F (1.321): a note effect has a note input (the keyboard shows) and a note output (`plugin-notes` in the log). */
  notes?: { inputs: number; outputs: number };
  stateVersion?: number;
}

export interface Session {
  filesOrigin: string;
  build: Build;
  validation: unknown;
  validationNote: string;
  target: { kind: string; name: string };
  /** `est dev --ui-preview <params.json>`: the custom UI against these parameters, no DSP. */
  uiPreview: EstParam[] | null;
  plugin: null | { hash: string; id: string; version: string; name: string; kind: 'effect' | 'instrument' | 'preview'; manifest: ManifestLite; presets: { id: string; name: string }[] };
}

export async function getSession(): Promise<Session> {
  const r = await fetch('/__est/session', { cache: 'no-store' });
  if (!r.ok) throw new Error(`the session: HTTP ${r.status}`);
  return r.json() as Promise<Session>;
}

export async function getBundle(): Promise<{ bytes: ArrayBuffer; hash: string }> {
  const r = await fetch('/__est/bundle.est', { cache: 'no-store' });
  if (!r.ok) throw new Error(`the bundle: HTTP ${r.status}`);
  return { bytes: await r.arrayBuffer(), hash: r.headers.get('x-est-hash') ?? '' };
}

export async function getPreset(id: string): Promise<{ id: string; name: string; state: string }> {
  const r = await fetch(`/__est/preset?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`the preset: HTTP ${r.status}`);
  return r.json() as Promise<{ id: string; name: string; state: string }>;
}

export const rebuild = () => fetch('/__est/rebuild', { method: 'POST' });

/** The events stream: builds, a new bundle, and commands (`est dev --json`'s stdin). */
export function onEvents(h: { build?: (b: Build) => void; bundle?: (d: { hash: string }) => void; command?: (c: Record<string, unknown>) => void }): () => void {
  const es = new EventSource('/__est/events');
  const on = (name: string, fn?: (d: never) => void) => { if (fn) es.addEventListener(name, e => fn(JSON.parse((e as MessageEvent).data) as never)); };
  on('build', h.build);
  on('bundle', h.bundle);
  on('command', h.command);
  return () => es.close();
}

/** `--json`: what the page logs, posted back to the server in batches. */
export function emitter(on: boolean) {
  let queue: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  // One post at a time, so the lines arrive in the order they were logged.
  let sending: Promise<unknown> = Promise.resolve();
  const flush = () => {
    timer = null;
    if (!queue.length) return;
    const body = JSON.stringify(queue);
    queue = [];
    sending = sending.then(() => fetch('/__est/emit', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).catch(() => {});
  };
  return (e: unknown) => {
    if (!on) return;
    queue.push(e);
    // A command's `done` goes at once: `est dev --json` waits for it before the next command.
    if ((e as { type?: unknown } | null)?.type === 'done') { if (timer) clearTimeout(timer); flush(); return; }
    timer ??= setTimeout(flush, 100);
  };
}
