import { useEffect, useRef, useState } from "preact/hooks";
import { PianoRollRenderer } from "../lib/midi-visualizer/piano-roll-renderer.ts";
import { transformMIDIToNotes } from "../lib/midi-visualizer/transformer.ts";
import type {
  VisualMetadata,
  VisualNote,
} from "../lib/midi-visualizer/types.ts";

type PianoRollProps = {
  /** URL to the MIDI file to load */
  midiUrl: string;
};

export default function PianoRoll({ midiUrl }: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PianoRollRenderer | null>(null);
  const notesRef = useRef<VisualNote[]>([]);
  const metadataRef = useRef<VisualMetadata | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Initialize renderer and load MIDI file
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      // Initialize WebGL renderer
      const renderer = new PianoRollRenderer(canvas);
      rendererRef.current = renderer;

      // Load MIDI file
      loadMIDIFile(midiUrl);

      // Start render loop
      const renderLoop = () => {
        if (rendererRef.current && notesRef.current.length > 0) {
          rendererRef.current.handleResize();
          rendererRef.current.render(notesRef.current);
        }
        animationFrameRef.current = requestAnimationFrame(renderLoop);
      };
      renderLoop();

      // Cleanup
      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
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

  // Load and parse MIDI file from URL
  const loadMIDIFile = async (url: string) => {
    try {
      setLoading(true);
      setError(null);

      // Fetch MIDI file
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load MIDI file: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      await parseMIDIBuffer(arrayBuffer);

      setLoading(false);
    } catch (err) {
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
    const uint8Array = new Uint8Array(arrayBuffer);

    // Parse MIDI file (dynamic import to avoid bundling server-side code)
    const { MIDIReader } = await import(
      "../lib/midi-file-reader/midi-reader.ts"
    );
    const midiFile = MIDIReader.fromBuffer(uint8Array);

    // Transform to visual notes
    const { notes, metadata } = transformMIDIToNotes(midiFile);
    notesRef.current = notes;
    metadataRef.current = metadata;

    // Reset view to show all notes
    if (rendererRef.current) {
      rendererRef.current.resetView(
        metadata.minPitch,
        metadata.maxPitch,
        metadata.totalDuration,
      );
    }
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
          class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
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
            <div class="text-gray-400 text-xl">No notes found in MIDI file</div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div class="p-2 bg-gray-800 border-t border-gray-700 text-sm text-gray-400">
        Drag to pan • Scroll to zoom • Click Reset to fit all notes
      </div>
    </div>
  );
}
