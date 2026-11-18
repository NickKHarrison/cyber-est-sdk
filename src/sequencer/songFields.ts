/**
 * 1.661 (forward compatibility, `src/lib/forwardFields.ts`): the fields the song's sanitisers know,
 * object by object, so a field a newer Cyber wrote is kept beside them (`keepExtras`). Each list is
 * checked against its type (`fieldsOf`: a field added to the type and not here is a compile error);
 * a retired name a sanitiser still reads or drops on purpose is listed too, so it is never kept as
 * unknown.
 */
import { fieldsOf } from '../lib/forwardFields';
import type { FxSlot } from '../audio/mixer/fxDefs';
import type { MidiFx } from './midiFx';
import type {
  AudioClip, AutomationLane, Clip, Locator, MasterBus, Note, ReturnBus, Scene, SequencerState,
  SessionAudioClip, SessionClip, SessionState, Track,
} from './sequencerTypes';

export const SONG_FIELDS = fieldsOf<SequencerState>()([
  'version', 'tempo', 'tracks', 'clips', 'loop', 'audioLaneMuted', 'audioLaneStart', 'lastScale', 'songScale', 'tuning', 'selectedTrackId', 'armedTrackId',
  'armedTrackIds', 'metronome', 'recordQuantize', 'returns', 'master', 'audioClips', 'automation', 'masterHeight',
  'locators', 'sig', 'meterMap', 'grooves', 'grooveAmount', 'masterTaper', 'session',
  // The room's own key in its `sequencer` value (collab.ts' `seqShared`), read back through this sanitiser.
  'trackOrder',
] as const);

export const TRACK_FIELDS = fieldsOf<Track>()([
  'id', 'name', 'color', 'mute', 'solo', 'volume', 'swing', 'pan', 'sends', 'fx', 'output', 'groupId', 'height',
  'delayMs', 'xfadeAssign', 'kind', 'folded', 'monitor', 'resample', 'estOut', 'frozen', 'midiFx', 'presetId',
  'modified', 'arp', 'engine', 'patch', 'auditionTake',
] as const);

export const FX_SLOT_FIELDS = fieldsOf<FxSlot>()(['id', 'type', 'on', 'params', 'keyTrackId', 'mod', 'est', 'rack'] as const);

export const MIDI_FX_FIELDS = fieldsOf<MidiFx>()([
  'id', 'type', 'on', 'shifts', 'velocity', 'strum', 'root', 'mode', 'follow', 'pitch', 'lowest', 'range', 'drive',
  'outLow', 'outHigh', 'random', 'seed', 'gate', 'rate', 'repeats', 'decay', 'steps', 'length', 'key', 'swing',
  'groove', 'free', 'chance', 'choices', 'interval', 'sign',
] as const);

/** A clip's (arranged or in a Session slot: a slot's fields are known to the arranged clip's sanitiser too). */
export const CLIP_FIELDS = fieldsOf<Clip | SessionClip>()([
  'id', 'trackId', 'name', 'color', 'start', 'length', 'contentLength', 'offset', 'notes', 'muted', 'scale',
  'humanise', 'velocity', 'envelopes', 'groove', 'program', 'steps', 'loopOff', 'take', 'takeGroup', 'sceneId', 'launch',
] as const);

export const NOTE_FIELDS = fieldsOf<Note>()(['id', 'pitch', 'start', 'length', 'velocity', 'muted', 'chance', 'velRange', 'mpe'] as const);

export const AUDIO_CLIP_FIELDS = fieldsOf<AudioClip | SessionAudioClip>()([
  'id', 'trackId', 'name', 'color', 'start', 'length', 'hash', 'assetName', 'offsetS', 'gainDb', 'fadeInS', 'fadeOutS',
  'muted', 'fadeInShape', 'fadeOutShape', 'warp', 'transpose', 'detune', 'reverse', 'loop', 'loopS', 'envelopes',
  'sourceSeconds', 'take', 'takeGroup', 'sceneId', 'launch',
] as const);

export const LANE_FIELDS = fieldsOf<AutomationLane>()(['id', 'target', 'points', 'on'] as const);
export const LOCATOR_FIELDS = fieldsOf<Locator>()(['id', 'beat', 'name'] as const);
export const RETURN_FIELDS = fieldsOf<ReturnBus>()([
  'id', 'name', 'volume', 'pan', 'mute', 'fx', 'height', 'color', 'xfadeAssign', 'output', 'sends',
] as const);
export const MASTER_FIELDS = fieldsOf<MasterBus>()(['fx', 'xfade'] as const);
export const SESSION_FIELDS = fieldsOf<SessionState>()(['scenes', 'clips', 'audioClips', 'quantize', 'overdubMode', 'noStop'] as const);
export const SCENE_FIELDS = fieldsOf<Scene>()(['id', 'name', 'tempo', 'sig', 'color', 'follow'] as const);
