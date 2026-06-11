// Pure, dependency-free terrain math shared by the renderer, gameplay, and the
// multiplayer server. NO three.js imports — the server consumes a copy of this
// file (server/src/TerrainCore.ts). KEEP THE TWO FILES IN SYNC: same seed +
// biome must produce identical heights/types/courses on every machine.

export type CoreVoxelType = 'field' | 'forest' | 'walk' | 'thicket' | 'water' | 'cliff' | 'path';

// Simple deterministic PRNG
export function lcg(seed: number) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Self-contained 2D Perlin Noise Generator
export class Noise2D {
  private perm: number[] = [];
  constructor(seed: number) {
    const random = lcg(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const temp = p[i];
      p[i] = p[j];
      p[j] = temp;
    }
    this.perm = [...p, ...p];
  }

  private fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
  private lerp(t: number, a: number, b: number) { return a + t * (b - a); }
  private grad(hash: number, x: number, y: number) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
  }

  public noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.perm[this.perm[X] + Y];
    const ab = this.perm[this.perm[X] + Y + 1];
    const ba = this.perm[this.perm[X + 1] + Y];
    const bb = this.perm[this.perm[X + 1] + Y + 1];

    const x1 = this.lerp(u, this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf));
    const x2 = this.lerp(u, this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1));
    return (this.lerp(v, x1, x2) + 1) / 2;
  }
}

// Procedural heightfield + terrain typing for one seed/biome pair
export class TerrainCore {
  public readonly noiseGen: Noise2D;
  public readonly biome: string;
  public readonly mapSize: number;
  public readonly waterLevel: number;

  constructor(seed: number, biome = 'alpine', mapSize = 384, waterLevel = 4) {
    this.noiseGen = new Noise2D(seed);
    this.biome = biome;
    this.mapSize = mapSize;
    this.waterLevel = waterLevel;
  }

  // Procedural continuous noise equation per biome
  public getHeight(x: number, z: number): number {
    const half = this.mapSize / 2;
    if (Math.abs(x) >= half - 4 || Math.abs(z) >= half - 4) {
      return 25.0; // Outer boundary lock
    }

    if (this.biome === 'sprint') {
      // Neat flat park lawns
      const n1 = this.noiseGen.noise(x * 0.004, z * 0.004) * 2.5;
      const n2 = this.noiseGen.noise(x * 0.02, z * 0.02) * 0.8;
      return n1 + n2 + 5.0;
    } else if (this.biome === 'dunes') {
      // Soft rolling sand dunes
      const n1 = this.noiseGen.noise(x * 0.007, z * 0.007) * 7.5;
      const n2 = this.noiseGen.noise(x * 0.025, z * 0.025) * 1.5;
      let height = n1 + n2 + 4.5;
      if (height < this.waterLevel) {
        height = Math.max(1.0, height);
      }
      return height;
    } else if (this.biome === 'gullies') {
      // Severe canyons with dry rocky clefts
      const n1 = this.noiseGen.noise(x * 0.006, z * 0.006) * 15.0;
      const n2 = this.noiseGen.noise(x * 0.035, z * 0.035) * 4.5;
      const cleft = Math.pow(this.noiseGen.noise(x * 0.015, z * 0.015), 3) * 9.0;
      const height = n1 + n2 - cleft + 6.0;
      return Math.max(1.0, height);
    } else {
      // Alpine Spruce Forests (Default): High peaks, deep stone depressions
      const n1 = this.noiseGen.noise(x * 0.005, z * 0.005) * 16.0;
      const n2 = this.noiseGen.noise(x * 0.03, z * 0.03) * 4.0;
      let height = n1 + n2;
      if (height < this.waterLevel) {
        height = Math.max(1.0, height);
      }
      return height;
    }
  }

