import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect
} from 'postprocessing';
import { GodraysPass, GodraysPassParams } from 'three-good-godrays';
import { N8AOPostPass } from 'n8ao';
import { TimePreset } from './SkySystem';
import { QualitySettings } from './Quality';

// HDR post-processing chain: AO -> volumetric god rays -> bloom + ACES + SMAA.
// Tone mapping must live here, not on the renderer: since three r152 the
// renderer only tone-maps when drawing to canvas, and with a composer the
// scene renders to an offscreen target.
export class PostFX {
  public composer: EffectComposer;
  private n8aoPass: any;
  private godraysPass: GodraysPass;
  // setParams() resets anything unspecified to library defaults, so always
  // send the full parameter set
  private godraysParams: Partial<GodraysPassParams> = {
    density: 1 / 128,
    maxDensity: 0.1,
    distanceAttenuation: 2,
    color: new THREE.Color(0xffeecc),
    raymarchSteps: 60,
    blur: true,
    gammaCorrection: false // bloom/tonemap passes follow this one
  };

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    sunLight: THREE.DirectionalLight
  ) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType
    });

    this.composer.addPass(new RenderPass(scene, camera));

    this.n8aoPass = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
    this.n8aoPass.configuration.aoRadius = 2.0;
    this.n8aoPass.configuration.intensity = 2.5;
    this.n8aoPass.configuration.halfRes = true;
    this.n8aoPass.configuration.gammaCorrection = false; // tone mapping happens later in the chain
    this.composer.addPass(this.n8aoPass);

    this.godraysPass = new GodraysPass(
      sunLight,
      camera as THREE.PerspectiveCamera,
      this.godraysParams
    );
    this.composer.addPass(this.godraysPass);

    this.composer.addPass(
      new EffectPass(
        camera,
        new BloomEffect({
          // Threshold above typical sunlit-white-ground luminance so only the
          // sun disc and strong speculars bloom, not the whole IOF-white floor
          luminanceThreshold: 1.35,
          intensity: 0.22,
          mipmapBlur: true
        }),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
        new SMAAEffect()
      )
    );
  }

  public setSize(width: number, height: number) {
    this.composer.setSize(width, height);
  }

  // God rays read as warm gold by day, near-invisible at night
  public setTimeOfDay(time: TimePreset) {
    switch (time) {
      case 'noon':
        this.godraysParams.color = new THREE.Color(0xffeecc);
        this.godraysParams.maxDensity = 0.06; // subtle by day; strong rays are a sunset thing
        break;
      case 'sunset':
        this.godraysParams.color = new THREE.Color(0xffaa55);
        this.godraysParams.maxDensity = 0.15;
        break;
      case 'night':
        this.godraysParams.color = new THREE.Color(0x334466);
        this.godraysParams.maxDensity = 0.03;
        break;
    }
    this.godraysPass.setParams(this.godraysParams);
  }

  public applyQuality(settings: QualitySettings) {
    this.n8aoPass.enabled = settings.aoMode !== 'off';
    this.n8aoPass.configuration.halfRes = settings.aoMode === 'half';

    this.godraysPass.enabled = settings.godraySteps > 0;
    if (settings.godraySteps > 0) {
      this.godraysParams.raymarchSteps = settings.godraySteps;
      this.godraysPass.setParams(this.godraysParams);
    }
  }

  public render(delta: number) {
    this.composer.render(delta);
  }
}
