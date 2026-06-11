export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  pixelRatioCap: number;
  aoMode: 'off' | 'half' | 'full';
  godraySteps: number; // 0 disables the pass
  shadowMapSize: number;
  grassDensityScale: number; // multiplies the per-chunk biome grass counts
  cardTreeRing: number; // chunk rings that get textured card trees (-1 = cones only)
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    pixelRatioCap: 1.0,
    aoMode: 'off',
    godraySteps: 0,
    shadowMapSize: 1024,
    grassDensityScale: 0.2,
    cardTreeRing: -1
  },
  medium: {
    pixelRatioCap: 1.25,
    aoMode: 'half',
    godraySteps: 30,
    shadowMapSize: 2048,
    grassDensityScale: 0.5,
    cardTreeRing: 1
  },
  high: {
    pixelRatioCap: 1.5,
    aoMode: 'half',
    godraySteps: 60,
    shadowMapSize: 2048,
    grassDensityScale: 1.0,
    cardTreeRing: 1
  },
  ultra: {
    pixelRatioCap: 2.0,
    aoMode: 'full',
    godraySteps: 90,
    shadowMapSize: 4096,
    grassDensityScale: 1.5,
    cardTreeRing: 2
  }
};

const STORAGE_KEY = 'webteering.quality';

export function loadQualityLevel(): QualityLevel {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'low' || stored === 'medium' || stored === 'high' || stored === 'ultra') {
    return stored;
  }
  return 'high';
}

export function saveQualityLevel(level: QualityLevel) {
  localStorage.setItem(STORAGE_KEY, level);
}
