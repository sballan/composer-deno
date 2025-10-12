import {
  type AftertouchEvent,
  type AnyMIDIEvent,
  type ControlChangeEvent,
  type KeySignatureEvent,
  type MetaEvent,
  MetaEventType,
  MIDIEventType,
  type MIDIFile,
  MIDIFormat,
  type MIDIHeader,
  type MIDITrack,
  type NoteEvent,
  type PitchBendEvent,
  type ProgramChangeEvent,
  type SysExEvent,
  type TempoEvent,
  type TextEvent,
  type TimeSignatureEvent,
} from "./midi-types.ts";

/**
 * MIDIReader class for parsing MIDI files and creating an internal representation
 */
export class MIDIReader {
  private data: Uint8Array;
  private position: number = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /**
   * Parse a MIDI file from binary data
   */
  static async fromFile(filePath: string): Promise<MIDIFile> {
    const data = await Deno.readFile(filePath);
    const reader = new MIDIReader(data);
    return reader.parse();
  }

  /**
   * Parse a MIDI file from Uint8Array
   */
  static fromBuffer(buffer: Uint8Array): MIDIFile {
    const reader = new MIDIReader(buffer);
    return reader.parse();
  }

  /**
   * Main parsing method
   */
  parse(): MIDIFile {
    const header = this.parseHeader();
    const tracks: MIDITrack[] = [];

    for (let i = 0; i < header.trackCount; i++) {
      tracks.push(this.parseTrack());
    }

    return {
      header,
      tracks,
    };
  }

  /**
   * Parse MIDI file header (MThd chunk)
   */
  private parseHeader(): MIDIHeader {
    const chunkType = this.readString(4);
    if (chunkType !== "MThd") {
      throw new Error(`Invalid MIDI file: expected MThd, got ${chunkType}`);
    }

    const chunkLength = this.readUInt32();
    if (chunkLength !== 6) {
      throw new Error(`Invalid header length: ${chunkLength}`);
    }

    const format = this.readUInt16();
    const trackCount = this.readUInt16();
    const timeDivision = this.readUInt16();

    if (format < 0 || format > 2) {
      throw new Error(`Invalid MIDI format: ${format}`);
    }

    return {
      format: format as MIDIFormat,
      trackCount,
      timeDivision,
    };
  }

  /**
   * Parse a MIDI track (MTrk chunk)
   */
  private parseTrack(): MIDITrack {
    const chunkType = this.readString(4);
    if (chunkType !== "MTrk") {
      throw new Error(`Invalid track: expected MTrk, got ${chunkType}`);
    }

    const chunkLength = this.readUInt32();
    const endPosition = this.position + chunkLength;
    const events: AnyMIDIEvent[] = [];
    let runningStatus: number | null = null;
    let trackName: string | undefined;

    while (this.position < endPosition) {
      const deltaTime = this.readVarLen();
      const statusByte = this.peek();

      let eventByte: number;
      if (statusByte >= 0x80) {
        eventByte = this.readUInt8();
        if (statusByte < 0xf0) {
          runningStatus = eventByte;
        }
      } else {
        if (runningStatus === null) {
          throw new Error("No running status available");
        }
        eventByte = runningStatus;
      }

      const event = this.parseEvent(deltaTime, eventByte);
      events.push(event);

      if (event.type === MIDIEventType.Meta) {
        const metaEvent = event as MetaEvent;
        if (metaEvent.metaType === MetaEventType.TrackName) {
          trackName = (metaEvent as TextEvent).text;
        }
      }
    }

    return {
      events,
      name: trackName,
    };
  }

  /**
   * Parse a single MIDI event
   */
  private parseEvent(
    deltaTime: number,
    statusByte: number,
  ): AnyMIDIEvent {
    const eventType = statusByte & 0xf0;
    const channel = statusByte & 0x0f;

    switch (eventType) {
      case MIDIEventType.NoteOff:
      case MIDIEventType.NoteOn: {
        const note = this.readUInt8();
        const velocity = this.readUInt8();
        return {
          deltaTime,
          type: eventType,
          channel,
          note,
          velocity,
        } as NoteEvent;
      }

      case MIDIEventType.PolyphonicAftertouch: {
        const note = this.readUInt8();
        const pressure = this.readUInt8();
        return {
          deltaTime,
          type: eventType,
          channel,
          note,
          pressure,
        } as AftertouchEvent;
      }

      case MIDIEventType.ControlChange: {
        const controller = this.readUInt8();
        const value = this.readUInt8();
        return {
          deltaTime,
          type: eventType,
          channel,
          controller,
          value,
        } as ControlChangeEvent;
      }

      case MIDIEventType.ProgramChange: {
        const program = this.readUInt8();
        return {
          deltaTime,
          type: eventType,
          channel,
          program,
        } as ProgramChangeEvent;
      }

      case MIDIEventType.ChannelAftertouch: {
        const pressure = this.readUInt8();
        return {
          deltaTime,
          type: eventType,
          channel,
          pressure,
        } as AftertouchEvent;
      }

      case MIDIEventType.PitchBend: {
        const lsb = this.readUInt8();
        const msb = this.readUInt8();
        const value = (msb << 7) | lsb;
        return {
          deltaTime,
          type: eventType,
          channel,
          value,
        } as PitchBendEvent;
      }

      default: {
        if (statusByte === MIDIEventType.Meta) {
          return this.parseMetaEvent(deltaTime);
        } else if (
          statusByte === MIDIEventType.SysEx ||
          statusByte === MIDIEventType.SysExEnd
        ) {
          return this.parseSysExEvent(deltaTime, statusByte);
        } else {
          throw new Error(`Unknown event type: 0x${statusByte.toString(16)}`);
        }
      }
    }
  }

