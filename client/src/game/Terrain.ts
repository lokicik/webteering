import * as THREE from 'three';
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
  private mapSize = 384; // Size of map (-192 to 192)
  private chunkSize = 32;
  private waterLevel = 4;
  private voxelSize = 1.0;
  
  // Height and type caches
  private heightMap: { [key: string]: number } = {};
  private typeMap: { [key: string]: VoxelType } = {};
  
  // Colors for voxel types matching standard topographic rules
  private voxelColors: { [key in VoxelType]: number } = {
    field: 0xffdd00,  /* Open field - Yellow */
    forest: 0xffffff, /* White Forest (normal) */
    walk: 0x90e090,   /* Slow Forest - light green */
    thicket: 0x30a030, /* Thick Forest - dark green */
    water: 0x00a0f0,   /* Lakes - Blue */
    cliff: 0x888888,   /* Rocks / Stone - Grey */
    path: 0xa06020     /* Paths / Dirt - Brown */
  };

  private materials: { [key: string]: THREE.Material } = {};
  private chunkGroup = new THREE.Group();

  constructor(scene: THREE.Scene, seed: number) {
    this.scene = scene;
    this.noiseGen = new Noise2D(seed);

    this.initMaterials();
    this.scene.add(this.chunkGroup);
  }

  private initMaterials() {
    // Generate mesh basic materials with vertex coloring support
    // Standard lambert material allows shadows and lighting to shade the terrain beautifully!
    this.materials['terrain'] = new THREE.MeshLambertMaterial({
      vertexColors: true,
      shadowSide: THREE.DoubleSide
    });

    // Special semi-transparent material for water surfaces
    this.materials['water'] = new THREE.MeshLambertMaterial({
      color: 0x00a0f0,
      transparent: true,
      opacity: 0.6
    });
  }

  // Retrieve terrain elevation at arbitrary coordinates
  public getTerrainHeight(x: number, z: number): number {
    const rx = Math.round(x / this.voxelSize);
    const rz = Math.round(z / this.voxelSize);
    
    // Bounds check
    const half = this.mapSize / 2;
    if (Math.abs(rx) > half || Math.abs(rz) > half) {
      return 15.0; // border mountain wall
    }

    const key = `${rx},${rz}`;
    if (this.heightMap[key] !== undefined) {
      return this.heightMap[key];
    }

    // Generate height procedurally if not cached
    const height = this.computeProceduralHeight(rx, rz);
    this.heightMap[key] = height;
    return height;
  }

  // Retrieve voxel material/terrain speed penalty type
  public getTerrainType(x: number, z: number): VoxelType {
    const rx = Math.round(x / this.voxelSize);
    const rz = Math.round(z / this.voxelSize);
    
    const key = `${rx},${rz}`;
    if (this.typeMap[key] !== undefined) {
      return this.typeMap[key];
    }

    const type = this.computeProceduralType(rx, rz);
    this.typeMap[key] = type;
    return type;
  }

  // Procedural height generation combining sine hills and fractal noise
  private computeProceduralHeight(x: number, z: number): number {
    const half = this.mapSize / 2;
    // Boundary wall
    if (Math.abs(x) >= half - 4 || Math.abs(z) >= half - 4) {
      return 25.0; // High mountain wall to trap player
    }

    // Layer 1: Huge sweeping hills
    const n1 = this.noiseGen.noise(x * 0.005, z * 0.005) * 16;
    
    // Layer 2: Micro ridges/depressions
    const n2 = this.noiseGen.noise(x * 0.03, z * 0.03) * 4;
    
    // Layer 3: Flat valleys
    let height = Math.round(n1 + n2);
    
    // Smooth valley floors near water level
    if (height < this.waterLevel) {
      // Deep lake beds
      height = Math.max(1, height);
    }

    return height;
  }

  private computeProceduralType(x: number, z: number): VoxelType {
    const height = this.getTerrainHeight(x, z);

    if (height <= this.waterLevel) {
      return 'water';
    }

    // Check slope steepness by examining neighbor heights
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

    if (maxSlope >= 2.0) {
      return 'cliff'; // steep stone cliff
    }

    // Procedural vegetation noise
    const vegNoise = this.noiseGen.noise(x * 0.04 + 10, z * 0.04 + 10);
    
    // Create random clear winding paths
    const pathNoise = Math.sin(x * 0.05) * Math.cos(z * 0.05);
    const pathChance = this.noiseGen.noise(x * 0.015, z * 0.015);
    if (pathChance > 0.72 && Math.abs(pathNoise) < 0.04) {
      return 'path'; // winding path
    }

    if (vegNoise > 0.82) {
      return 'thicket'; // dark dense green brush
    } else if (vegNoise > 0.62) {
      return 'walk'; // light green slow forest
    } else if (vegNoise > 0.42) {
      return 'forest'; // white normal runnable forest
    }

    return 'field'; // normal open yellow grass
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

    // Re-build all chunks
    this.generateTerrainMeshes();
  }

  // Build 3D meshes for all chunks in the map
  public generateTerrainMeshes() {
    // Clear old meshes
    while (this.chunkGroup.children.length > 0) {
      const child = this.chunkGroup.children[0];
      this.chunkGroup.remove(child);
    }

    const half = this.mapSize / 2;
    const numChunks = this.mapSize / this.chunkSize;

    for (let cz = 0; cz < numChunks; cz++) {
      for (let cx = 0; cx < numChunks; cx++) {
        // Chunk bounds in grid units
        const startX = -half + cx * this.chunkSize;
        const startZ = -half + cz * this.chunkSize;
        
        this.buildChunkMesh(startX, startZ);
      }
    }
  }

  // Custom high-performance exposed-face chunk mesh builder
  private buildChunkMesh(startX: number, startZ: number) {
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let vertexCount = 0;

    const addFace = (
      p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3,
      colorHex: number
    ) => {
      // Add vertices
      vertices.push(p1.x, p1.y, p1.z);
      vertices.push(p2.x, p2.y, p2.z);
      vertices.push(p3.x, p3.y, p3.z);
      vertices.push(p4.x, p4.y, p4.z);

      // Parse colors
      const color = new THREE.Color(colorHex);
      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);

      // Add two triangles per face
      indices.push(
        vertexCount, vertexCount + 1, vertexCount + 2,
        vertexCount, vertexCount + 2, vertexCount + 3
      );
      
      vertexCount += 4;
    };

    // Keep track of water planes in chunk
    const waterPoints: THREE.Vector3[] = [];

    // Scan all columns in this chunk
    for (let z = 0; z < this.chunkSize; z++) {
      for (let x = 0; x < this.chunkSize; x++) {
        const gx = startX + x;
        const gz = startZ + z;

        const h = this.getTerrainHeight(gx, gz);
        const type = this.getTerrainType(gx, gz);
        const color = this.voxelColors[type];

        // Core corners of voxel
        const xMin = gx - 0.5;
        const xMax = gx + 0.5;
        const zMin = gz - 0.5;
        const zMax = gz + 0.5;

        // 1. TOP FACE (Air surface at height h)
        if (type !== 'water') {
          addFace(
            new THREE.Vector3(xMin, h, zMin),
            new THREE.Vector3(xMin, h, zMax),
            new THREE.Vector3(xMax, h, zMax),
            new THREE.Vector3(xMax, h, zMin),
            color
          );
        } else {
          // If water, add a water plane at waterLevel height
          waterPoints.push(new THREE.Vector3(gx, this.waterLevel, gz));
          // Ground floor under water
          addFace(
            new THREE.Vector3(xMin, h, zMin),
            new THREE.Vector3(xMin, h, zMax),
            new THREE.Vector3(xMax, h, zMax),
            new THREE.Vector3(xMax, h, zMin),
            0x2d4d5e // Dark deep sandy mud color
          );
        }

        // 2. VERTICAL SIDE FACES (Only render exposed vertical walls)
        // Check adjacent neighbors (+X, -X, +Z, -Z)
        
        // +X side face
        const hRight = this.getTerrainHeight(gx + 1, gz);
        if (hRight < h) {
          addFace(
            new THREE.Vector3(xMax, h, zMin),
            new THREE.Vector3(xMax, h, zMax),
            new THREE.Vector3(xMax, hRight, zMax),
            new THREE.Vector3(xMax, hRight, zMin),
            type === 'cliff' ? color : 0x7a6348 // Brown dirt vertical edge
          );
        }

        // -X side face
        const hLeft = this.getTerrainHeight(gx - 1, gz);
        if (hLeft < h) {
          addFace(
            new THREE.Vector3(xMin, h, zMax),
            new THREE.Vector3(xMin, h, zMin),
            new THREE.Vector3(xMin, hLeft, zMin),
            new THREE.Vector3(xMin, hLeft, zMax),
            type === 'cliff' ? color : 0x7a6348
          );
        }

        // +Z side face
        const hFront = this.getTerrainHeight(gx, gz + 1);
        if (hFront < h) {
          addFace(
            new THREE.Vector3(xMax, h, zMax),
            new THREE.Vector3(xMin, h, zMax),
            new THREE.Vector3(xMin, hFront, zMax),
            new THREE.Vector3(xMax, hFront, zMax),
            type === 'cliff' ? color : 0x7a6348
          );
        }

        // -Z side face
        const hBack = this.getTerrainHeight(gx, gz - 1);
        if (hBack < h) {
          addFace(
            new THREE.Vector3(xMin, h, zMin),
            new THREE.Vector3(xMax, h, zMin),
            new THREE.Vector3(xMax, hBack, zMin),
            new THREE.Vector3(xMin, hBack, zMin),
            type === 'cliff' ? color : 0x7a6348
          );
        }
      }
    }

    // Assemble dynamic geometry
    if (vertices.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(geometry, this.materials['terrain']);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.chunkGroup.add(mesh);
    }

    // Assemble water plane if there is water in chunk
    if (waterPoints.length > 0) {
      const waterGeom = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize);
      waterGeom.rotateX(-Math.PI / 2);
      
      const waterMesh = new THREE.Mesh(waterGeom, this.materials['water']);
      waterMesh.position.set(
        startX + this.chunkSize / 2 - 0.5,
        this.waterLevel - 0.05,
        startZ + this.chunkSize / 2 - 0.5
      );
      waterMesh.receiveShadow = true;
      this.chunkGroup.add(waterMesh);
    }
  }

  public getMapSize(): number {
    return this.mapSize;
  }
}
