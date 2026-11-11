import { sanitiseTuning, type SongTuning } from './tuning';
import { sanitiseNoteMpe, type NoteMpe } from './noteMpe';
import { sanitiseStepClip } from './stepClip/sanitise';
import type { StepClipData } from './stepClip/stepTypes';
import { sanitiseScale, type Scale } from './scales';
import { songRules } from './songRules';
import { fitOutputs, withOutput } from './routing';
import { groupedOrder } from './trackOrder';
import { midiFxParamDef, sanitiseMidiFxListFor, trackMidiFx, type MidiFx } from './midiFx';
import { defaultSamplerPatch, samplerHashes, sanitiseSamplerPatch, type SamplerPatch } from '../audio/sampler/samplerTypes';
import { defaultFmPatch, sanitiseFmPatch, type FmPatch } from '../audio/fm/fmTypes';
import { defaultChipPatch, sanitiseChipPatch, type ChipPatch } from '../audio/chip/chipTypes';
import { kitHashes, sanitiseDrumKit, type DrumKit } from '../audio/drums/drumTypes';
import { defaultDrumKit } from '../audio/drums/drumKits';
import { defaultWavePatch, sanitiseWavePatch, type WavePatch } from '../audio/wave/waveTypes';
import { defaultFx, delayToneLaneValue, sanitiseFxList, type FxSlot } from '../audio/mixer/fxDefs';
import { cyberPatch, eqToSlot, type CyberType } from '../audio/mixer/cyberDefs';
import { faderToMasterDbBefore133, masterDbToTrackFader } from '../audio/masterGain';
import { bpmAt, secondsAt, songTempo } from './tempoMap';
import { sanitiseMeterMap } from './meterMap';
import { sanitiseGrooveAmount, sanitiseGrooveRef, sanitiseGrooves, type Groove } from './groove';
import { sanitiseEstBlock, type EstSlotBlock } from '../audio/est/slot';
import { defaultRackPatch, rackHashes, sanitiseRackPatch, type RackPatch } from '../audio/rack/rackTypes';
import type { ChainModule, DynamicsParams, EQParams, MaximizerParams, ModuleId, SaturationParams } from '../audio/types';
import {
  DIVISIONS, divisionBeats, defaultArpState, defaultSynthPatch, sanitiseArp, sanitiseSynthPatch,
  type ArpState, type Division, type SynthPatch,
} from '../audio/synth/synthTypes';

/**
 * The SEQUENCER's data model (Cyber_Sequencer_Work_Order.md §5): tracks, clips of notes on a
 * timeline, the loop brace and the transport's settings. Positions and lengths are in beats
 * (quarter notes), rounded to ticks (1/960 beat) on every write so drift never accumulates.
 * Everything from outside (projects, share links, live sessions) goes through
 * `sanitiseSequencerState`, which enforces every range and limit and drops unknown fields.
 */

export const TICKS_PER_BEAT = 960;
export const BEATS_PER_BAR = 4;
/** 1.109: 512 (was 128), so a song's take lanes fit (`take` on a clip); over it, takes go first, oldest first. */
export const MAX_CLIPS = 512;
export const MAX_NOTES = 4096;
export const MAX_BARS = 512;
export const MAX_BEATS = MAX_BARS * BEATS_PER_BAR;
/** Review 1.36 S-8: the loop brace is at least a 1/16 note long (a 1-tick loop flooded the scheduler). */
export const MIN_SONG_LOOP_BEATS = 1 / 16;

/** The loop brace as the transport plays it: never shorter than `MIN_SONG_LOOP_BEATS` (S-8). */
export function playableLoop<L extends { start: number; end: number }>(loop: L): L {
  return loop.end - loop.start >= MIN_SONG_LOOP_BEATS - 1e-9 ? loop : { ...loop, end: loop.start + MIN_SONG_LOOP_BEATS };
}
/**
 * 1.135: the song's tracks, every kind together, the pads track included. Until 1.135 each kind had
 * its own cap (four synth and MIDI tracks, eight Drum Racks, sixteen audio tracks, four groups);
 * instruments are made when first needed (`synthFor(id).ensure()`), so quiet tracks cost little.
 */
export const MAX_TRACKS = 128;
/** 1.135: how many more tracks the song can take (MAX_TRACKS in all; 1.210: the Game DAW's 32 while it holds the store, `songRules`). */
export const roomForTracks = (tracks: readonly unknown[]): number => Math.max(0, (songRules()?.maxTracks ?? MAX_TRACKS) - tracks.length);
/** 1.135: the one reason a new track is refused for its count. */
export const TRACK_LIMIT_TEXT = `A song holds at most ${MAX_TRACKS} tracks`;
/** Returns two to four until 1.74, none to eight since (Cyber_Mixer_And_Transport_Work_Order.md §2). */
export const MIN_RETURNS = 0;
export const MAX_RETURNS = 8;
/**
 * 1.111: a track's delay (`TrackBase.delayMs`, ms), Ableton's Track Delay: positive delays the
 * strip's sound (a DelayNode before its inserts), negative plays its clips and notes earlier.
 */
export const MIN_TRACK_DELAY_MS = -100;
export const MAX_TRACK_DELAY_MS = 100;
/** Rows on the pads track: the SAMPLE page's pads (sampleTypes' PAD_COUNT, 128 since 1.480; a pad's index is its row). */
// A literal, so this light module needs no import of sampleTypes; sampleTypes.test.ts checks it equals PAD_COUNT.
export const PAD_ROWS = 128;
export const MIN_TEMPO = 40;
export const MAX_TEMPO = 240;
export const MIN_VOLUME_DB = -48;
export const MAX_VOLUME_DB = 6;
export const MAX_SWING = 0.75;
/** 1.109: 512 (was 128), as MAX_CLIPS. */
export const MAX_AUDIO_CLIPS = 512;
/** 1.11: Warp (Cyber_Warp_Work_Order.md §2). */
export const MAX_WARP_MARKERS = 512;
export const MIN_SEG_BPM = 20;
export const MAX_SEG_BPM = 999;
export const MAX_TRANSPOSE = 48;
export const MAX_DETUNE = 50;
/** Two warp markers are at least this far apart in the source (seconds). */
export const MIN_MARKER_GAP_S = 0.001;
export const MAX_LANES = 64;
export const MAX_POINTS = 1024;
/** The tempo map release: the song's time-signature changes after beat 0 (`meterMap`), at most. */
export const MAX_METER_POINTS = 128;
/** An audio clip's source may be at most this long (seconds). */
export const MAX_AUDIO_SOURCE_S = 10 * 60;
export const MAX_FADE_S = 30;
/** 1.18: locators, flags on the ruler (Cyber_Next_Ten_Work_Order.md §2). */
export const MAX_LOCATORS = 64;
/**
 * 1.13: a row's height on the SEQUENCER's timeline (a track, a return, the master), in pixels,
 * when the person has resized it; absent: the row's default. Compact rows show only the name.
 */
export const MIN_ROW_H = 24;
export const MAX_ROW_H = 240;
/** A row height in range (whole pixels), or undefined for none. */
export function sanitiseRowHeight(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, v))) : undefined;
}

export interface Note {
  id: string;
  /** MIDI note 0–127 on a synth track; the pad's row 0–31 on the pads track. */
  pitch: number;
  /** Beats from the start of the clip's content. */
  start: number;
  length: number;
  /** 1–127. */
  velocity: number;
  /** Inactive (the `0` key): kept and drawn, but it does not play or export. Absent = active. */
  muted?: boolean;
  /**
   * 1.354 (Live 11's probability): the chance the note plays on each pass, whole percent 0…99
   * (`noteChance.ts` decides, seeded). Absent: 100 (always).
   */
  chance?: number;
  /**
   * 1.354 (Live 11's velocity deviation): each pass plays at a velocity between `velocity` and
   * `velocity + velRange` (−127…127, never 0; seeded with the chance). Absent: no deviation.
   */
  velRange?: number;
  /**
   * 1.377 (MPE as note expression, `noteMpe.ts`): the note's own pitch slide (semitones), pressure and
   * slide (CC 74), each a short point list in the note's time. Absent: none.
   */
  mpe?: NoteMpe;
}

export interface Clip {
  id: string;
  trackId: string;
  name: string;
  /** HSL triplet, e.g. "265 62% 52%" (as the pads' colours). */
  color: string;
  /** On the timeline, beats. */
  start: number;
  /** On the timeline, beats. */
  length: number;
  /** Of the notes, beats (≥ 1); the content repeats to fill `length`. */
  contentLength: number;
  /** Where in the content the clip starts playing (a trimmed start), 0 ≤ offset < contentLength. */
  offset: number;
  notes: Note[];
  muted: boolean;
  /** The clip's scale, for the piano roll's highlighting and fold (1.5); absent: none. */
  scale?: Scale | null;
  /** Seeded timing and velocity jitter (1.7, the drum grid); absent: none. */
  humanise?: Humanise | null;
  /** 1.358: the groove (an id in the song's `grooves`) its notes play through (`groove.ts`); absent or unknown: none. */
  groove?: string;
  /**
   * 1.80: the clip's velocity scale, a percentage (MIN_CLIP_VELOCITY…MAX_CLIP_VELOCITY): every
   * note's velocity is scaled by it on the way out (`notesInWindow`, `sessionNotes`), clamped
   * 1…127; the roll shows the notes' own velocities. Absent: 100 (no change).
   */
  velocity?: number;
  /** 1.80: up to MAX_CLIP_ENVELOPES envelopes in content time (`clipEnvelopes.ts`). Absent: none. */
  envelopes?: ClipEnvelope[];
  /**
   * 1.392 (Cyber_Instruments_MIDI_Work_Order_4.md, stream 10): a program change (and bank select)
   * sent to an External instrument's port at the clip's start, before its notes
   * (`externalControlPlayback.ts`); other instruments ignore it. Absent: none.
   */
  program?: ClipProgram;
  /**
   * 1.482 (Cyber_Step_Sequencer_Work_Order.md): set, the clip is a **Step Sequencer clip**: it plays
   * from these rows (`stepClip/expand.ts`, through `playedNotesOf`), never its `notes` (kept, not
   * played). Absent: an ordinary MIDI clip. A Session MIDI clip carries it too (`SessionClip`).
   */
  steps?: StepClipData;
  /**
   * 1.109 (take lanes): set, the clip is a **take** (its number, 1…MAX_TAKE, the take lane it is
   * on): it is drawn on its track's take lanes only and never plays, renders or exports
   * (`playingClips` in arrangement.ts is every reader's way in). Absent: an ordinary clip.
   */
  take?: number;
  /**
   * 1.109: the take group (a recording's id) a take belongs to, and the comp made from it (a clip
   * with `takeGroup` and no `take` is part of that group's comp). Absent: none.
   */
  takeGroup?: string;
}

/**
 * 1.80: what a clip envelope modulates on its track's strip: the volume, the pan, or a send (by
 * return index). EST 1.1 (1.327, DEV-H): or a modulatable parameter of an EST insert on that strip
 * (`est` its slot id, `param` its CLAP id), sent as `PARAM_MOD` (0.5 no change, 0 and 1 the
 * parameter's whole range down and up: `estModAmount`).
 */
export type ClipEnvelopeTarget = 'volume' | 'pan' | { send: number } | { est: string; param: number } | MidiEnvelopeTarget;
/**
 * 1.351 (Cyber_Instruments_MIDI_Work_Order.md, stream 4): a MIDI clip's recorded expression, sent to
 * the track's instrument at its times (`midiExpression.ts`, `midiExpressionPlayback.ts`), never to the
 * strip: the pitch bend (0.5 centre), channel pressure, or a controller (`cc` 0–119: 1 the mod
 * wheel, 64 the sustain pedal; value/127). At most MAX_MIDI_ENVELOPES, apart from the strip's three.
 */
export type MidiEnvelopeTarget = { midi: 'bend' } | { midi: 'pressure' } | { midi: 'cc'; cc: number };
export const MAX_MIDI_ENVELOPES = 4;
/** 1.351: whether a clip envelope's target is the instrument's (MIDI) rather than the strip's. */
export const isMidiEnvelopeTarget = (t: ClipEnvelopeTarget): t is MidiEnvelopeTarget => typeof t === 'object' && 'midi' in t;
/**
 * 1.80 (Cyber_Second_Pass_Work_Order.md §2 '1.80'): an envelope drawn in a clip, in **content
 * time** (`beat` 0 is the start of a MIDI clip's content, of an audio clip's left edge, or of its
 * warp loop when that is on; `clipEnvelopes.ts` maps song beats to it) with `value` 0…1 and
 * `curve` as an automation lane's points. It modulates the track's control, it does not replace
 * it: see `volumeGain`, `panOffset` and `sendGain`.
 */
export interface ClipEnvelope {
  target: ClipEnvelopeTarget;
  points: AutomationPoint[];
  /**
   * 1.387 (Cyber_Instruments_MIDI_Work_Order_4.md, stream 5): Live's **unlinked** envelope: its own
   * cycle, apart from the clip's loop. `start` and `length` are the envelope's loop in its own beats,
   * `loop` whether it repeats (off: it plays once from `start` and holds its last value), `offset`
   * the beats into the cycle where the clip's start falls (a split's right half keeps its phase).
   * The envelope's beat at `t` beats after the clip starts (a Session clip: after its launch) is
   * `start + wrap(offset + t, length)`. Absent: linked (the clip's content time, as before 1.387).
   */
  unlinked?: EnvelopeLoop;
}
/** 1.387: an unlinked envelope's own loop (`ClipEnvelope.unlinked`). */
export interface EnvelopeLoop { start: number; length: number; loop: boolean; offset: number }
/** 1.387: an unlinked envelope's shortest loop, beats. */
export const MIN_ENVELOPE_LOOP = 1 / 4;
export const MAX_CLIP_ENVELOPES = 3;
/** 1.80: a MIDI clip's velocity scale, percent. */
export const MIN_CLIP_VELOCITY = 10;
export const MAX_CLIP_VELOCITY = 200;
export const DEFAULT_CLIP_VELOCITY = 100;

/** A note's velocity through its clip's scale (percent; absent 100): rounded, 1…127. */
export function scaleVelocity(velocity: number, pct: number | undefined): number {
  if (pct === undefined || pct === DEFAULT_CLIP_VELOCITY) return velocity;
  const v = Math.round((velocity * pct) / 100);
  return v < 1 ? 1 : v > 127 ? 127 : v;
}

/** 1.392: a MIDI clip's program change (0–127) with an optional bank select MSB (CC 0) and LSB (CC 32), each 0–127. */
export interface ClipProgram { program: number; msb?: number; lsb?: number }

/** 1.392: a clip's program change in range, or undefined (none). */
export function sanitiseClipProgram(raw: unknown): ClipProgram | undefined {
  if (!isObj(raw)) return undefined;
  const b = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 127 ? v : undefined);
  const program = b(raw.program);
  if (program === undefined) return undefined;
  const msb = b(raw.msb), lsb = b(raw.lsb);
  return { program, ...(msb !== undefined ? { msb } : {}), ...(lsb !== undefined ? { lsb } : {}) };
}

/** Humanise (1.7): timing and velocity jitter, 0…1 each, reproducible from the seed. */
export interface Humanise { timing: number; velocity: number; seed: number }

interface TrackBase {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
  /** dB, MIN_VOLUME_DB (silent) to MAX_VOLUME_DB. */
  volume: number;
  /** 0–0.75: how far the off-beat sixteenths are delayed, as a share of half a sixteenth. */
  swing: number;
  /** The mixer (1.6): pan −1…1, post-fader sends to Return A and B (0…1), insert effects. */
  pan: number;
  /** One level per return, in the returns' order (two in 1.6–1.7; up to four since 1.8). */
  sends: number[];
  fx: FxSlot[];
  /**
   * 1.127: where the track plays (Live's Audio To): absent or null, the master; else a group's id,
   * a return's or an **audio** track's (resampling: it arrives on that track's input tap). Read it
   * through `routing.ts` (`outputOf`, `groupOf`); written by `setTrackOutput`. Never a loop.
   */
  output?: string | null;
  /**
   * The group track this track plays into (1.8); absent or null: not a group. Since 1.127 a derived
   * alias of `output` (written beside it when it names a group, for one release): never read it.
   */
  groupId?: string | null;
  /** 1.13: the row's height on the timeline (px, MIN_ROW_H…MAX_ROW_H); absent: the default. */
  height?: number;
  /**
   * 1.111: the track's delay in ms, MIN_TRACK_DELAY_MS…MAX_TRACK_DELAY_MS (0.1 ms steps; absent:
   * 0). Song data, not automatable. Positive: a DelayNode before the strip's inserts; negative: the
   * scheduler plays the track's clips and notes that much earlier (none on a monitored audio
   * track: `trackDelay.ts`). Live and in every render alike.
   */
  delayMs?: number;
  /** 1.118: its side of the master's crossfader (`MasterBus.xfade`); absent: none (it ignores the crossfader). */
  xfadeAssign?: XfadeAssign;
}

/** A track rendered to audio (1.7, Freeze): `hash` is the upload, `renderedKey` what it was rendered from. */
export interface Frozen { hash: string; renderedKey: string }

