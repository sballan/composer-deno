import type { MIDIFile, NoteEvent, TempoEvent } from "../midi-types.ts";
import { MetaEventType, MIDIEventType } from "../midi-types.ts";
import type { VisualMetadata, VisualNote } from "./types.ts";

/**
 * Default tempo if none is specified (120 BPM = 500,000 microseconds per quarter note)
 */
const DEFAULT_MICROSECONDS_PER_QUARTER = 500000;

/**
 * Converts MIDI file to visual notes for rendering
 */
export function transformMIDIToNotes(
  midiFile: MIDIFile,
): { notes: VisualNote[]; metadata: VisualMetadata } {
  const ticksPerQuarterNote = midiFile.header.timeDivision;
  const notes: VisualNote[] = [];

  // Track tempo changes for time conversion
  const tempoMap = buildTempoMap(midiFile, ticksPerQuarterNote);

  let minPitch = 127;
  let maxPitch = 0;
  let maxTime = 0;

  // Process each track
  for (let trackIndex = 0; trackIndex < midiFile.tracks.length; trackIndex++) {
    const track = midiFile.tracks[trackIndex];
    const activeNotes = new Map<
      string,
      { note: number; velocity: number; channel: number; startTime: number }
    >();

    let currentTick = 0;

    for (const event of track.events) {
      currentTick += event.deltaTime;

      if (
        event.type === MIDIEventType.NoteOn ||
        event.type === MIDIEventType.NoteOff
      ) {
        const noteEvent = event as NoteEvent;
        const key = `${noteEvent.channel}-${noteEvent.note}`;

        // Note On with velocity > 0 starts a note
        if (event.type === MIDIEventType.NoteOn && noteEvent.velocity > 0) {
          const startTime = ticksToSeconds(
            currentTick,
            tempoMap,
            ticksPerQuarterNote,
          );
          activeNotes.set(key, {
            note: noteEvent.note,
            velocity: noteEvent.velocity,
            channel: noteEvent.channel,
            startTime,
          });
        } // Note Off or Note On with velocity 0 ends a note
        else {
          const activeNote = activeNotes.get(key);
          if (activeNote) {
            const endTime = ticksToSeconds(
              currentTick,
              tempoMap,
              ticksPerQuarterNote,
            );
            const duration = endTime - activeNote.startTime;

            notes.push({
              track: trackIndex,
              pitch: activeNote.note,
              startTime: activeNote.startTime,
              duration,
              velocity: activeNote.velocity,
              channel: activeNote.channel,
            });

            minPitch = Math.min(minPitch, activeNote.note);
            maxPitch = Math.max(maxPitch, activeNote.note);
            maxTime = Math.max(maxTime, endTime);

            activeNotes.delete(key);
          }
        }
      }
    }

    // Close any remaining open notes
    for (const [_key, activeNote] of activeNotes) {
      const endTime = ticksToSeconds(
        currentTick,
        tempoMap,
        ticksPerQuarterNote,
      );
      const duration = endTime - activeNote.startTime;

      notes.push({
        track: trackIndex,
        pitch: activeNote.note,
        startTime: activeNote.startTime,
        duration,
        velocity: activeNote.velocity,
        channel: activeNote.channel,
      });

      minPitch = Math.min(minPitch, activeNote.note);
      maxPitch = Math.max(maxPitch, activeNote.note);
      maxTime = Math.max(maxTime, endTime);
    }
  }

  // Default pitch range if no notes found
  if (notes.length === 0) {
    minPitch = 60;
    maxPitch = 72;
  }

  const initialTempo = tempoMap.length > 0
    ? Math.round(60000000 / tempoMap[0].microsecondsPerQuarter)
    : 120;

  return {
    notes,
    metadata: {
      totalDuration: maxTime,
      minPitch,
      maxPitch,
      trackCount: midiFile.tracks.length,
      initialTempo,
      ticksPerQuarterNote,
    },
  };
}

/**
 * Builds a map of tempo changes throughout the MIDI file
 */
function buildTempoMap(
  midiFile: MIDIFile,
  _ticksPerQuarterNote: number,
): Array<{ tick: number; microsecondsPerQuarter: number }> {
  const tempoChanges: Array<{ tick: number; microsecondsPerQuarter: number }> =
    [];

  // Start with default tempo at tick 0
  tempoChanges.push({
    tick: 0,
    microsecondsPerQuarter: DEFAULT_MICROSECONDS_PER_QUARTER,
  });

  // Find all tempo changes (usually in first track)
  for (const track of midiFile.tracks) {
    let currentTick = 0;

    for (const event of track.events) {
      currentTick += event.deltaTime;

      if (
        event.type === MIDIEventType.Meta &&
        event.metaType === MetaEventType.SetTempo
      ) {
        const tempoEvent = event as TempoEvent;
        // Replace default if this is at tick 0, otherwise add new tempo change
        if (currentTick === 0) {
          tempoChanges[0] = {
            tick: 0,
            microsecondsPerQuarter: tempoEvent.microsecondsPerQuarterNote,
          };
        } else {
          tempoChanges.push({
            tick: currentTick,
            microsecondsPerQuarter: tempoEvent.microsecondsPerQuarterNote,
          });
        }
      }
    }
  }

  // Sort by tick (should already be sorted, but just to be safe)
  tempoChanges.sort((a, b) => a.tick - b.tick);

  return tempoChanges;
}

/**
 * Converts MIDI ticks to seconds based on tempo map
 */
function ticksToSeconds(
  tick: number,
  tempoMap: Array<{ tick: number; microsecondsPerQuarter: number }>,
  ticksPerQuarterNote: number,
): number {
  let seconds = 0;
  let lastTick = 0;
  let currentTempo = tempoMap[0].microsecondsPerQuarter;

  for (const tempoChange of tempoMap) {
    if (tempoChange.tick >= tick) {
      break;
    }

    // Add time for the segment before this tempo change
    const tickDelta = tempoChange.tick - lastTick;
    seconds += (tickDelta / ticksPerQuarterNote) * (currentTempo / 1000000);

    lastTick = tempoChange.tick;
    currentTempo = tempoChange.microsecondsPerQuarter;
  }

  // Add time for remaining ticks at current tempo
  const tickDelta = tick - lastTick;
  seconds += (tickDelta / ticksPerQuarterNote) * (currentTempo / 1000000);

  return seconds;
}
