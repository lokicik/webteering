import * as THREE from 'three';
import { createDetailAlbedo } from './textures/ProceduralTextures';
import { VoxelType } from '../sharedTypes';

// Simple deterministic PRNG
function lcg(seed: number) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Self-contained 2D Perlin Noise Generator
class Noise2D {
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

export class Terrain {
  private scene: THREE.Scene;
  private noiseGen: Noise2D;
  
  // Map dimensions
  private mapSize = 384; 
  private waterLevel = 4;
  
  // Height and type caches (for custom imported DEM maps)
  private heightMap: { [key: string]: number } = {};
  private typeMap: { [key: string]: VoxelType } = {};
  
  private biome = 'alpine';

  // Aesthetic color systems per Biome
  private biomeColors: { [biome: string]: { [key in VoxelType]: string } } = {
    alpine: {
      field: '#ffdd00',  // Warm gold fields (IOF Yellow)
      forest: '#ffffff', // Standard IOF White Forest
      walk: '#90e090',   // Slow Forest - light green
      thicket: '#30a030', // Thick Forest - dark green
      water: '#00a0f0',   // Blue water
      cliff: '#7a7a7a',   // Rocks - grey
      path: '#a06020'     // Dirt paths - brown
    },
    dunes: {
      field: '#e9d8a6',  // Warm sandy dune soil
      forest: '#f4f1de', // Soft dry forest floor
      walk: '#a3b18a',   // Sea grass fields
      thicket: '#2a9d8f', // Shoreline bushes
      water: '#0077b6',   // Turquoise ocean bay water
      cliff: '#ca6702',   // Weathered coastal sandstone
      path: '#e0a96d'     // Soft wet sand path
    },
    gullies: {
      field: '#ddb892',  // Dry desert scrub
      forest: '#ede0d4', // Pale dry forest loam
      walk: '#b7b7a4',   // Sparsely scattered desert bushes
      thicket: '#4a5d4e', // Thorny cacti cluster
      water: '#48cae4',   // Silt muddy dry riverbed water
      cliff: '#8b3a3a',   // Severe red-rock canyon walls
      path: '#d8b18a'     // Dusty desert track
    },
    sprint: {
      field: '#52b788',  // Manicured green lawns
      forest: '#74c69d', // Tidy city-park grass
      walk: '#40916c',   // Ornamental slow park hedges
      thicket: '#1b4332', // Unrunnable perimeter hedges
      water: '#00b4d8',   // Paved concrete swimming pool water
      cliff: '#a8a29e',   // Smooth concrete walls
      path: '#c08552'     // Neat gravel walkway
    }
  };

  // Natural ground colors for the rendered 3D world. The saturated IOF palette
  // above stays exclusive to the HUD/handheld map — painting it on the ground
  // (white forest floor, pure-yellow fields) destroys depth perception.
  private naturalColors: { [biome: string]: { [key in VoxelType]: string } } = {
    alpine: {
      field: '#8a9a52',   // alpine meadow, straw-green
      forest: '#56673f',  // needle-litter forest floor
      walk: '#4c5d38',    // mossy slow forest
      thicket: '#3a4c2e', // dense dark undergrowth
      water: '#1a6f9e',   // natural lake bed blue
      cliff: '#7a7a72',   // grey rock
      path: '#9b8052'     // packed dirt
    },
    dunes: {
      field: '#d8c690',   // dry dune grass over sand
      forest: '#b5ab7c',  // coastal scrub floor
      walk: '#a3b18a',    // sea grass
      thicket: '#5a7f63', // shoreline bushes
      water: '#1273a8',
      cliff: '#b07840',   // weathered sandstone
      path: '#dcc9a0'     // wet sand track
    },
    gullies: {
      field: '#c2a37a',   // desert scrub
      forest: '#b09a76',  // dry loam
      walk: '#a99e84',    // sparse brush
      thicket: '#56644f', // thorny cluster
      water: '#3f99b5',
      cliff: '#8b4a3a',   // red canyon rock
      path: '#c9af88'
    },
    sprint: {
      field: '#5d9e63',   // lawn
      forest: '#6fae7e',  // park grass
      walk: '#4f8a5c',
      thicket: '#2f5238',
      water: '#2a9cc4',
      cliff: '#9a948c',   // concrete
      path: '#b08a5e'     // gravel walkway
    }
  };