/** A return bus (1.6): fed by the tracks' sends, through its own inserts into the master. */
export type ReturnId = 'ret-a' | 'ret-b' | 'ret-c' | 'ret-d' | 'ret-e' | 'ret-f' | 'ret-g' | 'ret-h';
export interface ReturnBus {
  id: ReturnId;
  name: string;
  volume: number;
  pan: number;
  mute: boolean;
  fx: FxSlot[];
  /** 1.13: its row's height on the timeline (px); absent: the default. */
  height?: number;
  /**
   * 1.79: its colour, an HSL triplet as a track's (its SEQ row's bar, its MIX strip's top bar, its
   * lanes and every send knob to it). A return from before 1.79 takes `RETURN_COLORS` by index.
   */
  color: string;
  /**
   * 1.111: post-fader sends to the returns after this one only (A to B…H, never back, so no
   * cycle), by return index as a track's `sends`; an entry at or before its own index is 0.
   * Absent (or all 0): none, as before 1.111.
   */
  sends?: number[];
  /** 1.118: its side of the master's crossfader (`MasterBus.xfade`); absent: none (it ignores the crossfader). */
  xfadeAssign?: XfadeAssign;
  /** 1.127: where the return plays: absent or null, the master; else a later return's id (forward only, as `sends`). */
  output?: string | null;
}
/** 1.43: the DAW master strip's own settings (its gain stays the engine's `masterGainDb`). */
export interface MasterBus {
  fx: FxSlot[];
  /**
   * 1.118: the crossfader, −1 (all A) … 1 (all B); absent: 0 (the middle). A strip assigned to A is
   * scaled by cos(π/4·(x+1)), one assigned to B by sin(π/4·(x+1)) (`xfadeGain`), after its fader.
   */
  xfade?: number;
}
/** 1.118: a track's or a return's side of the crossfader (Live's A/B assign); none when absent. */
export type XfadeAssign = 'a' | 'b';
/** 1.118: the crossfader's position in range (−1…1; anything else 0), as the sanitiser keeps it. */
export function sanitiseXfade(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const c = Math.max(-1, Math.min(1, v));
  return c === 0 ? 0 : c; // never −0
}
/** 1.118: `{ xfadeAssign }` for 'a' or 'b', else nothing (old projects keep their shape). */
function xfadeAssignOf(v: unknown): { xfadeAssign?: XfadeAssign } {
  return v === 'a' || v === 'b' ? { xfadeAssign: v } : {};
}

export const RETURN_IDS = ['ret-a', 'ret-b', 'ret-c', 'ret-d', 'ret-e', 'ret-f', 'ret-g', 'ret-h'] as const satisfies readonly ReturnId[];
/** The returns' letters, in `RETURN_IDS` order (1.74: A to H). */
export const RETURN_LETTERS = 'ABCDEFGH';
/** The letter a return is shown with (A to H). */
export const returnLetter = (id: ReturnId): string => RETURN_LETTERS[RETURN_IDS.indexOf(id)] ?? '?';
/** The letter of the return at `index` (a send's), or its number past H. */
export const returnLetterAt = (index: number): string => RETURN_LETTERS[index] ?? String(index + 1);
/**
 * A synth track's instrument: the Model D-style ANALOG, the wavetable WAVE (1.6), the SAMPLER
 * (1.22), FM (1.27), (1.29) a Drum Rack of sixteen pads or (1.198) 8-BIT (`'chip'`, the NES's 2A03);
 * 1.88: `'none'`, a MIDI track (a synth track whose instrument was removed: its clips, MIDI FX, mix
 * and automation stay, it plays nothing). 1.256: `'pads'`, Cyber PADS, the project's pad kit
 * (`store.sample`, the pads track's and the Slicer's) played through this track's own strip; its
 * notes are pad rows, as the pads track's are (`playsKit`). EST Phase 3 (1.283, stream 3-A): `'est'`,
 * an installed EST instrument (an admin's, D-25; its `patch` is the plugin's `EstSlotBlock`, made
 * only by `estTrackBlockFor` from an installed instrument); a plugin that cannot run here is a
 * silent placeholder that keeps its notes, never ANALOG. A branch on `engine` handles all nine
 * (`engineBranches.test.ts` scans for them); `hasInstrument` is the one check.
 */
export type SynthEngine = 'analog' | 'wave' | 'sampler' | 'fm' | 'chip' | 'drums' | 'pads' | 'none' | 'est' | 'rack';
/** 1.88: the engines that are an instrument (every one but `'none'`). */
export type InstrumentEngine = Exclude<SynthEngine, 'none'>;
/**
 * The built-in instruments, in menu order. EST Phase 3: `'est'` is left out on purpose (an EST
 * track names an installed plugin, offered by 3-B's menus from the library, never by this list).
 */
export type BuiltInEngine = Exclude<InstrumentEngine, 'est'>;
// 1.356: the Instrument Rack last (`'rack'`, chains of Cyber engines: src/audio/rack/).
export const INSTRUMENT_ENGINES: readonly BuiltInEngine[] = ['analog', 'wave', 'sampler', 'fm', 'chip', 'drums', 'pads', 'rack'];
export const SYNTH_ENGINES: readonly SynthEngine[] = [...INSTRUMENT_ENGINES, 'none', 'est'];
export const ENGINE_LABELS: Record<SynthEngine, string> = { analog: 'Analog', wave: 'Wave', sampler: 'Sampler', fm: 'FM', chip: '8-bit', drums: 'Drums', pads: 'Cyber PADS', none: 'MIDI', est: 'EST', rack: 'Rack' };
interface SynthTrackBase extends TrackBase {
  kind: 'synth';
  /** The preset the patch came from ('factory:<id>' or 'user:<id>'), or null. */
  presetId: string | null;
  /** Changed since the preset was applied. */
  modified: boolean;
  frozen?: Frozen | null;
  /**
   * The track's arpeggiator (1.19; one for the whole SYNTH page before). The keys play the
   * selected synth track's; a track that is not selected does not arpeggiate.
   */
  arp: ArpState;
  /**
   * 1.21: the track's MIDI effects (Chord, Scale, Note Echo, Random; `midiFx.ts`), in order,
   * between its notes (keys, MIDI, clips) and its instrument. Absent: none.
   */
  midiFx?: MidiFx[];
}
export interface AnalogTrack extends SynthTrackBase { engine: 'analog'; patch: SynthPatch }
export interface WaveTrack extends SynthTrackBase { engine: 'wave'; patch: WavePatch }
/** 1.22: a SAMPLER track, one sample across the keyboard (`src/audio/sampler/`). */
export interface SamplerTrack extends SynthTrackBase { engine: 'sampler'; patch: SamplerPatch }
/** 1.27: an FM track, four operators in eight algorithms (`src/audio/fm/`). */
export interface FmTrack extends SynthTrackBase { engine: 'fm'; patch: FmPatch }
/** 1.198: an 8-BIT track, the NES's 2A03 sound chip (`src/audio/chip/`). */
export interface ChipTrack extends SynthTrackBase { engine: 'chip'; patch: ChipPatch }
/** 1.29: a Drum Rack track, sixteen pads of samples and FM and ANALOG voices (`src/audio/drums/`). */
export interface DrumTrack extends SynthTrackBase { engine: 'drums'; patch: DrumKit }
/** 1.88: a MIDI track, a synth track with no instrument (`patch` null): it keeps its clips and plays nothing. */
export interface MidiTrack extends SynthTrackBase { engine: 'none'; patch: null }
/** 1.256: Cyber PADS has nothing of its own per track: the kit it plays is the project's (`store.sample`). */
export type CyberPadsPatch = Record<string, never>;
/**
 * 1.256: a Cyber PADS track, a MIDI track playing the project's pad kit (the pads track's, the
 * Slicer's) through its own strip, its notes pad rows (0 is pad 1). Any number of them; the kit's
 * voice mode and choke groups act across every track that plays it.
 */
export interface CyberPadsTrack extends SynthTrackBase { engine: 'pads'; patch: CyberPadsPatch }
/**
 * EST Phase 3 (1.283): an EST instrument track. Its `patch` is the plugin's block (`EstSlotBlock`,
 * src/audio/est/slot.ts: the reference, name, vendor, CLAP state and cached parameters), as an EST
 * insert's `FxSlot.est`. Its sound is `src/audio/est/instrument.ts`; a plugin that cannot run here
 * (not an admin, not installed, over the budget, crashed) is silent and keeps the block as it came.
 */
export interface EstTrack extends SynthTrackBase { engine: 'est'; patch: EstSlotBlock }
/**
 * 1.356 (Cyber_Instrument_Rack_Design.md): an Instrument Rack track: up to eight chains of Cyber
 * engines (ANALOG, FM, 8-BIT) with key and velocity zones and eight macros (`src/audio/rack/rackTypes.ts`),
 * played as one instrument by `rackNode.ts`. A client before it reads an unknown engine as ANALOG.
 */
export interface RackTrack extends SynthTrackBase { engine: 'rack'; patch: RackPatch }
export type SynthTrack = AnalogTrack | WaveTrack | SamplerTrack | FmTrack | ChipTrack | DrumTrack | CyberPadsTrack | MidiTrack | EstTrack | RackTrack;
/** A synth track that has an instrument (every engine but `'none'`). */
export type InstrumentTrack = Exclude<SynthTrack, MidiTrack>;
export interface PadsTrack extends TrackBase {
  kind: 'pads';
  frozen?: Frozen | null;
  /** 1.64: the track's MIDI effects (Note Echo and Random: `PADS_MIDI_FX_TYPES`), before the pads. Absent: none. */
  midiFx?: MidiFx[];
}
/** A track of audio clips (1.7); `monitor` plays the microphone through the strip while armed. */
export interface AudioTrack extends TrackBase {
  kind: 'audio';
  /** Plays the microphone through the strip while armed; 1.127: and lets what plays into the track (its inputs) be heard. */
  monitor: boolean;
  /**
   * 1.127: **Resample**: the track records what plays into it (the tracks and returns whose output
   * is this track, through `Strip.inputTap`) instead of a microphone. Song data, as the routing it
   * records is (a device input is this machine's, `trackInput.ts`); only `true` is kept.
   */
  resample?: boolean;
  /**
   * EST 1.1 (1.327, DEV-H, D-56): this track's strip also hears output pair `pair` (1…3: channels
   * 2·pair and 2·pair + 1) of the EST instrument on track `trackId` (a multi-out instrument's
   * "output strip", made by `addEstOutputStrips`). Song data; absent: none. Its clips play as any
   * audio track's. An older client (DOC_VERSION 70) drops it and the strip is plain.
   */
  estOut?: { trackId: string; pair: number };
}
/** A group (1.8): a strip other tracks play into (inserts, pan, volume, sends), with no clips of its own. */
export interface GroupTrack extends TrackBase {
  kind: 'group';
  /** A group is never frozen (its members are). */
  frozen?: null;
  /**
   * 1.118: folded in the Session grid on MIX (its members' columns and strips hidden, its column
   * the union of their slots: `foldedMembers` in sessionColumns.ts). Song data; absent: unfolded.
   * The arrangement has no group fold: SEQ's rows are unchanged.
   */
  folded?: boolean;
}
export type Track = SynthTrack | PadsTrack | AudioTrack | GroupTrack;

/** A region of an upload on an audio track (1.7). */
export interface AudioClip {
  id: string;
  trackId: string;
  name: string;
  color: string;
  /** On the timeline, beats (on ticks). */
  start: number;
  length: number;
  /** The upload (its SHA-256, as `ProjectAssets.main`) and its name for display. */
  hash: string;
  assetName: string;
  /** Source seconds where the clip starts. */
  offsetS: number;
  gainDb: number;
  fadeInS: number;
  fadeOutS: number;
  muted: boolean;
  /** 1.11: each fade's shape, −1…1 (0 linear; the fade's midpoint handle bends it). */
  fadeInShape: number;
  fadeOutShape: number;
  /** 1.11: null plays the audio at its own speed (unwarped); otherwise it follows the song's tempo. */
  warp: AudioWarp | null;
  /** 1.11: semitones (±MAX_TRANSPOSE) and cents (±MAX_DETUNE). Unwarped, they change the speed too (repitch). */
  transpose: number;
  detune: number;
  /**
   * 1.11: the source is played reversed, as a new file: `offsetS` and the warp markers' `s` are
   * in the reversed source's seconds (0 = the original's end). `reverseAudioClip` mirrors them.
   */
  reverse: boolean;
  /** 1.11: the content's loop, in content beats (warped clips only; ignored while unwarped). */
  loop: AudioLoop;
  /**
   * Review 1.36 S-6: an unwarped clip's length in seconds, set by the first tempo change that
   * rescales it (`rescaleUnwarped`), so its length in beats is worked out from the seconds each
   * time rather than rounded again at every step. Kept only while `length` still matches it at
   * the song's tempo (another edit of the length makes it stale, and it is set again). Absent on
   * older projects and from older clients, which ignore it.
   */
  sourceSeconds?: number;
  /** 1.80: up to MAX_CLIP_ENVELOPES envelopes in content time (`clipEnvelopes.ts`). Absent: none. */
  envelopes?: ClipEnvelope[];
  /** 1.109: a take (see `Clip.take`). */
  take?: number;
  /** 1.109: its take group (see `Clip.takeGroup`). */
  takeGroup?: string;
}

/**
 * A warp marker (1.11): content beat `beat` of the clip plays source second `s`. Markers are
 * sorted, strictly increasing in both, and the map between them is linear (`warpMap.ts`).
 */
export interface WarpMarker { beat: number; s: number }
/** 1.26: 'pro' is Complex Pro, Complex with the formants kept when the clip is transposed. */
export type WarpMode = 'beats' | 'complex' | 'pro';
/** Beats mode's segment grid: the detected transients, or a fixed division (Ableton's Preserve). */
export type BeatsPreserve = 'transients' | '1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32';
/** Beats mode's Transient loop mode: what fills a segment longer than its audio. */
export type TransientLoopMode = 'off' | 'forward' | 'pingpong';
export interface AudioWarp {
  mode: WarpMode;
  markers: WarpMarker[];
  /** Beats mode's settings (kept while Complex is chosen). `envelope` 0…100. */
  beats: { preserve: BeatsPreserve; loopMode: TransientLoopMode; envelope: number };
  /**
   * 1.26: Complex Pro's settings (kept while another mode is chosen; absent before 1.26: the
   * defaults). `formants` 0…100: how much of the spectral envelope is kept in place when the clip
   * is transposed; `envelope` 8…256: the envelope's detail (cepstral coefficients at 44.1 kHz;
   * lower is smoother, for higher voices).
   */
  pro?: { formants: number; envelope: number };
}
/** A clip's content loop (1.11): `start` and `length` in content beats. */
export interface AudioLoop { on: boolean; start: number; length: number }
export const BEATS_PRESERVE: readonly BeatsPreserve[] = ['transients', '1', '1/2', '1/4', '1/8', '1/16', '1/32'];
export const TRANSIENT_LOOP_MODES: readonly TransientLoopMode[] = ['off', 'forward', 'pingpong'];
export const DEFAULT_BEATS_WARP: AudioWarp['beats'] = { preserve: 'transients', loopMode: 'forward', envelope: 100 };
export const DEFAULT_PRO_WARP: NonNullable<AudioWarp['pro']> = { formants: 100, envelope: 128 };
/** Complex Pro's settings, or the defaults. */
export const proOf = (w: Pick<AudioWarp, 'pro'>): NonNullable<AudioWarp['pro']> => w.pro ?? DEFAULT_PRO_WARP;

/** The 1.11 fields of a clip with nothing set: unwarped, no transpose, no reverse, no loop, linear fades. */
export function audioClipDefaults(): Pick<AudioClip, 'fadeInShape' | 'fadeOutShape' | 'warp' | 'transpose' | 'detune' | 'reverse' | 'loop'> {
  return { fadeInShape: 0, fadeOutShape: 0, warp: null, transpose: 0, detune: 0, reverse: false, loop: { on: false, start: 0, length: BEATS_PER_BAR } };
}

/** What an automation lane drives (1.7). Values are 0…1 in the target's own range. */
export type AutomationTarget =
  | { kind: 'track'; trackId: string; param: 'volume' | 'pan' | 'mute' }
  | { kind: 'track'; trackId: string; param: 'send'; index: number }
  /** A key of FX_DEFS[type].params that is `automatable`. */
  | { kind: 'fx'; trackId: string; fxId: string; param: string }
  /** A SYNTH_PARAMS key (ANALOG) or a WAVE_PARAMS path (WAVE). */
  | { kind: 'synth'; trackId: string; param: string }
  /** 1.63: a MIDI effect's parameter on a synth track (a key of `MIDI_FX_PARAMS[type]`), applied at each note's start. */
  | { kind: 'midiFx'; trackId: string; fxId: string; param: string }
  /**
   * 1.392 (Cyber_Instruments_MIDI_Work_Order_4.md, stream 10): a MIDI track's External instrument's
   * hardware control: a controller (`control` 0–119, value/127) or the pitch bend (`'bend'`, 0.5 the
   * centre), sent to its MIDI To port at the scheduler's times (`externalControlPlayback.ts`).
   */
  | { kind: 'midiOut'; trackId: string; control: number | 'bend' }
  | { kind: 'return'; returnId: string; param: 'volume' | 'pan' }
  | { kind: 'return'; returnId: string; param: 'fx'; fxId: string; key: string }
  /** 1.111: a return's send to a later return (`ReturnBus.sends[index]`). */
  | { kind: 'return'; returnId: string; param: 'send'; index: number }
  /** 1.13: the master volume (the store's `masterGainDb`, the gain after the MASTER chain). */
  | { kind: 'master'; param: 'volume' }
  /** 1.43: a master insert's parameter (as a return's). */
  | { kind: 'master'; param: 'fx'; fxId: string; key: string }
  /** 1.118: the master's crossfader (`MasterBus.xfade`, −1…1), played on every assigned strip's crossfade gain. */
  | { kind: 'master'; param: 'xfade' }
  /**
   * The tempo map release: the song's tempo lane (Cyber_Tempo_Map_Work_Order.md §2.1), `value` 0…1
   * as 40…240 BPM (`valueToBpm` in tempoMap.ts). Read by the transport, never played on a strip.
   */
  | { kind: 'master'; param: 'tempo' };
/** `value` 0…1; `curve` −1…1 bends the segment to the next point (0 straight). */
export interface AutomationPoint { beat: number; value: number; curve: number }
export interface AutomationLane { id: string; target: AutomationTarget; points: AutomationPoint[]; on: boolean }
/** A locator (1.18): a named flag on the ruler at a beat (on ticks). Shared in live sessions. */
export interface Locator { id: string; beat: number; name: string }
export type TrackKind = Track['kind'];

/** 'grid': the SEQUENCER's grid where the pointer last was (adaptive: at that view's zoom; local to each person). */
export type RecordQuantize = Division | 'off' | 'grid';

