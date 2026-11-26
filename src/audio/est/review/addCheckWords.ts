/**
 * 1.914: **the add-time checks' words** (addChecks.ts gives facts with numbers; nothing else writes a
 * sentence about them). For each finding: one plain sentence for the person, how serious it is, what to
 * do, and the lines **Copy for your AI** puts in its one message (`messageForAi`): every finding, what was
 * measured, the functions a profile named and, when the plugin was built here from source, the code of
 * those functions (`sourceExcerpts`), written so an assistant can act on it and give the whole plugin
 * back in the one prompt's form.
 *
 * Everything a plugin wrote (a parameter's name, a function's, a file's) goes through `clean` before it
 * is put in a sentence (control and hidden characters out, cut short), and is only ever drawn as text.
 * The words say **add**, never install (1.875's glossary). Pure: no DOM, no store.
 */
import { HIDDEN_TEXT_CLASS } from '../../../../shared/estHiddenText.mjs';
import { estRule } from '../install/rules';
import { ADD_CHECK_IDS, HEAVY_STOP, LOAD_VOICES, type AddCheckId, type AddCheckReport, type AddFinding, type AddSeverity } from './addChecks';

const HIDDEN = new RegExp(`[${HIDDEN_TEXT_CLASS}]`, 'gu');
/** A plugin's own text, safe to put in a sentence: no control or hidden characters, at most `max`. */
export function clean(text: unknown, max = 40): string {
  let out = '';
  for (const ch of String(text ?? '').replace(HIDDEN, '')) { const c = ch.codePointAt(0)!; if (c >= 0x20 && c !== 0x7f) out += ch; }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** A linear level as dBFS, one decimal, signed ("+3.5 dBFS", "−12.0 dBFS"). */
export function dbfs(x: number): string {
  if (!(x > 0)) return 'silence';
  const d = 20 * Math.log10(x);
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} dBFS`;
}
const below = (x: number, ref: number) => (x > 0 && ref > 0 ? `${Math.abs(20 * Math.log10(x / ref)).toFixed(0)} dB` : 'far');
const pct = (x: number) => `${Math.round(x * 100)} %`;
const ms = (s: number) => `${Math.round(s * 1000)} ms`;
const list = (names: readonly string[] | undefined, max = 6) => {
  const n = (names ?? []).map(x => clean(x));
  return n.length > max ? `${n.slice(0, max).join(', ')} and ${n.length - max} more` : n.join(', ');
};
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const KEY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** A MIDI key by name (60 is C4, as the kit counts). */
export const keyName = (k: number) => `${KEY_NAMES[((k % 12) + 12) % 12]}${Math.floor(k / 12) - 1}`;

export const SEVERITY_WORDS: Record<AddSeverity, string> = { serious: 'Fix before playing', warning: 'Worth fixing', note: 'Good to know' };

/** Each check as a question, and what its green tick says. */
export const CHECK_WORDS: Record<AddCheckId, { ask: string; clean: string }> = {
  sound: { ask: 'Does it make sound?', clean: 'It makes sound' },
  stops: { ask: 'Does a note stop?', clean: 'Notes stop when they should' },
  safe: { ask: 'Is it safe to hear?', clean: 'Its level is safe' },
  light: { ask: 'Does it run light enough?', clean: 'It runs light enough' },
  controls: { ask: 'Do the controls do anything?', clean: 'Every control does something' },
  rate: { ask: 'Does it sound the same at any sample rate?', clean: 'It sounds the same at 44.1 and 48 kHz' },
};
export const NOT_CHECKED_WORDS: Record<NonNullable<AddCheckReport['checks'][number]['why']>, string> = {
  time: 'Not checked: the few seconds Cyber gives the checks ran out. Check again to run it.',
  kind: 'Not checked: this kind of plugin makes no sound of its own.',
  error: 'Not checked: the check itself could not run.',
};

export const CARD_WORDS = {
  title: 'How it behaves',
  busy: 'Checking how it behaves… You can use it meanwhile.',
  allClean: 'Cyber played it for a few seconds and found nothing wrong.',
  serious: 'Cyber found something to fix before you play it.',
  copy: 'Copy for your AI',
  copied: 'Copied. Paste it into the same chat, then add the new answer here.',
  copyHow: 'One message with every finding and what Cyber measured.',
  again: 'Check again',
  failed: 'The checks could not run this time. The plugin is added and works as before.',
  trim: (db: number) => `Use a safe level (${Math.abs(db)} dB quieter)`,
  trimOn: (db: number) => `Safe level on: tracks you make with it start ${Math.abs(db)} dB quieter. Its own sound is unchanged.`,
  trimOff: 'Turn the safe level off',
  improved: 'Since the last version',
} as const;

export interface FindingWords {
  /** One plain sentence for the person. */
  sentence: string;
  /** What to do about it. */
  todo: string;
  /** The precise version for an assistant: what was measured and the surest change. */
  ai: string;
}

const hot = (f: AddFinding): string => {
  const fns = (f.functions ?? []).filter(x => x.share >= 0.05);
  if (!fns.length) return '';
  const named = fns.map(x => `${x.name ? `\`${clean(x.name, 80)}\`` : `function #${x.index} (the build kept no names)`} (${pct(x.share)})`);
  return ` Most of the work is in ${named.join(', ')}.`;
};
const BREAK_WORDS = ['stops the plugin', 'gives output that is not a number'];

/** The words of one finding. `kind` words an instrument's notes and an effect's sound apart. */
export function findingWords(f: AddFinding, kind: AddCheckReport['kind']): FindingWords {
  const n = f.numbers;
  const fx = kind !== 'instrument';
  switch (f.code) {
    case 'silent': return fx
      ? { sentence: 'Nothing came out when sound went in.', todo: 'Ask your AI to check that the sound going in reaches the output.', ai: `The effect's output was silent (under −80 dBFS) while its input peaked at ${dbfs(n.input ?? 0)}, with the transport playing and stopped. In render(), every output sample must be written from the input: read with io.in(c, n), write with io.out(c, n, value); check the default Mix or Level is not 0.` }
      : { sentence: `It made no sound for any of the ${n.notes ?? 5} notes Cyber played.`, todo: 'Ask your AI to check that a note starts a voice and the voices reach the output.', ai: 'The instrument was silent (under −80 dBFS) for notes at keys 36, 48, 60, 72 and 84 (velocity 0.8), with the transport stopped and playing. noteOn must start a voice and its envelope, the default level must not be 0, and render() must add every voice to both outputs.' };
    case 'silent-keys': {
      // The names are keys (numbers); anything else (a stored report that was changed) is left out.
      const keys = (f.names ?? []).map(Number).filter(k => Number.isInteger(k) && k >= 0 && k <= 127).map(k => `${keyName(k)} (key ${k})`);
      return { sentence: `It made no sound for ${n.silent} of the ${n.of} notes Cyber played${keys.length ? `: ${keys.join(', ')}` : ''}.`, todo: 'Fine for a drum kit. For anything else, ask your AI why those notes are silent.', ai: `Notes at these keys were silent (under −80 dBFS) at velocity 0.8 while others sounded: ${keys.join(', ')}. Check the key-to-frequency sum (440 × 2^((key − 69) / 12)), any key range test, and that a filter's cutoff does not close on low or high notes. If the plugin is a drum kit, add "drum-machine" to est.json's features and this is not reported.` };
    }
    case 'silent-soft': return { sentence: 'A softly played note made no sound, though the same note played harder did.', todo: 'Ask your AI to let quiet notes through, unless that is what you want.', ai: `A note at key 60 with velocity 0.25 was silent, while velocity 0.8 peaked at ${dbfs(n.loud ?? 0)}. Scale the level by velocity without a threshold (for example velocity × velocity never reaches 0 for velocity above 0).` };
    case 'does-nothing': return { sentence: 'The sound comes out exactly as it went in, whatever the controls are set to.', todo: 'Ask your AI to check that the effect is applied to the output.', ai: `The effect's output equals its input sample for sample at its defaults, and stays the same with every one of its ${n.params ?? 0} parameters at either end. In render() the processed value must be what is written with io.out(c, n, value), and each parameter must be read where it is used (this.<param>, set in the parameter's setter).` };
    case 'stuck': return { sentence: `Notes do not stop: ${n.after} seconds after the keys were let go it was still sounding, and not fading.`, todo: 'Ask your AI to make a released note fade to silence and end.', ai: `After a three-note chord was released, the output was still at ${dbfs(n.level ?? 0)} (${below(n.level ?? 0, n.held ?? 1)} under its held level) ${n.after} s later and not decaying (under 1 dB a second)${(n.tail ?? -1) >= 0 ? `, though tail() reports ${(n.tail ?? 0).toFixed(2)} s` : ''}. A released voice's envelope must reach 0 and the voice must then end: in noteOff call this.voices.release(note); in render, when a voice's envelope is no longer active, call this.voices.end(i, io, n). Check no envelope has a floor above 0 and no oscillator runs outside a voice.` };
    case 'rings': return { sentence: `It never dies away: ${n.after} seconds after the sound going in stopped, it was still sounding and not fading.`, todo: 'Ask your AI to keep the feedback below 1 so echoes fade.', ai: `After its input stopped, the effect's output was still at ${dbfs(n.level ?? 0)} ${n.after} s later and not decaying. Something feeds back at 1 or more: clamp every feedback amount to at most 0.95 where it is used (not only where it is set), and report the longest ring from tail().` };
    case 'note-end': return { sentence: `It did not tell Cyber that ${(n.notes ?? 0) - (n.ends ?? 0)} of ${n.notes} notes had ended, so it keeps running in silence.`, todo: 'Ask your AI to end every voice when its sound is over.', ai: `${n.notes} notes were played and released and the sound ended, but only ${n.ends} NOTE_END events were sent (rule EST-C024). When a voice's envelope is no longer active call this.voices.end(i, io, n) in render, exactly once a voice.` };
    case 'past-tail': return { sentence: `It was still sounding after the ${(n.tail ?? 0).toFixed(2)} second tail it reports, so an export or a freeze would cut it short.`, todo: 'Ask your AI to report a longer tail.', ai: `The output was at ${dbfs(n.level ?? 0)} after the ${(n.tail ?? 0).toFixed(2)} s that tail() reports had passed (rule EST-C028). Make tail() return the longest a released note or an echo can sound, in frames: for example \`return <u32>(this.sampleRate * 10.0);\`. A tail that is too long is fine.` };
    case 'loud': return { sentence: `It is dangerously loud: a ${fx ? 'normal sound through it' : 'four-note chord'} peaks at ${dbfs(n.peak ?? 0)}, where full scale is 0.`, todo: 'Use a safe level here, and ask your AI to lower its output.', ai: `At its default settings a ${fx ? 'test loop peaking at −6 dBFS came out' : 'four-note chord at full velocity peaked'} at ${dbfs(n.peak ?? 0)} (average ${dbfs(n.rms ?? 0)}). Aim for a peak near −6 dBFS: multiply the summed output by ${(0.5 / (n.peak || 1)).toFixed(3)} (or lower the default level by ${Math.ceil(20 * Math.log10((n.peak || 1) / 0.5))} dB), and scale by the number of voices rather than adding them at full level.` };
    case 'hot': return { sentence: `It is loud: a ${fx ? 'normal sound through it' : 'four-note chord'} peaks at ${dbfs(n.peak ?? 0)}, over full scale, so it clips.`, todo: 'Use a safe level here, or ask your AI to lower its output.', ai: `At its default settings the output peaked at ${dbfs(n.peak ?? 0)} (average ${dbfs(n.rms ?? 0)}), over 0 dBFS. Aim for a peak near −6 dBFS: multiply the summed output by ${(0.5 / (n.peak || 1)).toFixed(3)}.` };
    case 'limited': return { sentence: `It is far too loud: it peaks at ${dbfs(n.peak ?? 0)}, past the +12 dBFS where Cyber limits a plugin's output.`, todo: 'Use a safe level here, and ask your AI to lower its output.', ai: `At its default settings the output peaked at ${dbfs(n.peak ?? 0)}; the host clamps every sample at ±4 (+12 dBFS) and shows "Output limited". Multiply the summed output by ${(0.5 / (n.peak || 1)).toFixed(4)} and clamp the final sample to −1…1.` };
    case 'not-finite': return { sentence: 'Its output had samples that are not numbers. Cyber silences them, so the sound drops out.', todo: 'Ask your AI to guard its divisions and filters.', ai: `${n.samples} output samples were NaN or infinity at the default settings (the host writes 0 for each). Guard every division and square root (no divide by 0, no negative roots), clamp filter cutoffs to 20…0.45 × sampleRate, keep feedback below 1 and resonance below self-oscillation.` };
    case 'dc': return { sentence: 'Its output sits off centre (a DC offset), which wastes headroom and thumps when it starts and stops.', todo: 'Ask your AI to remove the offset.', ai: `The output's mean over half a second of a held ${fx ? 'signal' : 'chord'} was ${(n.dc ?? 0).toFixed(3)} (it should be near 0). Remove whatever adds a constant (a unipolar oscillator or LFO added to the output, a waveshaper's offset), or run the output through a DC blocker: y = x − x1 + 0.995 × y1.` };
    case 'click-off': return { sentence: 'A note ends with a click: its sound is cut off at once instead of fading.', todo: 'Ask your AI to give notes a short release.', ai: `When a held note (key 60) was released the output stepped by ${dbfs(n.step ?? 0)} in one sample, ${Math.round((n.step ?? 0) / Math.max(n.steady ?? 1e-9, 1e-9))} times its largest step while held: the voice is cut at the note-off. In noteOff start a release (at least 5 ms) with this.voices.release(note) and end the voice only when its envelope has reached 0.` };
    case 'too-heavy': return { sentence: `It is too heavy to run: ${fx ? 'with a busy sound going in' : `with ${n.voices} ${plural(n.voices ?? 0, 'note')} held`} it uses ${pct(n.mean ?? 0)} of the time a plugin gets, and Cyber stops a plugin at ${pct(HEAVY_STOP)}.${hot(f)}`, todo: 'Ask your AI to make it lighter before you rely on it.', ai: `${f.detail ? `The host stopped it (${clean(f.detail, 200)}). ` : ''}${fx ? 'With full-scale noise as its input' : `With ${n.voices} notes held`} a 128-sample block spent ${pct(n.mean ?? 0)} of the block's fuel${fx ? '' : ` (${pct(n.one ?? 0)} with one note)`}; the host stops an instance that stays at ${pct(HEAVY_STOP)}.${hot(f)} Do less work per sample there: compute coefficients once per block or on a parameter change, not per sample; replace per-sample sin/exp/pow with a phase accumulator or a table; cap the voices (8 is plenty) and the unison; no loops per sample whose length grows with a parameter.` };
    case 'heavy': return { sentence: `It is heavy: ${fx ? 'with a busy sound going in' : `with ${n.voices} ${plural(n.voices ?? 0, 'note')} held`} it uses ${pct(n.mean ?? 0)} of the time a plugin gets, close to the ${pct(HEAVY_STOP)} where Cyber stops one.${hot(f)}`, todo: 'It plays, but a slower computer may stop it. Ask your AI to make it lighter.', ai: `${fx ? 'With full-scale noise as its input' : `With ${n.voices} notes held`} a block spent ${pct(n.mean ?? 0)} of its fuel (its heaviest block ${pct(n.peak ?? 0)}); the host stops an instance at ${pct(HEAVY_STOP)}.${hot(f)} Compute coefficients once per block, replace per-sample sin/exp/pow with a phase accumulator or a table, and cap the voices.` };
    case 'dead-controls': return { sentence: `${n.dead === 1 ? 'One control' : `${n.dead} controls`} did not change the sound in Cyber's short test: ${list(f.names)}.`, todo: 'If it should change the sound, ask your AI to wire it up.', ai: `These parameters never changed the output, at either end of their range, alone and with every other parameter at random values (four notes, two of them overlapping, releases and the transport playing were in the 1.2 s test; a control that only shows over a longer time is not a fault): ${list(f.names, 24)}. Each parameter's setter must store its value and render() must read it; remove a parameter the sound does not use (from the sound code, est.json and the window).` };
    case 'extreme-combo': return { sentence: `With several controls at the ends of their range together (${list(f.names, 3)}) it breaks: that ${BREAK_WORDS[n.kind ?? 1]}.`, todo: 'Ask your AI to make it safe at every setting.', ai: `With ${n.named ? 'these settings together' : `all ${n.params} parameters at these ends`} the plugin ${n.kind === 0 ? 'stopped' : `gave ${n.samples} output samples that were NaN or infinity`}${f.detail ? ` (${clean(f.detail, 200)})` : ''}: ${list(f.names, 8)}. Each alone is fine. Guard what they reach together: a division by a count or a length that can be 0, an index or a buffer length worked out from two parameters, a filter whose cutoff and resonance are both at their ends, a feedback that passes 1. Clamp where the values are used, not only where they are set.` };
    case 'rate-pitch': return { sentence: `Its pitch changes with the sample rate: the same note came out at ${(n.hz48 ?? 0).toFixed(0)} Hz on one computer's setting and ${(n.hz441 ?? 0).toFixed(0)} Hz on another's.`, todo: 'Ask your AI to work pitch out from the sample rate it is given.', ai: `Key 69 (A4) came out at ${(n.hz48 ?? 0).toFixed(1)} Hz at 48 kHz and ${(n.hz441 ?? 0).toFixed(1)} Hz at 44.1 kHz: the phase step is the same count per sample at both rates. Use this.sampleRate (set in activate) wherever a frequency becomes a step: step = frequency / this.sampleRate. Never a constant 48000 or 44100.` };
    case 'rate-time': return { sentence: 'Its timing changes with the sample rate: a release that is one length on one computer is longer on another.', todo: 'Ask your AI to size times in seconds, from the sample rate it is given.', ai: `A released note took ${ms(n.s48 ?? 0)} to fall 40 dB at 48 kHz and ${ms(n.s441 ?? 0)} at 44.1 kHz: the same count of samples at both rates. Size every time from this.sampleRate: samples = seconds × this.sampleRate, coefficient = exp(−1 / (seconds × this.sampleRate)).` };
    case 'rate-delay': return { sentence: `Its echo is a fixed number of samples, so it is ${ms(n.s48 ?? 0)} on one computer's setting and ${ms(n.s441 ?? 0)} on another's.`, todo: 'Ask your AI to size delays in seconds, from the sample rate it is given.', ai: `A click came back ${n.frames} samples later at both 48 kHz and 44.1 kHz (${ms(n.s48 ?? 0)} and ${ms(n.s441 ?? 0)}). Size every delay in activate from the rate it gives: frames = <i32>(seconds × this.sampleRate), and allocate the buffer for the highest rate (96 kHz).` };
    case 'subnormal': return { sentence: 'In silence it keeps working on vanishingly small numbers, which uses the computer for nothing.', todo: 'Ask your AI to set tiny leftover values to zero.', ai: `In silence after its sound ended, the module stored ${n.stores} subnormal floats a second (rule EST-C027): a filter's memory, an envelope or a feedback sample decaying for ever. Set every value that feeds back on itself to 0 when its absolute value is below 1e-20.` };
    case 'window-params': return { sentence: `Its window has ${n.missing === 1 ? 'a control' : 'controls'} for ${n.missing === 1 ? 'a parameter' : 'parameters'} the plugin does not have, so ${n.missing === 1 ? 'it does' : 'they do'} nothing.`, todo: 'Ask your AI to make the window and the sound use the same parameters.', ai: `The window names parameter ids the plugin does not have: ${list(f.names, 12)}. Every \`param="<id>"\` in ui/index.html and every id given to est.get, est.set, est.param, est.begin and est.end in ui/ui.js must be an id of a parameter the sound code declares (ids start at 0).` };
    case 'stopped': return { sentence: 'It stopped while Cyber was testing it.', todo: 'Ask your AI to fix what stops it.', ai: `The plugin stopped during the checks (${clean(f.detail, 200)}). An array index out of range, a null object, or a division of whole numbers by 0: check every index against its buffer's length, allocate every buffer in activate(), and wrap delay positions.` };
  }
}

