import * as THREE from 'three';
import { Sound } from '../ui/Sound';
import { SkySystem, TimePreset } from './SkySystem';
import { PostFX } from './PostFX';
import { QualitySettings, QUALITY_PRESETS, loadQualityLevel } from './Quality';

export interface Updatable {
  update(delta: number): void;
}

export class Engine {
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public renderer!: THREE.WebGLRenderer;
  private clock!: THREE.Clock;
  private updatables: Updatable[] = [];
  private container: HTMLElement;
  
  // Lights
  private ambientLight!: THREE.HemisphereLight;
  private sunLight!: THREE.DirectionalLight;
  public skySystem!: SkySystem;
  public postFX!: PostFX;
  // Escape hatch: localStorage.setItem('webteering.postfx', 'off') falls back to plain rendering
  private postFXEnabled = localStorage.getItem('webteering.postfx') !== 'off';

  // Weather Realism systems
  private rainActive = false;
  private weatherMesh: THREE.Object3D | null = null;
  private weatherGeometry!: THREE.BufferGeometry;
  private weatherPositions!: Float32Array;
  private isSnowMode = false;
  private terrain: any = null;

  private cloudsGroup = new THREE.Group();
  private cloudMaterial: THREE.SpriteMaterial | null = null;

  public setTerrain(terrain: any) {
    this.terrain = terrain;
  }

  // Shadow frustum follows the player; snapped to shadow-map texels to avoid shimmer
  private readonly shadowCamHalfSize = 80;
  private currentLightDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
  private shadowRight = new THREE.Vector3();
  private shadowUp = new THREE.Vector3();
  private shadowCenter = new THREE.Vector3();

  private lightningIntensity = 0.0;
  private lightningChance = 0.0018; // probability per frame
  private weatherSampleFrame = 0; // rotates terrain-collision checks across frames
  private baseAmbientIntensity = 0.6;
  private baseSunIntensity = 0.8;
  private baseBgColor = new THREE.Color(0x7ec0ee);

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement;
    if (!this.container) {
      throw new Error(`Canvas container #${containerId} not found.`);
    }

    this.initScene();
    this.initLights();
    this.initRenderer();
    this.initResize();

    this.skySystem = new SkySystem(this.scene, this.renderer);
    this.skySystem.setPreset('noon');

    this.postFX = new PostFX(this.renderer, this.scene, this.camera, this.sunLight);
    this.postFX.setTimeOfDay('noon');