/**
 * The tempo map release: a time-signature change at `beat` (after beat 0, on a bar line of the
 * meter before it), in force until the next (Cyber_Tempo_Map_Work_Order.md §2.1).
 */
export interface MeterPoint { beat: number; sig: TimeSig }

export interface SequencerState {
  version: 1;
  /**
   * BPM, also the SYNTH page's LFO sync and arpeggiator. The tempo map release: the tempo at beat
   * 0. While the Master's tempo lane is in force (`songTempo` in tempoMap.ts), the store and the
   * sanitiser keep it equal to the lane's value at 0, rounded to 0.01; without the lane it is the
   * song's one tempo, as before.
   */
  tempo: number;
  /** At most MAX_TRACKS (128) tracks of any kinds (1.135), exactly one of them the pads track. */
  tracks: Track[];
  clips: Clip[];
  loop: { on: boolean; start: number; end: number };
  /**
   * Unused since 1.14 (the Audio lane, the loaded file played in the song, was removed: EDIT's
   * audio is not part of the song). Since 1.17 it is ignored on load, not written and not shared
   * in live sessions; the field stays optional so older snapshots still type-check.
   */
  audioLaneMuted?: boolean;
  /** Unused since 1.14 (was where the loaded file started on the timeline, beats ≥ 0; 1.5); ignored since 1.17. */
  audioLaneStart?: number;
  /** The last scale set on a clip: a new clip starts with it (1.5), unless the song has a scale (1.376). */
  lastScale: Scale | null;
  /**
   * 1.376: the song's key and scale (Live 12's), shown in the header; absent: none. A clip with no
   * scale of its own follows it. Read every scale through `scaleOf(seq, clip?)` (`songScale.ts`).
   */
  songScale?: Scale;
  /**
   * 1.388: the song's tuning (a `.scl` with an optional `.kbm`, or a `.tun`, and a reference pitch;
   * `tuning.ts`); absent: 12-TET at A = 440. Every instrument hears it as `tuningTable`'s per-note table.
   */
  tuning?: SongTuning;
  /** Per person (not shared in live sessions). */
  selectedTrackId: string | null;
  /** Per person (not shared in live sessions). */
  armedTrackId: string | null;
  /** 1.369: every armed track (multi-arm), valid only while its first is `armedTrackId`; read through `armedIds` (`multiArm.ts`). Per person. */
  armedTrackIds?: string[];
  metronome: boolean;
  recordQuantize: RecordQuantize;
  /** The mixer's returns (1.6: two; 1.8: two to four; 1.74: none to eight, in RETURN_IDS order). */
  returns: ReturnBus[];
  /**
   * 1.43: the DAW master strip's inserts (Cyber_Tools_Stages_Work_Order.md §2): any insert type, at
   * most MAX_FX. Before 1.43 the song played through the engine's chain; a snapshot without this
   * gets one built from its chain and module params (`migrateMasterFromChain`), so it sounds the
   * same. The chain stays, as the Editor's effects on the file.
   */
  master: MasterBus;
  /** Audio clips on the audio tracks (1.7). */
  audioClips: AudioClip[];
  /** Automation lanes (1.7), at most one per target. */
  automation: AutomationLane[];
  /** 1.13: the Master row's height on the timeline (px); absent: the default. */
  masterHeight?: number;
  /**
   * 1.18: the locators, sorted by beat (then id), at most MAX_LOCATORS. Export, bounce and
   * Follow ignore them; Delete Time and Insert Silence ripple them (`timeEdits.ts`).
   */
  locators: Locator[];
  /**
   * 1.25: the Session view's grid (Cyber_Session_View_Plan.md §2): scenes, the clips in its slots
   * and the launch quantisation. Absent before 1.25 (and until the grid is first edited):
   * `sessionOf` gives the default, eight empty scenes.
   */
  session?: SessionState;
  /**
   * 1.112: the song's time signature (one meter for the whole song): the ruler's and the grid's
   * bars, bar:beat positions, the click's accent, recording's and new clips' bars. Absent: 4/4
   * (`songSig`, `barBeats` in arrangement.ts, the one reader). A Session scene with its own `sig`
   * overrides it while that scene plays (`barBeatsOf`). The tempo map release: the signature at
   * beat 0; its changes after 0 are `meterMap`.
   */
  sig?: TimeSig;
  /**
   * The tempo map release (Cyber_Tempo_Map_Work_Order.md §2.1): the time-signature changes after
   * beat 0, sorted, each on a bar line of the meter before it and different from it, at most
   * MAX_METER_POINTS (`sanitiseMeterMap`). Absent: none. Read through `songMeter` (meterMap.ts).
   */
  meterMap?: MeterPoint[];
  /** 1.358: the groove pool (`groove.ts`): up to MAX_GROOVES grooves clips name by id. Absent: none. */
  grooves?: Groove[];
  /** 1.358: the pool's global amount, percent 0…130. Absent: 100. */
  grooveAmount?: number;
  /**
   * 1.133 (Cyber_Mixer_Inspector_Work_Order.md §2 "The master at +6"): the master-volume lane's
   * points are normalised along the tracks' taper (linear −48…+6 dB, 0 silent). Absent: a song
   * written before, whose master-volume points were on the knee taper (+12 at the top); the
   * sanitiser moves them onto the tracks' taper at the same dB (`migrateMasterLaneTaper`) and
   * writes the flag, so it runs once.
   */
  masterTaper?: 'track';
}

export const RECORD_QUANTIZE: readonly RecordQuantize[] = ['off', 'grid', '1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T'];

/** Track colours, in the order tracks are added. */
export const TRACK_COLORS = ['265 62% 58%', '190 70% 45%', '330 65% 55%', '40 85% 50%', '140 50% 45%'] as const;
export const PADS_COLOR = '15 80% 55%';
/** 1.29: the Drum Rack tracks' colours (warm, beside the pads track's). */
export const DRUM_TRACK_COLORS = ['24 85% 55%', '355 72% 58%', '48 85% 52%', '8 70% 50%'] as const;
/** Audio tracks' colours (1.7): cooler than the synths', so a lane of waveforms reads apart. */
export const AUDIO_COLORS = ['200 55% 50%', '160 45% 45%', '220 50% 60%', '180 40% 50%'] as const;
/** Group tracks' colours (1.8): neutral, so the members' colours stand out. */
export const GROUP_COLORS = ['0 0% 62%', '220 10% 58%', '30 12% 58%', '260 10% 62%'] as const;
/**
 * 1.79: the returns' colours, by index (A to H): cool tones (A near `--cyber-cool`, the colour
 * every return had before), apart from one another.
 */
export const RETURN_COLORS = [
  '195 85% 60%', '235 65% 68%', '170 60% 45%', '210 75% 60%', '255 50% 62%', '185 50% 55%', '225 40% 55%', '160 40% 55%',
] as const;
/**
 * The one colour picker's set, every kind's (tracks, returns, scenes and clips). 1.79: sixteen (the
 * synth tracks' five, the pads track's, the Drum Racks' four, the audio tracks' four and the first
 * two group greys). Since the polish release P3: fifty, laid out for a grid of 10 columns (5 rows):
 * row 1 a light shade of ten hues, rows 2–3 the sixteen (unchanged in name and value: the Game and
 * the tests read them) with six mid hues among them in hue order, row 4 a deep shade of the ten hues
 * of row 1, row 5 the greys from near-white to Charcoal (six dark greys among them). No two are
 * closer than ΔE2000 7 apart, except two greys (at least 4.9: Graphite and Charcoal, 4.96). Named, as the picker labels
 * them. The per-kind lists above stay the defaults.
 */
export const PALETTE: readonly { value: string; name: string }[] = [
  // Row 1: light shades.
  { value: '355 80% 78%', name: 'Blush' }, { value: '24 85% 76%', name: 'Peach' }, { value: '50 85% 72%', name: 'Butter' },
  { value: '100 50% 70%', name: 'Pistachio' }, { value: '165 50% 68%', name: 'Seafoam' }, { value: '195 70% 76%', name: 'Ice' },
  { value: '222 75% 78%', name: 'Cornflower' }, { value: '265 65% 80%', name: 'Lavender' }, { value: '300 50% 76%', name: 'Orchid' },
  { value: '330 75% 80%', name: 'Candy' },
  // Rows 2–3: the sixteen of 1.79 and six mid hues.
  { value: DRUM_TRACK_COLORS[1], name: 'Red' }, { value: DRUM_TRACK_COLORS[0], name: 'Orange' }, { value: TRACK_COLORS[3], name: 'Amber' },
  { value: DRUM_TRACK_COLORS[2], name: 'Yellow' }, { value: '80 60% 45%', name: 'Lime' }, { value: TRACK_COLORS[4], name: 'Green' },
  { value: AUDIO_COLORS[1], name: 'Jade' }, { value: AUDIO_COLORS[3], name: 'Aqua' }, { value: TRACK_COLORS[1], name: 'Teal' },
  { value: AUDIO_COLORS[0], name: 'Sky' },
  { value: DRUM_TRACK_COLORS[3], name: 'Rust' }, { value: PADS_COLOR, name: 'Coral' }, { value: TRACK_COLORS[2], name: 'Pink' },
  { value: '315 60% 50%', name: 'Magenta' }, { value: '285 45% 60%', name: 'Purple' }, { value: TRACK_COLORS[0], name: 'Violet' },
  { value: '245 50% 62%', name: 'Indigo' }, { value: AUDIO_COLORS[2], name: 'Periwinkle' }, { value: '210 85% 52%', name: 'Azure' },
  { value: '185 75% 50%', name: 'Cyan' },
  // Row 4: deep shades of row 1's hues.
  { value: '355 60% 34%', name: 'Maroon' }, { value: '24 60% 32%', name: 'Brown' }, { value: '50 60% 30%', name: 'Olive' },
  { value: '120 45% 28%', name: 'Forest' }, { value: '165 55% 26%', name: 'Pine' }, { value: '195 65% 28%', name: 'Petrol' },
  { value: '222 60% 34%', name: 'Navy' }, { value: '265 45% 36%', name: 'Plum' }, { value: '295 40% 32%', name: 'Grape' },
  { value: '330 55% 34%', name: 'Wine' },
  // Row 5: the greys, light to dark.
  { value: '0 0% 82%', name: 'Silver' }, { value: '220 10% 72%', name: 'Mist' }, { value: GROUP_COLORS[0], name: 'Grey' },
  { value: GROUP_COLORS[1], name: 'Slate' }, { value: '0 0% 52%', name: 'Smoke' }, { value: '0 0% 46%', name: 'Ash' },
  { value: '215 8% 40%', name: 'Gunmetal' }, { value: '220 5% 34%', name: 'Iron' }, { value: '220 6% 28%', name: 'Graphite' },
  { value: '220 6% 22%', name: 'Charcoal' },
];
/** A return's default colour (1.79), by its index. */
export const returnColorAt = (index: number): string => RETURN_COLORS[((index % RETURN_COLORS.length) + RETURN_COLORS.length) % RETURN_COLORS.length]!;

// --- Helpers ------------------------------------------------------------------------------

/** A position rounded to the tick grid. */
export function tk(beats: number): number {
  return Math.round(beats * TICKS_PER_BEAT) / TICKS_PER_BEAT;
}

let idCounter = 0;
/** A short unique id (unique enough for one project; peers mix in randomness). */
export function newId(prefix = ''): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36).slice(-5)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function isSynthTrack(t: Track | undefined | null): t is SynthTrack {
  return !!t && t.kind === 'synth';
}

/** 1.29: a Drum Rack track. */
export function isDrumTrack(t: Track | undefined | null): t is DrumTrack {
  return !!t && t.kind === 'synth' && t.engine === 'drums';
}

/** EST Phase 3: an EST instrument track (`engine: 'est'`). */
export function isEstTrack(t: Track | undefined | null): t is EstTrack {
  return !!t && t.kind === 'synth' && t.engine === 'est';
}

/** EST Phase 3: the block an EST instrument track plays (its `patch`), or null for any other track. */
export function estTrackBlock(t: Track | undefined | null): EstSlotBlock | null {
  return isEstTrack(t) ? t.patch : null;
}

/** A synth track with a melodic instrument (not a Drum Rack, not Cyber PADS, not a MIDI track; the four-synth limit counts these). EST Phase 3: an EST instrument is one. */
export function isMelodicSynth(t: Track | undefined | null): t is Exclude<SynthTrack, DrumTrack | CyberPadsTrack | MidiTrack> {
  return !!t && t.kind === 'synth' && t.engine !== 'drums' && t.engine !== 'pads' && t.engine !== 'none';
}

/** 1.256: a Cyber PADS track (a synth track whose instrument is the project's pad kit). */
export function isCyberPads(t: Track | undefined | null): t is CyberPadsTrack {
  return !!t && t.kind === 'synth' && t.engine === 'pads';
}

/**
 * 1.256: whether a track plays the project's pad kit (`store.sample`): the pads track, or a Cyber PADS
 * track. Its notes are pad rows (0 is pad 1, `PAD_ROWS`), its keys the pad keys, its window the
 * Slicer. Ask this where the pads track's notes or keys are meant; ask `kind === 'pads'` only for
 * the track kind itself (at most one, Add track ▸ Pads, its own MIDI file channel).
 */
export function playsKit(t: Track | undefined | null): t is PadsTrack | CyberPadsTrack {
  return !!t && (t.kind === 'pads' || (t.kind === 'synth' && t.engine === 'pads'));
}

/** 1.256: the kind whose note rules a track's notes follow: `'pads'` for a track that plays the kit, else its kind. */
export function noteKindOf(t: Pick<Track, 'kind'> & { engine?: SynthEngine }): TrackKind {
  return t.kind === 'synth' && t.engine === 'pads' ? 'pads' : t.kind;
}

/**
 * 1.256: whether a synth track's instrument is a node of its own (`synthFor`): every engine but a
 * MIDI track's (`'none'`) and Cyber PADS (`'pads'`, the sample player's voices into its strip).
 * EST Phase 3: an EST track has one (`EstInstrumentNode`, silent while a placeholder).
 */
export function hasSynthNode(t: Track | undefined | null): t is Exclude<SynthTrack, MidiTrack | CyberPadsTrack> {
  return !!t && t.kind === 'synth' && t.engine !== 'none' && t.engine !== 'pads';
}

/** 1.88: a synth track with an instrument (false for a MIDI track, `engine: 'none'`, and every other kind). */
export function hasInstrument(t: Track | undefined | null): t is InstrumentTrack {
  return !!t && t.kind === 'synth' && t.engine !== 'none';
}

/** 1.88: a MIDI track (a synth track with no instrument). */
export function isMidiTrack(t: Track | undefined | null): t is MidiTrack {
  return !!t && t.kind === 'synth' && t.engine === 'none';
}

/** The uploads a track's instrument plays: a SAMPLER's sample, a Drum Rack's sample pads (1.29). */
export function instrumentHashes(t: Track): string[] {
  if (t.kind !== 'synth') return [];
  if (t.engine === 'sampler') return samplerHashes(t.patch);
  if (t.engine === 'drums') return kitHashes(t.patch);
  // EST Phase 3: an EST instrument plays no upload (its state blob is no audio: `uploadUses` names it apart).
  if (t.engine === 'est') return [];
  // 1.371: an Instrument Rack's SAMPLER chains' samples.
  if (t.engine === 'rack') return rackHashes(t.patch);
  return [];
}

/** The synth track the SYNTH page plays: the selected track when it is a synth, else the first. */
/** The arpeggiator the keys play (1.19): the selected synth track's, or null with no synth track. */
export function selectedArp(s: Pick<SequencerState, 'tracks' | 'selectedTrackId'>): ArpState | null {
  return selectedSynthTrack(s)?.arp ?? null;
}

export function selectedSynthTrack(s: Pick<SequencerState, 'tracks' | 'selectedTrackId'>): SynthTrack | null {
  const sel = s.tracks.find(t => t.id === s.selectedTrackId);
  if (isSynthTrack(sel)) return sel;
  return (s.tracks.find(isSynthTrack) as SynthTrack | undefined) ?? null;
}

export function isAudioTrack(t: Track | undefined | null): t is AudioTrack {
  return !!t && t.kind === 'audio';
}

export function padsTrack(s: Pick<SequencerState, 'tracks'>): PadsTrack | null {
  return (s.tracks.find(t => t.kind === 'pads') as PadsTrack | undefined) ?? null;
}

/** A pad's level change for a velocity: 0 dB at 100, −12 dB at 1, on the same slope above 100 (§2). */
export function velocityDb(velocity: number): number {
  return ((Math.max(1, Math.min(127, velocity)) - 100) * 12) / 99;
}

export function clipEnd(c: Pick<Clip, 'start' | 'length'>): number {
  return c.start + c.length;
}

/** Where the last clip (of notes or audio) ends (beats), or 0. */
export function songEnd(s: Pick<SequencerState, 'clips'> & { audioClips?: readonly AudioClip[] }): number {
  const notes = s.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  return (s.audioClips ?? []).reduce((m, c) => Math.max(m, clipEnd(c)), notes);
}

/** One lane per target: a stable key for it. */
export function automationTargetKey(t: AutomationTarget): string {
  switch (t.kind) {
    case 'track': return t.param === 'send' ? `track:${t.trackId}:send:${t.index}` : `track:${t.trackId}:${t.param}`;
    case 'fx': return `fx:${t.trackId}:${t.fxId}:${t.param}`;
    case 'synth': return `synth:${t.trackId}:${t.param}`;
    case 'midiFx': return `midiFx:${t.trackId}:${t.fxId}:${t.param}`;
    case 'midiOut': return `midiOut:${t.trackId}:${t.control}`;
    case 'return': return t.param === 'fx' ? `return:${t.returnId}:fx:${t.fxId}:${t.key}` : t.param === 'send' ? `return:${t.returnId}:send:${t.index}` : `return:${t.returnId}:${t.param}`;
    case 'master': return t.param === 'fx' ? `master:fx:${t.fxId}:${t.key}` : `master:${t.param}`;
  }
}

