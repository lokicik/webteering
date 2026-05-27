import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { RoomManager } from './RoomManager';

const app = express();
app.use(cors());

// Serve built static client files
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'), (err) => {
    if (err) {
      // In development, the client runs on port 3000 separately, so just return a message
      res.status(200).send('Webteering Server is Running. In development, open the client on port 3000.');
    }
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();

// Room Sync Loop: Broadcast player state updates to each room at 20Hz (every 50ms)
setInterval(() => {
  const rooms = roomManager.getRoomList();
  for (const r of rooms) {
    const roomState = roomManager.getRoom(r.id);
    if (roomState && Object.keys(roomState.players).length > 0) {
      // Send player positions and state to everyone in this room
      io.to(r.id).emit('positions-update', roomState.players);
    }
  }
}, 50);

io.on('connection', (socket: Socket) => {
  console.log(`Player connected: ${socket.id}`);

  // 1. Time Synchronization (NTP-like protocol)
  socket.on('sync-ping', (clientTime: number) => {
    socket.emit('sync-pong', {
      clientTime,
      serverTime: Date.now()
    });
  });

  // 2. Room Browser list
  socket.on('get-rooms', () => {
    socket.emit('rooms-list', roomManager.getRoomList());
  });

  // 3. Create or Join Room
  socket.on('join-room', ({ roomId, roomName, playerName, skinColor, seed }) => {
    const cleanRoomId = roomId.trim().toLowerCase();
    if (!cleanRoomId) return;

    let room = roomManager.getRoom(cleanRoomId);
    if (!room) {
      // Create room if it doesn't exist
      room = roomManager.createRoom(cleanRoomId, roomName || `Room ${cleanRoomId}`, seed);
    }

    // Join room
    const joinResult = roomManager.joinRoom(cleanRoomId, socket.id, playerName || 'Runner', skinColor || '#ff0000');
    if (joinResult) {
      socket.join(cleanRoomId);
      console.log(`Player ${playerName} (${socket.id}) joined room: ${cleanRoomId}`);

      // Confirm join to client
      socket.emit('joined-room', {
        roomId: cleanRoomId,
        playerId: socket.id,
        roomState: joinResult
      });

      // Notify others in room
      io.to(cleanRoomId).emit('room-update', joinResult);
      
      // Update general rooms list for others browsing
      io.emit('rooms-list', roomManager.getRoomList());
    }
  });

  // 4. Update Position (Receives from client and updates state)
  socket.on('update-position', ({ x, y, z, rx, ry, anim }) => {
    const roomState = roomManager.updatePlayerPosition(socket.id, x, y, z, rx, ry, anim);
    // Position is broadcasted in the 20Hz update interval to prevent socket congestion
  });

  // 5. Punch Checkpoint
  socket.on('punch-checkpoint', ({ checkpointIndex, clientTime }) => {
    const result = roomManager.punchCheckpoint(socket.id, checkpointIndex, clientTime);
    if (result.success && result.room) {
      const room = result.room;
      const player = room.players[socket.id];
      
      console.log(`Player ${player?.name} punched checkpoint ${checkpointIndex} (Code: ${room.course[checkpointIndex].code})`);

      // Emit punch notification to all in room
      io.to(room.id).emit('player-punched', {
        playerId: socket.id,
        checkpointIndex,
        isFinish: result.isFinish,
        roomState: room
      });
      
      // Also broadcast room update to ensure sync
      io.to(room.id).emit('room-update', room);
    }
  });

  // 6. Start Race Countdown
  socket.on('start-race', () => {
    const roomId = roomManager.getPlayerRoomId(socket.id);
    if (!roomId) return;

    const room = roomManager.startCountdown(roomId);
    if (room) {
      io.to(roomId).emit('room-update', room);
      console.log(`Race countdown started in room ${roomId}. Start time: ${room.startTime}`);

      // Set timeout to start the race in 5 seconds
      setTimeout(() => {
        const activeRoom = roomManager.startRace(roomId);
        if (activeRoom) {
          io.to(roomId).emit('room-update', activeRoom);
          console.log(`Race started in room ${roomId}!`);
        }
      }, 5000);
    }
  });

  // 6.5. Send chat message to room
  socket.on('send-chat-message', (message: string) => {
    const roomId = roomManager.getPlayerRoomId(socket.id);
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    const player = room?.players[socket.id];
    if (player) {
      io.to(roomId).emit('chat-message', {
        sender: player.name,
        msg: message.substring(0, 100), // Limit length for safety
        color: player.skinColor
      });
    }
  });

  // 7. Disconnect and cleanup
  socket.on('disconnect', () => {
    const roomId = roomManager.getPlayerRoomId(socket.id);
    if (roomId) {
      const updatedRoom = roomManager.leaveRoom(socket.id);
      console.log(`Player disconnected: ${socket.id} from room ${roomId}`);

      if (updatedRoom) {
        io.to(roomId).emit('room-update', updatedRoom);
      }
      
      io.emit('rooms-list', roomManager.getRoomList());
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Webteering backend listening on port ${PORT}`);
});
