import { useEffect, useRef, useState } from "preact/hooks";
import { PianoRollRenderer } from "../lib/midi-visualizer/piano-roll-renderer.ts";
import { MIDIAudioPlayer } from "../lib/midi-visualizer/audio-player.ts";
import { transformMIDIToNotes } from "../lib/midi-visualizer/transformer.ts";
import type {
  VisualMetadata,
  VisualNote,
} from "../lib/midi-visualizer/types.ts";

type PianoRollProps = {
  /** URL to the MIDI file to load */
  midiUrl: string;
};

type TrackState = {
  index: number;
  name: string;
  muted: boolean;
  soloed: boolean;
};

export default function PianoRoll({ midiUrl }: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PianoRollRenderer | null>(null);
  const audioPlayerRef = useRef<MIDIAudioPlayer | null>(null);
  const notesRef = useRef<VisualNote[]>([]);
  const metadataRef = useRef<VisualMetadata | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [tracks, setTracks] = useState<TrackState[]>([]);
  const [trackPanelOpen, setTrackPanelOpen] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Initialize renderer and load MIDI file
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    console.log("PianoRoll: Initializing...");

    try {
      // Initialize WebGL renderer
      const renderer = new PianoRollRenderer(canvas);
      rendererRef.current = renderer;
      console.log("PianoRoll: WebGL renderer initialized");

      // Initialize audio player
      try {
        const audioPlayer = new MIDIAudioPlayer();
        audioPlayerRef.current = audioPlayer;
      } catch (err) {
        console.error("Failed to initialize audio player:", err);
        // Continue without audio player
      }

      // Load MIDI file
      loadMIDIFile(midiUrl).catch((err) => {
        console.error("Failed to load initial MIDI file:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load MIDI file",
        );
        setLoading(false);
      });

      // Start render loop
      const renderLoop = () => {
        if (rendererRef.current && notesRef.current.length > 0) {
          rendererRef.current.handleResize();

          // Get playhead time from audio player
          const playheadTime = audioPlayerRef.current?.getCurrentTime();

          // Filter notes based on mute/solo state
          const filteredNotes = getFilteredNotes();

          rendererRef.current.render(
            filteredNotes,
            playheadTime,
            metadataRef.current?.trackCount,
          );
        }
        animationFrameRef.current = requestAnimationFrame(renderLoop);
      };
      renderLoop();

      // Cleanup
      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioPlayerRef.current) {
          audioPlayerRef.current.destroy();
        }
        renderer.destroy();
      };
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to initialize renderer",
      );
      setLoading(false);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Spacebar: play/pause
      if (e.code === "Space" && !loading && notesRef.current.length > 0) {
        e.preventDefault();
        handlePlayPause();
      }

      // Enter: restart from beginning (preserve play state)
      if (e.code === "Enter" && !loading && notesRef.current.length > 0) {
        e.preventDefault();
        if (audioPlayerRef.current) {
          const wasPlaying = isPlaying;
          audioPlayerRef.current.stop();

          if (wasPlaying) {
            // Restart playback from beginning
            const filteredNotes = getFilteredNotes();
            audioPlayerRef.current.loadNotes(filteredNotes);
            audioPlayerRef.current.play();
          } else {
            // Stay paused at beginning
            setIsPlaying(false);
          }
        }
      }

      // Command+I (Mac) or Ctrl+I (Windows/Linux): toggle track panel
      if (
        e.code === "KeyI" &&
        (e.metaKey || e.ctrlKey) &&
        !loading &&
        tracks.length > 0
      ) {
        e.preventDefault();
        handleToggleTrackPanel();
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [loading, isPlaying, tracks.length, trackPanelOpen]);

  // Load and parse MIDI file from URL
  const loadMIDIFile = async (url: string) => {
    try {
      console.log("loadMIDIFile: Starting to load:", url);
      setLoading(true);
      setError(null);

      // Fetch MIDI file
      console.log("loadMIDIFile: Fetching...");
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load MIDI file: ${response.statusText}`);
      }

      console.log("loadMIDIFile: Parsing buffer...");
      const arrayBuffer = await response.arrayBuffer();
      await parseMIDIBuffer(arrayBuffer);

      console.log("loadMIDIFile: Complete!");
      setLoading(false);
    } catch (err) {
      console.error("loadMIDIFile: Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load MIDI file");
      setLoading(false);
    }
  };

  // Load and parse MIDI file from uploaded File
  const handleFileUpload = async (file: File) => {
    try {
      setLoading(true);
      setError(null);

      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      await parseMIDIBuffer(arrayBuffer);

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MIDI file");
      setLoading(false);
    }
  };

  // Parse MIDI buffer and render
  const parseMIDIBuffer = async (arrayBuffer: ArrayBuffer) => {
    console.log(
      "parseMIDIBuffer: Starting, buffer size:",
      arrayBuffer.byteLength,
    );
    const uint8Array = new Uint8Array(arrayBuffer);

    // Stop any playing audio
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
      setIsPlaying(false);
    }

    // Parse MIDI file (dynamic import to avoid bundling server-side code)
    console.log("parseMIDIBuffer: Importing MIDIReader...");
    const { MIDIReader } = await import(
      "../lib/midi-file-reader/midi-reader.ts"
    );
    console.log("parseMIDIBuffer: Parsing MIDI...");
    const midiFile = MIDIReader.fromBuffer(uint8Array);

    // Transform to visual notes
    console.log("parseMIDIBuffer: Transforming to notes...");
    const { notes, metadata } = transformMIDIToNotes(midiFile);
    console.log("parseMIDIBuffer: Got", notes.length, "notes");
    notesRef.current = notes;
    metadataRef.current = metadata;

    // Load notes into audio player
    if (audioPlayerRef.current) {
      console.log("parseMIDIBuffer: Loading notes into audio player...");
      audioPlayerRef.current.loadNotes(notes);
    }

    // Initialize tracks
    console.log("parseMIDIBuffer: Initializing tracks...");
    const trackStates: TrackState[] = [];
    for (let i = 0; i < metadata.trackCount; i++) {
      const _trackNotes = notes.filter((n) => n.track === i);
      const trackName = midiFile.tracks[i]?.name || `Track ${i + 1}`;
      trackStates.push({
        index: i,
        name: trackName,
        muted: false,
        soloed: false,
      });
    }
    setTracks(trackStates);

    // Reset view to show all notes
    if (rendererRef.current) {
      console.log("parseMIDIBuffer: Resetting view...");
      rendererRef.current.resetView(
        metadata.minPitch,
        metadata.maxPitch,
        metadata.totalDuration,
      );
    }
    console.log("parseMIDIBuffer: Complete!");
  };

  // Get filtered notes based on mute/solo state
  const getFilteredNotes = (): VisualNote[] => {
    const hasSolo = tracks.some((t) => t.soloed);

    return notesRef.current.filter((note) => {
      const track = tracks.find((t) => t.index === note.track);
      if (!track) return true;

      // If any track is soloed, only show soloed tracks
      if (hasSolo) {
        return track.soloed;
      }

      // Otherwise, show all non-muted tracks
      return !track.muted;
    });
  };

  // Handle file input change
  const handleFileInputChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  // Trigger file input click
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Toggle play/pause
  const handlePlayPause = () => {
    if (!audioPlayerRef.current) return;

    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      // Reload notes with current filter before playing
      const filteredNotes = getFilteredNotes();
      audioPlayerRef.current.loadNotes(filteredNotes);
      audioPlayerRef.current.play();
      setIsPlaying(true);
    }
  };

  // Toggle track panel
  const handleToggleTrackPanel = () => {
    setTrackPanelOpen(!trackPanelOpen);
  };

  // Toggle track mute
  const handleToggleMute = (trackIndex: number) => {
    // Compute new track states
    const newTracks = tracks.map((t) =>
      t.index === trackIndex ? { ...t, muted: !t.muted } : t
    );

    setTracks(newTracks);

    // Update audio player with filtered notes if playing
    if (isPlaying && audioPlayerRef.current) {
      // Get current time before updating
      const currentTime = audioPlayerRef.current.getCurrentTime();

      // Compute filtered notes based on new state
      const hasSolo = newTracks.some((t) => t.soloed);
      const filteredNotes = notesRef.current.filter((note) => {
        const track = newTracks.find((t) => t.index === note.track);
        if (!track) return true;
        if (hasSolo) return track.soloed;
        return !track.muted;
      });

      // Update notes and seek to current position (seamless update)
      audioPlayerRef.current.loadNotes(filteredNotes);
      audioPlayerRef.current.seek(currentTime);
    }
  };

  // Toggle track solo
  const handleToggleSolo = (trackIndex: number) => {
    // Compute new track states
    const newTracks = tracks.map((t) =>
      t.index === trackIndex ? { ...t, soloed: !t.soloed } : t
    );

    setTracks(newTracks);

    // Update audio player with filtered notes if playing
    if (isPlaying && audioPlayerRef.current) {
      // Get current time before updating
      const currentTime = audioPlayerRef.current.getCurrentTime();

      // Compute filtered notes based on new state
      const hasSolo = newTracks.some((t) => t.soloed);
      const filteredNotes = notesRef.current.filter((note) => {
        const track = newTracks.find((t) => t.index === note.track);
        if (!track) return true;
        if (hasSolo) return track.soloed;
        return !track.muted;
      });

      // Update notes and seek to current position (seamless update)
      audioPlayerRef.current.loadNotes(filteredNotes);
      audioPlayerRef.current.seek(currentTime);
    }
  };

  // Mouse/touch drag handlers for panning
  const handlePointerDown = (e: PointerEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging || !dragStartRef.current || !rendererRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    const viewport = rendererRef.current.getViewport();

    // Convert pixel delta to world delta
    const worldDx = -(dx / canvas.clientWidth) * viewport.width;
    const worldDy = (dy / canvas.clientHeight) * viewport.height;

    rendererRef.current.pan(worldDx, worldDy);

    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: PointerEvent) => {
    setIsDragging(false);
    dragStartRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // Wheel handler for zooming
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!rendererRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Zoom factor based on wheel delta
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;

    // Get mouse position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const centerX = (e.clientX - rect.left) / rect.width;
    const centerY = 1 - (e.clientY - rect.top) / rect.height; // Flip Y

    rendererRef.current.zoom(zoomFactor, centerX, centerY);
  };

  // UI button handlers
  const handleZoomIn = () => {
    rendererRef.current?.zoom(0.8, 0.5, 0.5);
  };

  const handleZoomOut = () => {
    rendererRef.current?.zoom(1.25, 0.5, 0.5);
  };

  const handleReset = () => {
    if (rendererRef.current && metadataRef.current) {
      rendererRef.current.resetView(
        metadataRef.current.minPitch,
        metadataRef.current.maxPitch,
        metadataRef.current.totalDuration,
      );
    }
  };

  return (
    <div class="w-full h-full flex flex-col">
      {/* Controls */}
      <div class="flex gap-2 p-4 bg-gray-800 border-b border-gray-700">
        <input
          ref={fileInputRef}
          type="file"
          accept=".mid,.midi"
          onChange={handleFileInputChange}
          class="hidden"
        />
        <button
          type="button"
          onClick={handleUploadClick}
          class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50"
          disabled={loading}
        >
          Upload MIDI
        </button>
        <button
          type="button"
          onClick={handleToggleTrackPanel}
          class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50"
          disabled={loading || tracks.length === 0}
        >
          {trackPanelOpen ? "◀ Hide" : "▶"} Track Options
        </button>
        <button
          type="button"
          onClick={handlePlayPause}
          class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
          disabled={loading || notesRef.current.length === 0}
        >
          {isPlaying ? "⏸ Pause" : "▶ Play"}
        </button>
        <button
          type="button"
          onClick={handleZoomIn}
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          disabled={loading}
        >
          Zoom In
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          disabled={loading}
        >
          Zoom Out
        </button>
        <button
          type="button"
          onClick={handleReset}
          class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded disabled:opacity-50"
          disabled={loading}
        >
          Reset View
        </button>

        {metadataRef.current && (
          <div class="ml-auto flex gap-4 text-sm text-gray-300">
            <span>Notes: {notesRef.current.length}</span>
            <span>
              Duration: {metadataRef.current.totalDuration.toFixed(1)}s
            </span>
            <span>Tempo: {metadataRef.current.initialTempo} BPM</span>
          </div>
        )}
      </div>

      {/* Main content area: track panel + canvas */}
      <div class="flex-1 flex overflow-hidden">
        {/* Track Panel */}
        {trackPanelOpen && (
          <div class="w-64 bg-gray-800 border-r border-gray-700 overflow-y-auto flex-shrink-0">
            <div class="p-4">
              <h3 class="text-white font-bold mb-4">Tracks</h3>
              {tracks.map((track) => (
                <div
                  key={track.index}
                  class="mb-3 p-3 bg-gray-750 rounded border border-gray-600"
                >
                  <div class="text-white text-sm font-semibold mb-2 truncate">
                    {track.name}
                  </div>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleMute(track.index)}
                      class={`flex-1 px-2 py-1 text-xs rounded ${
                        track.muted
                          ? "bg-red-600 text-white"
                          : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                      }`}
                    >
                      {track.muted ? "🔇 Muted" : "🔊 Mute"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleSolo(track.index)}
                      class={`flex-1 px-2 py-1 text-xs rounded ${
                        track.soloed
                          ? "bg-yellow-600 text-white"
                          : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                      }`}
                    >
                      {track.soloed ? "⭐ Solo" : "Solo"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Canvas */}
        <div class="flex-1 relative bg-gray-900">
          <canvas
            ref={canvasRef}
            class="w-full h-full cursor-grab active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            style={{ touchAction: "none" }}
          />

          {/* Loading/Error overlay */}
          {loading && (
            <div class="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
              <div class="text-white text-xl">Loading MIDI file...</div>
            </div>
          )}

          {error && (
            <div class="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
              <div class="text-red-500 text-xl">Error: {error}</div>
            </div>
          )}

          {!loading && !error && notesRef.current.length === 0 && (
            <div class="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
              <div class="text-gray-400 text-xl">
                No notes found in MIDI file
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div class="p-2 bg-gray-800 border-t border-gray-700 text-sm text-gray-400">
        Drag to pan • Scroll to zoom • Spacebar: play/pause • Enter: restart •
        ⌘I: toggle track options
      </div>
    </div>
  );
}