/** The track a lane belongs to (a return's lanes and the master's: null). */
export function automationTrackId(t: AutomationTarget): string | null {
  return t.kind === 'return' || t.kind === 'master' ? null : t.trackId;
}

/** The id of the Master row on the timeline (1.13); no track or return has it. */
export const MASTER_ROW_ID = 'master';

/** The timeline row a lane sits under (1.13): its track, its return, or the Master row. */
export function automationRowId(t: AutomationTarget): string {
  return t.kind === 'return' ? t.returnId : t.kind === 'master' ? MASTER_ROW_ID : t.trackId;
}

// --- Defaults ------------------------------------------------------------------------------

/**
 * An ANALOG track, named "Analog n" (1.17; "Synth n" before, which older projects keep), so the
 * SEQ and the SYNTH page's tabs say the same.
 */
export function defaultSynthTrack(n: number, patch: SynthPatch = defaultSynthPatch(), id = newId('t')): AnalogTrack {
  return {
    id, kind: 'synth', engine: 'analog', name: `Analog ${n}`, color: TRACK_COLORS[(n - 1) % TRACK_COLORS.length]!,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(), patch, presetId: null, modified: false, arp: defaultArpState(),
  };
}

/** A WAVE track (1.6), named "Wave n". */
export function defaultWaveTrack(n: number, patch: WavePatch = defaultWavePatch(), id = newId('t'), colorIndex = n - 1): WaveTrack {
  return {
    id, kind: 'synth', engine: 'wave', name: `Wave ${n}`, color: TRACK_COLORS[(colorIndex + 1) % TRACK_COLORS.length]!,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(), patch, presetId: null, modified: false, arp: defaultArpState(),
  };
}

/** A SAMPLER track (1.22), named "Sampler n". */
export function defaultSamplerTrack(n: number, patch: SamplerPatch = defaultSamplerPatch(), id = newId('t'), colorIndex = n - 1): SamplerTrack {
  return {
    id, kind: 'synth', engine: 'sampler', name: `Sampler ${n}`, color: TRACK_COLORS[(colorIndex + 2) % TRACK_COLORS.length]!,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(), patch, presetId: null, modified: false, arp: defaultArpState(),
  };
}

/** An FM track (1.27), named "FM n". */
export function defaultFmTrack(n: number, patch: FmPatch = defaultFmPatch(), id = newId('t'), colorIndex = n - 1): FmTrack {
  return {
    id, kind: 'synth', engine: 'fm', name: `FM ${n}`, color: TRACK_COLORS[(colorIndex + 3) % TRACK_COLORS.length]!,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(), patch, presetId: null, modified: false, arp: defaultArpState(),
  };
}

/** An 8-BIT track (1.198), named "8-bit n". */
export function defaultChipTrack(n: number, patch: ChipPatch = defaultChipPatch(), id = newId('t'), colorIndex = n - 1): ChipTrack {
  return {
    id, kind: 'synth', engine: 'chip', name: `8-bit ${n}`, color: TRACK_COLORS[(colorIndex + 4) % TRACK_COLORS.length]!,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(), patch, presetId: null, modified: false, arp: defaultArpState(),
  };
}

/** A Drum Rack track (1.29), named "Drums n", with the Hybrid kit. */
export function defaultDrumTrack(n: number, patch: DrumKit = defaultDrumKit(), id = newId('t'), colorIndex = n - 1): DrumTrack {
  return {
    id, kind: 'synth', engine: 'drums', name: `Drums ${n}`, color: DRUM_TRACK_COLORS[colorIndex % DRUM_TRACK_COLORS.length]!,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(), patch, presetId: 'drums:hybrid', modified: false, arp: defaultArpState(),
  };
}

/**
 * 1.88: the instrument a track gets when its engine is set to `engine` (`setTrackEngine`): that
 * engine's default patch and preset; `'none'` (a MIDI track) has no patch.
 */
export function defaultInstrument(engine: Exclude<SynthEngine, 'est'>): Pick<SynthTrack, 'engine' | 'patch' | 'presetId'> {
  // EST Phase 3: `'est'` has no default (a track becomes one only from an installed plugin, `estTrackBlockFor`).
  switch (engine) {
    case 'none': return { engine: 'none', patch: null, presetId: null };
    case 'wave': { const t = defaultWaveTrack(1, undefined, ''); return { engine: t.engine, patch: t.patch, presetId: t.presetId }; }
    case 'sampler': { const t = defaultSamplerTrack(1, undefined, ''); return { engine: t.engine, patch: t.patch, presetId: t.presetId }; }
    case 'fm': { const t = defaultFmTrack(1, undefined, ''); return { engine: t.engine, patch: t.patch, presetId: t.presetId }; }
    case 'chip': { const t = defaultChipTrack(1, undefined, ''); return { engine: t.engine, patch: t.patch, presetId: t.presetId }; }
    case 'drums': { const t = defaultDrumTrack(1, undefined, ''); return { engine: t.engine, patch: t.patch, presetId: t.presetId }; }
    // 1.256: Cyber PADS keeps nothing per track: the kit is the project's.
    case 'pads': return { engine: 'pads', patch: {}, presetId: null };
    case 'analog': { const t = defaultSynthTrack(1, undefined, ''); return { engine: t.engine, patch: t.patch, presetId: t.presetId }; }
    // 1.356: a rack of one ANALOG chain.
    case 'rack': return { engine: 'rack', patch: defaultRackPatch(), presetId: null };
  }
}

/** 1.88: a MIDI track (no instrument), named "MIDI n". */
export function defaultMidiTrack(n: number, id = newId('t'), colorIndex = n - 1): MidiTrack {
  return {
    id, kind: 'synth', engine: 'none', name: `MIDI ${n}`, color: TRACK_COLORS[colorIndex % TRACK_COLORS.length]!,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(), patch: null, presetId: null, modified: false, arp: defaultArpState(),
  };
}

/** 1.256: a Cyber PADS track, named "Cyber PADS n": a MIDI track playing the project's pad kit. */
export function defaultCyberPadsTrack(n: number, id = newId('t')): CyberPadsTrack {
  return {
    id, kind: 'synth', engine: 'pads', name: `Cyber PADS ${n}`, color: PADS_COLOR,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(), patch: {}, presetId: null, modified: false, arp: defaultArpState(),
  };
}

/**
 * Whether a track is a synth or MIDI track that is not a Drum Rack (1.88: a MIDI track included).
 * Until 1.135 these shared the four synth slots; there is no per-kind cap since, only MAX_TRACKS.
 */
export function usesSynthSlot(t: Track | undefined | null): boolean {
  return !!t && t.kind === 'synth' && t.engine !== 'drums';
}

export function defaultPadsTrack(id = newId('t')): PadsTrack {
  return { id, kind: 'pads', name: 'Pads', color: PADS_COLOR, mute: false, solo: false, volume: 0, swing: 0, ...defaultMix() };
}

/** An audio track (1.7), named "Audio n". */
export function defaultAudioTrack(n: number, id = newId('t')): AudioTrack {
  return {
    id, kind: 'audio', name: `Audio ${n}`, color: AUDIO_COLORS[(n - 1) % AUDIO_COLORS.length]!,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(), monitor: false,
  };
}

/** A group track (1.8), named "Group n". */
export function defaultGroupTrack(n: number, id = newId('t')): GroupTrack {
  return {
    id, kind: 'group', name: `Group ${n}`, color: GROUP_COLORS[(n - 1) % GROUP_COLORS.length]!,
    mute: false, solo: false, volume: 0, swing: 0, ...defaultMix(),
  };
}

/** A new return (1.8): empty, named by its letter. */
export function defaultReturn(id: ReturnId): ReturnBus {
  return { id, name: `Return ${returnLetter(id)}`, volume: 0, pan: 0, mute: false, fx: [], color: returnColorAt(RETURN_IDS.indexOf(id)) };
}

/** A track's mixer settings when new (or from before 1.6): centred, no sends, no effects. */
export function defaultMix(): { pan: number; sends: number[]; fx: FxSlot[] } {
  return { pan: 0, sends: [], fx: [] }; // one per return: sanitiseSequencerState's fitMix sizes them
}

/** The returns of a new project: a reverb on A, a delay on B (seeded ids, so every project's match). */
export function defaultReturns(): ReturnBus[] {
  return [
    { id: 'ret-a', name: 'Reverb', volume: 0, pan: 0, mute: false, fx: [{ ...defaultFx('reverb', 'ret-a-reverb'), params: { ...defaultFx('reverb').params, mix: 1 } }], color: RETURN_COLORS[0] },
    { id: 'ret-b', name: 'Delay', volume: 0, pan: 0, mute: false, fx: [{ ...defaultFx('delay', 'ret-b-delay'), params: { ...defaultFx('delay').params, mix: 1 } }], color: RETURN_COLORS[1] },
  ];
}

/** Each chain module's Cyber insert type, and its seeded slot id on the master (1.43). */
export const MODULE_INSERT: Readonly<Record<ModuleId, { type: CyberType; id: string }>> = Object.freeze({
  eq: { type: 'cyberEq', id: 'master-eq' },
  dynamics: { type: 'cyberComp', id: 'master-comp' },
  saturation: { type: 'cyberSat', id: 'master-sat' },
  maximizer: { type: 'cyberLimit', id: 'master-limit' },
});

/** The module params a chain migration reads (the snapshot's MASTER slices). */
export interface ChainParams {
  eq: EQParams;
  dynamics: DynamicsParams;
  saturation: SaturationParams;
  maximizer: MaximizerParams;
}

/**
 * 1.43: the master inserts that sound as `chain` with `params` did: one Cyber slot per chain entry,
 * in the chain's order, on as the module was enabled, its params converted (`eqToSlot`,
 * `cyberPatch`). Seeded ids, so two peers migrating the same song get the same slots.
 */
export function migrateMasterFromChain(chain: readonly ChainModule[], params: ChainParams): MasterBus {
  const fx: FxSlot[] = [];
  const seen = new Set<ModuleId>();
  for (const c of chain) {
    const m = MODULE_INSERT[c.id];
    if (!m || seen.has(c.id)) continue;
    seen.add(c.id);
    const base = defaultFx(m.type, m.id);
    const conv = c.id === 'eq' ? eqToSlot(params.eq) : cyberPatch(m.type, params[c.id]);
    fx.push({ ...base, on: c.enabled, params: { ...base.params, ...conv } });
  }
  return { fx: sanitiseFxList(fx) };
}

/**
 * A new song's master (P3): no inserts. (1.43 to P3: the four Cyber inserts of the old chain at
 * their defaults.) A saved song keeps its own; a pre-1.43 snapshot still gets its master from its
 * chain (`migrateMasterFromChain`).
 */
export function defaultMaster(): MasterBus {
  return { fx: [] };
}

/** The master from anything (1.43): its inserts sanitised as a return's; absent or broken, the default. */
export function sanitiseMaster(raw: unknown): MasterBus {
  if (!isObj(raw) || !Array.isArray(raw.fx)) return defaultMaster();
  // 1.118: the crossfader, kept only off the middle (a song without one keeps its shape).
  const xfade = sanitiseXfade(raw.xfade);
  return { fx: sanitiseFxList(raw.fx), ...(xfade ? { xfade } : {}) };
}

/** A new project's sequencer: Analog 1 (id `synth-1`) and the pads, no clips. */
export function defaultSequencerState(): SequencerState {
  const returns = defaultReturns();
  const sends = () => returns.map(() => 0); // one per return (1.74: defaultMix has none)
  const synth = { ...defaultSynthTrack(1, defaultSynthPatch(), 'synth-1'), sends: sends() };
  return {
    version: 1,
    tempo: 120,
    tracks: [synth, { ...defaultPadsTrack('pads'), sends: sends() }],
    clips: [],
    loop: { on: false, start: 0, end: 4 * BEATS_PER_BAR },
    lastScale: null,
    selectedTrackId: synth.id,
    armedTrackId: null,
    metronome: false,
    recordQuantize: 'off',
    returns,
    master: defaultMaster(),
    audioClips: [],
    automation: [],
    locators: [],
    masterTaper: 'track',
  };
}

/**
 * The next free "Analog n" (or "Wave n", "Audio n", "Group n") number. An ANALOG track's number is
 * also taken by an older project's "Synth n" (its name before 1.17), so no two tracks share one.
 */
export function nextSynthNumber(tracks: readonly Track[], prefix = 'Analog'): number {
  const re = new RegExp(`^${prefix === 'Analog' ? '(?:Analog|Synth)' : prefix} (\\d+)$`);
  const used = new Set(tracks.map(t => re.exec(t.name)?.[1]).filter(Boolean).map(Number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// --- Sanitising ------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, min: number, max: number, d: number) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR_RE = /^\d{1,3}(\.\d+)? \d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/;
const id = (v: unknown): string | null => (typeof v === 'string' && ID_RE.test(v) ? v : null);
const color = (v: unknown, d: string) => (typeof v === 'string' && COLOR_RE.test(v) ? v : d);
const name = (v: unknown, d: string) => {
  if (typeof v !== 'string') return d;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return s || d;
};

/** A note in range for its track's kind and its clip's content, or null. */
export function sanitiseNote(raw: unknown, kind: TrackKind, contentLength: number): Note | null {
  if (!isObj(raw)) return null;
  const nid = id(raw.id);
  if (!nid) return null;
  const maxPitch = kind === 'pads' ? PAD_ROWS - 1 : 127;
  if (typeof raw.pitch !== 'number' || !Number.isFinite(raw.pitch)) return null;
  const pitch = Math.round(raw.pitch);
  if (pitch < 0 || pitch > maxPitch) return null;
  const start = tk(num(raw.start, 0, MAX_BEATS, -1));
  if (start < 0 || start >= contentLength) return null;
  const length = tk(num(raw.length, 1 / TICKS_PER_BEAT, MAX_BEATS, 0.25));
  const note: Note = { id: nid, pitch, start, length: Math.max(1 / TICKS_PER_BEAT, length), velocity: Math.round(num(raw.velocity, 1, 127, 100)) };
  if (raw.muted === true) note.muted = true;
  // 1.354: chance and velocity range (absent: always, none).
  if (typeof raw.chance === 'number' && Number.isFinite(raw.chance)) {
    const c = Math.round(Math.min(100, Math.max(0, raw.chance)));
    if (c < 100) note.chance = c;
  }
  if (typeof raw.velRange === 'number' && Number.isFinite(raw.velRange)) {
    const r = Math.round(Math.min(127, Math.max(-127, raw.velRange)));
    if (r !== 0) note.velRange = r;
  }
  // 1.377: MPE note expression (a synth track's notes only).
  if (kind !== 'pads' && raw.mpe !== undefined) {
    const mpe = sanitiseNoteMpe(raw.mpe, note.length);
    if (mpe) note.mpe = mpe;
  }
  return note;
}

/** A clip in range, its notes checked, or null (no id, or a track that is not there). */
export function sanitiseClip(raw: unknown, tracks: readonly Track[]): Clip | null {
  if (!isObj(raw)) return null;
  const cid = id(raw.id);
  const track = tracks.find(t => t.id === raw.trackId);
  if (!cid || !track) return null;
  const start = tk(num(raw.start, 0, MAX_BEATS - 1 / TICKS_PER_BEAT, 0));
  const length = tk(Math.min(MAX_BEATS - start, num(raw.length, 1 / TICKS_PER_BEAT, MAX_BEATS, BEATS_PER_BAR)));
  const contentLength = tk(num(raw.contentLength, 1, MAX_BEATS, BEATS_PER_BAR));
  const offset = tk(num(raw.offset, 0, contentLength, 0)) % contentLength;
  if (track.kind === 'audio' || track.kind === 'group') return null; // audio clips only, or none
  const scale = track.kind === 'synth' ? sanitiseScale(raw.scale) : null;
  const humanise = sanitiseHumanise(raw.humanise);
  const velocity = sanitiseClipVelocity(raw.velocity);
  const envelopes = sanitiseClipEnvelopes(raw.envelopes);
  const groove = sanitiseGrooveRef(raw.groove);
  const program = track.kind === 'synth' ? sanitiseClipProgram(raw.program) : undefined;
  // 1.482: a Step Sequencer clip's rows (pad rows on a track that plays a kit).
  const steps = sanitiseStepClip(raw.steps, noteKindOf(track) === 'pads' ? PAD_ROWS - 1 : 127);
  const notes: Note[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.notes)) {
    for (const n of raw.notes) {
      if (notes.length >= MAX_NOTES) break;
      const note = sanitiseNote(n, track.kind, contentLength);
      if (note && !seen.has(note.id)) { seen.add(note.id); notes.push(note); }
    }
  }
  return {
    id: cid, trackId: track.id, name: name(raw.name, 'Clip'), color: color(raw.color, track.color),
    start, length: Math.max(1 / TICKS_PER_BEAT, length), contentLength, offset, notes, muted: bool(raw.muted, false),
    ...(scale ? { scale } : {}),
    ...(humanise ? { humanise } : {}),
    ...(velocity !== undefined ? { velocity } : {}),
    ...(envelopes ? { envelopes } : {}),
    ...(groove ? { groove } : {}),
    ...(program ? { program } : {}),
    ...(steps ? { steps } : {}),
    ...sanitiseTakeFields(raw),
  };
}

/** 1.109: the most take lanes a track has (a take's number is 1…MAX_TAKE). */
export const MAX_TAKE = 64;
/** 1.109: a clip's `take` and `takeGroup` in range (a take with no group is given none: it is still a take). */
export function sanitiseTakeFields(raw: Record<string, unknown>): { take?: number; takeGroup?: string } {
  const out: { take?: number; takeGroup?: string } = {};
  if (typeof raw.take === 'number' && Number.isInteger(raw.take) && raw.take >= 1 && raw.take <= MAX_TAKE) out.take = raw.take;
  const g = id(raw.takeGroup);
  if (g) out.takeGroup = g;
  return out;
}

/**
 * 1.109: at most `max` items, valid ones in order; over it, takes are dropped first, the oldest
 * (lowest take number, then the earliest in the list) first, then the rest from the end.
 */
export function capWithTakes<T extends { take?: number }>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  let over = list.length - max;
  const takes = list.map((c, i) => ({ c, i })).filter(x => x.c.take !== undefined).sort((a, b) => a.c.take! - b.c.take! || a.i - b.i);
  const gone = new Set<T>();
  for (const t of takes) { if (over <= 0) break; gone.add(t.c); over--; }
  return list.filter(c => !gone.has(c)).slice(0, max);
}

/** EST 1.1 (1.327): an audio track's `estOut` (a track id and a pair 1…3), or nothing. */
function estOutOf(raw: unknown): { estOut?: { trackId: string; pair: number } } {
  if (!isObj(raw) || typeof raw.trackId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.trackId)) return {};
  const pair = raw.pair;
  if (typeof pair !== 'number' || !Number.isInteger(pair) || pair < 1 || pair > 3) return {};
  return { estOut: { trackId: raw.trackId, pair } };
}

