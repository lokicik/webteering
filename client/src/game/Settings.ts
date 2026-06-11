export interface GameSettings {
  masterVol: number;   // 0..1
  ambienceVol: number; // 0..1
  sfxVol: number;      // 0..1
  musicVol: number;    // 0..1
  mouseSens: number;   // 0.0008..0.005
  fov: number;         // 55..100
}

export const DEFAULT_SETTINGS: GameSettings = {
  masterVol: 1.0,
  ambienceVol: 1.0,
  sfxVol: 1.0,
  musicVol: 1.0,
  mouseSens: 0.0022,
  fov: 70
};

const STORAGE_KEY = 'webteering.settings.v1';

export function loadSettings(): GameSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (err) {
    // Corrupted storage falls back to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: GameSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