  public getType(x: number, z: number): CoreVoxelType {
    const height = this.getHeight(x, z);

    if (height <= this.waterLevel) {
      return 'water';
    }

    // Check steepness slope
    const hR = this.getHeight(x + 1, z);
    const hL = this.getHeight(x - 1, z);
    const hF = this.getHeight(x, z + 1);
    const hB = this.getHeight(x, z - 1);

    const maxSlope = Math.max(
      Math.abs(height - hR),
      Math.abs(height - hL),
      Math.abs(height - hF),
      Math.abs(height - hB)
    );

    if (maxSlope >= 1.8 && this.biome !== 'sprint') {
      return 'cliff'; // steep rocky zone
    }

    // Paths generation
    const pathNoise = Math.sin(x * 0.05) * Math.cos(z * 0.05);
    const pathChance = this.noiseGen.noise(x * 0.015, z * 0.015);
    if (pathChance > 0.72 && Math.abs(pathNoise) < 0.04) {
      return 'path';
    }

    // Vegetation scatter thresholds
    const vegNoise = this.noiseGen.noise(x * 0.04 + 10, z * 0.04 + 10);

    if (this.biome === 'sprint') {
      // Tidy hedges and garden lawn layouts
      if (vegNoise > 0.76) {
        return 'thicket'; // solid hedge wall
      } else if (vegNoise > 0.60) {
        return 'walk'; // slower garden flowers
      } else if (vegNoise > 0.45) {
        return 'forest'; // neat park vegetation
      }
      return 'field';
    } else if (this.biome === 'dunes') {
      // Mostly yellow fields (sands) with sea grass
      if (vegNoise > 0.85) {
        return 'thicket';
      } else if (vegNoise > 0.68) {
        return 'walk';
      } else if (vegNoise > 0.50) {
        return 'forest';
      }
      return 'field';
    } else if (this.biome === 'gullies') {
      // Arid desert canyons: mostly bare dry soil
      if (vegNoise > 0.88) {
        return 'thicket';
      } else if (vegNoise > 0.75) {
        return 'walk';
      } else if (vegNoise > 0.65) {
        return 'forest';
      }
      return 'field';
    } else {
      // Alpine
      if (vegNoise > 0.82) {
        return 'thicket';
      } else if (vegNoise > 0.62) {
        return 'walk';
      } else if (vegNoise > 0.42) {
        return 'forest';
      }
      return 'field';
    }
  }
}

export interface CoursePoint {
  x: number;
  z: number;
}

// Terrain-aware control placement. Same seed -> same course everywhere.
// Each control must be reachable and the legs must force navigation:
//  - runnable ground (not water / not cliff), below the snowline, on the map
//  - leg length 60-140m, bearing change >= ~35 deg between consecutive legs
// Falls back to relaxed constraints, then to the legacy ring, so a course is
// always produced even on hostile seeds.
export function generateSmartCourse(core: TerrainCore, seed: number, numControls = 5): CoursePoint[] {
  const random = lcg((seed ^ 0x5eed) >>> 0);
  const points: CoursePoint[] = [];
  const half = core.mapSize / 2;
  const margin = 25;
  // Gullies are legitimately mountainous; allow higher controls there
  const maxHeight = core.biome === 'gullies' ? 18 : core.biome === 'sprint' ? 99 : 11;
  const minHeight = core.waterLevel + 0.6;

  let prevX = 0;
  let prevZ = 0;
  let prevBearing: number | null = null;

  for (let i = 0; i < numControls; i++) {
    let placed = false;

    for (let pass = 0; pass < 2 && !placed; pass++) {
      const minLeg = pass === 0 ? 60 : 40;
      const maxLeg = pass === 0 ? 140 : 180;
      const minTurn = pass === 0 ? 0.6 : 0; // ~35 degrees

      for (let attempt = 0; attempt < 40 && !placed; attempt++) {
        const bearing = random() * Math.PI * 2;
        if (prevBearing !== null && minTurn > 0) {
          let diff = Math.abs(bearing - prevBearing) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff < minTurn) continue;
        }

        const leg = minLeg + random() * (maxLeg - minLeg);
        const x = prevX + Math.cos(bearing) * leg;
        const z = prevZ + Math.sin(bearing) * leg;
        if (Math.abs(x) > half - margin || Math.abs(z) > half - margin) continue;

        const h = core.getHeight(x, z);
        if (h < minHeight || h > maxHeight) continue;
        const type = core.getType(x, z);
        if (type === 'water' || type === 'cliff') continue;

        points.push({ x: Math.round(x), z: Math.round(z) });
        prevX = x;
        prevZ = z;
        prevBearing = bearing;
        placed = true;
      }
    }

    if (!placed) {
      // Legacy ring fallback: never fail to produce a course
      const angle = random() * Math.PI * 2;
      const radius = 50 + (i + 1) * 40 + random() * 20;
      const x = Math.round(Math.cos(angle) * radius);
      const z = Math.round(Math.sin(angle) * radius);
      points.push({ x, z });
      prevX = x;
      prevZ = z;
      prevBearing = null;
    }
  }

  return points;
}
