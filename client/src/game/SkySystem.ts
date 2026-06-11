import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type TimePreset = 'noon' | 'sunset' | 'night';

// Atmospheric scattering sky dome + image-based lighting derived from it.
// Owns the sun direction so the sky disc, directional light, shadows and
// god rays all agree on where the sun is.
export class SkySystem {
  // Horizon tint per preset — fog must use these so it blends into the sky
  public static readonly HORIZON: Record<TimePreset, number> = {
    noon: 0xafc8dd,
    sunset: 0xe8794a,
    night: 0x05070d
  };

  private sky: Sky;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private scene: THREE.Scene;
  // Direction the visual sun sits at (may be below horizon at night)
  private sunDir = new THREE.Vector3(0, 1, 0);
  // Direction the scene light comes from (moon at night)
  private lightDir = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(2000);
    scene.add(this.sky);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
  }

  public setPreset(preset: TimePreset) {
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;

    let elevation: number;
    let azimuth: number;

    switch (preset) {
      case 'noon':
        u.turbidity.value = 6;
        u.rayleigh.value = 1.5;
        u.mieCoefficient.value = 0.005;
        u.mieDirectionalG.value = 0.8;
        elevation = 50;
        azimuth = 35;
        break;
      case 'sunset':
        u.turbidity.value = 10;
        u.rayleigh.value = 3.5;
        u.mieCoefficient.value = 0.02;
        u.mieDirectionalG.value = 0.85;
        elevation = 6;
        azimuth = 80;
        break;
      case 'night':
        u.turbidity.value = 2;
        u.rayleigh.value = 0.4;
        u.mieCoefficient.value = 0.002;
        u.mieDirectionalG.value = 0.7;
        elevation = -8; // sun below horizon -> near-black sky
        azimuth = 80;
        break;
    }

    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);

    if (preset === 'night') {
      // Moonlight from the opposite quadrant, well above the horizon
      this.lightDir.setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - 55),
        THREE.MathUtils.degToRad(215)
      );
    } else {
      this.lightDir.copy(this.sunDir);
    }

    this.updateEnvironment();
  }

  // Unit vector pointing FROM the scene TOWARDS the light source
  public getLightDirection(): THREE.Vector3 {
    return this.lightDir.clone();
  }

  public getSunDirection(): THREE.Vector3 {
    return this.sunDir.clone();
  }

  // Re-bake the IBL environment map from the sky. Costs ~10-20ms, so it only
  // runs on preset change, never per frame.
  private updateEnvironment() {
    const tmpScene = new THREE.Scene();
    const parent = this.sky.parent;
    tmpScene.add(this.sky);
    // Far plane must reach the 2000-unit sky box faces
    const rt = this.pmrem.fromScene(tmpScene, 0, 0.1, 4000);
    if (parent) parent.add(this.sky);

    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }

  public dispose() {
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.sky.removeFromParent();
  }
}
