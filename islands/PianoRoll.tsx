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
  minimized: boolean;
  height: number; // Height in pixels (0 means auto/flex)
};

export default function PianoRoll({ midiUrl }: PianoRollProps) {
  // Multiple canvases and renderers - one per track
  const trackCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const trackRendererRefs = useRef<(PianoRollRenderer | null)[]>([]);

  const audioPlayerRef = useRef<MIDIAudioPlayer | null>(null);
  const notesRef = useRef<VisualNote[]>([]);
  const metadataRef = useRef<VisualMetadata | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use ref for tracks to avoid stale closures in render loop
  const tracksRef = useRef<TrackState[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [tracks, setTracks] = useState<TrackState[]>([]);
  const [focusedTrack, setFocusedTrack] = useState<number | null>(null);
  const [draggingDivider, setDraggingDivider] = useState<number | null>(null); // Track index above the divider
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dividerDragStartRef = useRef<
    { y: number; height1: number; height2: number } | null
  >(null);

  // Initialize audio player and load MIDI file
  useEffect(() => {
    console.log("PianoRoll: Initializing...");

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
      if (trackRendererRefs.current.length > 0 && notesRef.current.length > 0) {
        // Get playhead time from audio player
        const playheadTime = audioPlayerRef.current?.getCurrentTime();

        // Render each track
        trackRendererRefs.current.forEach((renderer, trackIndex) => {
          if (!renderer) return;

          renderer.handleResize();

          // Get notes for this track, filtered by mute/solo state
          const trackNotes = getFilteredNotesForTrack(trackIndex);

          renderer.render(trackNotes, playheadTime);
        });
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
      // Destroy all renderers
      trackRendererRefs.current.forEach((renderer) => {
        if (renderer) renderer.destroy();
      });
    };
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
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [loading, isPlaying]);

  // Global pointer move handler for divider dragging
  useEffect(() => {
    if (draggingDivider === null) return;

    const handleGlobalPointerMove = (e: PointerEvent) => {
      handleDividerPointerMove(e);
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      handleDividerPointerUp(e);
    };

    globalThis.addEventListener("pointermove", handleGlobalPointerMove);
    globalThis.addEventListener("pointerup", handleGlobalPointerUp);

    return () => {
      globalThis.removeEventListener("pointermove", handleGlobalPointerMove);
      globalThis.removeEventListener("pointerup", handleGlobalPointerUp);
    };
  }, [draggingDivider]);

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

    // Destroy old renderers
    trackRendererRefs.current.forEach((renderer) => {
      if (renderer) renderer.destroy();
    });
    trackRendererRefs.current = [];
    trackCanvasRefs.current = [];

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
      const trackNotes = notes.filter((n) => n.track === i);
      const trackName = midiFile.tracks[i]?.name || `Track ${i + 1}`;
      trackStates.push({
        index: i,
        name: trackName,
        muted: false,
        soloed: false,
        minimized: trackNotes.length === 0, // Auto-minimize empty tracks
        height: 0, // 0 means auto/flex-based height
      });
    }
    tracksRef.current = trackStates;
    setTracks(trackStates);
    setFocusedTrack(null); // Reset focus when loading new file

    console.log("parseMIDIBuffer: Complete!");
  };

  // Get filtered notes based on mute/solo state (all tracks)
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

  // Get filtered notes for a specific track
  // Uses tracksRef instead of tracks state to avoid stale closures in render loop
  const getFilteredNotesForTrack = (trackIndex: number): VisualNote[] => {
    const track = tracksRef.current.find((t) => t.index === trackIndex);
    if (!track) return [];

    const hasSolo = tracksRef.current.some((t) => t.soloed);

    // If this track is muted and no track is soloed, return empty
    if (!hasSolo && track.muted) return [];

    // If any track is soloed and this track is not soloed, return empty
    if (hasSolo && !track.soloed) return [];

    // Return all notes for this track
    return notesRef.current.filter((note) => note.track === trackIndex);
  };

  // Initialize renderers when canvases are ready
  useEffect(() => {
    if (tracks.length === 0 || !metadataRef.current) return;

    console.log(`Initializing renderers for ${tracks.length} tracks`);

    // Initialize renderer for each canvas
    tracks.forEach((track) => {
      const canvas = trackCanvasRefs.current[track.index];
      if (!canvas) return;

      try {
        // Create renderer if it doesn't exist
        if (!trackRendererRefs.current[track.index]) {
          const renderer = new PianoRollRenderer(canvas);
          trackRendererRefs.current[track.index] = renderer;

          // Get notes for this specific track to calculate proper viewport
          const trackNotes = notesRef.current.filter(
            (n) => n.track === track.index,
          );

          if (trackNotes.length > 0) {
            // Calculate pitch range for this specific track
            const trackMinPitch = Math.min(...trackNotes.map((n) => n.pitch));
            const trackMaxPitch = Math.max(...trackNotes.map((n) => n.pitch));

            // Reset view to show this track's notes
            renderer.resetView(
              trackMinPitch,
              trackMaxPitch,
              metadataRef.current!.totalDuration,
            );
          } else {
            // Fallback to global range if no notes
            renderer.resetView(
              metadataRef.current!.minPitch,
              metadataRef.current!.maxPitch,
              metadataRef.current!.totalDuration,
            );
          }

          console.log(
            `Track ${track.index} (${track.name}): ${trackNotes.length} notes`,
          );
        }
      } catch (err) {
        console.error(
          `Failed to initialize renderer for track ${track.index}:`,
          err,
        );
      }
    });
  }, [tracks]);

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

  // Toggle track focus
  const handleToggleFocus = (trackIndex: number) => {
    setFocusedTrack(focusedTrack === trackIndex ? null : trackIndex);
  };

  // Toggle track minimize
  const handleToggleMinimize = (trackIndex: number) => {
    const newTracks = tracks.map((t) =>
      t.index === trackIndex
        ? { ...t, minimized: !t.minimized, height: !t.minimized ? 70 : 0 }
        : t
    );
    tracksRef.current = newTracks;
    setTracks(newTracks);
  };

  // Toggle track mute
  const handleToggleMute = (trackIndex: number) => {
    // Compute new track states
    const newTracks = tracks.map((t) =>
      t.index === trackIndex ? { ...t, muted: !t.muted } : t
    );

    tracksRef.current = newTracks;
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

    tracksRef.current = newTracks;
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
  // Horizontal (time) is synchronized, vertical (pitch) is independent per track
  const handlePointerDown = (trackIndex: number) => (e: PointerEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // Store which track initiated the drag
    (e.target as HTMLElement).dataset.trackIndex = trackIndex.toString();
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    if (trackRendererRefs.current.length === 0) return;

    // Get the track that initiated the drag
    const targetTrackIndex = parseInt(
      (e.target as HTMLElement).dataset.trackIndex || "0",
      10,
    );
    const targetRenderer = trackRendererRefs.current[targetTrackIndex];
    const targetCanvas = trackCanvasRefs.current[targetTrackIndex];
    if (!targetRenderer || !targetCanvas) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    const viewport = targetRenderer.getViewport();

    // Convert pixel delta to world delta
    const worldDx = -(dx / targetCanvas.clientWidth) * viewport.width;
    const worldDy = (dy / targetCanvas.clientHeight) * viewport.height;

    // Clamp horizontal pan to prevent going past the beginning
    const newViewportX = viewport.x + worldDx;
    const clampedViewportX = Math.max(0, newViewportX);
    const clampedWorldDx = clampedViewportX - viewport.x;

    // Apply horizontal pan to ALL renderers (synchronized time)
    // Apply vertical pan only to the target renderer (independent pitch)
    trackRendererRefs.current.forEach((renderer, index) => {
      if (renderer) {
        if (index === targetTrackIndex) {
          // This track: pan both X and Y
          renderer.pan(clampedWorldDx, worldDy);
        } else {
          // Other tracks: pan only X (synchronized horizontal scroll)
          renderer.pan(clampedWorldDx, 0);
        }
      }
    });

    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: PointerEvent) => {
    setIsDragging(false);
    dragStartRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // Wheel handler for track lanes
  // Vertical scroll (deltaY): Allow native scrolling (don't preventDefault for vertical)
  // Horizontal scroll (deltaX): Pan left/right on all tracks synchronized
  const handleTrackWheel = (_trackIndex: number) => (e: WheelEvent) => {
    if (trackRendererRefs.current.length === 0) return;

    // Horizontal scroll (left/right) - pan all tracks' time synchronized
    if (e.deltaX !== 0) {
      e.preventDefault(); // Only prevent default for horizontal scroll
      const firstRenderer = trackRendererRefs.current[0];
      if (!firstRenderer) return;
      const viewport = firstRenderer.getViewport();
      const scrollAmount = (e.deltaX / 100) * viewport.width * 0.1;

      // Calculate new viewport X position
      const newViewportX = viewport.x + scrollAmount;

      // Clamp to prevent scrolling past the beginning (time = 0)
      const clampedViewportX = Math.max(0, newViewportX);
      const actualScrollAmount = clampedViewportX - viewport.x;

      trackRendererRefs.current.forEach((renderer) => {
        if (renderer) {
          renderer.pan(actualScrollAmount, 0);
        }
      });
    }
    // For vertical scroll (deltaY), don't preventDefault - allow native scrolling
  };

  // Wheel handler for top UI bar
  // Scroll: horizontal zoom all tracks
  const handleUIBarWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (trackRendererRefs.current.length === 0) return;

    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;

    // Zoom horizontal (time) synchronized across all tracks
    // Use center point (0.5) since we're not over a specific canvas
    trackRendererRefs.current.forEach((renderer) => {
      if (!renderer) return;
      renderer.zoomX(zoomFactor, 0.5);
      // Clamp to prevent negative viewport
      const viewport = renderer.getViewport();
      if (viewport.x < 0) {
        renderer.pan(-viewport.x, 0);
      }
    });
  };

  // UI button handlers - synchronized horizontal zoom only
  const handleZoomIn = () => {
    trackRendererRefs.current.forEach((renderer) => {
      if (!renderer) return;
      renderer.zoomX(0.8, 0.5);
      // Clamp to prevent negative viewport
      const viewport = renderer.getViewport();
      if (viewport.x < 0) {
        renderer.pan(-viewport.x, 0);
      }
    });
  };

  const handleZoomOut = () => {
    trackRendererRefs.current.forEach((renderer) => {
      if (!renderer) return;
      renderer.zoomX(1.25, 0.5);
      // Clamp to prevent negative viewport
      const viewport = renderer.getViewport();
      if (viewport.x < 0) {
        renderer.pan(-viewport.x, 0);
      }
    });
  };

  const handleReset = () => {
    if (metadataRef.current) {
      trackRendererRefs.current.forEach((renderer) => {
        renderer?.resetView(
          metadataRef.current!.minPitch,
          metadataRef.current!.maxPitch,
          metadataRef.current!.totalDuration,
        );
      });
    }
  };

  // Divider drag handlers for resizing lanes
  const handleDividerPointerDown =
    (trackIndex: number) => (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setDraggingDivider(trackIndex);

      const track1 = tracksRef.current[trackIndex];
      const track2 = tracksRef.current[trackIndex + 1];
      if (!track1) return;

      dividerDragStartRef.current = {
        y: e.clientY,
        height1: track1.height,
        height2: track2 ? track2.height : 0,
      };
    };

  const handleDividerPointerMove = (e: PointerEvent) => {
    if (draggingDivider === null || !dividerDragStartRef.current) return;

    const deltaY = e.clientY - dividerDragStartRef.current.y;
    const currentTracks = tracksRef.current; // Use ref for latest state
    const track1 = currentTracks[draggingDivider];
    const track2 = currentTracks[draggingDivider + 1];
    if (!track1) return;

    // Calculate new heights
    const oldHeight1 = dividerDragStartRef.current.height1 || 200; // Default if using flex
    const newHeight1 = Math.max(70, oldHeight1 + deltaY);

    // Update track heights and auto-toggle minimized state
    const newTracks = currentTracks.map((t) => {
      if (t.index === draggingDivider) {
        return {
          ...t,
          height: newHeight1,
          minimized: newHeight1 <= 70, // Auto-minimize at minimum height
        };
      } else if (track2 && t.index === draggingDivider + 1) {
        // If there's a track below, resize it in opposite direction
        const oldHeight2 = dividerDragStartRef.current!.height2 || 200;
        const newHeight2 = Math.max(70, oldHeight2 - deltaY);
        return {
          ...t,
          height: newHeight2,
          minimized: newHeight2 <= 70, // Auto-minimize at minimum height
        };
      }
      return t;
    });

    tracksRef.current = newTracks;
    setTracks([...newTracks]); // Force new array reference to trigger re-render
  };

  const handleDividerPointerUp = (_e: PointerEvent) => {
    if (draggingDivider !== null) {
      setDraggingDivider(null);
      dividerDragStartRef.current = null;
    }
  };

  return (
    <div class="w-full h-full flex flex-col">
      {/* Controls */}
      <div
        class="flex gap-2 p-4 bg-gray-800 border-b border-gray-700"
        onWheel={handleUIBarWheel}
      >
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

      {/* Main content area: track lanes */}
      <div class="flex-1 flex flex-col overflow-y-auto overflow-x-hidden">
        {/* Loading/Error overlay */}
        {loading && (
          <div class="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 z-10">
            <div class="text-white text-xl">Loading MIDI file...</div>
          </div>
        )}

        {error && (
          <div class="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 z-10">
            <div class="text-red-500 text-xl">Error: {error}</div>
          </div>
        )}

        {!loading && !error && notesRef.current.length === 0 && (
          <div class="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 z-10">
            <div class="text-gray-400 text-xl">
              No notes found in MIDI file
            </div>
          </div>
        )}

        {/* Track Lanes */}
        {tracks.length > 0 && (
          <div class="flex-1 flex flex-col">
            {tracks.map((track) => {
              // Calculate height based on custom height, focus, and minimized state
              const isFocused = focusedTrack === track.index;
              const isOtherFocused = focusedTrack !== null && !isFocused;
              const isMinimized = track.minimized;
              const hasCustomHeight = track.height > 0;

              // If custom height is set, use it; otherwise use flex classes
              const heightStyle = hasCustomHeight
                ? { height: `${track.height}px`, minHeight: "70px" }
                : {};

              const heightClass = hasCustomHeight
                ? "" // Use inline style instead
                : isMinimized
                ? "flex-[0.2] min-h-[70px] max-h-[70px]"
                : isFocused
                ? "flex-[10]"
                : isOtherFocused
                ? "flex-[0.5] min-h-[70px]"
                : "flex-1 min-h-[100px]";

              return (
                <>
                  <div
                    key={track.index}
                    class={`flex border-b border-gray-700 ${heightClass} transition-all duration-300`}
                    style={heightStyle}
                  >
                    {/* Track controls on the left */}
                    <div class="w-48 bg-gray-800 border-r border-gray-700 p-2 flex flex-col gap-2 flex-shrink-0">
                      <div class="text-white text-sm font-semibold truncate">
                        {track.name}
                      </div>
                      <div class="flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleToggleMute(track.index)}
                          class={`flex-1 px-2 py-1 text-xs rounded ${
                            track.muted
                              ? "bg-red-600 text-white"
                              : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                          }`}
                          title={track.muted ? "Unmute" : "Mute"}
                        >
                          {track.muted ? "M" : "M"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleSolo(track.index)}
                          class={`flex-1 px-2 py-1 text-xs rounded ${
                            track.soloed
                              ? "bg-yellow-600 text-white"
                              : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                          }`}
                          title={track.soloed ? "Unsolo" : "Solo"}
                        >
                          S
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleFocus(track.index)}
                          class={`flex-1 px-2 py-1 text-xs rounded ${
                            isFocused
                              ? "bg-blue-600 text-white"
                              : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                          }`}
                          title={isFocused ? "Unfocus" : "Focus"}
                        >
                          F
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleMinimize(track.index)}
                          class={`flex-1 px-2 py-1 text-xs rounded ${
                            isMinimized
                              ? "bg-purple-600 text-white"
                              : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                          }`}
                          title={isMinimized ? "Restore" : "Minimize"}
                        >
                          _
                        </button>
                      </div>
                    </div>

                    {/* Track lane canvas on the right */}
                    <div class="flex-1 relative bg-gray-900">
                      <canvas
                        ref={(el) => {
                          trackCanvasRefs.current[track.index] = el;
                        }}
                        class="w-full h-full cursor-grab active:cursor-grabbing"
                        onPointerDown={handlePointerDown(track.index)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        onWheel={handleTrackWheel(track.index)}
                        style={{ touchAction: "none" }}
                      />
                    </div>
                  </div>

                  {/* Draggable divider after each track */}
                  <div
                    class="h-1 bg-gray-700 hover:bg-blue-500 cursor-ns-resize relative z-10"
                    onPointerDown={handleDividerPointerDown(track.index)}
                  />
                </>
              );
            })}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div class="p-2 bg-gray-800 border-t border-gray-700 text-sm text-gray-400">
        Drag to pan (horiz synced, vert independent) • Top bar scroll: zoom time
        • Scroll up/down: scroll tracks • Scroll left/right: pan time • Space:
        play/pause • Enter: restart
      </div>
    </div>
  );
}
