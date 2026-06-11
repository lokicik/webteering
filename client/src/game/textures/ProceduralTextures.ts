import * as THREE from 'three';

// All texture synthesis for the photoreal overhaul lives here.
// Everything is generated on canvas/ImageData at startup — no downloaded assets.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise: a wrapped random lattice with smooth bilinear interpolation.
// Sampling frequency must stay an integer multiple of the period for seamless tiling.
function makeTileableNoise(seed: number, period: number): (x: number, y: number) => number {
  const rand = mulberry32(seed);
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();

  const at = (ix: number, iy: number) =>
    lattice[((iy % period + period) % period) * period + ((ix % period + period) % period)];

  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const v00 = at(x0, y0);
    const v10 = at(x0 + 1, y0);
    const v01 = at(x0, y0 + 1);
    const v11 = at(x0 + 1, y0 + 1);
    return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
  };
}

// Tileable fbm built from integer-frequency octaves of the same wrapped lattice
function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

export type DetailKind = 'grass' | 'rock' | 'soil';

// Mid-grey-centered luminance detail, intended to be MULTIPLIED over vertex
// colors (x2 in the shader) so the underlying IOF map hue is never changed.
export function createDetailAlbedo(kind: DetailKind, size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  const period = 8; // lattice cells across the texture
  const n1 = makeTileableNoise(kind === 'grass' ? 101 : kind === 'rock' ? 202 : 303, period);
  const n2 = makeTileableNoise(kind === 'grass' ? 111 : kind === 'rock' ? 212 : 313, period);

  const contrast = 0.14;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * period;
      const v = (y / size) * period;

      let value: number; // 0..1, 0.5 = neutral
      switch (kind) {
        case 'grass': {
          // Anisotropic streaks read as blades/strands from above
          const streaks = fbm(n1, u * 1.5, v * 7.0, 4);
          const patches = fbm(n2, u, v, 3);
          value = streaks * 0.65 + patches * 0.35;
          break;
        }
        case 'rock': {
          // Ridged noise gives crack-like dark seams
          const ridge = 1.0 - Math.abs(2.0 * fbm(n1, u * 2.0, v * 2.0, 4) - 1.0);
          const blotch = fbm(n2, u, v, 3);
          value = ridge * 0.55 + blotch * 0.45;
          break;
        }
        case 'soil': {
          const speckle = fbm(n1, u * 6.0, v * 6.0, 3);
          const blotch = fbm(n2, u * 1.2, v * 1.2, 3);
          value = speckle * 0.5 + blotch * 0.5;
          break;
        }
      }

      const grey = Math.round(255 * (0.5 + (value - 0.5) * 2.0 * contrast));
      const idx = (y * size + x) * 4;
      img.data[idx] = grey;
      img.data[idx + 1] = grey;
      img.data[idx + 2] = grey;
      // Height stored in alpha for normal-map derivation
      img.data[idx + 3] = Math.round(255 * value);
    }
  }

  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Sobel height-to-normal. Reads luminance of the source canvas as height.