/** Which serious finding may be met with the safe trim alone (the fix is only level). */
export const levelOnly = (f: AddFinding) => f.code === 'loud' || f.code === 'hot' || f.code === 'limited';

/** The functions a report's findings name, the hottest first, each once. */
export function namedFunctions(report: Pick<AddCheckReport, 'findings'>): string[] {
  const out: string[] = [];
  for (const f of report.findings) for (const fn of f.functions ?? []) if (fn.name && !out.includes(fn.name)) out.push(fn.name);
  return out;
}

/** The most source a message carries (characters), and lines round a function's first line. */
export const EXCERPT_MAX = 6000;
const EXCERPT_LINES = 40;

/**
 * The code of the named functions in a plugin's source files (a build made here keeps them): for each
 * name, its last identifier (`Synth#render` → `render`, `assembly/index/burn` → `burn`) found as a
 * function or method declaration, with the lines after it. Nothing found: an empty list.
 */
export interface SourceExcerpt { path: string; line: number; name: string; code: string }

export function sourceExcerpts(names: readonly string[], sources: Readonly<Record<string, string>>): SourceExcerpt[] {
  const out: SourceExcerpt[] = [];
  let used = 0;
  for (const raw of names) {
    const id = /([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*$/.exec(raw.replace(/~.*$/, ''))?.[1];
    if (!id || id.length < 2) continue;
    const decl = new RegExp(`(?:^|\\s)(?:function\\s+${id}\\b|(?:(?:public|private|protected|static|export|@inline)\\s+)*${id}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)\\s*(?::\\s*[\\w<>\\[\\]| .]+)?\\s*\\{)`);
    for (const [path, text] of Object.entries(sources)) {
      if (!/\.(ts|rs|c|cc|cpp|h)$/.test(path)) continue;
      const lines = text.split('\n');
      const at = lines.findIndex(l => decl.test(l) && !/^\s*(\/\/|\*)/.test(l));
      if (at < 0) continue;
      const code = lines.slice(at, at + EXCERPT_LINES).join('\n');
      if (used + code.length > EXCERPT_MAX) return out;
      used += code.length;
      out.push({ path, line: at + 1, name: id, code });
      break;
    }
  }
  return out;
}

export interface AiMessageInput {
  report: AddCheckReport;
  plugin: { name: string; version: string };
  /** The plugin's source, when it was built here (paths → text): quoted for the functions a profile named. */
  sources?: Readonly<Record<string, string>>;
  /** Or the excerpts already cut from it (what a stored report keeps: never the whole source). */
  excerpts?: readonly SourceExcerpt[];
}

/** What **Copy for your AI** copies: every finding with what was measured, most serious first. */
export function messageForAi({ report, plugin, sources, excerpts: kept }: AiMessageInput): string {
  const order: AddSeverity[] = ['serious', 'warning', 'note'];
  const findings = [...report.findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const lines: string[] = [
    `Cyber added the plugin "${clean(plugin.name, 60)}" (version ${clean(plugin.version, 20)}) and it runs, but when Cyber played it for a few seconds to check how it behaves it found ${findings.length} ${plural(findings.length, 'thing')} to fix:`,
    '',
  ];
  findings.forEach((f, i) => {
    let title = '';
    try { title = estRule(f.rule).title; } catch { /* not a rule id */ }
    lines.push(`${i + 1}. [${SEVERITY_WORDS[f.severity]}] ${title} (rule ${f.rule})`, `   ${findingWords(f, report.kind).ai}`, '');
  });
  const measured: string[] = [];
  if (report.level) measured.push(`level at the defaults: peak ${dbfs(report.level.peak)}, average ${dbfs(report.level.rms)}`);
  if (report.load.length) measured.push(`work per block: ${report.load.map(l => `${l.voices ? `${l.voices} ${plural(l.voices, 'note')}` : 'full input'} ${pct(l.mean)}`).join(', ')} of the budget (stopped at ${pct(HEAVY_STOP)})`);
  if (measured.length) lines.push('What Cyber measured:', ...measured.map(x => `- ${x}`), '');
  const clear = report.checks.filter(c => c.status === 'clean').map(c => CHECK_WORDS[c.id].clean.toLowerCase());
  if (clear.length) lines.push(`These were fine, keep them as they are: ${clear.join('; ')}.`, '');
  const excerpts = kept ?? (sources ? sourceExcerpts(namedFunctions(report), sources) : []);
  if (excerpts.length) {
    lines.push('The code Cyber measured as the heaviest:', '');
    for (const e of excerpts) lines.push(`--- ${e.path}, line ${e.line} (${e.name}) ---`, e.code, '');
  }
  lines.push(
    'Fix these and give me the whole plugin again: every file, complete, in ONE code block, each file under its own `=== file: <path> ===` line, exactly as before. Keep the same id and keep everything that already works. Do not explain, just the code block.',
    '',
  );
  return lines.join('\n');
}

/**
 * What changed since an earlier version's report: the findings it had that this one does not (fixed),
 * and the ones that are new, by their code. A check not reached in either is not counted either way.
 */
export function sinceLast(prev: AddCheckReport, now: AddCheckReport): { fixed: string[]; added: string[] } {
  const ran = (r: AddCheckReport, id: AddCheckId) => r.checks.some(c => c.id === id && c.status !== 'not-checked');
  const both = ADD_CHECK_IDS.filter(id => ran(prev, id) && ran(now, id));
  const codes = (r: AddCheckReport) => new Map(r.findings.filter(f => both.includes(f.check)).map(f => [f.code, f] as const));
  const a = codes(prev), b = codes(now);
  return {
    fixed: [...a].filter(([c]) => !b.has(c)).map(([, f]) => FIXED_WORDS[f.code]),
    added: [...b].filter(([c]) => !a.has(c)).map(([, f]) => findingWords(f, now.kind).sentence),
  };
}

/** A fixed finding, said as what is right now. */
export const FIXED_WORDS: Record<AddFinding['code'], string> = {
  'silent': 'It makes sound now.',
  'silent-keys': 'Every note sounds now.',
  'silent-soft': 'Soft notes sound now.',
  'does-nothing': 'It changes the sound now.',
  'stuck': 'Notes stop now.',
  'rings': 'It dies away now.',
  'note-end': 'It tells Cyber when notes end now.',
  'past-tail': 'Its tail is long enough now.',
  'loud': 'Its level is safe now.',
  'hot': 'It no longer clips.',
  'limited': 'Its level is safe now.',
  'not-finite': 'Its output is always a number now.',
  'dc': 'The DC offset is gone.',
  'click-off': 'Notes end without a click now.',
  'too-heavy': 'It is light enough to run now.',
  'heavy': 'It runs lighter now.',
  'dead-controls': 'Every control does something now.',
  'extreme-combo': 'It is safe at every setting now.',
  'rate-pitch': 'Its pitch is the same at any sample rate now.',
  'rate-time': 'Its timing is the same at any sample rate now.',
  'rate-delay': 'Its echo is the same length at any sample rate now.',
  'subnormal': 'It rests in silence now.',
  'window-params': 'The window and the sound use the same parameters now.',
  'stopped': 'It no longer stops under test.',
};

/** The validator's line for a finding (`est validate`, a warning): the sentence and what was measured. */
export const validatorLine = (f: AddFinding, kind: AddCheckReport['kind']): string => findingWords(f, kind).ai;

/** The voices the load was measured at, in words ("1, 8 and 16 notes"). */
export const LOAD_WORDS = `${LOAD_VOICES.slice(0, -1).join(', ')} and ${LOAD_VOICES[LOAD_VOICES.length - 1]} notes`;