/** 1.80: a clip's velocity scale in range (whole percent), or undefined for none (100). */
export function sanitiseClipVelocity(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const v = Math.round(Math.min(MAX_CLIP_VELOCITY, Math.max(MIN_CLIP_VELOCITY, raw)));
  return v === DEFAULT_CLIP_VELOCITY ? undefined : v;
}

/** A target as a string key: 'volume', 'pan', 'send:<i>', 'est:<slot>:<param>', 'midi:bend', 'midi:pressure', 'midi:cc:<n>'. */
export function clipEnvelopeKey(t: ClipEnvelopeTarget): string {
  if (typeof t === 'string') return t;
  if ('midi' in t) return t.midi === 'cc' ? `midi:cc:${t.cc}` : `midi:${t.midi}`;
  return 'est' in t ? `est:${t.est}:${t.param}` : `send:${t.send}`;
}

/** 1.80: an envelope target, or null (a send's index must name a possible return). */
export function sanitiseEnvelopeTarget(raw: unknown): ClipEnvelopeTarget | null {
  if (raw === 'volume' || raw === 'pan') return raw;
  if (isObj(raw) && typeof raw.send === 'number' && Number.isInteger(raw.send) && raw.send >= 0 && raw.send < MAX_RETURNS) return { send: raw.send };
  // EST 1.1 (1.327): an EST insert's parameter (its slot id, its CLAP id).
  if (isObj(raw) && typeof raw.est === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.est) && typeof raw.param === 'number' && Number.isInteger(raw.param) && raw.param >= 0 && raw.param <= 0xffffffff) return { est: raw.est, param: raw.param };
  // 1.351: a MIDI clip's recorded expression (the bend, pressure, a controller below 120).
  if (isObj(raw) && (raw.midi === 'bend' || raw.midi === 'pressure')) return { midi: raw.midi };
  if (isObj(raw) && raw.midi === 'cc' && typeof raw.cc === 'number' && Number.isInteger(raw.cc) && raw.cc >= 0 && raw.cc < 120) return { midi: 'cc', cc: raw.cc };
  return null;
}

/** 1.387: an unlinked envelope's loop in range (on ticks; `offset` within the loop when it loops), or undefined (linked). */
export function sanitiseEnvelopeLoop(raw: unknown): EnvelopeLoop | undefined {
  if (!isObj(raw)) return undefined;
  const start = tk(num(raw.start, 0, MAX_BEATS, 0));
  const length = tk(num(raw.length, MIN_ENVELOPE_LOOP, MAX_BEATS, BEATS_PER_BAR));
  const loop = bool(raw.loop, true);
  const off = num(raw.offset, 0, MAX_BEATS, 0);
  const offset = tk(loop ? ((off % length) + length) % length : off);
  return { start, length, loop, offset: offset >= length && loop ? 0 : offset };
}

/**
 * 1.80: a clip's envelopes in range, or undefined when none is left: at most MAX_CLIP_ENVELOPES,
 * one per target (the first kept), each with its points as a lane's (`sanitisePoints`) and at
 * least one. Beats are content beats, 0…MAX_BEATS: points past the clip's content are kept (an
 * edit that shortens the content and one that lengthens it again give the curve back) and never
 * reached while it is shorter (`clipEnvelopes.ts` wraps at the content's length).
 */
export function sanitiseClipEnvelopes(raw: unknown): ClipEnvelope[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ClipEnvelope[] = [];
  const seen = new Set<string>();
  let strip = 0, midi = 0;
  for (const e of raw.slice(0, (MAX_CLIP_ENVELOPES + MAX_MIDI_ENVELOPES) * 4)) {
    if (!isObj(e)) continue;
    const target = sanitiseEnvelopeTarget(e.target);
    if (!target) continue;
    const isMidi = isMidiEnvelopeTarget(target);
    // 1.351: the strip's three and the instrument's four are counted apart.
    if (isMidi ? midi >= MAX_MIDI_ENVELOPES : strip >= MAX_CLIP_ENVELOPES) continue;
    const key = clipEnvelopeKey(target);
    if (seen.has(key)) continue;
    const points = sanitisePoints(e.points);
    if (!points.length) continue;
    seen.add(key);
    // 1.387: an unlinked envelope's own loop (absent or unreadable: linked).
    const unlinked = sanitiseEnvelopeLoop(e.unlinked);
    out.push(unlinked ? { target, points, unlinked } : { target, points });
    if (isMidi) midi++; else strip++;
    if (strip >= MAX_CLIP_ENVELOPES && midi >= MAX_MIDI_ENVELOPES) break;
  }
  return out.length ? out : undefined;
}

function sanitiseTrack(raw: unknown): Track | null {
  if (!isObj(raw)) return null;
  const tid = id(raw.id);
  if (!tid || (raw.kind !== 'synth' && raw.kind !== 'pads' && raw.kind !== 'audio' && raw.kind !== 'group')) return null;
  const base = {
    id: tid,
    name: name(raw.name, raw.kind === 'pads' ? 'Pads' : raw.kind === 'audio' ? 'Audio' : raw.kind === 'group' ? 'Group' : raw.engine === 'wave' ? 'Wave' : raw.engine === 'sampler' ? 'Sampler' : raw.engine === 'fm' ? 'FM' : raw.engine === 'chip' ? '8-bit' : raw.engine === 'drums' ? 'Drums' : raw.engine === 'pads' ? 'Cyber PADS' : raw.engine === 'none' ? 'MIDI' : raw.engine === 'est' ? 'EST' : raw.engine === 'rack' ? 'Rack' : 'Analog'),
    color: color(raw.color, raw.kind === 'pads' ? PADS_COLOR : raw.kind === 'audio' ? AUDIO_COLORS[0] : raw.kind === 'group' ? GROUP_COLORS[0] : TRACK_COLORS[0]),
    mute: bool(raw.mute, false),
    solo: bool(raw.solo, false),
    volume: num(raw.volume, MIN_VOLUME_DB, MAX_VOLUME_DB, 0),
    swing: num(raw.swing, 0, MAX_SWING, 0),
    ...sanitiseMix(raw),
    // 1.127: the output (a pre-1.127 `groupId` read as one), checked against the song in
    // sanitiseSequencerState's fitMix (`fitOutputs`: it must name a group, a return or an audio
    // track, groups never nest, no loop), which writes `groupId` beside it when it names a group.
    ...outputOfRaw(raw),
    ...heightOf(raw.height),
    ...delayOf(raw.delayMs),
    ...xfadeAssignOf(raw.xfadeAssign),
  };
  const frozen = sanitiseFrozen(raw.frozen);
  // 1.118: a group's Session fold (only `true` is kept).
  if (raw.kind === 'group') return { ...base, kind: 'group', ...(raw.folded === true ? { folded: true } : {}) };
  if (raw.kind === 'audio') return { ...base, kind: 'audio', monitor: bool(raw.monitor, false), ...(raw.resample === true ? { resample: true as const } : {}), ...estOutOf(raw.estOut) };
  if (raw.kind === 'pads') return { ...base, kind: 'pads', ...(frozen ? { frozen } : {}), ...midiFxOf(raw.midiFx, 'pads') };
  const synth = {
    ...base,
    kind: 'synth' as const,
    presetId: typeof raw.presetId === 'string' && raw.presetId.length <= 120 ? raw.presetId : null,
    modified: bool(raw.modified, false),
    ...(frozen ? { frozen } : {}),
    // Before 1.19 there was one arpeggiator (`synth.arp`); applySessionSnapshot copies it here first.
    arp: sanitiseArp(raw.arp),
    ...midiFxOf(raw.midiFx),
  };
  // Before 1.6 every synth track was ANALOG.
  if (raw.engine === 'wave') return { ...synth, engine: 'wave', patch: sanitiseWavePatch(raw.patch) };
  if (raw.engine === 'sampler') return { ...synth, engine: 'sampler', patch: sanitiseSamplerPatch(raw.patch) };
  if (raw.engine === 'fm') return { ...synth, engine: 'fm', patch: sanitiseFmPatch(raw.patch) };
  // 1.198: 8-BIT. A client before 1.198 reads it as ANALOG (DOC_VERSION 53 refuses it in a room).
  if (raw.engine === 'chip') return { ...synth, engine: 'chip', patch: sanitiseChipPatch(raw.patch) };
  if (raw.engine === 'drums') return { ...synth, engine: 'drums', patch: sanitiseDrumKit(raw.patch) };
  // 1.88: a MIDI track (no instrument). A client before 1.88 reads it as ANALOG (DOC_VERSION 31 refuses it in a room).
  if (raw.engine === 'none') return { ...synth, engine: 'none', patch: null };
  // 1.256: Cyber PADS (the project's pad kit). A client before 1.256 reads it as ANALOG (DOC_VERSION 65 refuses it in a room).
  if (raw.engine === 'pads') return { ...synth, engine: 'pads', patch: {} };
  // EST Phase 3 (1.283): an EST instrument. Its block is kept whatever this client can run (an
  // unknown or blocked plugin is a silent placeholder at run time, D-10, D-31), never ANALOG. Only a
  // block whose reference cannot be read at all (no valid id, version or hash) is a MIDI track:
  // silent, its notes and clips kept. A client before 1.283 reads it as ANALOG (DOC_VERSION 68 refuses it in a room).
  if (raw.engine === 'est') {
    const block = sanitiseEstBlock(raw.patch);
    return block ? { ...synth, engine: 'est', patch: block } : { ...synth, engine: 'none', patch: null };
  }
  // 1.356: an Instrument Rack (its chains each through their engine's sanitiser). A client before it reads it as ANALOG (DOC_VERSION refuses it in a room).
  if (raw.engine === 'rack') return { ...synth, engine: 'rack', patch: sanitiseRackPatch(raw.patch) };
  return { ...synth, engine: 'analog', patch: sanitiseSynthPatch(raw.patch) };
}

/** Pan, sends and effects from anything; absent (before 1.6): the defaults. One send per return. */
function sanitiseMix(raw: Record<string, unknown>): { pan: number; sends: number[]; fx: FxSlot[] } {
  const sends = Array.isArray(raw.sends) ? raw.sends : [];
  return {
    pan: num(raw.pan, -1, 1, 0),
    // One per return, up to eight (sanitiseSequencerState fits them to the returns).
    sends: Array.from({ length: Math.min(MAX_RETURNS, sends.length) }, (_, i) => num(sends[i], 0, 1, 0)),
    fx: sanitiseFxList(raw.fx),
  };
}

/** `{ midiFx }` when the track has any (1.21), else nothing (old projects keep their shape). 1.64: a pads track's, of the effects it takes. */
function midiFxOf(raw: unknown, kind: 'synth' | 'pads' = 'synth'): { midiFx?: MidiFx[] } {
  const list = sanitiseMidiFxListFor(kind, raw);
  return list.length ? { midiFx: list } : {};
}

/** 1.111: a track delay in range, on 0.1 ms steps (0 for anything else). */
export function sanitiseDelayMs(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const r = Math.round(Math.min(MAX_TRACK_DELAY_MS, Math.max(MIN_TRACK_DELAY_MS, v)) * 10) / 10;
  return r === 0 ? 0 : r; // never −0
}

/** `{ delayMs }` when set and not 0, else nothing (old projects keep their shape). */
function delayOf(v: unknown): { delayMs?: number } {
  const d = sanitiseDelayMs(v);
  return d === 0 ? {} : { delayMs: d };
}

/**
 * 1.111: a return's sends fitted to `count` returns, forward only (an entry at or before `index`,
 * its own, is 0), each 0…1; undefined when none is above 0 (the shape before 1.111).
 */
export function fitReturnSends(raw: unknown, index: number, count: number): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = Array.from({ length: Math.min(count, MAX_RETURNS) }, (_, i) => (i > index ? num(raw[i], 0, 1, 0) : 0));
  return out.some(v => v > 0) ? out : undefined;
}

/**
 * 1.127: `{ output }` from a raw track (`output` when the key is set, else a pre-1.127 `groupId`),
 * when it is an id, with `groupId` kept beside it when it names the same (a track checked alone,
 * `updateTrack`, keeps its alias; `fitMix` rewrites it against the song).
 */
function outputOfRaw(raw: Record<string, unknown>): { output?: string; groupId?: string } {
  const o = raw.output !== undefined ? raw.output : raw.groupId;
  if (typeof o !== 'string' || !ID_RE.test(o)) return {};
  return raw.groupId === o ? { output: o, groupId: o } : { output: o };
}

/** `{ height }` when set and in range, else nothing (old projects keep their shape). */
function heightOf(v: unknown): { height?: number } {
  const h = sanitiseRowHeight(v);
  return h === undefined ? {} : { height: h };
}

const HASH_RE = /^[a-f0-9]{64}$/;
function sanitiseFrozen(raw: unknown): Frozen | null {
  if (!isObj(raw) || typeof raw.hash !== 'string' || !HASH_RE.test(raw.hash)) return null;
  const key = typeof raw.renderedKey === 'string' && raw.renderedKey.length <= 128 ? raw.renderedKey : '';
  return { hash: raw.hash, renderedKey: key };
}

/** Humanise from anything, or null when absent or all zero. */
export function sanitiseHumanise(raw: unknown): Humanise | null {
  if (!isObj(raw)) return null;
  const h = { timing: num(raw.timing, 0, 1, 0), velocity: num(raw.velocity, 0, 1, 0), seed: Math.round(num(raw.seed, 0, 2 ** 31 - 1, 1)) };
  return h.timing === 0 && h.velocity === 0 ? null : h;
}

/** An audio clip in range on an audio track, or null. */
export function sanitiseAudioClip(raw: unknown, tracks: readonly Track[]): AudioClip | null {
  if (!isObj(raw)) return null;
  const cid = id(raw.id);
  const track = tracks.find(t => t.id === raw.trackId);
  if (!cid || !track || track.kind !== 'audio' || typeof raw.hash !== 'string' || !HASH_RE.test(raw.hash)) return null;
  const start = tk(num(raw.start, 0, MAX_BEATS - 1 / TICKS_PER_BEAT, 0));
  const length = tk(Math.min(MAX_BEATS - start, num(raw.length, 1 / TICKS_PER_BEAT, MAX_BEATS, BEATS_PER_BAR)));
  return {
    id: cid, trackId: track.id, name: name(raw.name, 'Audio'), color: color(raw.color, track.color),
    start, length: Math.max(1 / TICKS_PER_BEAT, length), hash: raw.hash, assetName: name(raw.assetName, 'Audio'),
    offsetS: num(raw.offsetS, 0, MAX_AUDIO_SOURCE_S, 0), gainDb: num(raw.gainDb, MIN_VOLUME_DB, MAX_VOLUME_DB + 6, 0),
    fadeInS: num(raw.fadeInS, 0, MAX_FADE_S, 0), fadeOutS: num(raw.fadeOutS, 0, MAX_FADE_S, 0), muted: bool(raw.muted, false),
    fadeInShape: num(raw.fadeInShape, -1, 1, 0), fadeOutShape: num(raw.fadeOutShape, -1, 1, 0),
    warp: sanitiseWarp(raw.warp),
    transpose: Math.round(num(raw.transpose, -MAX_TRANSPOSE, MAX_TRANSPOSE, 0)),
    detune: Math.round(num(raw.detune, -MAX_DETUNE, MAX_DETUNE, 0)),
    reverse: bool(raw.reverse, false),
    loop: sanitiseAudioLoop(raw.loop),
    ...withEnvelopes(sanitiseClipEnvelopes(raw.envelopes)),
    ...(typeof raw.sourceSeconds === 'number' && Number.isFinite(raw.sourceSeconds) && raw.sourceSeconds > 0 && raw.sourceSeconds <= MAX_BEATS * 60 / MIN_TEMPO
      ? { sourceSeconds: raw.sourceSeconds } : {}),
    ...sanitiseTakeFields(raw),
  };
}

/**
 * Warp markers in range: finite, sorted by beat, strictly increasing in beat and in source
 * seconds (at least MIN_MARKER_GAP_S apart), no segment slower than MIN_SEG_BPM or faster than
 * MAX_SEG_BPM, at most MAX_WARP_MARKERS. Null when fewer than two survive (the clip is then
 * unwarped: a bad warp never drops the clip).
 */
export function sanitiseWarpMarkers(raw: unknown): WarpMarker[] | null {
  if (!Array.isArray(raw)) return null;
  const pts: WarpMarker[] = [];
  for (const m of raw.slice(0, MAX_WARP_MARKERS * 2)) {
    if (!isObj(m) || typeof m.beat !== 'number' || typeof m.s !== 'number' || !Number.isFinite(m.beat) || !Number.isFinite(m.s)) continue;
    if (Math.abs(m.beat) > MAX_BEATS || m.s < -MAX_AUDIO_SOURCE_S || m.s > 2 * MAX_AUDIO_SOURCE_S) continue;
    pts.push({ beat: m.beat, s: m.s });
  }
  pts.sort((a, b) => a.beat - b.beat || a.s - b.s);
  const out: WarpMarker[] = [];
  for (const m of pts) {
    const prev = out[out.length - 1];
    if (prev) {
      const db = m.beat - prev.beat, ds = m.s - prev.s;
      if (db <= 1e-9 || ds < MIN_MARKER_GAP_S) continue;
      const bpm = (db / ds) * 60;
      if (bpm < MIN_SEG_BPM || bpm > MAX_SEG_BPM) continue;
    }
    if (out.length >= MAX_WARP_MARKERS) break;
    out.push(m);
  }
  return out.length >= 2 ? out : null;
}

