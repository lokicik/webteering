export type RunMode = 'classic' | 'rogaine' | 'relaxed' | 'multiplayer' | 'custom';

export interface RunRecord {
  mode: RunMode;
  biome: string;
  seed: number;
  timeMs: number;
  points?: number;   // rogaine
  distance: number;  // meters
  punches: number;
  finished: boolean;
  date: string;      // ISO
}

export interface BestRecord {
  timeMs?: number;
  points?: number;
  date: string;
}

interface StatsV1 {
  version: 1;
  runs: RunRecord[]; // newest first, capped
  career: {
    totalDistance: number;
    controlsPunched: number;
    totalRuns: number;
  };
  bests: { [key: string]: BestRecord };
}

const STORAGE_KEY = 'webteering.stats';
const MAX_RUNS = 100;

function freshStats(): StatsV1 {
  return {
    version: 1,
    runs: [],
    career: { totalDistance: 0, controlsPunched: 0, totalRuns: 0 },
    bests: {}
  };
}

export class StatsStore {
  public static load(): StatsV1 {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.runs)) {
          return parsed as StatsV1;
        }
      }
    } catch (err) {
      // Corrupted storage resets cleanly
    }
    return freshStats();
  }

  private static save(stats: StatsV1) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch (err) {
      // Storage full/unavailable: stats are best-effort
    }
  }

  // Records a run, updates career aggregates and personal bests.
  // Returns whether this run set a new best for its mode+biome key.
  public static recordRun(run: RunRecord): { isNewBest: boolean } {
    const stats = this.load();

    stats.runs.unshift(run);
    if (stats.runs.length > MAX_RUNS) stats.runs.length = MAX_RUNS;

    stats.career.totalDistance += run.distance;
    stats.career.controlsPunched += run.punches;
    stats.career.totalRuns += 1;

    let isNewBest = false;
    if (run.finished) {
      const keys = [`${run.mode}|${run.biome}`, `${run.mode}|${run.biome}|${run.seed}`];
      for (const key of keys) {
        const prev = stats.bests[key];
        const better = run.mode === 'rogaine'
          ? !prev || (run.points ?? 0) > (prev.points ?? -1)
          : !prev || run.timeMs < (prev.timeMs ?? Infinity);
        if (better) {
          stats.bests[key] = {
            timeMs: run.timeMs,
            points: run.points,
            date: run.date
          };
          if (key === keys[0]) isNewBest = true;
        }
      }
    }

    this.save(stats);
    return { isNewBest };
  }

  public static getBest(key: string): BestRecord | undefined {
    return this.load().bests[key];
  }
}
