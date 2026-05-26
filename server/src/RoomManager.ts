import { RoomState, PlayerState, Checkpoint, ScoreboardEntry } from './sharedTypes';

// Simple deterministic PRNG for generating matching courses
function lcg(seed: number) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export class RoomManager {
  private rooms: { [id: string]: RoomState } = {};
  private playerToRoom: { [playerId: string]: string } = {};

  // Generate a course deterministically from a seed
  public generateCourse(seed: number): Checkpoint[] {
    const random = lcg(seed);
    const numControls = 5;
    const course: Checkpoint[] = [];
    const descriptions = [
      'Boulder, North-East side',
      'Depression, shallow part',
      'Gully, upper end',
      'Spur, foot of slope',
      'Thicket, South edge',
      'Rock wall, base',
      'Hill, top'
    ];

    for (let i = 1; i <= numControls; i++) {
      // Place checkpoint in a random ring to distribute them nicely
      const angle = random() * Math.PI * 2;
      const radius = 50 + (i * 40) + (random() * 20); // progressive rings from start
      const x = Math.round(Math.cos(angle) * radius);
      const z = Math.round(Math.sin(angle) * radius);
      const descIndex = Math.floor(random() * descriptions.length);

      course.push({
        id: i,
        code: (30 + i).toString(),
        x,
        z,
        description: descriptions[descIndex]
      });
    }

    // Add Finish checkpoint close to start
    course.push({
      id: numControls + 1,
      code: 'F',
      x: 0,
      z: 10,
      description: 'Finish line banner'
    });

    return course;
  }

  public getRoom(roomId: string): RoomState | undefined {
    return this.rooms[roomId];
  }

  public getRoomList() {
    return Object.values(this.rooms).map(r => ({
      id: r.id,
      name: r.name,
      playerCount: Object.keys(r.players).length,
      status: r.status
    }));
  }

  public createRoom(roomId: string, roomName: string, seed?: number): RoomState {
    const mapSeed = seed !== undefined ? seed : Math.floor(Math.random() * 1000000);
    const course = this.generateCourse(mapSeed);

    const room: RoomState = {
      id: roomId,
      name: roomName,
      players: {},
      status: 'lobby',
      mapSeed,
      startTime: 0,
      course,
      scoreboard: {}
    };

    this.rooms[roomId] = room;
    return room;
  }

  public joinRoom(roomId: string, playerId: string, name: string, skinColor: string): RoomState | null {
    const room = this.rooms[roomId];
    if (!room) return null;

    // Create player state
    const player: PlayerState = {
      id: playerId,
      name,
      x: 0,
      y: 0, // dynamic client height initialisation
      z: 0,
      rx: 0,
      ry: 0,
      anim: 'idle',
      skinColor,
      punchedCheckpoints: []
    };

    room.players[playerId] = player;
    this.playerToRoom[playerId] = roomId;

    // Create scoreboard entry
    room.scoreboard[playerId] = {
      id: playerId,
      name,
      finished: false,
      elapsed: 0,
      splits: []
    };

    return room;
  }

  public leaveRoom(playerId: string): RoomState | null {
    const roomId = this.playerToRoom[playerId];
    if (!roomId) return null;

    const room = this.rooms[roomId];
    if (room) {
      delete room.players[playerId];
      delete room.scoreboard[playerId];
      delete this.playerToRoom[playerId];

      // If room is empty, delete it
      if (Object.keys(room.players).length === 0) {
        delete this.rooms[roomId];
        return null;
      }
      return room;
    }
    return null;
  }

  public getPlayerRoomId(playerId: string): string | undefined {
    return this.playerToRoom[playerId];
  }

  public updatePlayerPosition(
    playerId: string,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    anim: 'idle' | 'run' | 'swim'
  ): RoomState | null {
    const roomId = this.playerToRoom[playerId];
    if (!roomId) return null;

    const room = this.rooms[roomId];
    if (!room) return null;

    const player = room.players[playerId];
    if (player) {
      // Basic server anti-cheat speed threshold (e.g. teleporting validation)
      // Max running speed: ~10 units/sec, tick rate: 20Hz -> max ~0.5 units per tick.
      // We will enforce speed limit in the physical client update, and a broad ceiling on server.
      const maxDistancePerTick = 10; // High buffer to allow latency recovery, but stops massive teleports
      const dx = x - player.x;
      const dz = z - player.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < maxDistancePerTick || player.x === 0 && player.z === 0) {
        player.x = x;
        player.y = y;
        player.z = z;
      }
      
      player.rx = rx;
      player.ry = ry;
      player.anim = anim;
      
      return room;
    }
    return null;
  }

  public punchCheckpoint(playerId: string, checkpointIndex: number, clientTime: number): { room: RoomState | null; success: boolean; isFinish: boolean } {
    const roomId = this.playerToRoom[playerId];
    if (!roomId) return { room: null, success: false, isFinish: false };

    const room = this.rooms[roomId];
    if (!room || room.status !== 'racing') return { room: null, success: false, isFinish: false };

    const player = room.players[playerId];
    const score = room.scoreboard[playerId];
    if (!player || !score || score.finished) return { room, success: false, isFinish: false };

    const course = room.course;
    const targetCheckpoint = course[player.punchedCheckpoints.length];

    if (!targetCheckpoint) return { room, success: false, isFinish: false };

    // Verify index is next in order
    if (checkpointIndex !== player.punchedCheckpoints.length) {
      return { room, success: false, isFinish: false };
    }

    // Verify distance proximity: Player must be close to target checkpoint (x, z)
    const targetCP = course[checkpointIndex];
    const dx = player.x - targetCP.x;
    const dz = player.z - targetCP.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Limit to 6.0 meters (allows some latency cushion but blocks teleport punch cheats)
    if (dist > 6.0) {
      return { room, success: false, isFinish: false };
    }

    // Proximity verified! Punch is valid.
    player.punchedCheckpoints.push(checkpointIndex);

    // Calculate split time relative to server race start
    const serverTimeNow = Date.now();
    const elapsed = serverTimeNow - room.startTime;
    score.splits.push(elapsed);

    // Check if this is the final Finish control
    const isFinish = player.punchedCheckpoints.length === course.length;
    if (isFinish) {
      score.finished = true;
      score.elapsed = elapsed;

      // Check if all players have finished
      const allFinished = Object.values(room.scoreboard).every(entry => entry.finished);
      if (allFinished) {
        room.status = 'finished';
      }
    }

    return { room, success: true, isFinish };
  }

  public startCountdown(roomId: string): RoomState | null {
    const room = this.rooms[roomId];
    if (!room || room.status !== 'lobby') return null;

    room.status = 'countdown';
    room.startTime = Date.now() + 5000; // start 5 seconds in the future
    
    // Clear scoreboards and reset player states
    for (const pid in room.players) {
      room.players[pid].punchedCheckpoints = [];
      room.players[pid].x = 0;
      room.players[pid].y = 0;
      room.players[pid].z = 0;
      
      room.scoreboard[pid] = {
        id: pid,
        name: room.players[pid].name,
        finished: false,
        elapsed: 0,
        splits: []
      };
    }

    return room;
  }

  public startRace(roomId: string): RoomState | null {
    const room = this.rooms[roomId];
    if (!room || room.status !== 'countdown') return null;

    room.status = 'racing';
    return room;
  }
}