export function createNormalFromHeight(source: HTMLCanvasElement, strength = 1.0): THREE.CanvasTexture {
  const w = source.width;
  const h = source.height;
  const srcCtx = source.getContext('2d')!;
  const src = srcCtx.getImageData(0, 0, w, h).data;

  const heightAt = (x: number, y: number) => {
    const xi = ((x % w) + w) % w;
    const yi = ((y % h) + h) % h;
    const i = (yi * w + xi) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        (heightAt(x + 1, y - 1) + 2 * heightAt(x + 1, y) + heightAt(x + 1, y + 1)) -
        (heightAt(x - 1, y - 1) + 2 * heightAt(x - 1, y) + heightAt(x - 1, y + 1));
      const dy =
        (heightAt(x - 1, y + 1) + 2 * heightAt(x, y + 1) + heightAt(x + 1, y + 1)) -
        (heightAt(x - 1, y - 1) + 2 * heightAt(x, y - 1) + heightAt(x + 1, y - 1));

      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      const idx = (y * w + x) * 4;
      out.data[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      out.data[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      out.data[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      out.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Vertical bark: ridged streaks running along Y with knots and tone variation
export function createBarkTexture(size = 256): { albedo: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  const period = 8;
  const n1 = makeTileableNoise(401, period);
  const n2 = makeTileableNoise(411, period);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * period;
      const v = (y / size) * period;

      // Strong vertical anisotropy: stretched sampling makes ridges run up the trunk
      const ridges = 1.0 - Math.abs(2.0 * fbm(n1, u * 6.0, v * 0.8, 4) - 1.0);
      const tone = fbm(n2, u * 1.5, v * 1.5, 3);
      const value = ridges * 0.6 + tone * 0.4;

      // Dark brown-grey ramp
      const r = Math.round(46 + value * 50);
      const g = Math.round(34 + value * 36);
      const b = Math.round(26 + value * 26);

      const idx = (y * size + x) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const albedo = new THREE.CanvasTexture(canvas);
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.colorSpace = THREE.SRGBColorSpace;

  const normal = createNormalFromHeight(canvas, 2.0);
  return { albedo, normal };
}

// Conifer branch card: layered drooping sub-branches covered in short needle
// strokes, on a transparent background. Used with alphaTest cutout.
export function createConiferBranchTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(777);

  // Central stem from bottom-center to top-center
  const cx = size / 2;
  ctx.strokeStyle = '#3d2c1e';
  ctx.lineWidth = size * 0.015;
  ctx.beginPath();
  ctx.moveTo(cx, size * 0.98);
  ctx.lineTo(cx, size * 0.08);
  ctx.stroke();

  const needleColors = ['#16301c', '#1a2e1a', '#1f3d24', '#2d4a22', '#24421f'];

  // Sub-branches forking off the stem, drooping outward and down.
  // Needle strokes must stay dense/thick: thin sparse strokes lose alpha
  // coverage in lower mips and alpha-tested cards vanish at distance.
  const branchCount = 46;
  for (let b = 0; b < branchCount; b++) {
    const t = 0.1 + (b / branchCount) * 0.85; // position along the stem (top to bottom)
    const sy = size * t;
    const dir = b % 2 === 0 ? 1 : -1;
    // Lower branches reach further out; varied reach leaves sky gaps between them
    const reach = size * (0.08 + t * 0.38) * (0.55 + rand() * 0.65);
    const droop = reach * (0.25 + rand() * 0.3);

    const ex = cx + dir * reach;
    const ey = sy + droop;

    ctx.strokeStyle = '#33261a';
    ctx.lineWidth = size * 0.006;
    ctx.beginPath();
    ctx.moveTo(cx, sy);
    ctx.quadraticCurveTo(cx + dir * reach * 0.55, sy + droop * 0.25, ex, ey);
    ctx.stroke();

    // Needles along the sub-branch
    const needleCount = 34 + Math.floor(rand() * 18);
    for (let n = 0; n < needleCount; n++) {
      const nt = n / needleCount;
      // Point on the quadratic curve
      const qx = (1 - nt) * (1 - nt) * cx + 2 * (1 - nt) * nt * (cx + dir * reach * 0.55) + nt * nt * ex;
      const qy = (1 - nt) * (1 - nt) * sy + 2 * (1 - nt) * nt * (sy + droop * 0.25) + nt * nt * ey;

      const needleLen = size * (0.024 + rand() * 0.026) * (1.0 - nt * 0.3);
      const angle = (rand() - 0.5) * 2.4 + (dir > 0 ? 0.5 : Math.PI - 0.5);

      ctx.strokeStyle = needleColors[Math.floor(rand() * needleColors.length)];
      // Sparse lighter sun-catching tips
      if (rand() < 0.06) ctx.strokeStyle = '#4a6b35';
      ctx.lineWidth = 1.6 + rand() * 1.6;
      ctx.beginPath();
      ctx.moveTo(qx, qy);
      ctx.lineTo(qx + Math.cos(angle) * needleLen, qy + Math.sin(angle) * needleLen);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
