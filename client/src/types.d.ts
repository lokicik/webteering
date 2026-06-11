declare module 'n8ao' {
  import { Pass } from 'postprocessing';
  import * as THREE from 'three';

  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: THREE.Color;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      halfRes: boolean;
      screenSpaceRadius: boolean;
      renderMode: number;
      gammaCorrection: boolean;
    };
    setQualityMode(
      mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'
    ): void;
    setSize(width: number, height: number): void;
  }
}
