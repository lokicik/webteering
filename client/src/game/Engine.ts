import * as THREE from 'three';

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
  }

  public setFogDensity(percentage: number) {
    const fog = this.scene.fog as THREE.FogExp2;
    if (fog) {
      // Map 0-100 percentage to 0.002 (clear) - 0.08 (blinding fog)
      fog.density = 0.002 + (percentage / 100) * 0.078;
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

      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  public dispose() {
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
