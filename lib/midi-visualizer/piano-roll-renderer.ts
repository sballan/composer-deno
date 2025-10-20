import type { VisualNote } from "./types.ts";

/**
 * WebGL-based piano roll renderer
 */
export class PianoRollRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;

  // Camera/viewport state
  private viewportX = 0; // Start time in seconds
  private viewportY = 36; // Start pitch (MIDI note number) - centered on middle C area
  private viewportWidth = 10; // Seconds visible
  private viewportHeight = 48; // Number of pitches visible

  // Colors
  private backgroundColor: [number, number, number, number] = [
    0.1,
    0.1,
    0.15,
    1.0,
  ];
  private noteColor: [number, number, number, number] = [0.3, 0.6, 0.9, 0.8];

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2");
    if (!gl) {
      throw new Error("WebGL2 not supported");
    }
    this.gl = gl;

    this.initWebGL();
    this.handleResize();
  }

  /**
   * Initialize WebGL context, shaders, and buffers
   */
  private initWebGL(): void {
    const gl = this.gl;

    // Vertex shader - renders a quad for each note instance
    const vertexShaderSource = `#version 300 es
      precision highp float;

      // Quad vertices (2 triangles forming a rectangle)
      in vec2 a_position;

      // Instance attributes (per-note data)
      in float a_pitch;
      in float a_startTime;
      in float a_duration;
      in float a_velocity;

      // Uniforms for camera/viewport
      uniform vec2 u_viewportPos;    // (time, pitch) of bottom-left corner
      uniform vec2 u_viewportSize;   // (time span, pitch span)
      uniform vec2 u_resolution;     // Canvas size in pixels

      out float v_velocity;

      void main() {
        // Scale quad to note dimensions in world space
        vec2 notePos = vec2(a_startTime, a_pitch);
        vec2 noteSize = vec2(a_duration, 0.8); // 0.8 height for visual spacing

        // Apply quad position to note
        vec2 worldPos = notePos + a_position * noteSize;

        // Transform to viewport space (0-1)
        vec2 viewportSpace = (worldPos - u_viewportPos) / u_viewportSize;

        // Transform to clip space (-1 to 1)
        vec2 clipSpace = viewportSpace * 2.0 - 1.0;

        gl_Position = vec4(clipSpace, 0.0, 1.0);
        v_velocity = a_velocity / 127.0;
      }
    `;

    // Fragment shader - colors the notes
    const fragmentShaderSource = `#version 300 es
      precision highp float;

      in float v_velocity;
      out vec4 fragColor;

      uniform vec4 u_noteColor;

      void main() {
        // Vary brightness based on velocity
        float brightness = 0.5 + v_velocity * 0.5;
        fragColor = vec4(u_noteColor.rgb * brightness, u_noteColor.a);
      }
    `;

    // Compile shaders
    const vertexShader = this.compileShader(
      gl.VERTEX_SHADER,
      vertexShaderSource,
    );
    const fragmentShader = this.compileShader(
      gl.FRAGMENT_SHADER,
      fragmentShaderSource,
    );

    // Link program
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      throw new Error(`Failed to link program: ${info}`);
    }

    this.program = program;

    // Create vertex array object
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO");
    gl.bindVertexArray(vao);
    this.vao = vao;

    // Set up quad geometry (two triangles)
    const quadVertices = new Float32Array([
      0,
      0, // Bottom-left
      1,
      0, // Bottom-right
      0,
      1, // Top-left
      0,
      1, // Top-left
      1,
      0, // Bottom-right
      1,
      1, // Top-right
    ]);

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    // Create instance buffer (will be filled when rendering)
    const instanceBuffer = gl.createBuffer();
    if (!instanceBuffer) throw new Error("Failed to create instance buffer");
    this.instanceBuffer = instanceBuffer;

    // Set up instance attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);

    const pitchLoc = gl.getAttribLocation(program, "a_pitch");
    const startTimeLoc = gl.getAttribLocation(program, "a_startTime");
    const durationLoc = gl.getAttribLocation(program, "a_duration");
    const velocityLoc = gl.getAttribLocation(program, "a_velocity");

    // Each instance has 4 floats: pitch, startTime, duration, velocity
    const stride = 4 * 4; // 4 floats * 4 bytes

    gl.enableVertexAttribArray(pitchLoc);
    gl.vertexAttribPointer(pitchLoc, 1, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(pitchLoc, 1);

    gl.enableVertexAttribArray(startTimeLoc);
    gl.vertexAttribPointer(startTimeLoc, 1, gl.FLOAT, false, stride, 4);
    gl.vertexAttribDivisor(startTimeLoc, 1);

    gl.enableVertexAttribArray(durationLoc);
    gl.vertexAttribPointer(durationLoc, 1, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(durationLoc, 1);

    gl.enableVertexAttribArray(velocityLoc);
    gl.vertexAttribPointer(velocityLoc, 1, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(velocityLoc, 1);

    gl.bindVertexArray(null);

    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Compile a shader
   */
  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Failed to compile shader: ${info}`);
    }

    return shader;
  }

  /**
   * Render the piano roll
   */
  render(
    notes: VisualNote[],
    playheadTime?: number,
    trackCount?: number,
  ): void {
    const gl = this.gl;
    if (!this.program || !this.vao) return;

    // Clear canvas
    gl.clearColor(...this.backgroundColor);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw grid lines first (behind notes)
    this.renderNoteLanes();
    if (trackCount) {
      this.renderTrackSeparators(notes, trackCount);
    }

    // Filter notes in viewport for better performance
    const visibleNotes = notes.filter((note) => {
      const noteEndTime = note.startTime + note.duration;
      return (
        note.startTime < this.viewportX + this.viewportWidth &&
        noteEndTime > this.viewportX &&
        note.pitch >= this.viewportY &&
        note.pitch < this.viewportY + this.viewportHeight
      );
    });

    if (visibleNotes.length === 0) return;

    // Prepare instance data
    const instanceData = new Float32Array(visibleNotes.length * 4);
    for (let i = 0; i < visibleNotes.length; i++) {
      const note = visibleNotes[i];
      const offset = i * 4;
      instanceData[offset + 0] = note.pitch;
      instanceData[offset + 1] = note.startTime;
      instanceData[offset + 2] = note.duration;
      instanceData[offset + 3] = note.velocity;
    }

    // Upload instance data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);

    // Use program and set uniforms
    gl.useProgram(this.program);

    const viewportPosLoc = gl.getUniformLocation(this.program, "u_viewportPos");
    const viewportSizeLoc = gl.getUniformLocation(
      this.program,
      "u_viewportSize",
    );
    const resolutionLoc = gl.getUniformLocation(this.program, "u_resolution");
    const noteColorLoc = gl.getUniformLocation(this.program, "u_noteColor");

    gl.uniform2f(viewportPosLoc, this.viewportX, this.viewportY);
    gl.uniform2f(viewportSizeLoc, this.viewportWidth, this.viewportHeight);
    gl.uniform2f(resolutionLoc, gl.canvas.width, gl.canvas.height);
    gl.uniform4f(noteColorLoc, ...this.noteColor);

    // Draw instanced
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, visibleNotes.length);
    gl.bindVertexArray(null);

    // Draw playhead if provided
    if (playheadTime !== undefined) {
      this.renderPlayhead(playheadTime);
    }
  }

  /**
   * Render the playhead line
   */
  private renderPlayhead(time: number): void {
    const gl = this.gl;
    if (!this.program) return;

    // Check if playhead is in viewport
    if (time < this.viewportX || time > this.viewportX + this.viewportWidth) {
      return;
    }

    // Create thin vertical line spanning full viewport height
    // Render as multiple stacked quads since each quad is 0.8 units tall
    const lineWidth = 0.002 * this.viewportWidth;
    const pitchStart = Math.floor(this.viewportY);
    const pitchEnd = Math.ceil(this.viewportY + this.viewportHeight);
    const pitchCount = pitchEnd - pitchStart;

    // Create instance data for all pitch levels
    const instanceData = new Float32Array(pitchCount * 4);
    for (let i = 0; i < pitchCount; i++) {
      const offset = i * 4;
      instanceData[offset + 0] = pitchStart + i; // pitch
      instanceData[offset + 1] = time - lineWidth / 2; // startTime
      instanceData[offset + 2] = lineWidth; // duration
      instanceData[offset + 3] = 127; // velocity
    }

    // Upload playhead data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);

    // Use program with red color for playhead
    gl.useProgram(this.program);

    const viewportPosLoc = gl.getUniformLocation(this.program, "u_viewportPos");
    const viewportSizeLoc = gl.getUniformLocation(
      this.program,
      "u_viewportSize",
    );
    const resolutionLoc = gl.getUniformLocation(this.program, "u_resolution");
    const noteColorLoc = gl.getUniformLocation(this.program, "u_noteColor");

    gl.uniform2f(viewportPosLoc, this.viewportX, this.viewportY);
    gl.uniform2f(viewportSizeLoc, this.viewportWidth, this.viewportHeight);
    gl.uniform2f(resolutionLoc, gl.canvas.width, gl.canvas.height);
    gl.uniform4f(noteColorLoc, 1.0, 0.2, 0.2, 0.9); // Red playhead

    // Draw playhead
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pitchCount);
    gl.bindVertexArray(null);
  }

  /**
   * Render horizontal note lanes (piano roll grid)
   */
  private renderNoteLanes(): void {
    const gl = this.gl;
    if (!this.program) return;

    const pitchStart = Math.floor(this.viewportY);
    const pitchEnd = Math.ceil(this.viewportY + this.viewportHeight);
    const _lineHeight = 0.02; // Thin lines

    const lines: number[] = [];
    for (let pitch = pitchStart; pitch <= pitchEnd; pitch++) {
      // Draw line at each pitch
      lines.push(
        pitch, // pitch
        this.viewportX, // startTime
        this.viewportWidth, // duration (spans entire viewport width)
        127, // velocity
      );
    }

    if (lines.length === 0) return;

    const instanceData = new Float32Array(lines);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);

    gl.useProgram(this.program);

    const viewportPosLoc = gl.getUniformLocation(this.program, "u_viewportPos");
    const viewportSizeLoc = gl.getUniformLocation(
      this.program,
      "u_viewportSize",
    );
    const resolutionLoc = gl.getUniformLocation(this.program, "u_resolution");
    const noteColorLoc = gl.getUniformLocation(this.program, "u_noteColor");

    gl.uniform2f(viewportPosLoc, this.viewportX, this.viewportY);
    gl.uniform2f(viewportSizeLoc, this.viewportWidth, this.viewportHeight);
    gl.uniform2f(resolutionLoc, gl.canvas.width, gl.canvas.height);
    gl.uniform4f(noteColorLoc, 0.2, 0.2, 0.25, 0.3); // Subtle gray lines

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, lines.length / 4);
    gl.bindVertexArray(null);
  }

  /**
   * Render vertical track separator lines
   */
  private renderTrackSeparators(notes: VisualNote[], trackCount: number): void {
    const gl = this.gl;
    if (!this.program || trackCount <= 1) return;

    // Calculate time ranges for each track
    const trackRanges: Array<{ startTime: number; endTime: number }> = [];
    for (let track = 0; track < trackCount; track++) {
      const trackNotes = notes.filter((n) => n.track === track);
      if (trackNotes.length === 0) continue;

      const startTime = Math.min(...trackNotes.map((n) => n.startTime));
      const endTime = Math.max(
        ...trackNotes.map((n) => n.startTime + n.duration),
      );
      trackRanges.push({ startTime, endTime });
    }

    // Draw vertical separator lines between tracks
    const separators: number[] = [];
    const lineWidth = 0.005 * this.viewportWidth;

    for (let i = 0; i < trackRanges.length - 1; i++) {
      const endTime = trackRanges[i].endTime;
      const nextStartTime = trackRanges[i + 1].startTime;

      // Draw separator in the gap between tracks
      const separatorTime = (endTime + nextStartTime) / 2;

      // Only draw if visible
      if (
        separatorTime >= this.viewportX &&
        separatorTime <= this.viewportX + this.viewportWidth
      ) {
        const pitchStart = Math.floor(this.viewportY);
        const pitchEnd = Math.ceil(this.viewportY + this.viewportHeight);

        // Create vertical line spanning all pitches
        for (let pitch = pitchStart; pitch < pitchEnd; pitch++) {
          separators.push(
            pitch,
            separatorTime - lineWidth / 2,
            lineWidth,
            127,
          );
        }
      }
    }

    if (separators.length === 0) return;

    const instanceData = new Float32Array(separators);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);

    gl.useProgram(this.program);

    const viewportPosLoc = gl.getUniformLocation(this.program, "u_viewportPos");
    const viewportSizeLoc = gl.getUniformLocation(
      this.program,
      "u_viewportSize",
    );
    const resolutionLoc = gl.getUniformLocation(this.program, "u_resolution");
    const noteColorLoc = gl.getUniformLocation(this.program, "u_noteColor");

    gl.uniform2f(viewportPosLoc, this.viewportX, this.viewportY);
    gl.uniform2f(viewportSizeLoc, this.viewportWidth, this.viewportHeight);
    gl.uniform2f(resolutionLoc, gl.canvas.width, gl.canvas.height);
    gl.uniform4f(noteColorLoc, 0.5, 0.5, 0.6, 0.6); // Brighter separator lines

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, separators.length / 4);
    gl.bindVertexArray(null);
  }

  /**
   * Pan the viewport (move camera)
   */
  pan(deltaX: number, deltaY: number): void {
    this.viewportX += deltaX;
    this.viewportY += deltaY;

    // Clamp Y to reasonable bounds
    this.viewportY = Math.max(
      0,
      Math.min(127 - this.viewportHeight, this.viewportY),
    );
  }

  /**
   * Zoom the viewport
   */
  zoom(factor: number, centerX?: number, centerY?: number): void {
    // If center is provided, zoom toward that point
    if (centerX !== undefined && centerY !== undefined) {
      const worldX = this.viewportX + centerX * this.viewportWidth;
      const worldY = this.viewportY + centerY * this.viewportHeight;

      this.viewportWidth *= factor;
      this.viewportHeight *= factor;

      this.viewportX = worldX - centerX * this.viewportWidth;
      this.viewportY = worldY - centerY * this.viewportHeight;
    } else {
      this.viewportWidth *= factor;
      this.viewportHeight *= factor;
    }

    // Clamp zoom levels
    this.viewportWidth = Math.max(1, Math.min(100, this.viewportWidth));
    this.viewportHeight = Math.max(12, Math.min(128, this.viewportHeight));

    // Clamp Y
    this.viewportY = Math.max(
      0,
      Math.min(127 - this.viewportHeight, this.viewportY),
    );
  }

  /**
   * Reset viewport to show all notes
   */
  resetView(minPitch: number, maxPitch: number, totalDuration: number): void {
    this.viewportX = 0;
    this.viewportY = Math.max(0, minPitch - 2);
    this.viewportWidth = totalDuration * 1.1;
    this.viewportHeight = Math.max(12, maxPitch - minPitch + 4);
  }

  /**
   * Handle canvas resize
   */
  handleResize(): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      gl.viewport(0, 0, displayWidth, displayHeight);
    }
  }

  /**
   * Get current viewport state
   */
  getViewport(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.viewportX,
      y: this.viewportY,
      width: this.viewportWidth,
      height: this.viewportHeight,
    };
  }

  /**
   * Set viewport directly
   */
  setViewport(x: number, y: number, width: number, height: number): void {
    this.viewportX = x;
    this.viewportY = Math.max(0, Math.min(127 - height, y));
    this.viewportWidth = Math.max(1, Math.min(100, width));
    this.viewportHeight = Math.max(12, Math.min(128, height));
  }

  /**
   * Zoom only horizontally (time axis)
   */
  zoomX(factor: number, centerX = 0.5): void {
    const worldX = this.viewportX + centerX * this.viewportWidth;
    this.viewportWidth *= factor;
    this.viewportX = worldX - centerX * this.viewportWidth;

    // Clamp zoom level
    this.viewportWidth = Math.max(1, Math.min(100, this.viewportWidth));
  }

  /**
   * Zoom only vertically (pitch axis)
   */
  zoomY(factor: number, centerY = 0.5): void {
    const worldY = this.viewportY + centerY * this.viewportHeight;
    this.viewportHeight *= factor;
    this.viewportY = worldY - centerY * this.viewportHeight;

    // Clamp zoom level and position
    this.viewportHeight = Math.max(12, Math.min(128, this.viewportHeight));
    this.viewportY = Math.max(
      0,
      Math.min(127 - this.viewportHeight, this.viewportY),
    );
  }

  /**
   * Clean up WebGL resources
   */
  destroy(): void {
    const gl = this.gl;
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
  }
}