  // Natural in-world color for a terrain type (with shoreline polish), used by
  // terrain vertex coloring and foliage tinting
  public getNaturalColorHex(type: VoxelType, height?: number): string {
    const palette = this.naturalColors[this.biome] || this.naturalColors['alpine'];
    const base = palette[type] || '#56673f';

    if (type !== 'water' && height !== undefined) {
      if (this.biome === 'alpine' && height <= this.waterLevel + 0.8) {
        return '#cdb286'; // sandy lakeshore
      }
      if (this.biome === 'dunes' && height <= this.waterLevel + 1.2) {
        return '#e8dcc0'; // coastal beach
      }
    }
    return base;
  }

  private materials: { [key: string]: THREE.Material } = {};
  private chunkGroup = new THREE.Group();
  private waterMesh: THREE.Mesh | null = null;

  // Infinite chunk loading properties
  private activeChunks: { [key: string]: THREE.Mesh } = {};
  private chunkSize = 64;
  private chunkSegments = 32;
  private renderRadius = 2; // 5x5 chunks grid centered on player

  constructor(scene: THREE.Scene, seed: number, biome: string = 'alpine') {
    this.scene = scene;
    this.noiseGen = new Noise2D(seed);
    this.biome = biome;

    this.initMaterials();
    this.scene.add(this.chunkGroup);
  }

  private initMaterials() {
    // Lambert material supporting soft shading and lighting with smooth normals
    const terrainMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      shadowSide: THREE.DoubleSide
    });

    // Procedural detail texturing: mid-grey luminance noise multiplied over the
    // vertex colors so the IOF map hues (yellow open, white forest) stay exact.
    // Slope selects between grass streaks and cracked rock.
    const detailGrass = createDetailAlbedo('grass');
    const detailRock = createDetailAlbedo('rock');
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetailGrass = { value: detailGrass };
      shader.uniforms.uDetailRock = { value: detailRock };

