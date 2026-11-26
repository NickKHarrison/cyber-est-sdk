/**
 * The window check (1.912): does a plugin's window show every parameter, and does every control of
 * the window kit name a parameter the plugin has? Pure: text in, findings out. No DOM, nothing run.
 *
 * The window kit's elements (`<est-knob param="Cutoff">`, `<est-xy x= y=>` …, `sdk/packages/ui`) bind
 * by themselves, so the only way one can be dead is by naming nothing the plugin has: `unknown`. A
 * parameter no element names and no script writes is `uncovered`; that is `certain` only when every
 * parameter write in the page's scripts could be read (a number or a constant), since a hand-written
 * control may reach its parameter in ways text cannot show.
 *
 * Read by the builder that turns an assistant's answer into a plugin (`src/components/est/vibe/`),
 * and re-exported by the kit's tools; the rule ids stay the UI probe's (`uiProbe.ts`): this adds none.
 */

/** A parameter as the check needs it. `shown` false: hidden or the host's bypass (it needs no control). */
export interface WindowParam { id: number; name: string; shown?: boolean }

export interface WindowFiles {
  /** The window's page (`ui/index.html`). */
  html: string;
  /** The text of the page's own scripts (never Cyber's `est-ui.js`). */
  scripts: readonly string[];
}

export interface WindowCheck {
  /** The page uses the window kit (any `<est-…>` control or `<est-window>`). */
  kit: boolean;
  /** Kit controls naming a parameter the plugin lacks: each is a control that would do nothing. */
  unknown: { tag: string; attr: string; ref: string }[];
  /** Kit controls with no parameter named at all. */
  unnamed: string[];
  /** Shown parameters nothing in the window reaches. */
  uncovered: WindowParam[];
  /** Whether `uncovered` is certain (false: a script writes parameters in a way text cannot follow). */
  certain: boolean;
  /** The ids the window reaches. */
  covered: number[];
}

/** The kit's controls and the attributes that name their parameters. */
export const KIT_PARAM_ATTRS: Record<string, readonly string[]> = {
  'est-knob': ['param'], 'est-slider': ['param'], 'est-switch': ['param'], 'est-select': ['param'], 'est-value': ['param'], 'est-xy': ['x', 'y'],
};
/** Every element name of the kit (a page using any of them needs Cyber's `est-ui.js`). */
export const KIT_TAGS = ['est-window', 'est-row', 'est-panel', 'est-knob', 'est-slider', 'est-switch', 'est-select', 'est-xy', 'est-value', 'est-meter', 'est-spectrum', 'est-all'] as const;
/** Whether a page's HTML uses the window kit. */
export const usesWindowKit = (html: string): boolean => new RegExp(String.raw`<(?:${KIT_TAGS.join('|')})\b`, 'i').test(withoutHtmlComments(html));

const foldName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const withoutHtmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');
const TAG_ATTRS = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
const attrOf = (attrs: string, name: string): string | null => {
  const m = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
};

/** The parameter a `param` attribute names, as the kit resolves it at run time: an id, else a name (unique once folded). */
export function resolveRef(ref: string, params: readonly WindowParam[]): WindowParam | undefined {
  const t = ref.trim();
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return params.find(p => p.id === Number(t));
  const want = foldName(t);
  if (!want) return undefined;
  const hits = params.filter(p => foldName(p.name) === want);
  return hits.length === 1 ? hits[0] : undefined;
}

/** Script text with its comments taken out (strings kept), so a commented-out line is not read. */
export function stripJsComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    out += c; i++;
  }
  return out;
}

/**
 * The parameter ids a script writes (`.set(ID, …)`, `.begin(ID)`, `bind(el, ID)`), and whether every
 * such call could be read: an id is a whole number or a constant declared as one.
 */
