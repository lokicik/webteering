import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain } from './Terrain';
import { createBarkTexture, createConiferBranchTexture } from './textures/ProceduralTextures';
import { QualitySettings, QUALITY_PRESETS, loadQualityLevel } from './Quality';

// Simple deterministic PRNG
function lcg(seed: number) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Deterministic per-chunk seed so foliage is identical for all players
function hashChunk(seed: number, cx: number, cz: number): number {
  let h = (seed ^ Math.imul(cx, 374761393) ^ Math.imul(cz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Per-chunk (64x64m) spawn densities per biome
interface BiomeDensity {
  trees: number;
  grass: number;
  flowers: number;
  boulders: number;
  hedges: number;
}

const DENSITIES: { [biome: string]: BiomeDensity } = {
  alpine:  { trees: 72, grass: 1800, flowers: 90,  boulders: 6,  hedges: 0 },
  dunes:   { trees: 5,  grass: 2200, flowers: 60,  boulders: 2,  hedges: 0 },
  gullies: { trees: 0,  grass: 250,  flowers: 0,   boulders: 14, hedges: 0 },
  sprint:  { trees: 12, grass: 1500, flowers: 120, boulders: 1,  hedges: 5 }
};

interface FoliageChunk {
  cx: number;
  cz: number;
  lodNear: boolean; // near chunks get textured card trees, far ones cheap cones
  meshes: THREE.InstancedMesh[];
}

interface InstanceItem {
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

export class Foliage {
  private scene: THREE.Scene;
  private containerGroup = new THREE.Group();

  // Materials with uniform injection for wind-waving vertex shading
  private trunkMaterial!: THREE.MeshLambertMaterial;
  private branchMaterial!: THREE.MeshLambertMaterial; // textured conifer branch cards
  private branchDepthMaterial!: THREE.MeshDepthMaterial; // alpha-tested shadows for the cards
  private foliageMaterial!: THREE.MeshLambertMaterial;   // far-LOD cone material
  private grassMaterial!: THREE.MeshLambertMaterial;
  private flowerMaterial!: THREE.MeshLambertMaterial;
  private rockMaterial!: THREE.MeshLambertMaterial;
  private hedgeMaterial!: THREE.MeshLambertMaterial;

  // Shared geometries (built once, reused by every chunk)
  private cardTreeGeometry!: THREE.BufferGeometry;
  private coneLodGeometry!: THREE.BufferGeometry;
  private trunkGeometry!: THREE.BufferGeometry;
  private grassGeometry!: THREE.BufferGeometry;
  private flowerGeometry!: THREE.BufferGeometry;
  private rockGeometry!: THREE.BufferGeometry;
  private hedgeGeometry!: THREE.BufferGeometry;

  // Chunk streaming state
  private terrain: Terrain | null = null;
  private seed = 0;
  private biome = 'alpine';
  private chunks = new Map<string, FoliageChunk>();
  private buildQueue: { cx: number; cz: number }[] = [];
  private readonly chunkSize = 64;
  private readonly renderRadius = 2; // 5x5 grid like the terrain
  private readonly grassRing = 1;    // dense grass only in the 3x3 around the player
  private cardTreeRing = 1;          // textured trees within this ring, cones beyond (-1 = cones only)
  private grassDensityScale = 1.0;
  private lastCx: number | null = null;
  private lastCz: number | null = null;
  private lastPlayerPos = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.containerGroup);
    this.initMaterials();
    this.initGeometries();

    const preset = QUALITY_PRESETS[loadQualityLevel()];
    this.grassDensityScale = preset.grassDensityScale;
    this.cardTreeRing = preset.cardTreeRing;
  }

  // Adjust grass density / tree LOD radius; streamed chunks rebuild over the next frames
  public applyQuality(settings: QualitySettings) {
    if (
      settings.grassDensityScale === this.grassDensityScale &&
      settings.cardTreeRing === this.cardTreeRing
    ) {
      return;
    }
    this.grassDensityScale = settings.grassDensityScale;
    this.cardTreeRing = settings.cardTreeRing;

    if (this.terrain) {
      for (const key of [...this.chunks.keys()]) {
        this.removeChunk(key);
      }
      this.buildQueue = [];
      // Forces refreshGrid to requeue everything on the next update tick
      this.lastCx = null;
      this.lastCz = null;
    }
  }

  // Olive, desaturated grass blades with a few dry strands mixed in
  private createProceduralGrassTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);

    const blades = 30;
    for (let i = 0; i < blades; i++) {
      ctx.save();
      ctx.translate(30 + Math.random() * 196, 256);

      const angle = (Math.random() - 0.5) * 0.9;
      ctx.rotate(angle);

      const height = 130 + Math.random() * 110;
      const width = 4 + Math.random() * 4;

      const grad = ctx.createLinearGradient(0, 0, 0, -height);
      if (Math.random() < 0.15) {
        // Dry strand
        grad.addColorStop(0, '#6b6038');
        grad.addColorStop(1, '#9c8c58');
      } else {
        grad.addColorStop(0, '#46562a');
        grad.addColorStop(0.5, '#576830');
        grad.addColorStop(1, '#8da05c');
      }
      ctx.fillStyle = grad;

      ctx.beginPath();
      ctx.moveTo(-width / 2, 0);
      ctx.quadraticCurveTo(-width / 4, -height * 0.7, (Math.random() - 0.5) * 14, -height);
      ctx.quadraticCurveTo(width / 4, -height * 0.7, width / 2, 0);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createProceduralFlowerTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Transparent background
    ctx.clearRect(0, 0, 256, 256);

    // 1. Draw green stems
    ctx.strokeStyle = '#3f6212';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';

    // Left stem
    ctx.beginPath();
    ctx.moveTo(128, 256);
    ctx.quadraticCurveTo(90, 160, 80, 100);
    ctx.stroke();

    // Right stem
    ctx.beginPath();
    ctx.moveTo(128, 256);
    ctx.quadraticCurveTo(150, 150, 170, 85);
    ctx.stroke();

    // 2. Base leaves
    ctx.fillStyle = '#4d7c0f';
    ctx.beginPath();
    ctx.ellipse(128, 230, 28, 12, -0.4, 0, Math.PI * 2);
    ctx.ellipse(128, 230, 28, 12, 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Helper to draw a detailed daisy flower head
    const drawFlowerHead = (cx: number, cy: number, radius: number) => {
      // White petals
      ctx.fillStyle = '#ffffff';
      const petals = 12;
      for (let j = 0; j < petals; j++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((j * Math.PI * 2) / petals);
        ctx.beginPath();
        ctx.ellipse(0, -radius * 0.8, radius * 0.35, radius * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Yellow disk floret center
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
      ctx.fill();

      // Orange core detail
      ctx.fillStyle = '#ca8a04';
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.22, 0, Math.PI * 2);
      ctx.fill();
    };

    // Draw flowers at stem tips
    drawFlowerHead(80, 100, 32);
    drawFlowerHead(170, 85, 26);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private initMaterials() {
    // Custom shader injection for swaying wind movement
    const windShaderModifier = (shader: any) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = `
        uniform float uTime;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          #include <begin_vertex>
          // Sway amount scales with height (y) to keep base rooted
          if (position.y > 0.05) {
            float swayX = sin(uTime * 3.0 + position.x * 0.4) * 0.08 * position.y;
            float swayZ = cos(uTime * 2.6 + position.z * 0.4) * 0.08 * position.y;
            transformed.x += swayX;
            transformed.z += swayZ;
          }
        `
      );
    };

    // 1. Trunk material: procedural bark with ridged normal map
    const bark = createBarkTexture(256);
    this.trunkMaterial = new THREE.MeshLambertMaterial({
      map: bark.albedo,
      normalMap: bark.normal,
      normalScale: new THREE.Vector2(0.8, 0.8)
    });

    // 2a. Near-LOD conifer: alpha-tested needle branch cards with wind sway.
    //     Opaque + alphaTest so depth-based effects (AO, god rays) see real silhouettes.
    const branchTexture = createConiferBranchTexture();
    this.branchMaterial = new THREE.MeshLambertMaterial({
      map: branchTexture,
      alphaTest: 0.28, // low enough that mip-reduced needle alpha survives at distance
      transparent: false,
      side: THREE.DoubleSide,
      // Faint self-light so card undersides (backfaces lit only by the dark
      // hemisphere ground bounce) read dark green instead of black tarps
      emissive: 0x0a120b
    });
    this.branchMaterial.onBeforeCompile = (shader) => {
      windShaderModifier(shader);
      this.branchMaterial.userData.shader = shader;
    };
    // Without this, the cards would shadow as full quads
    this.branchDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: branchTexture,
      alphaTest: 0.28
    });

    // 2b. Far-LOD conifer cones (dark green, matches the card trees at distance)
    this.foliageMaterial = new THREE.MeshLambertMaterial({ color: 0x1c3520 });
    this.foliageMaterial.onBeforeCompile = (shader) => {
      windShaderModifier(shader);
      this.foliageMaterial.userData.shader = shader;
    };

    // 3. Grass material (olive green) with high wind sway and detailed procedural alpha-cut blades
    this.grassMaterial = new THREE.MeshLambertMaterial({
      map: this.createProceduralGrassTexture(),
      // Opaque + alphaTest discard: writes real depth so AO/god rays see blade silhouettes
      transparent: false,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      // Backlit DoubleSide blades otherwise render as black silhouettes
      emissive: 0x0c1008
    });
    this.grassMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uPlayerPos = { value: new THREE.Vector3(99999, 99999, 99999) };
      shader.vertexShader = `
        uniform float uTime;
        uniform vec3 uPlayerPos;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          #include <begin_vertex>
          if (position.y > 0.01) {
            // Intense grass swaying frequency
            float swayX = sin(uTime * 4.2 + position.x * 2.0) * 0.25 * position.y;
            float swayZ = cos(uTime * 3.8 + position.z * 2.0) * 0.25 * position.y;
            transformed.x += swayX;
            transformed.z += swayZ;

            // Player bending displacement
            #ifdef USE_INSTANCING
              vec4 worldInstancePos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            #else
              vec4 worldInstancePos = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            #endif

            vec3 diff = worldInstancePos.xyz - uPlayerPos;
            float dist = length(vec3(diff.x, 0.0, diff.z));
            if (dist < 2.5) {
              vec3 pushDir = normalize(vec3(diff.x, 0.0001, diff.z));
              float bendAmount = (1.0 - dist / 2.5) * 0.8 * position.y;
              transformed.x += pushDir.x * bendAmount;
              transformed.z += pushDir.z * bendAmount;
              transformed.y -= bendAmount * 0.25;
            }
          }
        `
      );
      this.grassMaterial.userData.shader = shader;
    };

    // 4. Wildflower material with detailed procedural daisies
    this.flowerMaterial = new THREE.MeshLambertMaterial({
      map: this.createProceduralFlowerTexture(),
      transparent: false,
      alphaTest: 0.5,
      side: THREE.DoubleSide
    });
    this.flowerMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uPlayerPos = { value: new THREE.Vector3(99999, 99999, 99999) };
      shader.vertexShader = `
        uniform float uTime;
        uniform vec3 uPlayerPos;
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          #include <begin_vertex>
          if (position.y > 0.01) {
            float swayX = sin(uTime * 4.5 + position.x * 3.0) * 0.20 * position.y;
            float swayZ = cos(uTime * 4.0 + position.z * 3.0) * 0.20 * position.y;
            transformed.x += swayX;
            transformed.z += swayZ;

            // Player bending displacement
            #ifdef USE_INSTANCING
              vec4 worldInstancePos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            #else
              vec4 worldInstancePos = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            #endif

            vec3 diff = worldInstancePos.xyz - uPlayerPos;
            float dist = length(vec3(diff.x, 0.0, diff.z));
            if (dist < 2.5) {
              vec3 pushDir = normalize(vec3(diff.x, 0.0001, diff.z));
              float bendAmount = (1.0 - dist / 2.5) * 0.7 * position.y;
              transformed.x += pushDir.x * bendAmount;
              transformed.z += pushDir.z * bendAmount;
              transformed.y -= bendAmount * 0.2;
            }
          }
        `
      );
      this.flowerMaterial.userData.shader = shader;
    };


    // 5. Rocks/boulder material (grey)
    this.rockMaterial = new THREE.MeshLambertMaterial({ color: 0x707070 });

    // 6. Park hedges material (tidy dark green box hedges)
    this.hedgeMaterial = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
  }

  private initGeometries() {
    this.cardTreeGeometry = this.buildCardTreeGeometry();

    // Far-LOD: the classic 3-cone spruce, merged to a single geometry/draw
    const cone1 = new THREE.ConeGeometry(1.2, 1.4, 6);
    cone1.translate(0, 2.4, 0);
    const cone2 = new THREE.ConeGeometry(0.9, 1.2, 6);
    cone2.translate(0, 3.2, 0);
    const cone3 = new THREE.ConeGeometry(0.5, 0.9, 6);
    cone3.translate(0, 3.9, 0);
    this.coneLodGeometry = mergeGeometries([cone1, cone2, cone3])!;

    // Slightly tapered trunk, pivot at base
    this.trunkGeometry = new THREE.CylinderGeometry(0.10, 0.22, 3.2, 7, 3);
    this.trunkGeometry.translate(0, 1.6, 0);

    // Crossed billboard cards for grass blades
    const grassCard1 = new THREE.PlaneGeometry(0.35, 0.7);
    grassCard1.translate(0, 0.35, 0);
    const grassCard2 = grassCard1.clone();
    grassCard2.rotateY(Math.PI / 2);
    this.grassGeometry = mergeGeometries([grassCard1, grassCard2])!;

    this.flowerGeometry = new THREE.PlaneGeometry(0.3, 0.5);
    this.flowerGeometry.translate(0, 0.25, 0);

    this.rockGeometry = new THREE.DodecahedronGeometry(0.7, 1);

    this.hedgeGeometry = new THREE.BoxGeometry(2.0, 1.2, 0.6);
    this.hedgeGeometry.translate(0, 0.6, 0);
  }

  // Layered drooping branch cards around a trunk + crossed crown spike.
  // ~25 alpha-tested quads per tree; reads as a dark layered spruce up close.
  private buildCardTreeGeometry(): THREE.BufferGeometry {
    const rng = lcg(98765);
    const cards: THREE.BufferGeometry[] = [];

    const ringDefs = [
      { y: 1.05, count: 6, size: 1.80, tilt: 0.42 },
      { y: 1.85, count: 5, size: 1.70, tilt: 0.36 },
      { y: 2.65, count: 4, size: 1.35, tilt: 0.30 },
      { y: 3.35, count: 3, size: 1.00, tilt: 0.24 }
    ];

    for (const ring of ringDefs) {
      for (let c = 0; c < ring.count; c++) {
        const card = new THREE.PlaneGeometry(ring.size * 0.75, ring.size);
        card.translate(0, ring.size / 2, 0); // pivot at the trunk-side edge
        // Droop the card outward and slightly down like a spruce branch
        card.rotateX(-(Math.PI / 2 + ring.tilt));
        const angle = (c / ring.count) * Math.PI * 2 + rng() * 0.9;
        card.rotateY(angle);
        card.translate(0, ring.y + (rng() - 0.5) * 0.25, 0);
        cards.push(card);
      }
    }

    // Crown spike: two crossed vertical cards
    for (let i = 0; i < 2; i++) {
      const crown = new THREE.PlaneGeometry(0.8, 1.6);
      crown.translate(0, 0.8, 0);
      crown.rotateY(i * (Math.PI / 2));
      crown.translate(0, 3.5, 0);
      cards.push(crown);
    }

    return mergeGeometries(cards)!;
  }

  // ---- Chunked generation -------------------------------------------------

  // Scatter instanced nature assets procedurally matching the active biome.
  // Foliage streams in 64m chunks around the player (mirroring the terrain grid)
  // so grass can be dense up close while far chunks carry cheap LOD trees.
  public generateFoliage(terrain: Terrain, seed: number, biome: string) {
    this.clear();
    this.terrain = terrain;
    this.seed = seed;
    this.biome = biome;

    // Build the full grid synchronously once (load time); afterwards the grid
    // follows the player with budgeted incremental builds
    this.refreshGrid(this.lastPlayerPos);
    while (this.buildQueue.length > 0) {
      const job = this.buildQueue.shift()!;
      this.buildChunk(job.cx, job.cz);
    }
  }

  private chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private chunkRing(cx: number, cz: number, pcx: number, pcz: number): number {
    return Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
  }

  private refreshGrid(playerPos: THREE.Vector3) {
    if (!this.terrain) return;
    const pcx = Math.floor(playerPos.x / this.chunkSize);
    const pcz = Math.floor(playerPos.z / this.chunkSize);
    if (pcx === this.lastCx && pcz === this.lastCz) return;
    this.lastCx = pcx;
    this.lastCz = pcz;

    const wanted = new Set<string>();
    for (let dx = -this.renderRadius; dx <= this.renderRadius; dx++) {
      for (let dz = -this.renderRadius; dz <= this.renderRadius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = this.chunkKey(cx, cz);
        wanted.add(key);

        const lodNear = this.chunkRing(cx, cz, pcx, pcz) <= this.cardTreeRing;
        const existing = this.chunks.get(key);
        if (!existing) {
          if (!this.buildQueue.some(j => j.cx === cx && j.cz === cz)) {
            this.buildQueue.push({ cx, cz });
          }
        } else if (existing.lodNear !== lodNear) {
          // LOD ring changed: rebuild this chunk with the other tree representation
          this.removeChunk(key);
          this.buildQueue.push({ cx, cz });
        }
      }
    }

    for (const key of [...this.chunks.keys()]) {
      if (!wanted.has(key)) this.removeChunk(key);
    }
    this.buildQueue = this.buildQueue.filter(j => wanted.has(this.chunkKey(j.cx, j.cz)));
  }

  private removeChunk(key: string) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    for (const mesh of chunk.meshes) {
      this.containerGroup.remove(mesh);
      mesh.dispose(); // shared geometry/material untouched
    }
    this.chunks.delete(key);
  }

  private makeInstanced(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    items: InstanceItem[],
    options: { castShadow?: boolean; receiveShadow?: boolean; depthMaterial?: THREE.Material } = {}
  ): THREE.InstancedMesh | null {
    if (items.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      if (item.color) mesh.setColorAt(i, item.color);
    });
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = options.receiveShadow ?? false;
    if (options.depthMaterial) mesh.customDepthMaterial = options.depthMaterial;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); // tight per-chunk sphere -> free frustum culling
    this.containerGroup.add(mesh);
    return mesh;
  }

  private buildChunk(cx: number, cz: number) {
    if (!this.terrain) return;
    const key = this.chunkKey(cx, cz);
    if (this.chunks.has(key)) return;

    const pcx = this.lastCx ?? 0;
    const pcz = this.lastCz ?? 0;
    const ring = this.chunkRing(cx, cz, pcx, pcz);
    const lodNear = ring <= this.cardTreeRing;

    const chunk: FoliageChunk = { cx, cz, lodNear, meshes: [] };
    const rng = lcg(hashChunk(this.seed, cx, cz));
    const d = DENSITIES[this.biome] || DENSITIES['alpine'];
    const x0 = cx * this.chunkSize;
    const z0 = cz * this.chunkSize;
    const half = this.terrain.getMapSize() / 2;
    const terrain = this.terrain;
    const dummy = new THREE.Object3D();

    const inBounds = (x: number, z: number) =>
      Math.abs(x) < half - 4 && Math.abs(z) < half - 4;

    // 1. TREES (trunks + card foliage near / cone foliage far)
    if (d.trees > 0) {
      const trunkItems: InstanceItem[] = [];
      const folItems: InstanceItem[] = [];

      const placeTree = (x: number, z: number) => {
        const y = terrain.getTerrainHeight(x, z);
        if (y <= 4.2) return false;
        const scale = 2.2 + rng() * 1.0; // 9-14m tall spruce
        const yScale = scale * (0.85 + rng() * 0.25); // mild height variation

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.scale.set(scale, yScale, scale);
        dummy.updateMatrix();

        // Varied per tree; kept bright since it multiplies the dark needle texture
        const tint = new THREE.Color().setHSL(
          0.30 + (rng() - 0.5) * 0.05,
          0.25,
          0.62 + rng() * 0.28
        );
        trunkItems.push({ matrix: dummy.matrix.clone() });
        folItems.push({ matrix: dummy.matrix.clone(), color: tint });
        return true;
      };

      let spawned = 0;
      for (let i = 0; i < d.trees * 3 && spawned < d.trees; i++) {
        const x = x0 + rng() * this.chunkSize;
        const z = z0 + rng() * this.chunkSize;
        if (!inBounds(x, z)) continue;

        const type = terrain.getTerrainType(x, z);
        const canSpawn =
          type === 'forest' || type === 'walk' || type === 'thicket' ||
          (this.biome === 'sprint' && type === 'field');
        if (!canSpawn) continue;

        if (placeTree(x, z)) {
          spawned++;
          // Thickets read as dense clusters: spawn close companions
          if (type === 'thicket') {
            for (let extra = 0; extra < 2; extra++) {
              const ex = x + (rng() - 0.5) * 6;
              const ez = z + (rng() - 0.5) * 6;
              if (inBounds(ex, ez) && terrain.getTerrainType(ex, ez) === 'thicket') {
                placeTree(ex, ez);
              }
            }
          }
        }
      }

      const trunks = this.makeInstanced(this.trunkGeometry, this.trunkMaterial, trunkItems, {
        castShadow: true,
        receiveShadow: true
      });
      if (trunks) chunk.meshes.push(trunks);

      const foliage = lodNear
        ? this.makeInstanced(this.cardTreeGeometry, this.branchMaterial, folItems, {
            castShadow: true,
            depthMaterial: this.branchDepthMaterial
          })
        : this.makeInstanced(this.coneLodGeometry, this.foliageMaterial, folItems, {
            castShadow: true
          });
      if (foliage) chunk.meshes.push(foliage);
    }

    // 2. DENSE SWAYING GRASS (near ring only; fog and trees hide the cutoff)
    const grassTarget = Math.round(d.grass * this.grassDensityScale);
    if (grassTarget > 0 && ring <= this.grassRing) {
      const grassItems: InstanceItem[] = [];
      const white = new THREE.Color(0xffffff);

      for (let i = 0; i < grassTarget * 2 && grassItems.length < grassTarget; i++) {
        const x = x0 + rng() * this.chunkSize;
        const z = z0 + rng() * this.chunkSize;
        if (!inBounds(x, z)) continue;

        const type = terrain.getTerrainType(x, z);
        if (type !== 'field' && type !== 'forest' && type !== 'walk') continue;
        const y = terrain.getTerrainHeight(x, z);
        if (y <= 4.1) continue;

        // Snowline: sparse, frosted tufts instead of lush green on snow
        const onSnow = y >= 11;
        if (onSnow && rng() < 0.5) continue;

        const scale = 0.5 + rng() * 0.7;
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, rng() * Math.PI, 0);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();

        // Root tinting: blend the blade toward the ground's natural color so
        // meadow grass reads straw-green and forest grass darker
        const tint = new THREE.Color(terrain.getNaturalColorHex(type))
          .lerp(white, 0.45)
          .multiplyScalar(0.95 + rng() * 0.25);
        if (onSnow) tint.lerp(new THREE.Color(0xeef2ff), 0.6);
        grassItems.push({ matrix: dummy.matrix.clone(), color: tint });
      }

      const grass = this.makeInstanced(this.grassGeometry, this.grassMaterial, grassItems, {
        receiveShadow: true
      });
      if (grass) chunk.meshes.push(grass);
    }

    // 3. WILDFLOWERS (near ring only)
    if (d.flowers > 0 && ring <= this.grassRing) {
      const flowerItems: InstanceItem[] = [];
      for (let i = 0; i < d.flowers * 4 && flowerItems.length < d.flowers; i++) {
        const x = x0 + rng() * this.chunkSize;
        const z = z0 + rng() * this.chunkSize;
        if (!inBounds(x, z)) continue;

        if (terrain.getTerrainType(x, z) !== 'field') continue;
        const y = terrain.getTerrainHeight(x, z);
        if (y <= 4.1 || y >= 10) continue; // no daisies on the snowline

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        const s = 0.7 + rng() * 0.6;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        flowerItems.push({ matrix: dummy.matrix.clone() });
      }

      const flowers = this.makeInstanced(this.flowerGeometry, this.flowerMaterial, flowerItems);
      if (flowers) chunk.meshes.push(flowers);
    }

    // 4. ORGANIC BOULDERS
    if (d.boulders > 0) {
      const rockItems: InstanceItem[] = [];
      for (let i = 0; i < d.boulders * 4 && rockItems.length < d.boulders; i++) {
        const x = x0 + rng() * this.chunkSize;
        const z = z0 + rng() * this.chunkSize;
        if (!inBounds(x, z)) continue;

        const type = terrain.getTerrainType(x, z);
        if (!(type === 'cliff' || (this.biome === 'gullies' && type !== 'water'))) continue;
        const y = terrain.getTerrainHeight(x, z);

        const scale = 0.6 + rng() * 1.5;
        dummy.position.set(x, y - 0.2 * scale, z); // slightly embedded
        dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        dummy.scale.set(scale, scale * (0.8 + rng() * 0.4), scale);
        dummy.updateMatrix();
        rockItems.push({ matrix: dummy.matrix.clone() });
      }

      const rocks = this.makeInstanced(this.rockGeometry, this.rockMaterial, rockItems, {
        castShadow: true,
        receiveShadow: true
      });
      if (rocks) chunk.meshes.push(rocks);
    }

    // 5. HEDGES (Only Scandinavian Sprint Park)
    if (d.hedges > 0 && this.biome === 'sprint') {
      const hedgeItems: InstanceItem[] = [];
      for (let i = 0; i < d.hedges * 3 && hedgeItems.length < d.hedges; i++) {
        // Arrange hedges in aligned rows or decorative park quadrants
        const qx = Math.round((x0 + rng() * this.chunkSize) / 4) * 4;
        const qz = Math.round((z0 + rng() * this.chunkSize) / 4) * 4;
        if (!inBounds(qx, qz)) continue;

        if (terrain.getTerrainType(qx, qz) !== 'field') continue;
        const y = terrain.getTerrainHeight(qx, qz);
        if (y <= 4.1) continue;

        dummy.position.set(qx, y, qz);
        // 90-degree tidy orientations
        dummy.rotation.set(0, Math.floor(rng() * 4) * (Math.PI / 2), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        hedgeItems.push({ matrix: dummy.matrix.clone() });
      }

      const hedges = this.makeInstanced(this.hedgeGeometry, this.hedgeMaterial, hedgeItems, {
        castShadow: true,
        receiveShadow: true
      });
      if (hedges) chunk.meshes.push(hedges);
    }

    this.chunks.set(key, chunk);
  }

  // Animate dynamic grass billboard swayed offsets and conifer branch motions,
  // and stream foliage chunks around the player
  public update(time: number, playerPos?: THREE.Vector3) {
    if (this.grassMaterial.userData.shader) {
      this.grassMaterial.userData.shader.uniforms.uTime.value = time;
      if (playerPos) {
        this.grassMaterial.userData.shader.uniforms.uPlayerPos.value.copy(playerPos);
      }
    }
    if (this.flowerMaterial.userData.shader) {
      this.flowerMaterial.userData.shader.uniforms.uTime.value = time;
      if (playerPos) {
        this.flowerMaterial.userData.shader.uniforms.uPlayerPos.value.copy(playerPos);
      }
    }
    if (this.foliageMaterial.userData.shader) {
      this.foliageMaterial.userData.shader.uniforms.uTime.value = time;
    }
    if (this.branchMaterial.userData.shader) {
      this.branchMaterial.userData.shader.uniforms.uTime.value = time;
    }

    if (playerPos) {
      this.lastPlayerPos.copy(playerPos);
    }
    if (this.terrain) {
      this.refreshGrid(this.lastPlayerPos);
      // Budget one chunk build per frame to avoid hitches while running
      if (this.buildQueue.length > 0) {
        const job = this.buildQueue.shift()!;
        this.buildChunk(job.cx, job.cz);
      }
    }
  }

  // Clean all instanced assets from active GPU memory
  public clear() {
    for (const key of [...this.chunks.keys()]) {
      this.removeChunk(key);
    }
    this.buildQueue = [];
    this.terrain = null;
    this.lastCx = null;
    this.lastCz = null;
  }

  public dispose() {
    this.clear();
    this.scene.remove(this.containerGroup);
  }
}
