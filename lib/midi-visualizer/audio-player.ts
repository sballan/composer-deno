import type { VisualNote } from "./types.ts";

/**
 * Simple MIDI audio player using Web Audio API
 */
export class MIDIAudioPlayer {
  private audioContext: AudioContext;
  private masterGain: GainNode;
  private scheduledNotes: Map<
    number,
    { oscillator: OscillatorNode; gain: GainNode }
  > = new Map();
  private notes: VisualNote[] = [];
  private startTime: number = 0;
  private pauseTime: number = 0;
  private isPlaying: boolean = false;
  private schedulerInterval: number | null = null;
  private scheduleAheadTime: number = 0.2; // Schedule 200ms ahead
  private lastScheduledTime: number = 0;

  constructor() {
    this.audioContext = new AudioContext();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.3; // Master volume
    this.masterGain.connect(this.audioContext.destination);
  }

  /**
   * Load notes for playback
   */
  loadNotes(notes: VisualNote[]): void {
    // Sort notes by start time so all tracks play together correctly
    this.notes = [...notes].sort((a, b) => a.startTime - b.startTime);
    this.lastScheduledTime = 0;
  }

  /**
   * Start playback
   */
  play(): void {
    if (this.isPlaying) return;

    // Resume audio context if suspended (browser autoplay policy)
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }

    this.isPlaying = true;

    // If resuming from pause, adjust start time
    if (this.pauseTime > 0) {
      this.startTime = this.audioContext.currentTime - this.pauseTime;
      this.pauseTime = 0;
    } else {
      this.startTime = this.audioContext.currentTime;
      this.lastScheduledTime = 0;
    }

    // Start scheduling loop
    this.schedulerInterval = setInterval(() => {
      this.scheduleNotes();
    }, 50) as unknown as number;
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    this.pauseTime = this.audioContext.currentTime - this.startTime;

    // Stop scheduler
    if (this.schedulerInterval !== null) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    // Stop all currently playing notes
    this.stopAllNotes();
  }

  /**
   * Stop playback and reset
   */
  stop(): void {
    this.pause();
    this.pauseTime = 0;
    this.lastScheduledTime = 0;
    this.stopAllNotes();
  }

  /**
   * Seek to a specific time
   */
  seek(time: number): void {
    const wasPlaying = this.isPlaying;

    if (this.isPlaying) {
      this.pause();
    }

    this.pauseTime = time;
    this.lastScheduledTime = time;
    this.stopAllNotes();

    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Get current playback time
   */
  getCurrentTime(): number {
    if (this.isPlaying) {
      return this.audioContext.currentTime - this.startTime;
    }
    return this.pauseTime;
  }

  /**
   * Check if playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Schedule notes that should play soon
   */
  private scheduleNotes(): void {
    const currentTime = this.audioContext.currentTime - this.startTime;
    const scheduleUntil = currentTime + this.scheduleAheadTime;

    for (const note of this.notes) {
      const noteStartTime = note.startTime;
      const noteEndTime = note.startTime + note.duration;

      // Skip notes we've already scheduled
      if (noteStartTime < this.lastScheduledTime) continue;

      // Stop scheduling future notes
      if (noteStartTime > scheduleUntil) break;

      // Schedule this note
      this.scheduleNote(note, noteStartTime, noteEndTime);
    }

    this.lastScheduledTime = scheduleUntil;
  }

  /**
   * Schedule a single note
   */
  private scheduleNote(
    note: VisualNote,
    startTime: number,
    endTime: number,
  ): void {
    const audioStartTime = this.startTime + startTime;
    const audioEndTime = this.startTime + endTime;

    // Convert MIDI note to frequency (A4 = 440Hz, MIDI note 69)
    const frequency = 440 * Math.pow(2, (note.pitch - 69) / 12);

    // Create oscillator for this note
    const oscillator = this.audioContext.createOscillator();
    oscillator.type = "triangle"; // Simple sine wave
    oscillator.frequency.value = frequency;

    // Create gain node for envelope
    const gainNode = this.audioContext.createGain();
    const velocity = note.velocity / 127;
    const volume = velocity * 0.1; // Reduced volume per note

    // Simple ADSR envelope
    const attackTime = 0.01;
    const releaseTime = 0.05;

    gainNode.gain.setValueAtTime(0, audioStartTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioStartTime + attackTime);
    gainNode.gain.setValueAtTime(volume, audioEndTime - releaseTime);
    gainNode.gain.linearRampToValueAtTime(0, audioEndTime);

    // Connect nodes
    oscillator.connect(gainNode);
    gainNode.connect(this.masterGain);

    // Schedule start and stop
    oscillator.start(audioStartTime);
    oscillator.stop(audioEndTime);

    // Track scheduled note
    const noteId = Math.random();
    this.scheduledNotes.set(noteId, { oscillator, gain: gainNode });

    // Clean up when done
    oscillator.onended = () => {
      this.scheduledNotes.delete(noteId);
      try {
        oscillator.disconnect();
        gainNode.disconnect();
      } catch {
        // Already disconnected
      }
    };
  }

  /**
   * Stop all currently playing notes
   */
  private stopAllNotes(): void {
    const now = this.audioContext.currentTime;

    for (const [id, { oscillator, gain }] of this.scheduledNotes) {
      try {
        // Quick fade out
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.01);

        oscillator.stop(now + 0.01);
      } catch {
        // Note may have already stopped
      }
      this.scheduledNotes.delete(id);
    }
  }

  /**
   * Clean up audio resources
   */
  destroy(): void {
    this.stop();
    this.masterGain.disconnect();
    this.audioContext.close();
  }
}