      shader.vertexShader = `
        varying vec3 vDetailWorldPos;
        varying vec3 vDetailWorldNormal;
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          #include <begin_vertex>
          vDetailWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vDetailWorldNormal = normalize(mat3(modelMatrix) * normal);
        `
      );

      shader.fragmentShader = `
        uniform sampler2D uDetailGrass;
        uniform sampler2D uDetailRock;
        varying vec3 vDetailWorldPos;
        varying vec3 vDetailWorldNormal;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
          #include <color_fragment>
          {
            vec2 uvTop = vDetailWorldPos.xz * 0.35;
            vec3 grassDetail = texture2D(uDetailGrass, uvTop).rgb;
            vec3 rockDetail = texture2D(uDetailRock, uvTop * 0.6).rgb;
            // Steep faces are exactly the rock zones, so a top projection suffices
            float rockW = smoothstep(0.55, 0.8, 1.0 - vDetailWorldNormal.y);
            vec3 detail = mix(grassDetail, rockDetail, rockW);
            // Second, much lower-frequency sample breaks visible tiling.
            // Clamped so white IOF ground can't get pushed past 1 and blow out.
            float macro = texture2D(uDetailGrass, uvTop * 0.043).g;
            diffuseColor.rgb *= min(detail * 2.0 * (0.85 + macro * 0.3), vec3(1.12));
          }
        `
      );
      terrainMat.userData.shader = shader;
    };

    this.materials['terrain'] = terrainMat;

    // Stunning glassmorphic translucent water plane with custom depth and shoreline foam fading shaders
    this.materials['water'] = new THREE.MeshStandardMaterial({
      color: '#ffffff', // Set base color to white so vertex colors render exactly
      vertexColors: true, // Enable vertex colors for dynamic white crest foam!
      transparent: true,
      opacity: 0.85,
      roughness: 0.08,
      metalness: 0.15,
      side: THREE.DoubleSide
    });

    this.materials['water'].onBeforeCompile = (shader) => {
      shader.vertexShader = `
        attribute float aDepth;
        varying float vDepth;
      ` + shader.vertexShader;
      
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          #include <begin_vertex>
          vDepth = aDepth;
        `
      );

      shader.fragmentShader = `
        varying float vDepth;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
          #include <color_fragment>
          
          // Style water color dynamically based on depth:
          // Extremely shallow (shorelines) -> blend to white foam
          // Deeper water -> blend to deep, rich blue with higher opacity
          
          float depthFactor = clamp(vDepth / 2.8, 0.0, 1.0); // scales from 0 to 2.8m deep
          
          vec3 shallowColor = vec3(0.8, 0.95, 1.0); // bright shoreline white/teal foam
          vec3 deepColor = diffuseColor.rgb; // base biome water color (e.g. blue)
          
          // Shoreline foam threshold
          if (vDepth < 0.35) {
            float foam = clamp((0.35 - vDepth) / 0.35, 0.0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 1.0, 1.0), foam * 0.95);
            diffuseColor.a = mix(0.72, 0.95, foam);
          } else {
            diffuseColor.rgb = mix(shallowColor, deepColor, depthFactor);
            diffuseColor.a = mix(0.48, 0.85, depthFactor);
          }
        `
      );
    };
  }

  // Retrieve dynamic elevation at arbitrary fractional coordinates
  public getTerrainHeight(x: number, z: number): number {
    const half = this.mapSize / 2;
    if (Math.abs(x) > half || Math.abs(z) > half) {
      return 25.0; // boundary wall
    }

    const isCustom = Object.keys(this.heightMap).length > 0;
    if (isCustom) {
      // Bilinear interpolation for imported DEM custom heightmaps to make them super smooth!
      const x0 = Math.floor(x);
      const x1 = x0 + 1;
      const z0 = Math.floor(z);
      const z1 = z0 + 1;

      const h00 = this.heightMap[`${x0},${z0}`] ?? 4.0;
      const h10 = this.heightMap[`${x1},${z0}`] ?? 4.0;
      const h01 = this.heightMap[`${x0},${z1}`] ?? 4.0;
      const h11 = this.heightMap[`${x1},${z1}`] ?? 4.0;

      const tx = x - x0;
      const tz = z - z0;

      const h0 = h00 + tx * (h10 - h00);
      const h1 = h01 + tx * (h11 - h01);
      return h0 + tz * (h1 - h0);
    }

    // Evaluate procedurally with high float precision
    return this.computeProceduralHeight(x, z);
  }

  // Retrieve voxel material/runnability type
  public getTerrainType(x: number, z: number): VoxelType {
    const rx = Math.round(x);
    const rz = Math.round(z);
    
    const key = `${rx},${rz}`;
    if (this.typeMap[key] !== undefined) {
      return this.typeMap[key];
    }

    const type = this.computeProceduralType(rx, rz);
    this.typeMap[key] = type;
    return type;
  }

  // Procedural continuous noise equation per biome
  private computeProceduralHeight(x: number, z: number): number {
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
      let height = n1 + n2 - cleft + 6.0;
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

  private computeProceduralType(x: number, z: number): VoxelType {
    const height = this.getTerrainHeight(x, z);

    if (height <= this.waterLevel) {
      return 'water';
    }

    // Check steepness slope
    const hR = this.getTerrainHeight(x + 1, z);
    const hL = this.getTerrainHeight(x - 1, z);
    const hF = this.getTerrainHeight(x, z + 1);
    const hB = this.getTerrainHeight(x, z - 1);
    
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

  // Load custom height and features maps (digital imports)
  public loadCustomMap(elevationData: number[], featureData: VoxelType[], size: number) {
    this.mapSize = size;
    this.heightMap = {};
    this.typeMap = {};

    const half = size / 2;
    for (let rz = 0; rz < size; rz++) {
      for (let rx = 0; rx < size; rx++) {
        const x = rx - half;
        const z = rz - half;
        const index = rz * size + rx;
        const key = `${x},${z}`;
        
        this.heightMap[key] = elevationData[index];
        this.typeMap[key] = featureData[index];
      }
    }

    // Re-build
    this.generateTerrainMeshes();
  }

  // Expose colors system cleanly to HUD contour map drawing
  public getVoxelColorHex(type: VoxelType, height?: number): string {
    const palette = this.biomeColors[this.biome] || this.biomeColors['alpine'];
    let baseColor = palette[type] || '#ffffff';

    // Polish highlights: Sandy shores & snowy cliff caps
    if (type !== 'water' && height !== undefined) {
      if (this.biome === 'alpine') {
        if (height <= this.waterLevel + 0.8) {
          return '#e5c290'; // Sandy lake beaches
        } else if (height >= 12.0 && type === 'cliff') {
          return '#e5e5e5'; // Stunning white snowy summits!
        }
      } else if (this.biome === 'dunes') {
        if (height <= this.waterLevel + 1.2) {
          return '#f2e8cf'; // Dune coast beaches
        }
      }
    }

    return baseColor;
  }

  // Create water plane mesh and do initial chunk loading
  public generateTerrainMeshes() {
    // Clear old meshes
    while (this.chunkGroup.children.length > 0) {
      const child = this.chunkGroup.children[0];
      this.chunkGroup.remove(child);
    }
    this.activeChunks = {};

    // Do initial chunk grid update at center
    this.updateChunkGrid(0, 0);

    // Render single beautiful translucent water sheet plane centered on player chunk
    const waterSegments = 64;
    const waterGeom = new THREE.PlaneGeometry(160, 160, waterSegments, waterSegments); // 160x160m sheet
    waterGeom.rotateX(-Math.PI / 2);

    // Initialize analytical depth attributes and base colors
    const waterDepthAttr: number[] = [];
    const waterColors: number[] = [];
    const waterBaseColorHex = this.naturalColors[this.biome]?.water || '#1a6f9e';
    const waterBaseColor = new THREE.Color(waterBaseColorHex);
    const waterPosAttr = waterGeom.getAttribute('position') as THREE.BufferAttribute;
    
    for (let i = 0; i < waterPosAttr.count; i++) {
      const lx = waterPosAttr.getX(i);
      const lz = waterPosAttr.getZ(i);
      
      const hUnder = this.getTerrainHeight(lx, lz);
      const depth = Math.max(0, this.waterLevel - hUnder);
      waterDepthAttr.push(depth);
      
      waterColors.push(waterBaseColor.r, waterBaseColor.g, waterBaseColor.b);
    }
    
    waterGeom.setAttribute('aDepth', new THREE.Float32BufferAttribute(waterDepthAttr, 1));
    waterGeom.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));

    this.waterMesh = new THREE.Mesh(waterGeom, this.materials['water']);
    this.waterMesh.position.set(0, this.waterLevel - 0.05, 0);
    this.waterMesh.receiveShadow = true;
    this.chunkGroup.add(this.waterMesh);
  }

  public updateChunkGrid(playerX: number, playerZ: number) {
    const pChunkX = Math.floor(playerX / this.chunkSize);
    const pChunkZ = Math.floor(playerZ / this.chunkSize);

    const keySet = new Set<string>();

    for (let cz = pChunkZ - this.renderRadius; cz <= pChunkZ + this.renderRadius; cz++) {
      for (let cx = pChunkX - this.renderRadius; cx <= pChunkX + this.renderRadius; cx++) {
        const key = `${cx},${cz}`;
        keySet.add(key);

        if (!this.activeChunks[key]) {
          this.activeChunks[key] = this.buildTerrainChunk(cx, cz);
        }
      }
    }

    // Dispose and remove out-of-range chunks
    for (const key in this.activeChunks) {
      if (!keySet.has(key)) {
        const mesh = this.activeChunks[key];
        this.chunkGroup.remove(mesh);
        mesh.geometry.dispose();
        delete this.activeChunks[key];
      }
    }

    // Move single water plane sheet to center on player chunk to optimize geometry draws
    if (this.waterMesh) {
      const wxOffset = pChunkX * this.chunkSize;
      const wzOffset = pChunkZ * this.chunkSize;
      const moved =
        this.waterMesh.position.x !== wxOffset || this.waterMesh.position.z !== wzOffset;
      this.waterMesh.position.set(wxOffset, this.waterLevel - 0.05, wzOffset);

      // aDepth is baked against world heights, so it goes stale when the sheet
      // re-centers — rebake so shoreline foam hugs the actual shore everywhere
      if (moved) {
        const posAttr = this.waterMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        const depthAttr = this.waterMesh.geometry.getAttribute('aDepth') as THREE.BufferAttribute;
        for (let i = 0; i < posAttr.count; i++) {
          const hUnder = this.getTerrainHeight(wxOffset + posAttr.getX(i), wzOffset + posAttr.getZ(i));
          depthAttr.setX(i, Math.max(0, this.waterLevel - hUnder));
        }
        depthAttr.needsUpdate = true;
      }
    }
  }

  private buildTerrainChunk(cx: number, cz: number): THREE.Mesh {
    const size = this.chunkSize;
    const geometry = new THREE.PlaneGeometry(size, size, this.chunkSegments, this.chunkSegments);
    
    const startX = cx * size;
    const startZ = cz * size;

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors: number[] = [];
    const normals: number[] = [];
    const normalVec = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i);
      const ly = posAttr.getY(i);

      // Map PlaneGeometry coordinate offsets to world
      const wx = startX + lx;
      const wz = startZ - ly;

      const h = this.getTerrainHeight(wx, wz);
      posAttr.setZ(i, h);

      // Dynamic slope erosion calculation for Triplanar-style blending
      const hL = this.getTerrainHeight(wx - 0.5, wz);
      const hR = this.getTerrainHeight(wx + 0.5, wz);
      const hB = this.getTerrainHeight(wx, wz - 0.5);
      const hF = this.getTerrainHeight(wx, wz + 0.5);
      const slope = Math.sqrt((hR - hL) * (hR - hL) + (hF - hB) * (hF - hB));

      // World-space surface normal from the same central differences
      normalVec.set(hL - hR, 1.0, hB - hF).normalize();
      normals.push(normalVec.x, normalVec.y, normalVec.z);

      const type = this.getTerrainType(wx, wz);
      // The 3D world renders NATURAL ground colors; the IOF palette lives on
      // the HUD/handheld map only (real orienteering: natural terrain, IOF map)
      let hex = this.getNaturalColorHex(type, h);

      const color = new THREE.Color(hex);

      // Erosion blending: blend steep slopes to grey rock and peak caps to white snow
      if (type !== 'water' && type !== 'path' && slope > 0.8) {
        const slopeFactor = Math.min(1.0, (slope - 0.8) / 1.0);
        const stoneColor = new THREE.Color('#7a7a7a');
        color.lerp(stoneColor, slopeFactor * 0.85);

        if (h >= 11.5) {
          const snowColor = new THREE.Color('#f0f0f0');
          color.lerp(snowColor, slopeFactor * 0.9);
        }
      }

      // High ridge override (slope-independent): the flat-topped boundary wall
      // (h=25 outside the map) must read as a distant white-grey ridge, not a
      // saturated IOF-colored band floating at the horizon
      if (h > 18) {
        const ridgeFactor = Math.min(1.0, (h - 18) / 6);
        color.lerp(new THREE.Color('#7a7a7a'), ridgeFactor * 0.85);
        color.lerp(new THREE.Color('#f0f0f0'), ridgeFactor * 0.8);
      }

      // Subtle vertex tone variation (shader detail texturing supplies the fine grain)
      const noiseVal = this.noiseGen.noise(wx * 0.7, wz * 0.7);
      const texNoise = (noiseVal - 0.5) * 0.05;
      color.r = Math.max(0, Math.min(1, color.r + texNoise));
      color.g = Math.max(0, Math.min(1, color.g + texNoise));
      color.b = Math.max(0, Math.min(1, color.b + texNoise));

      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.rotateX(-Math.PI / 2);

    // PlaneGeometry is center-origin (lx, ly span [-size/2, +size/2]) and heights
    // were sampled at (startX + lx, startZ - ly), so translating by exactly
    // (startX, startZ) puts every rendered vertex at its sampled world position.
    // (A half-chunk offset here displaced the whole visible terrain from the
    // logical height field, making players/foliage/animals float on slopes.)
    geometry.translate(startX, 0, startZ);

    // Analytic normals from the height field (central differences computed in
    // the vertex loop). Identical math on both sides of every chunk border, so
    // lighting is seamless across chunks — computeVertexNormals() isn't.
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    const chunkMesh = new THREE.Mesh(geometry, this.materials['terrain']);
    chunkMesh.castShadow = true;
    chunkMesh.receiveShadow = true;
    this.chunkGroup.add(chunkMesh);

    return chunkMesh;
  }

  // Animate gentle water ripples and dynamic chunk loading centered on playerPos
  public update(time: number, playerPos?: THREE.Vector3) {
    if (playerPos) {
      this.updateChunkGrid(playerPos.x, playerPos.z);
    }

    if (this.waterMesh) {
      const posAttr = this.waterMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const colorAttr = this.waterMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      
      const waterBaseColorHex = this.naturalColors[this.biome]?.water || '#1a6f9e';
      const waterBaseColor = new THREE.Color(waterBaseColorHex);

      // Get water sheet offset coordinates in world
      const wxOffset = this.waterMesh.position.x;
      const wzOffset = this.waterMesh.position.z;

      for (let i = 0; i < posAttr.count; i++) {
        // Find local coordinates on sheet and translate to world for ripple waves
        const lx = posAttr.getX(i);
        const lz = posAttr.getZ(i);
        
        const wx = wxOffset + lx;
        const wz = wzOffset + lz;

        // Multi-frequency wave formula
        const wave1 = Math.sin(time * 1.6 + wx * 0.06 + wz * 0.04) * 0.08;
        const wave2 = Math.cos(time * 2.2 - wx * 0.12 + wz * 0.10) * 0.04;
        const wave3 = Math.sin(time * 0.8 + wx * 0.02 - wz * 0.02) * 0.12;
        const wave = wave1 + wave2 + wave3;
        posAttr.setY(i, wave); 

        // Dynamic white wave crest foam highlighting
        const crestThreshold = 0.03;
        const maxWaveHeight = 0.18;
        const foamFactor = Math.max(0, Math.min(1, (wave - crestThreshold) / (maxWaveHeight - crestThreshold)));

        // Interpolate colors: base water color -> white foam
        const r = waterBaseColor.r + (1.0 - waterBaseColor.r) * foamFactor;
        const g = waterBaseColor.g + (1.0 - waterBaseColor.g) * foamFactor;
        const b = waterBaseColor.b + (1.0 - waterBaseColor.b) * foamFactor;

        colorAttr.setXYZ(i, r, g, b);
      }
      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
    }
  }

  public getMapSize(): number {
    return this.mapSize;
  }

  public getBiome(): string {
    return this.biome;
  }

  public getWaterLevel(): number {
    return this.waterLevel;
  }

  public dispose() {
    // Clear old meshes and dispose geometries/materials
    while (this.chunkGroup.children.length > 0) {
      const child = this.chunkGroup.children[0] as THREE.Mesh;
      this.chunkGroup.remove(child);
      if (child.geometry) {
        child.geometry.dispose();
      }
    }
    
    // Dispose materials
    for (const key in this.materials) {
      this.materials[key].dispose();
    }
    this.materials = {};

    this.scene.remove(this.chunkGroup);
  }
}

