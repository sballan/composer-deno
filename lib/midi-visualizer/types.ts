/**
 * Represents a visual note for rendering on a piano roll
 */
export type VisualNote = {
  /** Track index in the MIDI file */
  track: number;
  /** MIDI note number (0-127, middle C is 60) */
  pitch: number;
  /** Start time in seconds */
  startTime: number;
  /** Duration in seconds */
  duration: number;
  /** Velocity (0-127, volume/intensity) */
  velocity: number;
  /** MIDI channel (0-15) */
  channel: number;
};

/**
 * Metadata about the MIDI file for visualization
 */
export type VisualMetadata = {
  /** Total duration in seconds */
  totalDuration: number;
  /** Lowest pitch in the file */
  minPitch: number;
  /** Highest pitch in the file */
  maxPitch: number;
  /** Number of tracks */
  trackCount: number;
  /** Initial tempo in BPM */
  initialTempo: number;
  /** Ticks per quarter note from MIDI header */
  ticksPerQuarterNote: number;
};