/** A clip's warp, or null (unwarped) when it is absent or its markers do not make a map. */
export function sanitiseWarp(raw: unknown): AudioWarp | null {
  if (!isObj(raw)) return null;
  const markers = sanitiseWarpMarkers(raw.markers);
  if (!markers) return null;
  const b = isObj(raw.beats) ? raw.beats : {};
  return {
    mode: raw.mode === 'beats' ? 'beats' : raw.mode === 'pro' ? 'pro' : 'complex',
    markers,
    beats: {
      preserve: typeof b.preserve === 'string' && (BEATS_PRESERVE as readonly string[]).includes(b.preserve) ? b.preserve as BeatsPreserve : DEFAULT_BEATS_WARP.preserve,
      loopMode: typeof b.loopMode === 'string' && (TRANSIENT_LOOP_MODES as readonly string[]).includes(b.loopMode) ? b.loopMode as TransientLoopMode : DEFAULT_BEATS_WARP.loopMode,
      envelope: Math.round(num(b.envelope, 0, 100, DEFAULT_BEATS_WARP.envelope)),
    },
    ...(isObj(raw.pro) ? { pro: {
      formants: Math.round(num(raw.pro.formants, 0, 100, DEFAULT_PRO_WARP.formants)),
      envelope: Math.round(num(raw.pro.envelope, 8, 256, DEFAULT_PRO_WARP.envelope)),
    } } : {}),
  };
}

const withEnvelopes = (envelopes: ClipEnvelope[] | undefined) => (envelopes ? { envelopes } : {});

/** A clip's loop in range (content beats; the length at least a 32nd). */
export function sanitiseAudioLoop(raw: unknown): AudioLoop {
  const d = audioClipDefaults().loop;
  if (!isObj(raw)) return d;
  return {
    on: bool(raw.on, false),
    start: tk(num(raw.start, -MAX_BEATS, MAX_BEATS, 0)),
    length: tk(num(raw.length, 1 / 32, MAX_BEATS, d.length)),
  };
}

/** The audio clips with the limits applied: valid, unique ids, at most MAX_AUDIO_CLIPS (1.109: takes dropped first, `capWithTakes`). */
export function sanitiseAudioClips(raw: unknown, tracks: readonly Track[]): AudioClip[] {
  const out: AudioClip[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw) ? raw : [];
  for (const r of list.slice(0, MAX_AUDIO_CLIPS * 4)) {
    const c = sanitiseAudioClip(r, tracks);
    if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
  }
  return capWithTakes(out, MAX_AUDIO_CLIPS);
}

const PARAM_RE = /^[A-Za-z0-9_.]{1,48}$/;
const param = (v: unknown): string | null => (typeof v === 'string' && PARAM_RE.test(v) ? v : null);

/** A lane's target, checked against the tracks and returns (the parameter's existence is the engine's to check). */
export function sanitiseAutomationTarget(raw: unknown, tracks: readonly Track[]): AutomationTarget | null {
  if (!isObj(raw)) return null;
  const track = typeof raw.trackId === 'string' ? tracks.find(t => t.id === raw.trackId) : undefined;
  switch (raw.kind) {
    case 'track': {
      if (!track) return null;
      if (raw.param === 'volume' || raw.param === 'pan' || raw.param === 'mute') return { kind: 'track', trackId: track.id, param: raw.param };
      if (raw.param === 'send' && typeof raw.index === 'number' && Number.isInteger(raw.index) && raw.index >= 0 && raw.index < MAX_RETURNS) {
        return { kind: 'track', trackId: track.id, param: 'send', index: raw.index };
      }
      return null;
    }
    case 'fx': {
      const fxId = id(raw.fxId), p = param(raw.param);
      if (!track || !fxId || !p || !track.fx.some(f => f.id === fxId)) return null;
      return { kind: 'fx', trackId: track.id, fxId, param: p };
    }
    case 'synth': {
      const p = param(raw.param);
      if (!track || track.kind !== 'synth' || !p) return null;
      return { kind: 'synth', trackId: track.id, param: p };
    }
    case 'midiFx': {
      const fxId = id(raw.fxId), p = param(raw.param);
      const fx = fxId ? trackMidiFx(track)?.find(f => f.id === fxId) : undefined;
      if (!track || !fx || !p || !midiFxParamDef(fx.type, p)) return null;
      return { kind: 'midiFx', trackId: track.id, fxId: fx.id, param: p };
    }
    case 'midiOut': {
      // 1.392: a MIDI track's hardware controller or bend.
      if (!track || track.kind !== 'synth') return null;
      if (raw.control === 'bend') return { kind: 'midiOut', trackId: track.id, control: 'bend' };
      return typeof raw.control === 'number' && Number.isInteger(raw.control) && raw.control >= 0 && raw.control < 120
        ? { kind: 'midiOut', trackId: track.id, control: raw.control } : null;
    }
    case 'return': {
      const rid = (RETURN_IDS as readonly unknown[]).includes(raw.returnId) ? raw.returnId as string : null;
      if (!rid) return null;
      if (raw.param === 'volume' || raw.param === 'pan') return { kind: 'return', returnId: rid, param: raw.param };
      // 1.111: a send to a later return only (forward, as `ReturnBus.sends`).
      if (raw.param === 'send') {
        const ix = raw.index;
        return typeof ix === 'number' && Number.isInteger(ix) && ix > RETURN_IDS.indexOf(rid as ReturnId) && ix < MAX_RETURNS
          ? { kind: 'return', returnId: rid, param: 'send', index: ix } : null;
      }
      const fxId = id(raw.fxId), key = param(raw.key);
      if (raw.param === 'fx' && fxId && key) return { kind: 'return', returnId: rid, param: 'fx', fxId, key };
      return null;
    }
    case 'master': {
      if (raw.param === 'volume') return { kind: 'master', param: 'volume' };
      if (raw.param === 'xfade') return { kind: 'master', param: 'xfade' };
      if (raw.param === 'tempo') return { kind: 'master', param: 'tempo' };
      const fxId = id(raw.fxId), key = param(raw.key);
      return raw.param === 'fx' && fxId && key ? { kind: 'master', param: 'fx', fxId, key } : null;
    }
    default: return null;
  }
}

/** A lane: its target checked, its points in range, sorted by beat, one per beat, at most MAX_POINTS. */
export function sanitiseAutomationLane(raw: unknown, tracks: readonly Track[]): AutomationLane | null {
  if (!isObj(raw)) return null;
  const lid = id(raw.id);
  const target = sanitiseAutomationTarget(raw.target, tracks);
  if (!lid || !target) return null;
  return { id: lid, target, points: sanitisePoints(raw.points), on: bool(raw.on, true) };
}

/**
 * A lane's (and, 1.80, a clip envelope's) points in range: beats 0…MAX_BEATS on ticks, values
 * 0…1, curves −1…1, sorted by beat, at most two on one beat (a step: the first and the last
 * there), at most MAX_POINTS.
 */
export function sanitisePoints(raw: unknown): AutomationPoint[] {
  const pts: AutomationPoint[] = [];
  for (const p of Array.isArray(raw) ? raw.slice(0, MAX_POINTS * 2) : []) {
    if (!isObj(p) || typeof p.beat !== 'number' || !Number.isFinite(p.beat)) continue;
    pts.push({ beat: tk(num(p.beat, 0, MAX_BEATS, 0)), value: num(p.value, 0, 1, 0), curve: num(p.curve, -1, 1, 0) });
  }
  pts.sort((a, b) => a.beat - b.beat);
  const points: AutomationPoint[] = [];
  for (const p of pts) {
    const last = points[points.length - 1];
    // Two points on one beat make a step: keep the first and the last there.
    if (last && last.beat === p.beat && points[points.length - 2]?.beat === p.beat) points[points.length - 1] = p;
    else points.push(p);
    if (points.length >= MAX_POINTS) break;
  }
  return points;
}

/** The lanes with the limits applied: unique ids, one per target, at most MAX_LANES. */
export function sanitiseAutomation(raw: unknown, tracks: readonly Track[]): AutomationLane[] {
  const out: AutomationLane[] = [];
  const ids = new Set<string>();
  const targets = new Set<string>();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_LANES) break;
    const l = sanitiseAutomationLane(r, tracks);
    if (!l || ids.has(l.id)) continue;
    const key = automationTargetKey(l.target);
    if (targets.has(key)) continue;
    ids.add(l.id); targets.add(key); out.push(l);
  }
  return out;
}

/**
 * 1.133: a song written before 1.133 (no `masterTaper`) has its master-volume lane's points on the
 * old knee taper (`faderToMasterDbBefore133`, +12 at the top); each point moves to the tracks'
 * taper at the same dB (`masterDbToTrackFader`). A point above +6 dB is capped there and one
 * between silence and −48 dB becomes silence (the new taper's floor). `already`: the song carries
 * the flag, nothing moves. Returns `lanes` itself when nothing moved.
 */
export function migrateMasterLaneTaper(lanes: AutomationLane[], already: boolean): AutomationLane[] {
  if (already) return lanes;
  const isMaster = (l: AutomationLane) => l.target.kind === 'master' && l.target.param === 'volume';
  if (!lanes.some(isMaster)) return lanes;
  const move = (v: number) => Math.round(masterDbToTrackFader(faderToMasterDbBefore133(v)) * 1e6) / 1e6;
  return lanes.map(l => (isMaster(l) ? { ...l, points: l.points.map(p => ({ ...p, value: move(p.value) })) } : l));
}

/**
 * 1.62: a 1.13 delay's `tone` lanes (the parameter moved into the 1.14 delay's filter, so they went
 * inert) as lanes on the filter's frequency, their values mapped so the low-pass follows the tone as
 * it did (`delayToneLaneValue`, at the slot's own filter width). A delay that has a frequency lane
 * already keeps it and the tone lane goes. Any other lane, and any other type's `tone` (the
 * Distortion's, the Cyber Saturator's), is left as it is. Returns `lanes` itself when nothing moved.
 */
export function migrateDelayToneLanes(lanes: AutomationLane[], tracks: readonly Track[], returns: readonly ReturnBus[], master: MasterBus): AutomationLane[] {
  const slotOf = (t: AutomationTarget): FxSlot | undefined => {
    if (t.kind === 'fx') return tracks.find(x => x.id === t.trackId)?.fx.find(f => f.id === t.fxId);
    if (t.kind === 'return' && t.param === 'fx') return returns.find(r => r.id === t.returnId)?.fx.find(f => f.id === t.fxId);
    if (t.kind === 'master' && t.param === 'fx') return master.fx.find(f => f.id === t.fxId);
    return undefined;
  };
  const keyOf = (t: AutomationTarget) => (t.kind === 'fx' ? t.param : (t.kind === 'return' || t.kind === 'master') && t.param === 'fx' ? t.key : null);
  const isTone = (l: AutomationLane) => keyOf(l.target) === 'tone' && slotOf(l.target)?.type === 'delay';
  if (!lanes.some(isTone)) return lanes;
  const taken = new Set(lanes.map(l => automationTargetKey(l.target)));
  const out: AutomationLane[] = [];
  for (const l of lanes) {
    if (!isTone(l)) { out.push(l); continue; }
    const t = l.target;
    const target: AutomationTarget = t.kind === 'fx' ? { ...t, param: 'filterFreq' } : { ...t, key: 'filterFreq' } as AutomationTarget;
    const k = automationTargetKey(target);
    if (taken.has(k)) continue;
    taken.add(k);
    const width = slotOf(t)!.params.filterWidth ?? 6;
    out.push({ ...l, target, points: l.points.map(p => ({ ...p, value: delayToneLaneValue(p.value, width) })) });
  }
  return out;
}

/** Locators in range (1.18): unique ids, beats on ticks within the song, names cleaned, sorted by beat, at most MAX_LOCATORS. */
export function sanitiseLocators(raw: unknown): Locator[] {
  const out: Locator[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw.slice(0, MAX_LOCATORS * 2) : []) {
    if (!isObj(r)) continue;
    const lid = id(r.id);
    if (!lid || seen.has(lid) || typeof r.beat !== 'number' || !Number.isFinite(r.beat)) continue;
    seen.add(lid);
    out.push({ id: lid, beat: tk(num(r.beat, 0, MAX_BEATS, 0)), name: name(r.name, 'Locator') });
  }
  return sortLocators(out).slice(0, MAX_LOCATORS);
}

/** The next free "Locator n" name. */
export function nextLocatorName(locators: readonly Locator[]): string {
  const used = new Set(locators.map(l => /^Locator (\d+)$/.exec(l.name)?.[1]).filter(Boolean).map(Number));
  let n = 1;
  while (used.has(n)) n++;
  return `Locator ${n}`;
}

