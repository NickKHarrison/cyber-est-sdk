// The example app: no framework, one page. A slider per parameter (grouped by module), the
// readout, and a line saying what the host does. Replace it with your app (React, Svelte, plain
// DOM: anything Vite bundles); keep talking to the store, and keep `./engine` the one import that
// reaches the host, so the build's engine swap still applies.
import { start } from './engine';
import { createStore, FLAGS, type Param } from './store';
import './style.css';

const store = createStore();
const app = document.getElementById('app')!;

const shown = (p: Param) => !(p.flags & (FLAGS.HIDDEN | FLAGS.READONLY | FLAGS.BYPASS));
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

let built: Param[] | null = null;
const inputs = new Map<number, { input: HTMLInputElement; out: HTMLOutputElement }>();
let readoutEl: HTMLElement | null = null;

function build(params: Param[]) {
  built = params;
  inputs.clear();
  const title = document.createElement('h1');
  title.textContent = document.title;
  app.replaceChildren(title);
  const groups = new Map<string, Param[]>();
  for (const p of params.filter(shown)) groups.set(p.module || 'Parameters', [...(groups.get(p.module || 'Parameters') ?? []), p]);
  for (const [module, list] of groups) {
    const set = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = module;
    set.append(legend);
    for (const p of list) {
      const row = document.createElement('label');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = p.name;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(p.min);
      input.max = String(p.max);
      input.step = p.flags & FLAGS.STEPPED ? '1' : String((p.max - p.min) / 1000);
      input.value = String(store.get(p.id));
      const out = document.createElement('output');
      out.textContent = fmt(store.get(p.id));
      // A drag is one gesture: Cyber keeps its changes as one undo step.
      input.addEventListener('pointerdown', () => store.begin(p.id));
      input.addEventListener('pointerup', () => store.end(p.id));
      input.addEventListener('pointercancel', () => store.end(p.id));
      input.addEventListener('input', () => store.set(p.id, Number(input.value)));
      row.append(name, input, out);
      set.append(row);
      inputs.set(p.id, { input, out });
    }
    app.append(set);
  }
  readoutEl = document.createElement('p');
  readoutEl.className = 'readout';
  readoutEl.setAttribute('aria-live', 'off');
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = 'Cyber plays the sound and owns the transport, the keys, MIDI and tempo.';
  app.append(readoutEl, note);
}

function show(id: number | null) {
  if (store.params() !== built) build(store.params());
  for (const [pid, el] of inputs) {
    if (id !== null && id !== pid) continue;
    const v = store.get(pid);
    if (Number(el.input.value) !== v) el.input.value = String(v);
    el.out.textContent = fmt(v);
  }
  if (readoutEl) {
    const r = Object.entries(store.readout());
    readoutEl.textContent = r.length ? r.map(([k, v]) => `${k} ${fmt(v)}`).join(' · ') : '';
  }
}

store.subscribe(id => show(id));
start(store);
show(null);
document.body.dataset.ready = 'true';
