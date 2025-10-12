/**
 * MIDI file format types
 */
export const MIDIFormat = {
  SingleTrack: 0,
  MultiTrack: 1,
  MultiSong: 2,
} as const;

export type MIDIFormat = typeof MIDIFormat[keyof typeof MIDIFormat];

/**
 * MIDI event types
 */
export const MIDIEventType = {
  NoteOff: 0x80,
  NoteOn: 0x90,
  PolyphonicAftertouch: 0xa0,
  ControlChange: 0xb0,
  ProgramChange: 0xc0,
  ChannelAftertouch: 0xd0,
  PitchBend: 0xe0,
  Meta: 0xff,
  SysEx: 0xf0,
  SysExEnd: 0xf7,
} as const;

export type MIDIEventType = typeof MIDIEventType[keyof typeof MIDIEventType];

/**
 * Meta event types
 */
export const MetaEventType = {
  SequenceNumber: 0x00,
  TextEvent: 0x01,
  CopyrightNotice: 0x02,
  TrackName: 0x03,
  InstrumentName: 0x04,
  Lyric: 0x05,
  Marker: 0x06,
  CuePoint: 0x07,
  ChannelPrefix: 0x20,
  EndOfTrack: 0x2f,
  SetTempo: 0x51,
  SMPTEOffset: 0x54,
  TimeSignature: 0x58,
  KeySignature: 0x59,
  SequencerSpecific: 0x7f,
} as const;

export type MetaEventType = typeof MetaEventType[keyof typeof MetaEventType];

/**
 * Base MIDI event type
 */
export type MIDIEvent = {
  deltaTime: number;
  type: MIDIEventType;
  channel?: number;
};

/**
 * Note On/Off events
 */
export type NoteEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.NoteOn | typeof MIDIEventType.NoteOff;
  note: number;
  velocity: number;
  channel: number;
};

/**
 * Control Change event
 */
export type ControlChangeEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.ControlChange;
  controller: number;
  value: number;
  channel: number;
};

/**
 * Program Change event
 */
export type ProgramChangeEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.ProgramChange;
  program: number;
  channel: number;
};

/**
 * Pitch Bend event
 */
export type PitchBendEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.PitchBend;
  value: number;
  channel: number;
};

/**
 * Aftertouch events
 */
export type AftertouchEvent = {
  deltaTime: number;
  type:
    | typeof MIDIEventType.PolyphonicAftertouch
    | typeof MIDIEventType.ChannelAftertouch;
  pressure: number;
  note?: number;
  channel: number;
};

/**
 * Meta event type
 */
export type MetaEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.Meta;
  metaType: MetaEventType;
  data: Uint8Array;
};

/**
 * Tempo meta event
 */
export type TempoEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.Meta;
  metaType: typeof MetaEventType.SetTempo;
  microsecondsPerQuarterNote: number;
  bpm: number;
  data: Uint8Array;
};

/**
 * Time Signature meta event
 */
export type TimeSignatureEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.Meta;
  metaType: typeof MetaEventType.TimeSignature;
  numerator: number;
  denominator: number;
  clocksPerClick: number;
  thirtySecondNotesPerQuarterNote: number;
  data: Uint8Array;
};

/**
 * Key Signature meta event
 */
export type KeySignatureEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.Meta;
  metaType: typeof MetaEventType.KeySignature;
  sharpsOrFlats: number;
  isMinor: boolean;
  data: Uint8Array;
};

/**
 * Text meta event
 */
export type TextEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.Meta;
  metaType:
    | typeof MetaEventType.TextEvent
    | typeof MetaEventType.CopyrightNotice
    | typeof MetaEventType.TrackName
    | typeof MetaEventType.InstrumentName
    | typeof MetaEventType.Lyric
    | typeof MetaEventType.Marker
    | typeof MetaEventType.CuePoint;
  text: string;
  data: Uint8Array;
};

/**
 * SysEx event
 */
export type SysExEvent = {
  deltaTime: number;
  type: typeof MIDIEventType.SysEx | typeof MIDIEventType.SysExEnd;
  data: Uint8Array;
};

/**
 * Union type of all MIDI events
 */
export type AnyMIDIEvent =
  | NoteEvent
  | ControlChangeEvent
  | ProgramChangeEvent
  | PitchBendEvent
  | AftertouchEvent
  | MetaEvent
  | TempoEvent
  | TimeSignatureEvent
  | KeySignatureEvent
  | TextEvent
  | SysExEvent;

/**
 * MIDI track
 */
export type MIDITrack = {
  events: AnyMIDIEvent[];
  name?: string;
};

/**
 * MIDI file header
 */
export type MIDIHeader = {
  format: MIDIFormat;
  trackCount: number;
  timeDivision: number;
};

/**
 * Complete MIDI file representation
 */
export type MIDIFile = {
  header: MIDIHeader;
  tracks: MIDITrack[];
};
