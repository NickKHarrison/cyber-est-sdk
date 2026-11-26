/**
 * 1.914 (the add-time checks, EST-U006): **the parameters a plugin's window names that the plugin does not
 * have.** A window made by an assistant often keeps a knob for a parameter the sound code dropped (or
 * numbers them from 1): the control then moves and nothing happens. This reads the window's files as text,
 * never running them: every `param="<id>"` attribute of the page (the kit's `<est-knob>` and
 * `<est-slider>`), and every literal id given to the script's own API (`est.get(3)`, `est.set(3, v)`,
 * `est.param(3)`, `est.begin(3)`, `est.end(3)`, on whatever name `EstUI.connect()` was assigned to). An id
 * built at run time is not seen, so it finds only what is plainly wrong.
 *
 * Pure: no DOM, no Node.
 */
export interface WindowParamRef { id: number; where: string }

const dec = new TextDecoder('utf-8', { fatal: false });
const TEXT = /\.(html?|m?js)$/i;
/** The kit's own library, which Cyber supplies: never the plugin's code. */
const LIBRARY = /(^|\/)est-ui\.js$/i;

/** Comments taken out of a script or a page, so an example in one is not read as code. */
function bare(src: string, html: boolean): string {
  if (html) return src.replace(/<!--[\s\S]*?-->/g, '');
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** The ids the window names that are not among `ids`, each once, with the file it is in. */
export function windowParamRefs(uiPath: string | null, files: ReadonlyMap<string, Uint8Array>, ids: readonly number[]): WindowParamRef[] {
  if (!uiPath || !ids.length) return [];
  const dir = uiPath.includes('/') ? uiPath.slice(0, uiPath.lastIndexOf('/') + 1) : '';
  const have = new Set(ids);
  const out = new Map<number, string>();
  const note = (raw: string, where: string) => {
    const id = Number(raw);
    if (Number.isSafeInteger(id) && id >= 0 && !have.has(id) && !out.has(id)) out.set(id, where);
  };
  for (const [name, bytes] of files) {
    if (!name.startsWith(dir) || !TEXT.test(name) || LIBRARY.test(name) || bytes.length > 1024 * 1024) continue;
    const html = /\.html?$/i.test(name);
    const text = bare(dec.decode(bytes), html);
    if (html) {
      for (const m of text.matchAll(/<[a-z][^<>]*?\sparam\s*=\s*(?:"(\d{1,10})"|'(\d{1,10})'|(\d{1,10}))/gi)) note(m[1] ?? m[2] ?? m[3] ?? '', name);
      continue;
    }
    const names = new Set<string>();
    for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?EstUI\s*\.\s*connect\s*\(/g)) names.add(m[1]!);
    if (!names.size) continue;
    for (const n of names) {
      const call = new RegExp(`(?:^|[^\\w$.])${n.replace(/\$/g, '\\$')}\\s*\\.\\s*(?:get|set|param|begin|end)\\s*\\(\\s*(\\d{1,10})\\s*[,)]`, 'g');
      for (const m of text.matchAll(call)) note(m[1]!, name);
    }
  }
  return [...out].map(([id, where]) => ({ id, where })).sort((a, b) => a.id - b.id);
}
