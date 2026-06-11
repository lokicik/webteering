export interface TimedSample {
  x: number;
  z: number;
  t: number; // ms since race start
}

export interface ReplayPaths {
  [id: string]: TimedSample[];
}

export interface ReplayPlayerInfo {
  [id: string]: { name: string; skinColor: string };
}

// Animated post-race route replay drawn over the pre-rendered static map.
// Owns its own RAF loop, running only between play() and pause()/dispose().
export class ReplayPlayer {
  private canvas: HTMLCanvasElement;
  private background: HTMLCanvasElement;
  private paths: ReplayPaths = {};
  private players: ReplayPlayerInfo = {};

  private duration = 0;
  private cursor = 0;
  private speed = 4;
  private playing = false;
  private rafId = 0;
  private lastFrameTime = 0;
  private onTick: ((cursorMs: number, durationMs: number, playing: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, background: HTMLCanvasElement) {
    this.canvas = canvas;
    this.background = background;
  }

  public load(
    paths: ReplayPaths,
    players: ReplayPlayerInfo,
    onTick: (cursorMs: number, durationMs: number, playing: boolean) => void
  ) {
    this.pause();
    this.paths = paths;
    this.players = players;
    this.onTick = onTick;
    this.duration = 0;
    for (const pid in paths) {
      const path = paths[pid];
      if (path.length) this.duration = Math.max(this.duration, path[path.length - 1].t);
    }
    this.cursor = this.duration; // start showing the full routes (matches old static view)
    this.render();
    this.onTick?.(this.cursor, this.duration, false);
  }

  public getDuration(): number {
    return this.duration;
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public play() {
    if (this.playing || this.duration <= 0) return;
    if (this.cursor >= this.duration) this.cursor = 0; // replay from the start
    this.playing = true;
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
    this.onTick?.(this.cursor, this.duration, true);
  }

  public pause() {
    this.playing = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.onTick?.(this.cursor, this.duration, false);
  }

  public setSpeed(mult: number) {
    this.speed = mult;
  }

  public getSpeed(): number {
    return this.speed;
  }

  public seek(tMs: number) {
    this.cursor = Math.max(0, Math.min(this.duration, tMs));
    this.render();
    this.onTick?.(this.cursor, this.duration, this.playing);
  }

  public dispose() {
    this.playing = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.onTick = null;
    this.paths = {};
  }

  private loop = (now: number) => {
    if (!this.playing) return;
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;
    this.cursor += dt * this.speed;

    if (this.cursor >= this.duration) {
      this.cursor = this.duration;
      this.render();
      this.playing = false;
      this.onTick?.(this.cursor, this.duration, false);
      return;
    }

    this.render();
    this.onTick?.(this.cursor, this.duration, true);
    this.rafId = requestAnimationFrame(this.loop);
  };

  private render() {
    const size = this.background.width || this.canvas.width;
    if (this.canvas.width !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.drawImage(this.background, 0, 0);

    const half = size / 2;

    for (const pid in this.paths) {
      const path = this.paths[pid];
      if (path.length < 2) continue;
      const info = this.players[pid] || { name: 'Runner', skinColor: '#00ccff' };

      // Trailing polyline of every sample up to the cursor
      ctx.save();
      ctx.strokeStyle = info.skinColor;
      ctx.lineWidth = 3.0;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = info.skinColor;
      ctx.shadowBlur = 6;

      ctx.beginPath();
      ctx.moveTo(path[0].x + half, path[0].z + half);
      let lastIdx = 0;
      for (let i = 1; i < path.length; i++) {
        if (path[i].t > this.cursor) break;
        ctx.lineTo(path[i].x + half, path[i].z + half);
        lastIdx = i;
      }

      // Interpolated head position between the bracketing samples
      let headX = path[lastIdx].x;
      let headZ = path[lastIdx].z;
      if (lastIdx < path.length - 1) {
        const a = path[lastIdx];
        const b = path[lastIdx + 1];
        const span = b.t - a.t;
        const f = span > 0 ? Math.max(0, Math.min(1, (this.cursor - a.t) / span)) : 0;
        headX = a.x + (b.x - a.x) * f;
        headZ = a.z + (b.z - a.z) * f;
        ctx.lineTo(headX + half, headZ + half);
      }
      ctx.stroke();
      ctx.restore();

      // Runner head dot (only meaningful mid-replay)
      if (this.cursor < this.duration) {
        ctx.save();
        ctx.fillStyle = info.skinColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(headX + half, headZ + half, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}