/** Locators sorted by beat (ties by id, so every peer has the same order). */
export function sortLocators(list: readonly Locator[]): Locator[] {
  return [...list].sort((a, b) => a.beat - b.beat || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The returns from anything (1.74: none to eight): those present, in `RETURN_IDS` order and
 * contiguous (a gap ends the list: C only after B). A snapshot with no `returns` field at all (a
 * song from before 1.6) gets A and B, the defaults; an empty list stays empty.
 */
export function sanitiseReturns(raw: unknown): ReturnBus[] {
  const d = defaultReturns();
  if (raw === undefined) return d;
  const list = Array.isArray(raw) ? raw : [];
  const out: ReturnBus[] = [];
  const rawSends: unknown[] = [];
  for (const [i, rid] of RETURN_IDS.entries()) {
    const r = list.find(x => isObj(x) && x.id === rid);
    if (!isObj(r)) break;
    const fallback = d[i] ?? defaultReturn(rid);
    rawSends.push(r.sends);
    out.push({
      id: rid, name: name(r.name, fallback.name), volume: num(r.volume, MIN_VOLUME_DB, MAX_VOLUME_DB, 0),
      pan: num(r.pan, -1, 1, 0), mute: bool(r.mute, false), fx: sanitiseFxList(r.fx), ...heightOf(r.height),
      color: color(r.color, returnColorAt(i)), // 1.79: kept; one from before 1.79 takes its index's
      ...xfadeAssignOf(r.xfadeAssign),
      // 1.127: its output, to a later return only (fitted below, once the count is known).
      ...(typeof r.output === 'string' && (RETURN_IDS as readonly string[]).includes(r.output) ? { output: r.output } : {}),
    });
  }
  // 1.111: each return's sends, to the returns after it only, fitted once the count is known.
  return out.map((r, i) => {
    const sends = fitReturnSends(rawSends[i], i, out.length);
    // 1.127: an output to itself, an earlier return or one not there is the master.
    const oi = r.output ? RETURN_IDS.indexOf(r.output as ReturnId) : -1;
    const { output: _o, ...rest } = r;
    const fitted = oi > i && oi < out.length ? r : rest;
    return sends ? { ...fitted, sends } : fitted;
  });
}

/**
 * Each track's sends fitted to the returns, and (1.127) its output checked by `fitOutputs` (a
 * group, a return or an audio track; groups never nest; no loop; else the master), with `groupId`
 * written beside an output that names a group (the alias, for one release) and neither at the master.
 */
function fitMix(tracks: Track[], returns: readonly ReturnBus[]): Track[] {
  const outs = fitOutputs({ tracks, returns });
  const fitted = tracks.map(t => {
    const sends = Array.from({ length: returns.length }, (_, i) => t.sends[i] ?? 0);
    const sameSends = sends.length === t.sends.length && sends.every((v, i) => v === t.sends[i]);
    const routed = withOutput(t, outs.get(t.id) ?? null, tracks);
    const sameRoute = routed.output === t.output && routed.groupId === t.groupId && ('groupId' in routed) === ('groupId' in t) && ('output' in routed) === ('output' in t);
    if (sameSends && sameRoute) return t;
    return { ...routed, sends } as Track;
  });
  // 1.136: a group's members lie directly under it (an old song's scattered members gather).
  const ordered = groupedOrder(fitted);
  return ordered === fitted ? fitted : [...ordered];
}

/**
 * The tracks with the limits applied: unique ids, at most one pads track (P3: none is added, a song
 * may have none), at most MAX_TRACKS in all (1.135: no cap per kind).
 */
export function sanitiseTracks(raw: unknown): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>();
  let pads = false;
  for (const r of Array.isArray(raw) ? raw.slice(0, MAX_TRACKS) : []) {
    const t = sanitiseTrack(r);
    if (!t || seen.has(t.id)) continue;
    // P3: the pads track is optional (a song may have none; at most one is kept), and no place is kept for it.
    if (t.kind === 'pads') { if (pads) continue; pads = true; }
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/** The clips with the limits applied: valid, unique ids, at most MAX_CLIPS (1.109: takes dropped first, `capWithTakes`). */
export function sanitiseClips(raw: unknown, tracks: readonly Track[]): Clip[] {
  const out: Clip[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw) ? raw : [];
  for (const r of list.slice(0, MAX_CLIPS * 4)) {
    const c = sanitiseClip(r, tracks);
    if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
  }
  return capWithTakes(out, MAX_CLIPS);
}

/** The song's loop brace: on ticks, inside the song, at least MIN_SONG_LOOP_BEATS long (else the default). */
function sanitiseSongLoop(raw: unknown): SequencerState['loop'] {
  const d = defaultSequencerState().loop;
  const loop = isObj(raw) ? raw : {};
  let ls = tk(num(loop.start, 0, MAX_BEATS - 1, 0));
  let le = tk(num(loop.end, 0, MAX_BEATS, d.end));
  if (le <= ls) { ls = d.start; le = d.end; }
  else if (le - ls < MIN_SONG_LOOP_BEATS) le = tk(ls + MIN_SONG_LOOP_BEATS);
  return { on: bool(loop.on, false), start: ls, end: le };
}

const sanitiseRecordQuantize = (v: unknown): RecordQuantize =>
  (typeof v === 'string' && (RECORD_QUANTIZE as readonly string[]).includes(v) ? v as RecordQuantize : 'off');

/** A track id that is one of `tracks`, else null. */
const trackRef = (v: unknown, tracks: readonly Track[]): string | null => (typeof v === 'string' && tracks.some(t => t.id === v) ? v : null);

/** 1.369: the multi-arm list: track ids of `tracks`, no repeats, at most MAX_TRACKS; undefined for fewer than two. */
const armedList = (v: unknown, tracks: readonly Track[]): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const ids = [...new Set(v.filter((x): x is string => typeof x === 'string' && tracks.some(t => t.id === x)))];
  return ids.length > 1 ? ids : undefined;
};

/** The fields `setSequencer` takes: the transport's settings, the selection, audio clips and lanes. */
export type SequencerPatch = Partial<Pick<SequencerState, 'tempo' | 'loop' | 'lastScale' | 'metronome' | 'recordQuantize' | 'selectedTrackId' | 'armedTrackId' | 'armedTrackIds' | 'songScale' | 'tuning' | 'audioClips' | 'automation' | 'sig' | 'meterMap' | 'grooves' | 'grooveAmount'>>;

/**
 * The tempo map release (Cyber_Tempo_Map_Work_Order.md §2.1): the song's `tempo` while its tempo
 * lane is in force, the lane's value at beat 0 rounded to 0.01; `tempo` itself without the lane.
 */
export function tempoAtZero(tempo: number, automation: readonly AutomationLane[]): number {
  const t = songTempo({ tempo, automation });
  return typeof t === 'number' ? tempo : Math.round(bpmAt(t, 0) * 100) / 100;
}

/**
 * Review 1.37 S-10: the fields of `patch` alone, validated by the same rules as
 * `sanitiseSequencerState`, against `cur` (an already sanitised song, whose tracks they refer to).
 * Selecting a track, arming one, the loop or the metronome no longer re-sanitise the whole song.
 */
export function sanitiseSequencerPatch(cur: SequencerState, patch: SequencerPatch): SequencerPatch {
  const raw: Record<string, unknown> = patch;
  const out: SequencerPatch = {};
  const has = (k: keyof SequencerPatch) => Object.prototype.hasOwnProperty.call(raw, k);
  if (has('tempo')) out.tempo = num(raw.tempo, MIN_TEMPO, MAX_TEMPO, 120);
  if (has('loop')) out.loop = sanitiseSongLoop(raw.loop);
  if (has('lastScale')) out.lastScale = sanitiseScale(raw.lastScale);
  if (has('songScale')) out.songScale = sanitiseScale(raw.songScale) ?? undefined;
  if (has('tuning')) out.tuning = sanitiseTuning(raw.tuning) ?? undefined;
  if (has('selectedTrackId')) out.selectedTrackId = trackRef(raw.selectedTrackId, cur.tracks) ?? cur.tracks[0]?.id ?? null;
  if (has('armedTrackId')) out.armedTrackId = trackRef(raw.armedTrackId, cur.tracks);
  if (has('armedTrackIds')) out.armedTrackIds = armedList(raw.armedTrackIds, cur.tracks);
  if (has('metronome')) out.metronome = bool(raw.metronome, false);
  if (has('recordQuantize')) out.recordQuantize = sanitiseRecordQuantize(raw.recordQuantize);
  // 1.112: 4/4 is stored as no signature, so a 4/4 song's data is as before.
  if (has('sig')) out.sig = sanitiseSongSig(raw.sig);
  // The tempo map release: the meter's changes, kept on the bar lines of the signature at 0.
  if (has('sig') || has('meterMap')) out.meterMap = sanitiseMeterMap(has('meterMap') ? raw.meterMap : cur.meterMap, has('sig') ? out.sig : cur.sig);
  // 1.358: the groove pool and its amount (undefined clears: none, 100 %).
  if (has('grooves')) out.grooves = sanitiseGrooves(raw.grooves);
  if (has('grooveAmount')) out.grooveAmount = sanitiseGrooveAmount(raw.grooveAmount);
  if (has('audioClips')) out.audioClips = sanitiseAudioClips(raw.audioClips, cur.tracks);
  if (has('automation')) out.automation = sanitiseAutomation(raw.automation, cur.tracks);
  // The tempo map release: while the tempo lane is in force, `tempo` is its value at 0.
  if (has('tempo') || has('automation')) {
    const at0 = tempoAtZero(out.tempo ?? cur.tempo, out.automation ?? cur.automation);
    if (has('tempo') || at0 !== cur.tempo) out.tempo = at0;
  }
  return out;
}

/**
 * 1.95: what a DAW project's card on Home says (shared/projectSummary.mjs): its tracks (groups are
 * not counted: they hold tracks), its tempo, and its length to where its last clip ends, in
 * seconds at that tempo. Pure; sent with each save and when the project opens.
 */
export function songSummary(s: Pick<SequencerState, 'tempo' | 'tracks' | 'clips'> & { audioClips?: readonly AudioClip[]; automation?: readonly AutomationLane[] }): { tracks: number; bpm: number; seconds: number } {
  const bpm = Number.isFinite(s.tempo) && s.tempo > 0 ? s.tempo : 120;
  // The tempo map release: through the tempo lane when it is in force (`bpm` stays the tempo at 0).
  const clock = songTempo({ tempo: bpm, automation: s.automation });
  const seconds = typeof clock === 'number' ? songEnd(s) * 60 / bpm : secondsAt(clock, songEnd(s));
  return {
    tracks: s.tracks.filter(t => t.kind !== 'group').length,
    bpm: Math.round(bpm * 100) / 100,
    seconds: Math.round(seconds * 1000) / 1000,
  };
}

/** The SEQUENCER's state with every field present and in range; unknown fields dropped. */
export function sanitiseSequencerState(raw: unknown): SequencerState {
  const d = defaultSequencerState();
  if (!isObj(raw)) return d;
  const returns = sanitiseReturns(raw.returns);
  const tracks = fitMix(sanitiseTracks(raw.tracks), returns);
  const clips = sanitiseClips(raw.clips, tracks);
  const trackId = (v: unknown) => trackRef(v, tracks);
  const masterHeight = sanitiseRowHeight(raw.masterHeight);
  const audioClips = sanitiseAudioClips(raw.audioClips, tracks);
  const master = sanitiseMaster(raw.master);
  const sig = sanitiseSongSig(raw.sig);
  // The tempo map release: the meter's changes after 0, and `tempo` = the tempo lane at 0 while it is in force.
  const meterMap = sanitiseMeterMap(raw.meterMap, sig);
  const grooves = sanitiseGrooves(raw.grooves);
  const grooveAmount = sanitiseGrooveAmount(raw.grooveAmount);
  const automation = migrateMasterLaneTaper(
    migrateDelayToneLanes(sanitiseAutomation(raw.automation, tracks), tracks, returns, master), raw.masterTaper === 'track');
  return {
    version: 1,
    tempo: tempoAtZero(num(raw.tempo, MIN_TEMPO, MAX_TEMPO, 120), automation),
    tracks,
    clips,
    loop: sanitiseSongLoop(raw.loop),
    lastScale: sanitiseScale(raw.lastScale),
    ...(sanitiseScale(raw.songScale) ? { songScale: sanitiseScale(raw.songScale)! } : {}),
    ...(sanitiseTuning(raw.tuning) ? { tuning: sanitiseTuning(raw.tuning)! } : {}),
    selectedTrackId: trackId(raw.selectedTrackId) ?? tracks[0]?.id ?? null,
    armedTrackId: trackId(raw.armedTrackId),
    ...(armedList(raw.armedTrackIds, tracks) ? { armedTrackIds: armedList(raw.armedTrackIds, tracks) } : {}),
    metronome: bool(raw.metronome, false),
    recordQuantize: sanitiseRecordQuantize(raw.recordQuantize),
    returns,
    master,
    audioClips,
    automation,
    ...(masterHeight === undefined ? {} : { masterHeight }),
    locators: sanitiseLocators(raw.locators),
    ...(sig ? { sig } : {}),
    ...(meterMap ? { meterMap } : {}),
    ...(grooves ? { grooves } : {}),
    ...(grooveAmount !== undefined ? { grooveAmount } : {}),
    masterTaper: 'track',
    ...(raw.session === undefined || raw.session === null ? {} : {
      session: sanitiseSession(raw.session, tracks, new Set([...clips.map(c => c.id), ...audioClips.map(c => c.id)])),
    }),
  };
}

// --- 1.25: the Session view (Cyber_Session_View_Plan.md §2) ------------------------------------

/** An ordinary account's scenes at most (N1: `sceneLimit()` is the account's). */
export const MAX_SCENES = 32;
/** N1: an admin account's scenes at most, and the model's hard cap (`sanitiseSession`), so an
 *  admin's song loads whole on any client. */
export const MAX_SCENES_ADMIN = 700;
export const DEFAULT_SCENES = 8;
/** An ordinary account's Session clips in all, MIDI and audio (1.190: `sessionClipLimit()` is the account's). */
export const MAX_SESSION_CLIPS = 256;
/**
 * 1.190: an admin account's Session clips at most, and the model's hard cap (`sanitiseSession`), so
 * an admin's song loads whole on any client. 700 scenes × 21 tracks is ~14.7k slots; 16384 holds a
 * set of that shape whole (the owner's 551 × 21 has ~11.6k).
 */
export const MAX_SESSION_CLIPS_ADMIN = 16384;
/** Launch quantisation, as Live's Global Quantization: none, a note value, or bars. */
export type LaunchQuantize = 'none' | '1/16' | '1/8' | '1/4' | '1/2' | '1' | '2' | '4' | '8';
export const LAUNCH_QUANTIZE: readonly LaunchQuantize[] = ['none', '1/16', '1/8', '1/4', '1/2', '1', '2', '4', '8'];
/** Each quantisation's grid in beats (0: none). */
export const LAUNCH_QUANTIZE_BEATS: Readonly<Record<LaunchQuantize, number>> = {
  none: 0, '1/16': 0.25, '1/8': 0.5, '1/4': 1, '1/2': 2, '1': BEATS_PER_BAR, '2': 2 * BEATS_PER_BAR, '4': 4 * BEATS_PER_BAR, '8': 8 * BEATS_PER_BAR,
};
export const LAUNCH_QUANTIZE_LABELS: Readonly<Record<LaunchQuantize, string>> = {
  none: 'None', '1/16': '1/16', '1/8': '1/8', '1/4': '1/4', '1/2': '1/2', '1': '1 Bar', '2': '2 Bars', '4': '4 Bars', '8': '8 Bars',
};

/**
 * A row of the grid. 1.26: `tempo` (BPM), set when the scene is launched; absent: the scene leaves
 * the tempo. 1.28: `sig`, a time signature set when it is launched: the Session's bar from then on
 * (its launch quantisation, follow actions and slot recordings count in its bars); absent: the
 * scene leaves it. 1.112: absent, the Session counts in the song's `sig`.
 */
export interface Scene {
  id: string; name: string; tempo?: number; sig?: TimeSig;
  /** 1.118: the scene's own colour (an HSL triple, the track palette's); absent: none. Its clips keep theirs. */
  color?: string;
}
/** 1.28: a scene's time signature: `num` beats of 1/`den` notes. */
export interface TimeSig { num: number; den: number }
export const SIG_DENOMINATORS = [2, 4, 8, 16] as const;
/** A time signature's bar in beats (quarter notes): 4/4 is 4, 7/8 is 3.5. */
export const sigBeats = (s: TimeSig): number => (s.num * 4) / s.den;
/** 1.112: the beat a signature counts in, in quarter notes: its denominator's note (6/8: an eighth, 0.5). */
export function sigUnit(sig: TimeSig): number {
  return 4 / sig.den;
}
/**
 * 1.112: the span between a signature's accented lines, in quarter notes: a compound meter's
 * dotted beat (6/8, 9/8, 12/8: three eighths, so 6/8 is accented on 1 and 4), else its beat.
 */
export function sigAccent(sig: TimeSig): number {
  const unit = sigUnit(sig);
  return sig.den >= 8 && sig.num > 3 && sig.num % 3 === 0 ? 3 * unit : unit;
}
export function sanitiseSig(raw: unknown): TimeSig | undefined {
  if (!isObj(raw)) return undefined;
  const num = typeof raw.num === 'number' && Number.isFinite(raw.num) ? Math.round(Math.min(32, Math.max(1, raw.num))) : 4;
  const den = (SIG_DENOMINATORS as readonly number[]).includes(raw.den as number) ? raw.den as number : 4;
  return { num, den };
}
/** 1.112: the song's signature as `sanitiseSig`, with 4/4 (the default) as none. */
export function sanitiseSongSig(raw: unknown): TimeSig | undefined {
  const s = sanitiseSig(raw);
  return s && !(s.num === 4 && s.den === 4) ? s : undefined;
}

/**
 * 1.26: how a clip's ▶ (or pad) behaves, as Live's Launch Modes: Trigger launches; Gate plays
 * while held; Toggle launches, or stops it when it plays; Repeat relaunches it on every boundary
 * while held.
 */
export type LaunchMode = 'trigger' | 'gate' | 'toggle' | 'repeat';
export const LAUNCH_MODES: readonly LaunchMode[] = ['trigger', 'gate', 'toggle', 'repeat'];
/**
 * 1.26: what follows a clip after its follow time (Live's Follow Actions), within its column's
 * clips. 1.116: `jump` launches the clip in the slot named by the follow's `jumpA` or `jumpB`.
 */
export type FollowAction = 'none' | 'stop' | 'again' | 'previous' | 'next' | 'first' | 'last' | 'any' | 'other' | 'jump';
export const FOLLOW_ACTIONS: readonly FollowAction[] = ['none', 'stop', 'again', 'previous', 'next', 'first', 'last', 'any', 'other', 'jump'];
export const MAX_FOLLOW_BARS = 64;
/** 1.116: a follow time as typed, bars.beats.sixteenths (beats of the signature's denominator). */
export interface FollowTime { bars: number; beats: number; sixteenths: number }
/**
 * 1.116: a clip's Follow Action. `linked`: at the end of its loop (its loop length from the launch;
 * a clip that does not loop, at its end); unlinked: after `time`, counted from the launch through
 * its loop passes, 0.0.0 off. Then action A with `chanceA` per cent, else B. `jumpA`/`jumpB`: the
 * scene id of the slot a Jump launches, in the clip's column. Before 1.116 it was `{ bars }`
 * from the launch, which reads as Unlinked `bars.0.0` (`sanitiseFollow`), so it plays as before.
 */
export interface ClipFollow {
  time: FollowTime;
  linked: boolean;
  a: FollowAction;
  b: FollowAction;
  chanceA: number;
  jumpA?: string;
  jumpB?: string;
}
export const DEFAULT_FOLLOW: ClipFollow = { time: { bars: 0, beats: 0, sixteenths: 0 }, linked: false, a: 'next', b: 'none', chanceA: 100 };
/** 1.116: a follow time in beats (quarter notes), with the bar and the beat (4 / the denominator) it counts in. */
export function followTimeBeats(t: FollowTime, bar: number, beat = 1): number {
  return t.bars * bar + t.beats * beat + t.sixteenths * 0.25;
}
/** 1.116: the follow action is on (Linked, or a time past 0.0.0). */
export const followOn = (f: ClipFollow): boolean => f.linked || f.time.bars + f.time.beats + f.time.sixteenths > 0;
/** 1.116: a follow in range; an old `{ bars }` (before 1.116) reads as Unlinked at `bars.0.0`. */
export function sanitiseFollow(raw: unknown): ClipFollow {
  const d = DEFAULT_FOLLOW;
  const f = isObj(raw) ? raw : {};
  const act = (v: unknown, dv: FollowAction) => (typeof v === 'string' && (FOLLOW_ACTIONS as readonly string[]).includes(v) ? v as FollowAction : dv);
  const t = isObj(f.time) ? f.time : { bars: f.bars };
  const jump = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : undefined);
  const jumpA = jump(f.jumpA);
  const jumpB = jump(f.jumpB);
  return {
    time: {
      bars: Math.round(num(t.bars, 0, MAX_FOLLOW_BARS, 0)),
      beats: Math.round(num(t.beats, 0, 31, 0)),
      sixteenths: Math.round(num(t.sixteenths, 0, 3, 0)),
    },
    linked: f.linked === true,
    a: act(f.a, d.a), b: act(f.b, d.b),
    chanceA: Math.round(num(f.chanceA, 0, 100, 100)),
    ...(jumpA ? { jumpA } : {}),
    ...(jumpB ? { jumpB } : {}),
  };
}
/**
 * 1.26: a session clip's launch settings. `quantize` 'global' follows the grid's; `follow`: its
 * Follow Action (1.116: `ClipFollow`).
 */
export interface ClipLaunch {
  mode: LaunchMode;
  quantize: LaunchQuantize | 'global';
  follow: ClipFollow;
  /** 1.28, Legato: launched while another clip plays on its track, it starts where that clip was, not from its start. */
  legato?: boolean;
  /**
   * 1.116, Loop: absent or true, the clip loops (a MIDI clip its brace); false, it plays once from
   * its start and its slot stops at its end (`launchLoopSpan` in sessionPlayback.ts reads these).
   */
  loop?: boolean;
  /**
   * 1.116, the loop brace of a MIDI session clip, content beats (`roll-loop-brace`): a launch plays
   * from `loopStart` and loops [loopStart, loopEnd). Absent: 0 and the clip's length.
   */
  loopStart?: number;
  loopEnd?: number;
}
export const DEFAULT_CLIP_LAUNCH: ClipLaunch = { mode: 'trigger', quantize: 'global', follow: DEFAULT_FOLLOW };
/** A clip's launch settings, or the defaults. */
export const launchOf = (c: { launch?: ClipLaunch }): ClipLaunch => c.launch ?? DEFAULT_CLIP_LAUNCH;

/**
 * A MIDI clip in a slot: a `Clip` whose `start` and `offset` are 0 and whose `length` is its
 * `contentLength` (its loop), on a synth or pads track, in scene `sceneId`. 1.26: `launch`.
 */
export type SessionClip = Clip & { sceneId: string; launch?: ClipLaunch };
/** An audio clip in a slot: `start` 0, `length` its loop in beats, on an audio track. */
export type SessionAudioClip = AudioClip & { sceneId: string; launch?: ClipLaunch };

/** 1.26: a clip's launch settings in range, or undefined for the defaults. */
/**
 * 1.116: what a clip launched in a slot plays, content beats: [start, end), looping when `loop`
 * (`launchLoopSpan` in sessionPlayback.ts is the readers' name for it). A MIDI clip that loops
 * plays its brace (default its whole content), one that does not its content once from 0; an
 * audio clip [0, length) (its warp loop repeats inside).
 */
export function launchSpanOf(clip: (Pick<Clip, 'contentLength'> | Pick<AudioClip, 'hash' | 'length'>) & { launch?: ClipLaunch }): { start: number; end: number; loop: boolean } {
  const l = clip.launch;
  const loop = l?.loop !== false;
  if ('hash' in clip) return { start: 0, end: clip.length, loop };
  const len = clip.contentLength;
  if (!loop) return { start: 0, end: len, loop };
  const end = Math.min(len, l?.loopEnd ?? len);
  const start = Math.max(0, Math.min(end, l?.loopStart ?? 0));
  return { start, end, loop };
}

/** 1.116: the shortest loop brace, beats. */
export const MIN_LAUNCH_LOOP = 0.25;

/**
 * 1.116: a launch's Loop and (a MIDI clip's, `length` its content) loop brace in range, written
 * over `launch` (the sanitised rest): Loop kept only when off; the brace in ticks inside
 * [0, length], at least MIN_LAUNCH_LOOP long, its start kept only when past 0 and its end only
 * when before the length (so a whole-clip brace follows the clip's length).
 */
export function sanitiseLaunchLoop(launch: ClipLaunch | undefined, raw: unknown, length: number | null): ClipLaunch | undefined {
  if (!isObj(raw)) return launch;
  const { loop: _o, loopStart: _s, loopEnd: _e, ...base } = launch ?? DEFAULT_CLIP_LAUNCH;
  const out: ClipLaunch = { ...base, ...(raw.loop === false ? { loop: false } : {}) };
  if (length !== null && length > 0) {
    const min = Math.min(MIN_LAUNCH_LOOP, length);
    const end = tk(num(raw.loopEnd, min, length, length));
    const start = tk(num(raw.loopStart, 0, Math.max(0, end - min), 0));
    if (start > 0) out.loopStart = start;
    if (end < length - 1e-9) out.loopEnd = end;
  }
  if (out.loop === undefined && out.loopStart === undefined && out.loopEnd === undefined) return launch;
  return out;
}

export function sanitiseClipLaunch(raw: unknown): ClipLaunch | undefined {
  if (!isObj(raw)) return undefined;
  const d = DEFAULT_CLIP_LAUNCH;
  const out: ClipLaunch = {
    mode: typeof raw.mode === 'string' && (LAUNCH_MODES as readonly string[]).includes(raw.mode) ? raw.mode as LaunchMode : d.mode,
    quantize: raw.quantize === 'global' ? 'global' : typeof raw.quantize === 'string' && (LAUNCH_QUANTIZE as readonly string[]).includes(raw.quantize) ? raw.quantize as LaunchQuantize : 'global',
    follow: sanitiseFollow(raw.follow),
    ...(raw.legato === true ? { legato: true } : {}),
  };
  return JSON.stringify(out) === JSON.stringify(d) ? undefined : out;
}
export interface SessionState {
  scenes: Scene[];
  clips: SessionClip[];
  audioClips: SessionAudioClip[];
  quantize: LaunchQuantize;
  /** 1.112: how an audio overdub on a slot treats its clip (`slotOverdub.ts`); absent: replace. */
  overdubMode?: OverdubMode;
  /**
   * 1.118: the slots (`trackId|sceneId`) whose stop button was removed, as Live stores it per slot:
   * empty, such a slot shows nothing and a scene launch leaves its track playing. Absent: none.
   */
  noStop?: string[];
}

// 1.118 (stream S1): slots without a stop button.
/** At most this many slots without a stop button are kept. */
export const MAX_NO_STOP = 4096;
/** 1.190: a long `noStop` list as a set, per list (each drawn slot asks on every store change). */
const noStopSets = new WeakMap<readonly string[], Set<string>>();
/** True when the slot (empty or not) keeps its stop button (the default). */
export function slotHasStop(s: Pick<SessionState, 'noStop'>, trackId: string, sceneId: string): boolean {
  const list = s.noStop;
  if (!list?.length) return true;
  const key = `${trackId}|${sceneId}`;
  if (list.length < 32) return !list.includes(key);
  let set = noStopSets.get(list);
  // A list grown in place is read again (its keys are unique, so the sizes match when it has not).
  if (!set || set.size !== list.length) noStopSets.set(list, (set = new Set(list)));
  return !set.has(key);
}
/** `session.noStop` in range: unique keys of existing slot tracks and scenes; none: absent. */
function noStopOf(v: unknown, tracks: readonly Track[], sceneIds: ReadonlySet<string>): { noStop?: string[] } {
  if (!Array.isArray(v)) return {};
  const ok = new Set(tracks.filter(hasSlots).map(t => t.id));
  const out = new Set<string>();
  for (const k of v) {
    if (out.size >= MAX_NO_STOP) break;
    if (typeof k !== 'string') continue;
    const bar = k.indexOf('|');
    if (bar > 0 && ok.has(k.slice(0, bar)) && sceneIds.has(k.slice(bar + 1))) out.add(k);
  }
  return out.size ? { noStop: [...out] } : {};
}

/** 1.112: an audio overdub replaces the punch range (1.68) or layers the take over it, the old clip kept as a take. */
export type OverdubMode = 'replace' | 'layer';
/** 1.112: `session.overdubMode` in range: 'layer', else absent (replace). */
const overdubModeOf = (v: unknown): { overdubMode?: OverdubMode } => (v === 'layer' ? { overdubMode: 'layer' } : {});

/** The default grid: eight empty scenes (fixed ids, so two people's defaults are the same grid). */
export function defaultSessionState(): SessionState {
  return {
    scenes: Array.from({ length: DEFAULT_SCENES }, (_, i) => ({ id: `scene${i + 1}`, name: String(i + 1) })),
    clips: [], audioClips: [], quantize: '1',
  };
}
const DEFAULT_SESSION = defaultSessionState();
/** A project's session, or the default (the same object each time) when it has none. */
export function sessionOf(s: Pick<SequencerState, 'session'>): SessionState {
  return s.session ?? DEFAULT_SESSION;
}

/** Which tracks have slots: synth and pads tracks hold MIDI clips, audio tracks audio clips. */
export function hasSlots(t: Track | undefined | null): boolean {
  return !!t && (t.kind === 'synth' || t.kind === 'pads' || t.kind === 'audio');
}

/** The clip in a slot (either kind), or null. */
export function slotClip(s: SessionState, trackId: string, sceneId: string): SessionClip | SessionAudioClip | null {
  return s.clips.find(c => c.trackId === trackId && c.sceneId === sceneId)
    ?? s.audioClips.find(c => c.trackId === trackId && c.sceneId === sceneId) ?? null;
}

/** 1.190: where each id sits in a long Session clip list, per list (the scheduler asks per track, 40 times a second). */
const idPlaces = new WeakMap<readonly { id: string }[], Map<string, number>>();
function byId<T extends { id: string }>(list: readonly T[], id: string): T | undefined {
  if (list.length < 64) return list.find(c => c.id === id);
  let at = idPlaces.get(list);
  if (!at) { at = new Map(list.map((c, i) => [c.id, i] as const)); idPlaces.set(list, at); }
  const i = at.get(id);
  const hit = i === undefined ? undefined : list[i];
  if (hit?.id === id) return hit;
  // Not indexed (or a list changed in place): read it as before, and index it again next time.
  const found = list.find(c => c.id === id);
  if (found) idPlaces.delete(list);
  return found;
}

/** A session clip by id (either kind), or null. */
export function sessionClipById(s: SessionState, id: string): SessionClip | SessionAudioClip | null {
  return byId(s.clips, id) ?? byId(s.audioClips, id) ?? null;
}

/** A MIDI clip by id, arranged or in a slot: what the piano roll and the drum grid edit. */
export function midiClipById(s: Pick<SequencerState, 'clips' | 'session'>, id: string | null | undefined): Clip | SessionClip | null {
  if (!id) return null;
  return s.clips.find(c => c.id === id) ?? s.session?.clips.find(c => c.id === id) ?? null;
}

export const isSessionClip = (c: Clip | AudioClip): c is SessionClip | SessionAudioClip => typeof (c as { sceneId?: unknown }).sceneId === 'string';

/** A session MIDI clip in range: as `sanitiseClip`, then start and offset 0 and its length its loop. */
export function sanitiseSessionClip(raw: unknown, tracks: readonly Track[], sceneIds: ReadonlySet<string>): SessionClip | null {
  if (!isObj(raw) || typeof raw.sceneId !== 'string' || !sceneIds.has(raw.sceneId)) return null;
  // 1.109: a slot's clip is never a take.
  const c = sanitiseClip({ ...raw, start: 0, offset: 0, take: undefined, takeGroup: undefined }, tracks);
  if (!c) return null;
  const launch = sanitiseLaunchLoop(sanitiseClipLaunch(raw.launch), raw.launch, c.contentLength);
  return { ...c, start: 0, offset: 0, length: c.contentLength, sceneId: raw.sceneId, ...(launch ? { launch } : {}) };
}

/** A session audio clip in range: as `sanitiseAudioClip`, then start 0. */
export function sanitiseSessionAudioClip(raw: unknown, tracks: readonly Track[], sceneIds: ReadonlySet<string>): SessionAudioClip | null {
  if (!isObj(raw) || typeof raw.sceneId !== 'string' || !sceneIds.has(raw.sceneId)) return null;
  const c = sanitiseAudioClip({ ...raw, start: 0, take: undefined, takeGroup: undefined }, tracks);
  // 1.116: an audio clip takes Loop, not the brace (its warp loop is its own).
  const launch = sanitiseLaunchLoop(sanitiseClipLaunch(raw.launch), raw.launch, null);
  return c ? { ...c, start: 0, sceneId: raw.sceneId, ...(launch ? { launch } : {}) } : null;
}

/**
 * The session in range: 1…MAX_SCENES_ADMIN scenes with unique ids; clips on tracks of the right kind
 * in existing scenes, one per slot (the first kept), unique ids (also across the two lists and
 * the arrangement's), at most MAX_SESSION_CLIPS_ADMIN in all (1.190: the account's own limit,
 * `sessionClipLimit()`, only stops a song growing past it here).
 */
export function sanitiseSession(raw: unknown, tracks: readonly Track[], takenIds: ReadonlySet<string> = new Set()): SessionState {
  const d = defaultSessionState();
  if (!isObj(raw)) return d;
  const scenes: Scene[] = [];
  const sceneIds = new Set<string>();
  for (const r of Array.isArray(raw.scenes) ? raw.scenes : []) {
    if (scenes.length >= MAX_SCENES_ADMIN) break;
    if (!isObj(r)) continue;
    const sid = id(r.id);
    if (!sid || sceneIds.has(sid)) continue;
    sceneIds.add(sid);
    const tempo = typeof r.tempo === 'number' && Number.isFinite(r.tempo) ? Math.round(Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, r.tempo)) * 100) / 100 : undefined;
    const sig = sanitiseSig(r.sig);
    // 1.118: a scene's colour.
    const sceneColor = typeof r.color === 'string' && COLOR_RE.test(r.color) ? r.color : undefined;
    scenes.push({ id: sid, name: typeof r.name === 'string' ? r.name.slice(0, 40) : '', ...(tempo !== undefined ? { tempo } : {}), ...(sig ? { sig } : {}), ...(sceneColor ? { color: sceneColor } : {}) });
  }
  if (!scenes.length) return { ...d, quantize: quantizeOf(raw.quantize), ...overdubModeOf(raw.overdubMode) };
  const slots = new Set<string>();
  const ids = new Set(takenIds);
  const clips: SessionClip[] = [];
  const audioClips: SessionAudioClip[] = [];
  const take = (c: { id: string; trackId: string; sceneId: string }) => {
    const slot = `${c.trackId}|${c.sceneId}`;
    if (slots.has(slot) || ids.has(c.id) || clips.length + audioClips.length >= MAX_SESSION_CLIPS_ADMIN) return false;
    slots.add(slot); ids.add(c.id);
    return true;
  };
  for (const r of Array.isArray(raw.clips) ? raw.clips : []) {
    const c = sanitiseSessionClip(r, tracks, sceneIds);
    if (c && take(c)) clips.push(c);
  }
  for (const r of Array.isArray(raw.audioClips) ? raw.audioClips : []) {
    const c = sanitiseSessionAudioClip(r, tracks, sceneIds);
    if (c && take(c)) audioClips.push(c);
  }
  return { scenes, clips, audioClips, quantize: quantizeOf(raw.quantize), ...overdubModeOf(raw.overdubMode), ...noStopOf(raw.noStop, tracks, sceneIds) };
}
const quantizeOf = (v: unknown): LaunchQuantize => (typeof v === 'string' && (LAUNCH_QUANTIZE as readonly string[]).includes(v) ? v as LaunchQuantize : '1');