export function scriptWrites(scripts: readonly string[]): { ids: Set<number>; certain: boolean } {
  const ids = new Set<number>();
  let certain = true;
  for (const raw of scripts) {
    const src = stripJsComments(raw);
    const consts = new Map<string, number>();
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([^;=]*?=\s*\d+\s*(?:,\s*[A-Za-z_$][\w$]*\s*=\s*\d+\s*)*);/g)) {
      for (const d of m[1]!.split(',')) { const kv = /^\s*([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*$/.exec(d); if (kv) consts.set(kv[1]!, Number(kv[2])); }
    }
    for (const m of src.matchAll(/\b([A-Z][A-Z0-9_]*)\s*[:=]\s*(\d+)\b/g)) if (!consts.has(m[1]!)) consts.set(m[1]!, Number(m[2]));
    const take = (arg: string) => {
      const t = arg.trim();
      const v = /^\d+$/.test(t) ? Number(t) : consts.get(t);
      if (v === undefined) certain = false; else ids.add(v);
    };
    for (const m of src.matchAll(/\.(?:set|begin)\s*\(\s*([^,()]+?)\s*[,)]/g)) take(m[1]!);
    for (const m of src.matchAll(/\bbind\s*\(\s*[^,]+,\s*([^,()]+?)\s*[,)]/g)) take(m[1]!);
  }
  return { ids, certain };
}

/** Check a window against the plugin's parameters. */
export function checkWindow(files: WindowFiles, params: readonly WindowParam[]): WindowCheck {
  const html = withoutHtmlComments(files.html);
  const kit = usesWindowKit(html);
  const unknown: WindowCheck['unknown'] = [];
  const unnamed: string[] = [];
  const covered = new Set<number>();
  let all = false;
  for (const m of html.matchAll(new RegExp(String.raw`<(est-[a-z]+)\b(${TAG_ATTRS})>`, 'gi'))) {
    const tag = m[1]!.toLowerCase(), attrs = m[2]!;
    if (tag === 'est-all') {
      const only = attrOf(attrs, 'params');
      if (only === null) all = true;
      else for (const x of only.split(',')) { const p = resolveRef(x, params); if (p) covered.add(p.id); }
      continue;
    }
    const names = KIT_PARAM_ATTRS[tag];
    if (!names) continue;
    let any = false;
    for (const a of names) {
      const ref = attrOf(attrs, a);
      if (ref === null) continue;
      any = true;
      const p = resolveRef(ref, params);
      if (p) covered.add(p.id); else unknown.push({ tag, attr: a, ref });
    }
    if (!any) unnamed.push(tag);
  }
  const writes = scriptWrites(files.scripts);
  for (const id of writes.ids) if (params.some(p => p.id === id)) covered.add(id);
  const shown = params.filter(p => p.shown !== false);
  const uncovered = all ? [] : shown.filter(p => !covered.has(p.id));
  return { kit, unknown, unnamed, uncovered, certain: all || writes.certain, covered: [...(all ? shown.map(p => p.id) : covered)].sort((a, b) => a - b) };
}

/** The findings in plain words, each a sentence an assistant (or a person) can act on. */
export function windowCheckWords(c: WindowCheck, params: readonly WindowParam[]): string[] {
  const names = params.filter(p => p.shown !== false).map(p => `"${p.name}" (id ${p.id})`).join(', ');
  const out: string[] = [];
  for (const u of c.unknown) out.push(`<${u.tag} ${u.attr}="${u.ref}"> names a parameter the sound code does not have, so that control would do nothing. The plugin's parameters are: ${names}. Use one of those names or ids, or add the parameter to the sound code.`);
  for (const t of c.unnamed) out.push(`A <${t}> has no ${KIT_PARAM_ATTRS[t]!.map(a => `${a}="…"`).join(' and ')} attribute, so it is connected to nothing. Name its parameter: ${names}.`);
  if (c.uncovered.length && c.certain) out.push(`The window has no control for ${c.uncovered.map(p => `"${p.name}" (id ${p.id})`).join(', ')}. Every parameter of the sound needs one: add an element for each, or put <est-all></est-all> in a row to get a control for every parameter the window does not show.`);
  return out;
}