  /**
   * Parse a meta event
   */
  private parseMetaEvent(deltaTime: number): AnyMIDIEvent {
    const metaType = this.readUInt8();
    const length = this.readVarLen();
    const data = this.readBytes(length);

    const baseEvent: MetaEvent = {
      deltaTime,
      type: MIDIEventType.Meta,
      metaType: metaType as MetaEventType,
      data,
    };

    switch (metaType) {
      case MetaEventType.SetTempo: {
        const microsecondsPerQuarterNote = (data[0] << 16) | (data[1] << 8) |
          data[2];
        const bpm = Math.round(60000000 / microsecondsPerQuarterNote);
        return {
          ...baseEvent,
          metaType: MetaEventType.SetTempo,
          microsecondsPerQuarterNote,
          bpm,
        } as TempoEvent;
      }

      case MetaEventType.TimeSignature: {
        return {
          ...baseEvent,
          metaType: MetaEventType.TimeSignature,
          numerator: data[0],
          denominator: Math.pow(2, data[1]),
          clocksPerClick: data[2],
          thirtySecondNotesPerQuarterNote: data[3],
        } as TimeSignatureEvent;
      }

      case MetaEventType.KeySignature: {
        return {
          ...baseEvent,
          metaType: MetaEventType.KeySignature,
          sharpsOrFlats: new Int8Array([data[0]])[0],
          isMinor: data[1] === 1,
        } as KeySignatureEvent;
      }

      case MetaEventType.TextEvent:
      case MetaEventType.CopyrightNotice:
      case MetaEventType.TrackName:
      case MetaEventType.InstrumentName:
      case MetaEventType.Lyric:
      case MetaEventType.Marker:
      case MetaEventType.CuePoint: {
        const text = new TextDecoder().decode(data);
        return {
          ...baseEvent,
          metaType,
          text,
        } as TextEvent;
      }

      default:
        return baseEvent;
    }
  }

  /**
   * Parse a SysEx event
   */
  private parseSysExEvent(deltaTime: number, statusByte: number): SysExEvent {
    const length = this.readVarLen();
    const data = this.readBytes(length);

    return {
      deltaTime,
      type: statusByte as
        | typeof MIDIEventType.SysEx
        | typeof MIDIEventType.SysExEnd,
      data,
    };
  }

  /**
   * Read a string of specified length
   */
  private readString(length: number): string {
    const bytes = this.readBytes(length);
    return new TextDecoder().decode(bytes);
  }

  /**
   * Read a 32-bit unsigned integer (big-endian)
   */
  private readUInt32(): number {
    const value = (this.data[this.position] << 24) |
      (this.data[this.position + 1] << 16) |
      (this.data[this.position + 2] << 8) |
      this.data[this.position + 3];
    this.position += 4;
    return value >>> 0;
  }

  /**
   * Read a 16-bit unsigned integer (big-endian)
   */
  private readUInt16(): number {
    const value = (this.data[this.position] << 8) |
      this.data[this.position + 1];
    this.position += 2;
    return value;
  }

  /**
   * Read an 8-bit unsigned integer
   */
  private readUInt8(): number {
    return this.data[this.position++];
  }

  /**
   * Peek at the next byte without advancing position
   */
  private peek(): number {
    return this.data[this.position];
  }

  /**
   * Read bytes without advancing position
   */
  private readBytes(length: number): Uint8Array {
    const bytes = this.data.slice(this.position, this.position + length);
    this.position += length;
    return bytes;
  }

  /**
   * Read a variable-length quantity
   */
  private readVarLen(): number {
    let value = 0;
    let byte: number;

    do {
      byte = this.readUInt8();
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);

    return value;
  }
}