// --- The 1.3 migration (§5.4) ------------------------------------------------------------------

/** Velocities of the 1.3 step sequencer's normal and accented steps. */
const STEP_VELOCITY = 90;
const STEP_ACCENT = 120;
const SLIDE_OVERLAP = 0.125;

/**
 * A sequencer for a project saved before 1.4 (no `sequencer` in its snapshot): the pads track and
 * Analog 1 with the old SYNTH page's patch and tempo, and its step pattern (if any step is on) as a
 * clip at bar 1, looped as the old sequencer did. Accents are velocity 120; a tie into the same
 * note is one longer note, into another note it overlaps (legato); a slide overlaps the step
 * before by a 32nd so mono glide still happens.
 */
/**
 * A pre-1.19 snapshot's one arpeggiator onto its synth tracks (1.19): each synth track without its
 * own `arp` gets a copy of `synth.arp`; a track that has one keeps it. Raw in, raw out (the
 * sanitiser runs after); anything that is not a sequencer with tracks comes back as it was.
 */
export function migrateArpToTracks(rawSequencer: unknown, rawSynth: unknown): unknown {
  if (!isObj(rawSequencer) || !Array.isArray(rawSequencer.tracks) || !isObj(rawSynth) || !isObj(rawSynth.arp)) return rawSequencer;
  const arp = rawSynth.arp;
  return {
    ...rawSequencer,
    tracks: rawSequencer.tracks.map((t: unknown) => (isObj(t) && t.kind === 'synth' && !isObj(t.arp) ? { ...t, arp } : t)),
  };
}

export function migrateFromSynth(rawSynth: unknown): SequencerState {
  const s = defaultSequencerState();
  const r = isObj(rawSynth) ? rawSynth : {};
  const synthTrack = s.tracks[0] as AnalogTrack;
  synthTrack.patch = sanitiseSynthPatch(r.patch);
  synthTrack.presetId = typeof r.presetId === 'string' && r.presetId.length <= 120 ? r.presetId : null;
  synthTrack.modified = bool(r.modified, false);
  s.tempo = num(r.tempo, MIN_TEMPO, MAX_TEMPO, 120);
  const seq = isObj(r.seq) ? r.seq : null;
  if (!seq || !Array.isArray(seq.steps)) return s;
  const rawSteps: unknown[] = seq.steps;
  const rate = typeof seq.rate === 'string' && (DIVISIONS as readonly string[]).includes(seq.rate) ? seq.rate as Division : '1/16';
  const step = divisionBeats(rate);
  const length = Math.round(num(seq.length, 1, 16, 16));
  const root = Math.round(num(seq.root, 24, 84, 36));
  const steps = Array.from({ length }, (_, i) => {
    const raw = rawSteps[i];
    const st = isObj(raw) ? raw : {};
    return {
      on: bool(st.on, false),
      pitch: Math.max(0, Math.min(127, root + Math.round(num(st.note, -24, 24, 0)))),
      gate: num(st.gate, 0.1, 1, 0.5),
      accent: bool(st.accent, false),
      slide: bool(st.slide, false),
    };
  });
  if (!steps.some(st => st.on)) return s;
  const notes: Note[] = [];
  for (let i = 0; i < length; i++) {
    const st = steps[i]!;
    if (!st.on) continue;
    // A tie into the same note continues it: that step is already part of this note.
    const prev = steps[i - 1];
    if (prev?.on && prev.gate >= 1 && prev.pitch === st.pitch && !st.slide) continue;
    // Extend through ties into the same note.
    let j = i;
    while (steps[j]!.gate >= 1 && steps[j + 1]?.on && steps[j + 1]!.pitch === st.pitch && !steps[j + 1]!.slide) j++;
    const last = steps[j]!;
    const next = steps[j + 1];
    let len: number;
    if (next?.on && (last.gate >= 1 || next.slide)) len = (j - i + 1) * step + SLIDE_OVERLAP; // legato into the next note
    else if (last.gate >= 1) len = (j - i + 1) * step;
    else len = (j - i + last.gate) * step;
    notes.push({ id: `n${i}`, pitch: st.pitch, start: tk(i * step), length: tk(Math.max(1 / 32, len)), velocity: st.accent ? STEP_ACCENT : STEP_VELOCITY });
  }
  const contentLength = tk(Math.max(1, length * step));
  s.clips = [{
    id: 'step-pattern', trackId: synthTrack.id, name: 'Step pattern', color: synthTrack.color,
    start: 0, length: contentLength, contentLength, offset: 0, notes, muted: false,
  }];
  if (rate === '1/16') synthTrack.swing = num(seq.swing, 0, MAX_SWING, 0);
  s.loop = { on: true, start: 0, end: contentLength };
  return s;
}
