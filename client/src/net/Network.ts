import { io, Socket } from 'socket.io-client';
import { RoomState, PlayerState } from '../sharedTypes';

export class Network {
  public socket: Socket;
  private playerId: string | null = null;
  private timeOffset = 0; // serverTime = localTime + timeOffset
  private latency = 0;
  
  // Callbacks
  public onJoinedRoom: ((data: { roomId: string; playerId: string; roomState: RoomState }) => void) | null = null;
  public onRoomUpdate: ((roomState: RoomState) => void) | null = null;
  public onPositionsUpdate: ((players: { [id: string]: PlayerState }) => void) | null = null;
  public onPlayerPunched: ((data: { playerId: string; checkpointIndex: number; isFinish: boolean; roomState: RoomState }) => void) | null = null;
  public onRoomsList: ((rooms: any[]) => void) | null = null;
  public onChatMessage: ((data: { sender: string; msg: string; color: string }) => void) | null = null;


  constructor() {
    // Resolve backend endpoint (same host in production, localhost:3001 in dev)
    const host = window.location.hostname;
    const protocol = window.location.protocol;
    const socketUrl = host === 'localhost' || host === '127.0.0.1' 
      ? 'http://localhost:3001' 
      : `${protocol}//${window.location.host}`;

    this.socket = io(socketUrl, {
      autoConnect: true,
      reconnection: true
    });

    this.initListeners();
    this.syncTime();
  }

  private initListeners() {
    this.socket.on('connect', () => {
      console.log('Connected to Webteering network backend');
      this.syncTime();
    });

    this.socket.on('joined-room', (data) => {
      this.playerId = data.playerId;
      if (this.onJoinedRoom) this.onJoinedRoom(data);
    });

    this.socket.on('room-update', (roomState: RoomState) => {
      if (this.onRoomUpdate) this.onRoomUpdate(roomState);
    });

    this.socket.on('positions-update', (players: { [id: string]: PlayerState }) => {
      if (this.onPositionsUpdate) this.onPositionsUpdate(players);
    });

    this.socket.on('player-punched', (data) => {
      if (this.onPlayerPunched) this.onPlayerPunched(data);
    });

    this.socket.on('rooms-list', (rooms: any[]) => {
      if (this.onRoomsList) this.onRoomsList(rooms);
    });

    this.socket.on('chat-message', (data: { sender: string; msg: string; color: string }) => {
      if (this.onChatMessage) this.onChatMessage(data);
    });
  }


  // NTP-like time synchronization protocol
  public syncTime() {
    const startPing = Date.now();
    this.socket.emit('sync-ping', startPing);

    this.socket.once('sync-pong', (data: { clientTime: number; serverTime: number }) => {
      const now = Date.now();
      this.latency = (now - data.clientTime) / 2;
      this.timeOffset = data.serverTime - (now + this.latency);
      console.log(`Clock Sync Offset: ${this.timeOffset}ms | Latency: ${this.latency}ms`);
    });
  }

  // Get synchronized server time
  public getServerTime(): number {
    return Date.now() + this.timeOffset;
  }

  public getPlayerId(): string | null {
    return this.playerId;
  }

  public getRooms() {
    this.socket.emit('get-rooms');
  }

  public joinRoom(roomId: string, roomName: string, playerName: string, skinColor: string, seed?: number) {
    this.socket.emit('join-room', {
      roomId,
      roomName,
      playerName,
      skinColor,
      seed
    });
  }

  public leaveRoom() {
    this.socket.emit('leave-room');
    this.playerId = null;
  }

  public startRace() {
    this.socket.emit('start-race');
  }

  // Throttled position update sending (called in update loops)
  private lastUpdate = 0;
  public sendPosition(x: number, y: number, z: number, rx: number, ry: number, anim: 'idle' | 'run' | 'swim') {
    const now = Date.now();
    if (now - this.lastUpdate < 45) return; // Cap output rate to ~22Hz to preserve bandwidth
    
    this.lastUpdate = now;
    this.socket.emit('update-position', {
      x: parseFloat(x.toFixed(3)),
      y: parseFloat(y.toFixed(3)),
      z: parseFloat(z.toFixed(3)),
      rx: parseFloat(rx.toFixed(4)),
      ry: parseFloat(ry.toFixed(4)),
      anim
    });
  }

  public punchCheckpoint(checkpointIndex: number) {
    this.socket.emit('punch-checkpoint', {
      checkpointIndex,
      clientTime: this.getServerTime()
    });
  }

  public sendChatMessage(message: string) {
    this.socket.emit('send-chat-message', message);
  }
}
