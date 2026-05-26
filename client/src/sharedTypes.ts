export type VoxelType = 'field' | 'forest' | 'walk' | 'thicket' | 'water' | 'cliff' | 'path';

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rx: number; // yaw rotation
  ry: number; // pitch rotation
  anim: 'idle' | 'run' | 'swim';
  skinColor: string;
  punchedCheckpoints: number[]; // list of checkpoint indices punched
}

export interface Checkpoint {
  id: number;
  code: string;
  x: number;
  z: number;
  description: string;
}

export interface ScoreboardEntry {
  id: string;
  name: string;
  finished: boolean;
  elapsed: number;
  splits: number[]; // timestamps of each punch relative to startTime
}

export interface RoomState {
  id: string;
  name: string;
  players: { [id: string]: PlayerState };
  status: 'lobby' | 'countdown' | 'racing' | 'finished';
  mapSeed: number;
  startTime: number; // synchronised time (server time)
  course: Checkpoint[];
  scoreboard: { [id: string]: ScoreboardEntry };
}
