import { assertEquals, assertThrows } from "@std/assert";
import { MIDIReader } from "./midi-reader.ts";
import { MetaEventType, MIDIEventType, MIDIFormat } from "./midi-types.ts";
import type {
  NoteEvent,
  TempoEvent,
  TextEvent,
  TimeSignatureEvent,
} from "./midi-types.ts";

/**
 * Helper function to create a simple MIDI file buffer
 */
function createSimpleMIDIBuffer(): Uint8Array {
  const parts: number[] = [];

  // MThd header
  parts.push(
    ...[0x4d, 0x54, 0x68, 0x64], // "MThd"
    ...[0x00, 0x00, 0x00, 0x06], // chunk length = 6
    ...[0x00, 0x00], // format 0 (single track)
    ...[0x00, 0x01], // 1 track
    ...[0x00, 0x60], // 96 ticks per quarter note
  );

  // MTrk track
  const trackData: number[] = [];

  // Track name meta event (delta time 0)
  trackData.push(
    0x00, // delta time
    0xff,
    0x03, // meta event: track name
    0x0a, // length (10 bytes for "Test Track")
    ...[0x54, 0x65, 0x73, 0x74, 0x20, 0x54, 0x72, 0x61, 0x63, 0x6b], // "Test Track"
  );

  // Tempo meta event (120 BPM)
  trackData.push(
    0x00, // delta time
    0xff,
    0x51, // meta event: set tempo
    0x03, // length
    0x07,
    0xa1,
    0x20, // 500000 microseconds per quarter note (120 BPM)
  );

  // Time signature 4/4
  trackData.push(
    0x00, // delta time
    0xff,
    0x58, // meta event: time signature
    0x04, // length
    0x04,
    0x02,
    0x18,
    0x08, // 4/4, 24 clocks per click, 8 32nd notes per quarter
  );

  // Note On (C4, velocity 64, channel 0)
  trackData.push(
    0x00, // delta time
    0x90, // note on, channel 0
    0x3c, // note 60 (C4)
    0x40, // velocity 64
  );

  // Note Off (C4, velocity 0, channel 0) - after 96 ticks
  trackData.push(
    0x60, // delta time (96)
    0x80, // note off, channel 0
    0x3c, // note 60 (C4)
    0x00, // velocity 0
  );

  // End of track
  trackData.push(
    0x00, // delta time
    0xff,
    0x2f,
    0x00, // meta event: end of track
  );

  // Add MTrk header
  parts.push(
    ...[0x4d, 0x54, 0x72, 0x6b], // "MTrk"
  );

  // Add track length
  const trackLength = trackData.length;
  parts.push(
    (trackLength >> 24) & 0xff,
    (trackLength >> 16) & 0xff,
    (trackLength >> 8) & 0xff,
    trackLength & 0xff,
  );

  // Add track data
  parts.push(...trackData);

  return new Uint8Array(parts);
}

/**
 * Helper to create MIDI with running status
 */
function createMIDIWithRunningStatus(): Uint8Array {
  const parts: number[] = [];

  // MThd header
  parts.push(
    ...[0x4d, 0x54, 0x68, 0x64],
    ...[0x00, 0x00, 0x00, 0x06],
    ...[0x00, 0x00],
    ...[0x00, 0x01],
    ...[0x00, 0x60],
  );

  // MTrk track
  const trackData: number[] = [];

  // Note On (C4, velocity 64, channel 0)
  trackData.push(
    0x00,
    0x90,
    0x3c,
    0x40,
  );

  // Note On (D4, velocity 64, channel 0) - using running status
  trackData.push(
    0x10, // delta time
    0x3e, // note 62 (D4) - no status byte
    0x40, // velocity 64
  );

  // Note On (E4, velocity 64, channel 0) - using running status
  trackData.push(
    0x10,
    0x40, // note 64 (E4)
    0x40,
  );

  // End of track
  trackData.push(0x00, 0xff, 0x2f, 0x00);

  parts.push(...[0x4d, 0x54, 0x72, 0x6b]);
  const trackLength = trackData.length;
  parts.push(
    (trackLength >> 24) & 0xff,
    (trackLength >> 16) & 0xff,
    (trackLength >> 8) & 0xff,
    trackLength & 0xff,
  );
  parts.push(...trackData);

  return new Uint8Array(parts);
}

Deno.test("MIDIReader - parse header correctly", () => {
  const buffer = createSimpleMIDIBuffer();
  const midi = MIDIReader.fromBuffer(buffer);

  assertEquals(midi.header.format, MIDIFormat.SingleTrack);
  assertEquals(midi.header.trackCount, 1);
  assertEquals(midi.header.timeDivision, 96);
});

Deno.test("MIDIReader - parse track count", () => {
  const buffer = createSimpleMIDIBuffer();
  const midi = MIDIReader.fromBuffer(buffer);

  assertEquals(midi.tracks.length, 1);
});

Deno.test("MIDIReader - parse track name", () => {
  const buffer = createSimpleMIDIBuffer();
  const midi = MIDIReader.fromBuffer(buffer);

  assertEquals(midi.tracks[0].name, "Test Track");
});

