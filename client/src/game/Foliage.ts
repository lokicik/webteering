import * as THREE from 'three';
import { Terrain } from './Terrain';

// Simple deterministic PRNG
function lcg(seed: number) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export class Foliage {
  private scene: THREE.Scene;
  private containerGroup = new THREE.Group();

  // Materials with uniform injection for wind-waving vertex shading
  private trunkMaterial!: THREE.MeshLambertMaterial;
  private foliageMaterial!: THREE.MeshLambertMaterial;
  private grassMaterial!: THREE.MeshLambertMaterial;
  private flowerMaterial!: THREE.MeshLambertMaterial;
  private rockMaterial!: THREE.MeshLambertMaterial;
  private hedgeMaterial!: THREE.MeshLambertMaterial;

  // Instanced Meshes
  private instancedTrunks: THREE.InstancedMesh | null = null;
  private instancedFol1: THREE.InstancedMesh | null = null;
  private instancedFol2: THREE.InstancedMesh | null = null;
  private instancedFol3: THREE.InstancedMesh | null = null;
  
  private instancedGrass: THREE.InstancedMesh | null = null;
  private instancedFlowers: THREE.InstancedMesh | null = null;
  private instancedBoulders: THREE.InstancedMesh | null = null;
  private instancedHedges: THREE.InstancedMesh | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.containerGroup);
    this.initMaterials();
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
          if (position.y > 0.1) {
            float swayX = sin(uTime * 3.0 + position.x * 0.4) * 0.08 * position.y;
            float swayZ = cos(uTime * 2.6 + position.z * 0.4) * 0.08 * position.y;
            transformed.x += swayX;
            transformed.z += swayZ;
          }
        `
      );
    };

    // 1. Trunk material (brown wood)
    this.trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x5c4033 });

    // 2. Conifer spruce branches (green) with wind sway
    this.foliageMaterial = new THREE.MeshLambertMaterial({ color: 0x14401e });
    this.foliageMaterial.onBeforeCompile = (shader) => {
      windShaderModifier(shader);
      this.foliageMaterial.userData.shader = shader;
    };

    // 3. Grass material (lime green) with high wind sway
    this.grassMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x8ac926, 
      side: THREE.DoubleSide
    });
    this.grassMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = `
        uniform float uTime;
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
          }
        `
      );
      this.grassMaterial.userData.shader = shader;
    };

    // 4. Wildflower material (yellow/white)
    this.flowerMaterial = new THREE.MeshLambertMaterial({ 
      color: 0xffd700, 
      side: THREE.DoubleSide
    });
    this.flowerMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = `
        uniform float uTime;
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

  // Scatter instanced nature assets procedurally matching the active biome
  public generateFoliage(terrain: Terrain, seed: number, biome: string) {
    this.clear();

    const random = lcg(seed);
    const mapSize = terrain.getMapSize();
    const half = mapSize / 2;

    // Define density metrics depending on active biome
    let treeCount = 0;
    let grassCount = 0;
    let boulderCount = 0;
    let hedgeCount = 0;

    if (biome === 'alpine') {
      treeCount = 1800;
      grassCount = 4000;
      boulderCount = 200;
    } else if (biome === 'dunes') {
      treeCount = 150;      // Sparse coastal trees
      grassCount = 6000;     // Lots of sand beach dune-grasses!
      boulderCount = 60;     // Occasional dry shoreline rocks
    } else if (biome === 'gullies') {
      treeCount = 0;        // Completely arid canyon
      grassCount = 600;      // Sparse dry brush
      boulderCount = 500;    // Dense rocky deposits & boulders
    } else if (biome === 'sprint') {
      treeCount = 400;      // Manicured garden birch/pines
      grassCount = 3000;     // Tidy trimmed lawns
      boulderCount = 20;     // Minimal decorative park rocks
      hedgeCount = 180;      // Decorative hedge partitions
    }

    const dummy = new THREE.Object3D();

    // 1. GENERATE TREES
    if (treeCount > 0) {
      const trunkGeom = new THREE.CylinderGeometry(0.12, 0.18, 3.2, 8);
      trunkGeom.translate(0, 1.6, 0); // pivot at base
      this.instancedTrunks = new THREE.InstancedMesh(trunkGeom, this.trunkMaterial, treeCount);
      this.instancedTrunks.castShadow = true;
      this.instancedTrunks.receiveShadow = true;

      const fol1Geom = new THREE.ConeGeometry(1.2, 1.4, 8);
      fol1Geom.translate(0, 2.4, 0);
      this.instancedFol1 = new THREE.InstancedMesh(fol1Geom, this.foliageMaterial, treeCount);
      this.instancedFol1.castShadow = true;

      const fol2Geom = new THREE.ConeGeometry(0.9, 1.2, 8);
      fol2Geom.translate(0, 3.2, 0);
      this.instancedFol2 = new THREE.InstancedMesh(fol2Geom, this.foliageMaterial, treeCount);
      this.instancedFol2.castShadow = true;

      const fol3Geom = new THREE.ConeGeometry(0.5, 0.9, 8);
      fol3Geom.translate(0, 3.9, 0);
      this.instancedFol3 = new THREE.InstancedMesh(fol3Geom, this.foliageMaterial, treeCount);
      this.instancedFol3.castShadow = true;

      let spawnedTrees = 0;
      for (let i = 0; i < treeCount * 3 && spawnedTrees < treeCount; i++) {
        const x = random() * (mapSize - 12) - half + 6;
        const z = random() * (mapSize - 12) - half + 6;

        const type = terrain.getTerrainType(x, z);
        const y = terrain.getTerrainHeight(x, z);

        // Trees only spawn on forest soil types
        const canSpawn = (type === 'forest' || type === 'walk' || type === 'thicket' || (biome === 'sprint' && type === 'field'));
        if (canSpawn && y > 4.2) {
          const scale = 0.75 + random() * 0.5; // slight height variation
          
          dummy.position.set(x, y, z);
          dummy.rotation.set(0, random() * Math.PI * 2, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();

          this.instancedTrunks.setMatrixAt(spawnedTrees, dummy.matrix);
          this.instancedFol1.setMatrixAt(spawnedTrees, dummy.matrix);
          this.instancedFol2.setMatrixAt(spawnedTrees, dummy.matrix);
          this.instancedFol3.setMatrixAt(spawnedTrees, dummy.matrix);

          spawnedTrees++;
        }
      }
      this.containerGroup.add(this.instancedTrunks);
      this.containerGroup.add(this.instancedFol1);
      this.containerGroup.add(this.instancedFol2);
      this.containerGroup.add(this.instancedFol3);
    }

    // 2. GENERATE SWAYING GRASS
    if (grassCount > 0) {
      // Crossed billboard card geometry for realistic 3D appearance
      const card1 = new THREE.PlaneGeometry(0.4, 0.65);
      card1.translate(0, 0.325, 0);
      const card2 = card1.clone().rotateY(Math.PI / 2);
      
      const grassGeom = new THREE.BufferGeometry();
      // Combine attributes for simple crossed card
      const pos1 = card1.getAttribute('position') as THREE.BufferAttribute;
      const pos2 = card2.getAttribute('position') as THREE.BufferAttribute;
      const combinedPositions = new Float32Array(pos1.count * 3 * 2);
      combinedPositions.set(pos1.array as Float32Array);
      combinedPositions.set(pos2.array as Float32Array, pos1.count * 3);
      grassGeom.setAttribute('position', new THREE.BufferAttribute(combinedPositions, 3));

      // Simple UV mapping
      const uv1 = card1.getAttribute('uv') as THREE.BufferAttribute;
      const uv2 = card2.getAttribute('uv') as THREE.BufferAttribute;
      const combinedUVs = new Float32Array(uv1.count * 2 * 2);
      combinedUVs.set(uv1.array as Float32Array);
      combinedUVs.set(uv2.array as Float32Array, uv1.count * 2);
      grassGeom.setAttribute('uv', new THREE.BufferAttribute(combinedUVs, 2));

      // Combine normals
      const norm1 = card1.getAttribute('normal') as THREE.BufferAttribute;
      const norm2 = card2.getAttribute('normal') as THREE.BufferAttribute;
      const combinedNormals = new Float32Array(norm1.count * 3 * 2);
      combinedNormals.set(norm1.array as Float32Array);
      combinedNormals.set(norm2.array as Float32Array, norm1.count * 3);
      grassGeom.setAttribute('normal', new THREE.BufferAttribute(combinedNormals, 3));

      // Set indices
      const idx1 = Array.from(card1.getIndex()?.array || []);
      const idx2 = Array.from(card2.getIndex()?.array || []).map(idx => idx + pos1.count);
      grassGeom.setIndex([...idx1, ...idx2]);

      this.instancedGrass = new THREE.InstancedMesh(grassGeom, this.grassMaterial, grassCount);
      this.instancedGrass.castShadow = false;
      this.instancedGrass.receiveShadow = true;

      let spawnedGrass = 0;
      for (let i = 0; i < grassCount * 4 && spawnedGrass < grassCount; i++) {
        const x = random() * (mapSize - 6) - half + 3;
        const z = random() * (mapSize - 6) - half + 3;

        const type = terrain.getTerrainType(x, z);
        const y = terrain.getTerrainHeight(x, z);

        // Grass spawns on fields, forests, or walk speed zones above water level
        const canSpawn = (type === 'field' || type === 'forest' || type === 'walk');
        if (canSpawn && y > 4.1) {
          const scale = 0.5 + random() * 0.7;
          
          dummy.position.set(x, y, z);
          dummy.rotation.set(0, random() * Math.PI, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();

          this.instancedGrass.setMatrixAt(spawnedGrass, dummy.matrix);
          spawnedGrass++;
        }
      }
      this.containerGroup.add(this.instancedGrass);
    }

    // 3. GENERATE WILDFLOWERS
    if (grassCount > 0) {
      const flowerCount = Math.floor(grassCount * 0.15); // 15% ratio
      const card = new THREE.PlaneGeometry(0.3, 0.5);
      card.translate(0, 0.25, 0);
      
      this.instancedFlowers = new THREE.InstancedMesh(card, this.flowerMaterial, flowerCount);

      let spawnedFlowers = 0;
      for (let i = 0; i < flowerCount * 4 && spawnedFlowers < flowerCount; i++) {
        const x = random() * (mapSize - 6) - half + 3;
        const z = random() * (mapSize - 6) - half + 3;

        const type = terrain.getTerrainType(x, z);
        const y = terrain.getTerrainHeight(x, z);

        if (type === 'field' && y > 4.1) {
          dummy.position.set(x, y, z);
          dummy.rotation.set(0, random() * Math.PI * 2, 0);
          dummy.scale.set(0.7 + random() * 0.6, 0.7 + random() * 0.6, 0.7 + random() * 0.6);
          dummy.updateMatrix();

          this.instancedFlowers.setMatrixAt(spawnedFlowers, dummy.matrix);
          spawnedFlowers++;
        }
      }
      this.containerGroup.add(this.instancedFlowers);
    }

    // 4. GENERATE ORGANIC BOULDERS
    if (boulderCount > 0) {
      // Build a rugged low-poly rock geometry using a deformed dodecahedron
      const rockGeom = new THREE.DodecahedronGeometry(0.7, 1);
      this.instancedBoulders = new THREE.InstancedMesh(rockGeom, this.rockMaterial, boulderCount);
      this.instancedBoulders.castShadow = true;
      this.instancedBoulders.receiveShadow = true;

      let spawnedBoulders = 0;
      for (let i = 0; i < boulderCount * 4 && spawnedBoulders < boulderCount; i++) {
        const x = random() * (mapSize - 8) - half + 4;
        const z = random() * (mapSize - 8) - half + 4;

        const type = terrain.getTerrainType(x, z);
        const y = terrain.getTerrainHeight(x, z);

        if (type === 'cliff' || (biome === 'gullies' && type !== 'water')) {
          const scale = 0.6 + random() * 1.5;
          
          dummy.position.set(x, y - 0.2 * scale, z); // slightly embedded
          dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
          dummy.scale.set(scale, scale * (0.8 + random() * 0.4), scale);
          dummy.updateMatrix();

          this.instancedBoulders.setMatrixAt(spawnedBoulders, dummy.matrix);
          spawnedBoulders++;
        }
      }
      this.containerGroup.add(this.instancedBoulders);
    }

    // 5. GENERATE HEDGES (Only Scandinavian Sprint Park)
    if (hedgeCount > 0 && biome === 'sprint') {
      const hedgeGeom = new THREE.BoxGeometry(2.0, 1.2, 0.6);
      hedgeGeom.translate(0, 0.6, 0); // pivot at base
      this.instancedHedges = new THREE.InstancedMesh(hedgeGeom, this.hedgeMaterial, hedgeCount);
      this.instancedHedges.castShadow = true;
      this.instancedHedges.receiveShadow = true;

      let spawnedHedges = 0;
      for (let i = 0; i < hedgeCount * 3 && spawnedHedges < hedgeCount; i++) {
        // Arrange hedges in aligned rows or decorative park quadrants
        const qx = Math.round((random() * (mapSize - 40) - half + 20) / 4) * 4;
        const qz = Math.round((random() * (mapSize - 40) - half + 20) / 4) * 4;

        const type = terrain.getTerrainType(qx, qz);
        const y = terrain.getTerrainHeight(qx, qz);

        if (type === 'field' && y > 4.1) {
          dummy.position.set(qx, y, qz);
          // 90-degree tidy orientations
          dummy.rotation.set(0, Math.floor(random() * 4) * (Math.PI / 2), 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();

          this.instancedHedges.setMatrixAt(spawnedHedges, dummy.matrix);
          spawnedHedges++;
        }
      }
      this.containerGroup.add(this.instancedHedges);
    }
  }

  // Animate dynamic grass billboard swayed offsets and conifer branch motions
  public update(time: number) {
    if (this.grassMaterial.userData.shader) {
      this.grassMaterial.userData.shader.uniforms.uTime.value = time;
    }
    if (this.flowerMaterial.userData.shader) {
      this.flowerMaterial.userData.shader.uniforms.uTime.value = time;
    }
    if (this.foliageMaterial.userData.shader) {
      this.foliageMaterial.userData.shader.uniforms.uTime.value = time;
    }
  }

  // Clean all instanced assets from active GPU memory
  public clear() {
    if (this.instancedTrunks) {
      this.containerGroup.remove(this.instancedTrunks);
      this.instancedTrunks.dispose();
      this.instancedTrunks = null;
    }
    if (this.instancedFol1) {
      this.containerGroup.remove(this.instancedFol1);
      this.instancedFol1.dispose();
      this.instancedFol1 = null;
    }
    if (this.instancedFol2) {
      this.containerGroup.remove(this.instancedFol2);
      this.instancedFol2.dispose();
      this.instancedFol2 = null;
    }
    if (this.instancedFol3) {
      this.containerGroup.remove(this.instancedFol3);
      this.instancedFol3.dispose();
      this.instancedFol3 = null;
    }
    if (this.instancedGrass) {
      this.containerGroup.remove(this.instancedGrass);
      this.instancedGrass.dispose();
      this.instancedGrass = null;
    }
    if (this.instancedFlowers) {
      this.containerGroup.remove(this.instancedFlowers);
      this.instancedFlowers.dispose();
      this.instancedFlowers = null;
    }
    if (this.instancedBoulders) {
      this.containerGroup.remove(this.instancedBoulders);
      this.instancedBoulders.dispose();
      this.instancedBoulders = null;
    }
    if (this.instancedHedges) {
      this.containerGroup.remove(this.instancedHedges);
      this.instancedHedges.dispose();
      this.instancedHedges = null;
    }
  }

  public dispose() {
    this.clear();
    this.scene.remove(this.containerGroup);
  }
}