    this.applyQuality(QUALITY_PRESETS[loadQualityLevel()]);
  }

  // Apply resolution / AO / god rays / shadow quality. Live-safe at runtime.
  public applyQuality(settings: QualitySettings) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap));
    this.postFX?.setSize(window.innerWidth, window.innerHeight);

    if (this.sunLight.shadow.mapSize.width !== settings.shadowMapSize) {
      this.sunLight.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      // Force shadow map reallocation at the new resolution
      this.sunLight.shadow.map?.dispose();
      (this.sunLight.shadow as any).map = null;
    }

    this.postFX?.applyQuality(settings);
  }

  private initScene() {
    this.scene = new THREE.Scene();
    
    // Perspective Camera
    this.camera = new THREE.PerspectiveCamera(
      70, // Field of View
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 5, 0); // Start slightly elevated

    // Base Clock
    this.clock = new THREE.Clock();

    // Default Atmospheric Fog
    this.scene.fog = new THREE.FogExp2(0x0c0f18, 0.015);

    // Initialise low-poly voxel clouds
    this.initClouds();
  }

  private initLights() {
    // Hemisphere sky/ground bounce light (sky blue from above, dark forest-floor bounce below)
    this.ambientLight = new THREE.HemisphereLight(0xbdd7ff, 0x3a4a2a, 0.55);
    this.scene.add(this.ambientLight);

    // Directional Sun Light casting beautiful crisp voxel shadows
    this.sunLight = new THREE.DirectionalLight(0xfff4e0, 3.0);
    this.sunLight.position.set(50, 100, 30);
    this.sunLight.castShadow = true;
    
    // Configure shadow details for performance and crisp voxel edges
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 300;

    // Tight ortho bounds (~8cm/texel at 2048); the frustum follows the player each frame
    const d = this.shadowCamHalfSize;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target); // target must be in the scene for its matrix to update
    
    // Update ambient base background
    this.scene.background = new THREE.Color(0x0c0f18);
  }

  private initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // SMAA in the post chain handles AA
      stencil: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2 for performance
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Append to DOM container
    this.container.appendChild(this.renderer.domElement);
  }

  private initResize() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postFX?.setSize(window.innerWidth, window.innerHeight);
    });
  }

  public addUpdatable(item: Updatable) {
    this.updatables.push(item);
  }

  public removeUpdatable(item: Updatable) {
    const index = this.updatables.indexOf(item);
    if (index !== -1) {
      this.updatables.splice(index, 1);
    }
  }

  // Set active lighting and sky colors based on Time of Day
  public setTimeOfDay(time: TimePreset, customFogDensity?: number) {
    const fog = this.scene.fog as THREE.FogExp2;
    // Clearer base than before: navigation sightlines matter; god rays + the
    // per-preset boosts below supply the atmospheric depth
    const fogPercent = customFogDensity !== undefined ? customFogDensity / 1000 : 0.008;

    switch (time) {
      case 'noon':
        this.ambientLight.color.setHex(0xbdd7ff);
        this.ambientLight.groundColor.setHex(0x3a4a2a);
        this.ambientLight.intensity = 0.45;

        this.sunLight.color.setHex(0xfff4e0);
        this.sunLight.intensity = 2.6;
        this.renderer.toneMappingExposure = 1.1;
        this.cloudMaterial?.color.setHex(0xffffff);

        if (fog) {
          fog.density = fogPercent;
        }
        break;

      case 'sunset':
        this.ambientLight.color.setHex(0xcc6644);
        this.ambientLight.groundColor.setHex(0x33281e);
        this.ambientLight.intensity = 0.35;

        this.sunLight.color.setHex(0xff7733);
        this.sunLight.intensity = 2.2;
        this.renderer.toneMappingExposure = 1.0;
        this.cloudMaterial?.color.setHex(0xffb380);

        if (fog) {
          fog.density = fogPercent + 0.010; // mistier at sunset
        }
        break;

      case 'night':
        this.ambientLight.color.setHex(0x223355);
        this.ambientLight.groundColor.setHex(0x0a0d14);
        this.ambientLight.intensity = 0.12;

        this.sunLight.color.setHex(0x7788bb);
        this.sunLight.intensity = 0.5; // Moon casting faint shadows
        this.renderer.toneMappingExposure = 0.9;
        this.cloudMaterial?.color.setHex(0x222833);

        if (fog) {
          fog.density = fogPercent + 0.02; // dark heavy night fog
        }
        break;
    }

    // Sky dome, IBL environment, and the authoritative light direction.
    // Sky disc, shadows, fog tint and god rays all derive from here.
    this.skySystem.setPreset(time);
    this.postFX?.setTimeOfDay(time);
    const lightDir = this.skySystem.getLightDirection();
    this.currentLightDir.copy(lightDir);
    this.sunLight.position.copy(lightDir).multiplyScalar(150);

    const horizon = SkySystem.HORIZON[time];
    this.scene.background = new THREE.Color(horizon); // hidden behind sky dome; lightning fallback
    if (fog) {
      fog.color.setHex(horizon);
    }

    // Cache weather bases
    this.baseAmbientIntensity = this.ambientLight.intensity;
    this.baseSunIntensity = this.sunLight.intensity;
    if (this.scene.background) {
      this.baseBgColor.copy(this.scene.background as THREE.Color);
    }
  }

  public setFogDensity(percentage: number) {
    const fog = this.scene.fog as THREE.FogExp2;
    if (fog) {
      // Quadratic curve: low slider values stay sunny-clear (15% -> ~0.0047),
      // high values still reach blinding fog (100% -> 0.078)
      const t = percentage / 100;
      fog.density = 0.003 + t * t * 0.075;
    }
  }

  // Create or destroy dynamic falling instanced weather particles (Rain / Snow)
  public setRainActive(active: boolean) {
    this.rainActive = active;
    
    if (active) {
      if (this.weatherMesh) return;
      
      const biome = this.terrain ? this.terrain.getBiome() : 'alpine';
      this.isSnowMode = (biome === 'alpine');
      
      const vertexCount = 1200;
      this.weatherGeometry = new THREE.BufferGeometry();
      
      if (this.isSnowMode) {
        // Snow mode: individual drifting points
        this.weatherPositions = new Float32Array(vertexCount * 3);
        for (let i = 0; i < vertexCount; i++) {
          this.weatherPositions[i*3] = (Math.random() - 0.5) * 45;
          this.weatherPositions[i*3+1] = Math.random() * 32;
          this.weatherPositions[i*3+2] = (Math.random() - 0.5) * 45;
        }
        this.weatherGeometry.setAttribute('position', new THREE.BufferAttribute(this.weatherPositions, 3));
        
        // Beautiful, soft circular fluffy white snow particle texture
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const pCtx = canvas.getContext('2d')!;
        const grad = pCtx.createRadialGradient(8, 8, 0, 8, 8, 8);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        pCtx.fillStyle = grad;
        pCtx.fillRect(0, 0, 16, 16);
        const texture = new THREE.CanvasTexture(canvas);

        const snowMaterial = new THREE.PointsMaterial({
          color: 0xffffff,
          size: 0.35,
          map: texture,
          transparent: true,
          opacity: 0.85,
          blending: THREE.NormalBlending,
          depthWrite: false
        });
        
        this.weatherMesh = new THREE.Points(this.weatherGeometry, snowMaterial);
        this.scene.add(this.weatherMesh);
      } else {
        // Rain mode: line segment needles
        this.weatherPositions = new Float32Array(vertexCount * 3 * 2);
        for (let i = 0; i < vertexCount; i++) {
          const rx = (Math.random() - 0.5) * 45;
          const ry = Math.random() * 32;
          const rz = (Math.random() - 0.5) * 45;
          
          const idx = i * 6;
          this.weatherPositions[idx] = rx;
          this.weatherPositions[idx+1] = ry;
          this.weatherPositions[idx+2] = rz;
          
          this.weatherPositions[idx+3] = rx;
          this.weatherPositions[idx+4] = ry - 0.8;
          this.weatherPositions[idx+5] = rz;
        }
        this.weatherGeometry.setAttribute('position', new THREE.BufferAttribute(this.weatherPositions, 3));
        
        const rainMaterial = new THREE.LineBasicMaterial({
          color: 0x88aacc,
          transparent: true,
          opacity: 0.55,
          depthWrite: false
        });
        
        this.weatherMesh = new THREE.LineSegments(this.weatherGeometry, rainMaterial);
        this.scene.add(this.weatherMesh);
      }
    } else {
      if (!this.weatherMesh) return;
      this.scene.remove(this.weatherMesh);
      this.weatherGeometry.dispose();
      if (this.weatherMesh instanceof THREE.Points) {
        ((this.weatherMesh as any).material as THREE.PointsMaterial).map?.dispose();
      }
      ((this.weatherMesh as any).material as THREE.Material).dispose();
      this.weatherMesh = null;
    }
  }

  // Fall weather box around player and trigger random lightning flash/thunders
  private updateWeather(delta: number) {
    if (this.rainActive && this.weatherMesh) {
      // Center weather box on player camera position
      this.weatherMesh.position.set(this.camera.position.x, 0, this.camera.position.z);
      
      const posAttr = this.weatherGeometry.getAttribute('position') as THREE.BufferAttribute;
      const array = posAttr.array as Float32Array;
      
      // Terrain collision checks rotate through 1/4 of the particles per frame:
      // physics still runs on all of them, but ground-height noise sampling is
      // the expensive part and a particle near the ground gets caught within
      // ~3 frames anyway (also a 1.5m altitude floor short-circuits high ones)
      this.weatherSampleFrame = (this.weatherSampleFrame + 1) % 4;

      if (this.isSnowMode) {
        const count = posAttr.count; // number of snow particles
        for (let i = 0; i < count; i++) {
          const idx = i * 3;

          // Slow drifting falling motion + gentle swaying wind drift
          array[idx+1] -= 3.8 * delta; // slow fall (3.8 m/s)
          array[idx] += Math.sin(this.clock.getElapsedTime() + idx) * 0.8 * delta; // sway drift

          if (i % 4 !== this.weatherSampleFrame) continue;

          const rx = array[idx];
          const rz = array[idx+2];

          // Determine local terrain height for collisions
          let terrainY = 0;
          if (this.terrain) {
            const worldX = this.camera.position.x + rx;
            const worldZ = this.camera.position.z + rz;
            terrainY = this.terrain.getTerrainHeight(worldX, worldZ);
          }

          // Reset top if falls below terrain ground height
          if (array[idx+1] < terrainY) {
            array[idx] = (Math.random() - 0.5) * 45;
            array[idx+1] = 25 + Math.random() * 7; // restart high in the sky
            array[idx+2] = (Math.random() - 0.5) * 45;
          }
        }
      } else {
        const count = posAttr.count / 2; // number of rain needles
        for (let i = 0; i < count; i++) {
          const idx = i * 6;

          // Fast falling motion
          array[idx+1] -= 22 * delta;
          array[idx+4] -= 22 * delta;

          if (i % 4 !== this.weatherSampleFrame) {
            // Cheap hard floor so unsampled needles never tunnel far underground
            if (array[idx+1] < -8) {
              array[idx+1] = 25;
              array[idx+4] = 24.2;
            }
            continue;
          }

          const rx = array[idx];
          const rz = array[idx+2];

          // Determine local terrain height for collisions
          let terrainY = 0;
          if (this.terrain) {
            const worldX = this.camera.position.x + rx;
            const worldZ = this.camera.position.z + rz;
            terrainY = this.terrain.getTerrainHeight(worldX, worldZ);
          }

          // Reset top if falls below terrain ground height
          if (array[idx+1] < terrainY) {
            const newRx = (Math.random() - 0.5) * 45;
            const newRy = 25 + Math.random() * 7;
            const newRz = (Math.random() - 0.5) * 45;

            array[idx] = newRx;
            array[idx+1] = newRy;
            array[idx+2] = newRz;

            array[idx+3] = newRx;
            array[idx+4] = newRy - 0.8;
            array[idx+5] = newRz;
          }
        }
      }
      posAttr.needsUpdate = true;

      // 2. Storm Lightning Flash Simulation (only if rain, thunder looks weird in snow!)
      if (!this.isSnowMode) {
        if (this.lightningIntensity <= 0.0) {
          if (Math.random() < this.lightningChance) {
            this.lightningIntensity = 1.0;
            Sound.playThunder();
          }
        } else {
          this.lightningIntensity -= delta * 3.8; // rapid flash decay
          if (this.lightningIntensity < 0.0) {
            this.lightningIntensity = 0.0;
          }
          
          const flashVal = this.lightningIntensity;
          this.ambientLight.intensity = this.baseAmbientIntensity * (1 + flashVal * 4.0);
          this.sunLight.intensity = this.baseSunIntensity * (1 + flashVal * 3.0);
          
          const skyColor = new THREE.Color().lerpColors(this.baseBgColor, new THREE.Color(0xffffff), flashVal * 0.85);
          this.scene.background = skyColor;
          
          const fog = this.scene.fog as THREE.FogExp2;
          if (fog) {
            fog.color.copy(skyColor);
          }
        }
      }
    } else {
      // Reset if rain got disabled during a flash
      if (this.lightningIntensity > 0.0) {
        this.lightningIntensity = 0.0;
        this.ambientLight.intensity = this.baseAmbientIntensity;
        this.sunLight.intensity = this.baseSunIntensity;
        this.scene.background = this.baseBgColor;
        const fog = this.scene.fog as THREE.FogExp2;
        if (fog) {
          fog.color.copy(this.baseBgColor);
        }
      }
    }
  }

  public start() {
    this.clock.getDelta(); // Reset clock delta
    
    const animate = () => {
      requestAnimationFrame(animate);
      
      const delta = Math.min(this.clock.getDelta(), 0.1); // Cap delta to prevent massive physics jumps on lag

      // Update all registered subsystems
      for (const item of this.updatables) {
        item.update(delta);
      }

      // Animate falling rain box and thunder cracks
      this.updateWeather(delta);

      // Animate low-poly sky clouds
      this.updateClouds(delta);

      // Keep the tight shadow frustum centered on the player
      this.updateShadowFrustum();

      if (this.postFXEnabled && this.postFX) {
        this.postFX.render(delta);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    };

    animate();
  }

  // Soft puffy cloud texture: clustered radial-gradient blobs on transparent canvas
  private createCloudTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const puffCount = 14;
    for (let i = 0; i < puffCount; i++) {
      // Cluster puffs in a horizontal ellipse, flatter at the bottom
      const angle = Math.random() * Math.PI * 2;
      const px = size / 2 + Math.cos(angle) * Math.random() * size * 0.28;
      const py = size / 2 + Math.sin(angle) * Math.random() * size * 0.12;
      const radius = size * (0.10 + Math.random() * 0.14);

      const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
      grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.22)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private initClouds() {
    this.scene.add(this.cloudsGroup);

    this.cloudMaterial = new THREE.SpriteMaterial({
      map: this.createCloudTexture(),
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      fog: true
    });

    const cloudCount = 12;
    for (let c = 0; c < cloudCount; c++) {
      const cloud = new THREE.Sprite(this.cloudMaterial);

      const cx = (Math.random() - 0.5) * 350;
      // High enough that sandbox Flight Mode doesn't fly into an opaque sprite
      const cy = 160 + Math.random() * 60;
      const cz = (Math.random() - 0.5) * 350;
      cloud.position.set(cx, cy, cz);
      cloud.scale.set(45 + Math.random() * 35, 18 + Math.random() * 14, 1);

      // Store drift velocity
      cloud.userData = {
        vx: 0.8 + Math.random() * 1.5,
        vz: (Math.random() - 0.5) * 0.4
      };

      this.cloudsGroup.add(cloud);
    }
  }

  // Re-center the sun's shadow camera on the player, snapping its position to
  // whole shadow-map texels (in light space) so shadow edges don't crawl while moving
  private updateShadowFrustum() {
    const lightDir = this.currentLightDir;
    const texel = (2 * this.shadowCamHalfSize) / this.sunLight.shadow.mapSize.width;

    // Orthonormal basis perpendicular to the light direction
    const upRef = Math.abs(lightDir.y) > 0.99 ? 1 : 0;
    this.shadowUp.set(upRef, 1 - upRef, 0);
    this.shadowRight.crossVectors(this.shadowUp, lightDir).normalize();
    this.shadowUp.crossVectors(lightDir, this.shadowRight);

    const p = this.camera.position;
    const rx = Math.floor(p.dot(this.shadowRight) / texel) * texel;
    const uy = Math.floor(p.dot(this.shadowUp) / texel) * texel;
    const ld = p.dot(lightDir); // along-axis offset needs no snapping

    this.shadowCenter
      .set(0, 0, 0)
      .addScaledVector(this.shadowRight, rx)
      .addScaledVector(this.shadowUp, uy)
      .addScaledVector(lightDir, ld);

    this.sunLight.target.position.copy(this.shadowCenter);
    this.sunLight.position.copy(this.shadowCenter).addScaledVector(lightDir, 150);
  }

  private updateClouds(delta: number) {
    this.cloudsGroup.children.forEach(c => {
      const cloud = c as THREE.Group;
      cloud.position.x += cloud.userData.vx * delta;
      cloud.position.z += cloud.userData.vz * delta;

      // Wrap boundaries
      const halfMap = 200;
      if (cloud.position.x > halfMap) cloud.position.x = -halfMap;
      if (cloud.position.z > halfMap) cloud.position.z = -halfMap;
      if (cloud.position.z < -halfMap) cloud.position.z = halfMap;
    });
  }

  public dispose() {
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