Deno.test("MIDIReader - parse tempo event", () => {
  const buffer = createSimpleMIDIBuffer();
  const midi = MIDIReader.fromBuffer(buffer);

  const tempoEvent = midi.tracks[0].events.find((e) =>
    e.type === MIDIEventType.Meta &&
    e.metaType === MetaEventType.SetTempo
  ) as TempoEvent | undefined;

  assertEquals(tempoEvent !== undefined, true);
  assertEquals(tempoEvent?.bpm, 120);
  assertEquals(tempoEvent?.microsecondsPerQuarterNote, 500000);
});

Deno.test("MIDIReader - parse time signature event", () => {
  const buffer = createSimpleMIDIBuffer();
  const midi = MIDIReader.fromBuffer(buffer);

  const timeSigEvent = midi.tracks[0].events.find((e) =>
    e.type === MIDIEventType.Meta &&
    e.metaType === MetaEventType.TimeSignature
  ) as TimeSignatureEvent | undefined;

  assertEquals(timeSigEvent !== undefined, true);
  assertEquals(timeSigEvent?.numerator, 4);
  assertEquals(timeSigEvent?.denominator, 4);
});

Deno.test("MIDIReader - parse note events", () => {
  const buffer = createSimpleMIDIBuffer();
  const midi = MIDIReader.fromBuffer(buffer);

  const noteEvents = midi.tracks[0].events.filter((e) =>
    e.type === MIDIEventType.NoteOn || e.type === MIDIEventType.NoteOff
  ) as NoteEvent[];

  assertEquals(noteEvents.length, 2);

  // Note On
  assertEquals(noteEvents[0].type, MIDIEventType.NoteOn);
  assertEquals(noteEvents[0].note, 60); // C4
  assertEquals(noteEvents[0].velocity, 64);
  assertEquals(noteEvents[0].channel, 0);
  assertEquals(noteEvents[0].deltaTime, 0);

  // Note Off
  assertEquals(noteEvents[1].type, MIDIEventType.NoteOff);
  assertEquals(noteEvents[1].note, 60); // C4
  assertEquals(noteEvents[1].velocity, 0);
  assertEquals(noteEvents[1].channel, 0);
  assertEquals(noteEvents[1].deltaTime, 96);
});

Deno.test("MIDIReader - parse running status", () => {
  const buffer = createMIDIWithRunningStatus();
  const midi = MIDIReader.fromBuffer(buffer);

  const noteEvents = midi.tracks[0].events.filter((e) =>
    e.type === MIDIEventType.NoteOn
  ) as NoteEvent[];

  assertEquals(noteEvents.length, 3);

  // First note (explicit status)
  assertEquals(noteEvents[0].note, 60); // C4

  // Second note (running status)
  assertEquals(noteEvents[1].note, 62); // D4
  assertEquals(noteEvents[1].deltaTime, 16);

  // Third note (running status)
  assertEquals(noteEvents[2].note, 64); // E4
  assertEquals(noteEvents[2].deltaTime, 16);
});

Deno.test("MIDIReader - throw error on invalid header", () => {
  const invalidBuffer = new Uint8Array([
    0x4d,
    0x54,
    0x68,
    0x65, // "MThe" instead of "MThd"
    0x00,
    0x00,
    0x00,
    0x06,
  ]);

  assertThrows(
    () => MIDIReader.fromBuffer(invalidBuffer),
    Error,
    "Invalid MIDI file",
  );
});

Deno.test("MIDIReader - throw error on invalid track", () => {
  const parts: number[] = [
    ...[0x4d, 0x54, 0x68, 0x64],
    ...[0x00, 0x00, 0x00, 0x06],
    ...[0x00, 0x00],
    ...[0x00, 0x01],
    ...[0x00, 0x60],
    ...[0x4d, 0x54, 0x72, 0x65], // "MTre" instead of "MTrk"
    ...[0x00, 0x00, 0x00, 0x04],
    ...[0x00, 0xff, 0x2f, 0x00],
  ];

  const invalidBuffer = new Uint8Array(parts);

  assertThrows(
    () => MIDIReader.fromBuffer(invalidBuffer),
    Error,
    "Invalid track",
  );
});

Deno.test("MIDIReader - parse text meta events", () => {
  const buffer = createSimpleMIDIBuffer();
  const midi = MIDIReader.fromBuffer(buffer);

  const textEvent = midi.tracks[0].events.find((e) =>
    e.type === MIDIEventType.Meta &&
    e.metaType === MetaEventType.TrackName
  ) as TextEvent | undefined;

  assertEquals(textEvent !== undefined, true);
  assertEquals(textEvent?.text, "Test Track");
});

Deno.test("MIDIReader - handle all events in track", () => {
  const buffer = createSimpleMIDIBuffer();
  const midi = MIDIReader.fromBuffer(buffer);

  // Should have: track name, tempo, time signature, note on, note off, end of track
  assertEquals(midi.tracks[0].events.length >= 6, true);
});
