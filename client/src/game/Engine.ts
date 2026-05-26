import * as THREE from 'three';
import { Sound } from '../ui/Sound';

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
  private ambientLight!: THREE.AmbientLight;
  private sunLight!: THREE.DirectionalLight;

  // Weather Realism systems
  private rainActive = false;
  private rainMesh: THREE.LineSegments | null = null;
  private rainGeometry!: THREE.BufferGeometry;
  private rainPositions!: Float32Array;

  private lightningIntensity = 0.0;
  private lightningChance = 0.0018; // probability per frame
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
  }

  private initLights() {
    // Soft ambient lighting (prevents pitch black voxel faces)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    // Directional Sun Light casting beautiful crisp voxel shadows
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.sunLight.position.set(50, 100, 30);
    this.sunLight.castShadow = true;
    
    // Configure shadow details for performance and crisp voxel edges
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 300;
    
    // Orthographic shadow camera bounds to fit active navigation view
    const d = 120;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;

    this.scene.add(this.sunLight);
    
    // Update ambient base background
    this.scene.background = new THREE.Color(0x0c0f18);
  }

  private initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2 for performance
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
  public setTimeOfDay(time: 'noon' | 'sunset' | 'night', customFogDensity?: number) {
    const fog = this.scene.fog as THREE.FogExp2;
    const fogPercent = customFogDensity !== undefined ? customFogDensity / 1000 : 0.015;

    switch (time) {
      case 'noon':
        this.scene.background = new THREE.Color(0x7ec0ee); // Sunny Blue Sky
        this.ambientLight.color.setHex(0xffffff);
        this.ambientLight.intensity = 0.7;
        
        this.sunLight.color.setHex(0xfffaed);
        this.sunLight.intensity = 0.9;
        this.sunLight.position.set(50, 100, 30);
        
        if (fog) {
          fog.color.setHex(0x7ec0ee);
          fog.density = fogPercent;
        }
        break;

      case 'sunset':
        this.scene.background = new THREE.Color(0xfd5e53); // Orange Sunset
        this.ambientLight.color.setHex(0xffaaaa);
        this.ambientLight.intensity = 0.45;
        
        this.sunLight.color.setHex(0xffaa44);
        this.sunLight.intensity = 0.75;
        this.sunLight.position.set(80, 25, 10);
        
        if (fog) {
          fog.color.setHex(0xfd5e53);
          fog.density = fogPercent + 0.005; // slightly mistier at sunset
        }
        break;

      case 'night':
        this.scene.background = new THREE.Color(0x020408); // Pitch Black Sky
        this.ambientLight.color.setHex(0x334466);
        this.ambientLight.intensity = 0.15; // Ambient moonlight only
        
        this.sunLight.color.setHex(0x8899bb);
        this.sunLight.intensity = 0.25; // Moon casting faint shadows
        this.sunLight.position.set(-30, 80, -20);
        
        if (fog) {
          fog.color.setHex(0x020408);
          fog.density = fogPercent + 0.02; // dark heavy night fog
        }
        break;
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
      // Map 0-100 percentage to 0.002 (clear) - 0.08 (blinding fog)
      fog.density = 0.002 + (percentage / 100) * 0.078;
    }
  }

  // Create or destroy dynamic falling instanced rain needles
  public setRainActive(active: boolean) {
    this.rainActive = active;
    
    if (active) {
      if (this.rainMesh) return;
      
      const vertexCount = 1200; // dense rain needles box
      this.rainGeometry = new THREE.BufferGeometry();
      this.rainPositions = new Float32Array(vertexCount * 3 * 2);
      
      for (let i = 0; i < vertexCount; i++) {
        const rx = (Math.random() - 0.5) * 45;
        const ry = Math.random() * 32;
        const rz = (Math.random() - 0.5) * 45;
        
        const idx = i * 6;
        this.rainPositions[idx] = rx;
        this.rainPositions[idx+1] = ry;
        this.rainPositions[idx+2] = rz;
        
        this.rainPositions[idx+3] = rx;
        this.rainPositions[idx+4] = ry - 0.8; // needle streak length
        this.rainPositions[idx+5] = rz;
      }
      
      this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
      
      const rainMaterial = new THREE.LineBasicMaterial({
        color: 0x88aacc,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      });
      
      this.rainMesh = new THREE.LineSegments(this.rainGeometry, rainMaterial);
      this.scene.add(this.rainMesh);
    } else {
      if (!this.rainMesh) return;
      this.scene.remove(this.rainMesh);
      this.rainGeometry.dispose();
      (this.rainMesh.material as THREE.Material).dispose();
      this.rainMesh = null;
    }
  }

  // Fall rain box around player and trigger random lightning flash/thunders
  private updateWeather(delta: number) {
    if (this.rainActive && this.rainMesh) {
      // Center rain box on player camera position
      this.rainMesh.position.set(this.camera.position.x, 0, this.camera.position.z);
      
      const posAttr = this.rainGeometry.getAttribute('position') as THREE.BufferAttribute;
      const array = posAttr.array as Float32Array;
      const count = posAttr.count / 2; // number of needles
      
      for (let i = 0; i < count; i++) {
        const idx = i * 6;
        
        // Falling motion
        array[idx+1] -= 22 * delta;
        array[idx+4] -= 22 * delta;
        
        // Reset top if falls below ground
        if (array[idx+1] < 0) {
          const rx = (Math.random() - 0.5) * 45;
          const ry = 30 + Math.random() * 5;
          const rz = (Math.random() - 0.5) * 45;
          
          array[idx] = rx;
          array[idx+1] = ry;
          array[idx+2] = rz;
          
          array[idx+3] = rx;
          array[idx+4] = ry - 0.8;
          array[idx+5] = rz;
        }
      }
      posAttr.needsUpdate = true;

      // 2. Storm Lightning Flash Simulation
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
        this.ambientLight.intensity = this.baseAmbientIntensity + flashVal * 2.8;
        this.sunLight.intensity = this.baseSunIntensity + flashVal * 2.5;
        
        const skyColor = new THREE.Color().lerpColors(this.baseBgColor, new THREE.Color(0xffffff), flashVal * 0.85);
        this.scene.background = skyColor;
        
        const fog = this.scene.fog as THREE.FogExp2;
        if (fog) {
          fog.color.copy(skyColor);
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

      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  public dispose() {
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
