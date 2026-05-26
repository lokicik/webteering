import * as THREE from 'three';
import { Engine } from './game/Engine';
import { Terrain } from './game/Terrain';
import { Controls } from './game/Controls';
import { Elements } from './game/Elements';
import { Network } from './net/Network';
import { HUD } from './ui/HUD';
import { Sound } from './ui/Sound';
import { Checkpoint, RoomState } from './sharedTypes';

class WebteeringApp {
  private engine!: Engine;
  private terrain!: Terrain;
  private controls!: Controls;
  private elements!: Elements;
  private network!: Network;
  private hud!: HUD;

  // App States
  private activeRoomId: string | null = null;
  private localPlayerId: string | null = null;
  private roomState: RoomState | null = null;
  
  private isTutorial = false;
  private tutorialStep = 0;
  
  private isFreeplay = false;
  private headlamp: THREE.SpotLight | null = null;

  constructor() {
    this.initCore();
    this.initLobbyUI();
  }

  private initCore() {
    // 1. Initialise main 3D engine
    this.engine = new Engine('canvas-container');
    
    // 2. Initialise HUD UI
    this.hud = new HUD();
    
    // 3. Initialise procedural terrain
    // Start with a temporary placeholder seed, we reload on join
    this.terrain = new Terrain(this.engine.scene, 12345);
    
    // 4. Initialise First Person controls with terrain heights hook
    this.controls = new Controls(this.engine.camera, this.engine.renderer.domElement, this.terrain);
    
    // 5. Initialise static & dynamic voxel models manager
    this.elements = new Elements(this.engine.scene);

    // Register active loops
    this.engine.addUpdatable(this);

    // Hide HUD initially
    document.getElementById('hud-container')?.classList.add('hidden');
    
    // Remove loader
    document.getElementById('loading-screen')?.classList.add('hidden');

    // 6. Start the engine loop
    this.engine.start();
  }

  private initLobbyUI() {
    // Connect to WebSocket server
    this.network = new Network();

    const nameInput = document.getElementById('player-name') as HTMLInputElement;
    const roomInput = document.getElementById('new-room-id') as HTMLInputElement;
    const btnCreate = document.getElementById('btn-create-room');
    const btnStartRace = document.getElementById('btn-start-race');
    const btnLeaveRoom = document.getElementById('btn-leave-room');
    const btnPodiumClose = document.getElementById('btn-podium-close');

    // Generate random room name on startup
    if (roomInput) {
      roomInput.value = Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    // Connect color picker buttons
    let selectedColor = '#ff3333';
    const colorBtns = document.querySelectorAll('.color-btn');
    colorBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        colorBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedColor = (btn as HTMLElement).dataset.color || '#ff3333';
      });
    });

    // Room Browser lists hook
    this.network.onRoomsList = (rooms) => {
      const listEl = document.getElementById('rooms-list');
      if (!listEl) return;
      listEl.innerHTML = '';
      
      if (rooms.length === 0) {
        listEl.innerHTML = '<p class="no-rooms">No active rooms. Create one below!</p>';
        return;
      }

      rooms.forEach(r => {
        const item = document.createElement('div');
        item.className = 'room-item';
        item.innerHTML = `
          <div class="room-info">
            <span class="room-name">${r.name}</span>
            <span class="room-status ${r.status}">${r.status}</span>
          </div>
          <span class="room-count">${r.playerCount} / 8</span>
        `;

        item.addEventListener('click', () => {
          this.network.joinRoom(
            r.id,
            r.name,
            nameInput.value || 'Runner',
            selectedColor
          );
        });

        listEl.appendChild(item);
      });
    };

    // Periodically fetch room listings
    this.network.getRooms();
    setInterval(() => {
      if (!this.activeRoomId && !this.isTutorial && !this.isFreeplay) {
        this.network.getRooms();
      }
    }, 4000);

    // Join / Create Room triggers
    btnCreate?.addEventListener('click', () => {
      const code = roomInput.value.trim().toLowerCase();
      if (!code) return;
      this.network.joinRoom(
        code,
        `Room ${code.toUpperCase()}`,
        nameInput.value || 'Runner',
        selectedColor
      );
    });

    // Start Race Countdowns trigger
    btnStartRace?.addEventListener('click', () => {
      this.network.startRace();
    });

    // Leave Room wait triggers
    btnLeaveRoom?.addEventListener('click', () => {
      this.network.leaveRoom();
      this.activeRoomId = null;
      this.roomState = null;
      document.getElementById('room-wait-screen')?.classList.add('hidden');
      document.getElementById('lobby-screen')?.classList.remove('hidden');
    });

    // Close scoreboard triggers
    btnPodiumClose?.addEventListener('click', () => {
      document.getElementById('podium-screen')?.classList.add('hidden');
      if (this.activeRoomId) {
        // Return to waiting room screen
        document.getElementById('room-wait-screen')?.classList.remove('hidden');
      } else {
        document.getElementById('lobby-screen')?.classList.remove('hidden');
      }
    });

    // Lobby network callbacks
    this.network.onJoinedRoom = ({ roomId, playerId, roomState }) => {
      this.activeRoomId = roomId;
      this.localPlayerId = playerId;
      this.roomState = roomState;

      document.getElementById('lobby-screen')?.classList.add('hidden');
      document.getElementById('room-wait-screen')?.classList.remove('hidden');
      
      this.updateLobbyWaitRoom();
    };

    this.network.onRoomUpdate = (roomState) => {
      this.roomState = roomState;
      this.updateLobbyWaitRoom();
      this.syncActiveRaceState();
    };

    // Multiplayer positions syncs
    this.network.onPositionsUpdate = (players) => {
      this.elements.updateOtherPlayers(players, this.localPlayerId);
    };

    this.network.onPlayerPunched = ({ playerId, checkpointIndex, isFinish, roomState }) => {
      this.roomState = roomState;
      
      const isMe = (playerId === this.localPlayerId);
      const cp = roomState.course[checkpointIndex];

      if (isMe) {
        // Trigger local screen punch banner
        const elapsed = roomState.scoreboard[playerId].splits[checkpointIndex];
        this.hud.triggerPunchAlert(cp.code, cp.description, elapsed);
      } else {
        // Play faint beep for others
        Sound.playTick(false);
      }

      // Check if finished
      if (isFinish && isMe) {
        this.controls.unlock();
      }
    };

    // Mode select listeners (Tutorial & Sandbox)
    document.getElementById('btn-tutorial-start')?.addEventListener('click', () => {
      this.startTutorialMode();
    });

    document.getElementById('btn-freeplay-start')?.addEventListener('click', () => {
      this.startFreeplayMode();
    });
  }

  // --- WAIT ROOM LOBBY SYNC ---
  private updateLobbyWaitRoom() {
    if (!this.roomState) return;

    const titleEl = document.getElementById('room-title') as HTMLElement;
    const seedEl = document.getElementById('room-map-seed') as HTMLElement;
    const gridEl = document.getElementById('room-players-grid') as HTMLElement;
    const btnStart = document.getElementById('btn-start-race') as HTMLElement;
    const msgHost = document.getElementById('wait-host-msg') as HTMLElement;

    titleEl.innerText = this.roomState.name;
    seedEl.innerText = `Map Seed: ${this.roomState.mapSeed}`;

    gridEl.innerHTML = '';
    
    const players = Object.values(this.roomState.players);
    players.forEach(p => {
      const card = document.createElement('div');
      const isMe = (p.id === this.localPlayerId);
      card.className = `player-card ${isMe ? 'is-me' : ''}`;
      card.innerHTML = `
        <span class="player-color-dot" style="background-color: ${p.skinColor}; color: ${p.skinColor};"></span>
        <span class="player-name-lbl">${p.name}</span>
      `;
      gridEl.appendChild(card);
    });

    // Host controller check (first player is host)
    const isHost = (players[0]?.id === this.localPlayerId);
    if (isHost && this.roomState.status === 'lobby') {
      btnStart.classList.remove('hidden');
      msgHost.classList.add('hidden');
    } else {
      btnStart.classList.add('hidden');
      msgHost.classList.remove('hidden');
    }
  }

  // --- MULTIPLAYER IN-GAME SESSION SYNC ---
  private syncActiveRaceState() {
    if (!this.roomState) return;

    const status = this.roomState.status;

    if (status === 'countdown' || status === 'racing') {
      // 1. Hide Lobby overlays
      document.getElementById('room-wait-screen')?.classList.add('hidden');
      document.getElementById('lobby-screen')?.classList.add('hidden');
      document.getElementById('hud-container')?.classList.remove('hidden');

      // Lock mouse cursor to start racing!
      this.controls.lock();

      // 2. Load 3D Terrain on demand if not loaded or matching seed
      this.reloadTerrainAndCourse(this.roomState.mapSeed, this.roomState.course);

      // 3. Update HUD panels
      const localP = this.roomState.players[this.localPlayerId || ''];
      if (localP) {
        this.hud.updateECard(this.roomState.course, localP.punchedCheckpoints);
      }
    } else if (status === 'finished') {
      // Show podium table
      this.showScoreboardSummary();
    }
  }

  private reloadTerrainAndCourse(seed: number, course: Checkpoint[]) {
    // Regenerate heightfield meshes
    this.terrain = new Terrain(this.engine.scene, seed);
    this.terrain.generateTerrainMeshes();

    // Redraw HUD compass/legend once
    this.elements.clearStaticEntities();

    // Snap local player to dry start position height
    const startHeight = this.terrain.getTerrainHeight(0, 0);
    this.controls.position.set(0, startHeight + 1.0, 0);

    // Pre-build 3D Pine trees/boulders inside terrain limits
    // Use the LCG deterministic seeds to place static props identically for everyone!
    const random = lcg(seed);
    const density = 250;
    const half = this.terrain.getMapSize() / 2;

    for (let i = 0; i < density; i++) {
      const rx = Math.round(random() * (half * 2 - 10) - half + 5);
      const rz = Math.round(random() * (half * 2 - 10) - half + 5);
      
      const type = this.terrain.getTerrainType(rx, rz);
      const h = this.terrain.getTerrainHeight(rx, rz);

      if (type === 'forest' || type === 'walk' || type === 'thicket') {
        // Spawn voxel tree
        this.elements.createVoxelTree(rx, h, rz);
      } else if (type === 'cliff') {
        // Spawn voxel boulder
        this.elements.createVoxelBoulder(rx, h, rz);
      }
    }

    // Build 3D Control flags
    course.forEach(cp => {
      const h = this.terrain.getTerrainHeight(cp.x, cp.z);
      this.elements.createControlFlag(cp, h);
    });

    // Cache topographic background overlay canvas
    this.hud.preRenderStaticMap(this.terrain, course);
  }

  private showScoreboardSummary() {
    if (!this.roomState) return;

    this.controls.unlock();
    
    document.getElementById('hud-container')?.classList.add('hidden');
    document.getElementById('stamina-bar-container')?.classList.add('hidden');
    document.getElementById('podium-screen')?.classList.remove('hidden');

    const tbody = document.getElementById('podium-tbody') as HTMLElement;
    tbody.innerHTML = '';

    // Sort finished lists
    const sorted = Object.values(this.roomState.scoreboard).sort((a, b) => {
      if (a.finished && b.finished) return a.elapsed - b.elapsed;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.splits.length - a.splits.length;
    });

    sorted.forEach((entry, idx) => {
      const tr = document.createElement('tr');
      const isMe = (entry.id === this.localPlayerId);
      if (isMe) tr.className = 'is-me-row';

      const timeStr = entry.finished ? this.hud.formatTime(entry.elapsed) : 'DID NOT FINISH';
      const count = `${entry.splits.length} / ${this.roomState!.course.length}`;

      tr.innerHTML = `
        <td class="rank-cell">#${idx + 1}</td>
        <td style="font-weight:${isMe ? 'bold':'normal'}">${entry.name}</td>
        <td>${count}</td>
        <td style="font-family:var(--font-mono); font-weight:bold;">${timeStr}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- GAME MODE: INTERACTIVE TUTORIAL STATE MACHINE ---
  private startTutorialMode() {
    this.isTutorial = true;
    this.isFreeplay = false;
    this.tutorialStep = 1;

    // Load static tutorial seed (seed = 101)
    const course: Checkpoint[] = [
      { id: 1, code: '31', x: 20, z: 20, description: 'Boulder, North side' },
      { id: 2, code: 'F', x: 0, z: 10, description: 'Finish banner' }
    ];

    // Load elements
    document.getElementById('lobby-screen')?.classList.add('hidden');
    document.getElementById('hud-container')?.classList.remove('hidden');
    document.getElementById('tutorial-box')?.classList.remove('hidden');
    
    // Toggle sandbox and multiplayer off
    document.getElementById('leaderboard-panel')?.classList.add('hidden');

    // Trigger full assets pre-load
    this.reloadTerrainAndCourse(101, course);
    this.hud.updateECard(course, []);

    // Snap to starting position
    const startHeight = this.terrain.getTerrainHeight(0, 0);
    this.controls.position.set(0, startHeight + 1.0, 0);

    // Initial state
    this.controls.lock();
    this.updateTutorialProgress();
  }

  private updateTutorialProgress() {
    const textEl = document.getElementById('tutorial-text') as HTMLElement;
    const btnNext = document.getElementById('btn-tutorial-next') as HTMLElement;
    const skipEl = document.getElementById('btn-tutorial-skip');

    skipEl?.addEventListener('click', () => {
      this.exitTutorial();
    });

    switch (this.tutorialStep) {
      case 1:
        textEl.innerHTML = `Welcome to <b>Webteering</b>!<br><br>Use <b>WASD</b> keys to walk and <b>Mouse</b> to look around.<br><br>Run around to test movement. (Walk forward 5 meters to continue)`;
        btnNext.classList.add('hidden');
        break;
      case 2:
        textEl.innerHTML = `Nice movement!<br><br>Now press <b>M</b> key to open your <b>Topographic Map</b>.<br><br>Notice the brown loops? Those are <b>contour lines</b>. Highly packed lines indicate steep slopes. Walk up the tall hill on your right (height over 8m).`;
        btnNext.classList.add('hidden');
        break;
      case 3:
        textEl.innerHTML = `Great climbing! Elevation is key in route selection.<br><br>Let's orient your map! The bezel at the bottom right is your <b>Compass</b>.<br><br>Move mouse to rotate until the <b>red North needle N</b> aligns perfectly with the bezel's top heading line!`;
        btnNext.classList.add('hidden');
        break;
      case 4:
        textEl.innerHTML = `Perfectly aligned! Your map now matches the forest direction.<br><br>Find <b>Checkpoint 1 [Code 31]</b> marked as a red ring on your map, hidden behind a boulder (coordinates X:20, Z:20). Stand close and press <b>E</b> to punch!`;
        btnNext.classList.add('hidden');
        break;
      case 5:
        textEl.innerHTML = `Awesome double-beep stamp feedback!<br><br>Now sprint back to the <b>Finish Banner [Code F]</b> at coordinates (X:0, Z:10) and press <b>E</b> to finish your training course!`;
        btnNext.classList.add('hidden');
        break;
      case 6:
        textEl.innerHTML = `<b>CONGRATULATIONS!</b><br><br>You've successfully mastered voxel map reading, compass alignment, and checkpoint punching.<br><br>You are ready for multiplayer races!`;
        btnNext.classList.remove('hidden');
        btnNext.innerText = 'Back to Lobby';
        
        btnNext.onclick = () => {
          this.exitTutorial();
        };
        break;
    }
  }

  private evaluateTutorialTriggers() {
    if (!this.isTutorial) return;

    if (this.tutorialStep === 1) {
      // Walk 5 meters
      if (this.controls.position.length() > 5.0) {
        this.tutorialStep = 2;
        this.updateTutorialProgress();
        Sound.playTick(true);
      }
    } else if (this.tutorialStep === 2) {
      // Climb over 8.0 meters high
      if (this.controls.position.y > 8.0) {
        this.tutorialStep = 3;
        this.updateTutorialProgress();
        Sound.playTick(true);
      }
    } else if (this.tutorialStep === 3) {
      // Compass alignment within 0.15 radians of North (0)
      const yaw = this.controls.getRotation().rx;
      const angleNormalized = Math.abs((yaw % (Math.PI * 2)));
      if (angleNormalized < 0.15 || Math.abs(angleNormalized - Math.PI * 2) < 0.15) {
        this.tutorialStep = 4;
        this.updateTutorialProgress();
        Sound.playTick(true);
      }
    }
  }

  private exitTutorial() {
    this.isTutorial = false;
    this.tutorialStep = 0;
    
    this.controls.unlock();
    this.elements.clearStaticEntities();

    document.getElementById('hud-container')?.classList.add('hidden');
    document.getElementById('stamina-bar-container')?.classList.add('hidden');
    document.getElementById('tutorial-box')?.classList.add('hidden');
    document.getElementById('leaderboard-panel')?.classList.remove('hidden');
    document.getElementById('lobby-screen')?.classList.remove('hidden');
  }

  // --- GAME MODE: FREEPLAY SANDBOX ---
  private startFreeplayMode() {
    this.isFreeplay = true;
    this.isTutorial = false;

    // Load random freeplay seed (seed = random)
    const seed = Math.floor(Math.random() * 1000000);
    const course = [
      { id: 1, code: '51', x: 40, z: -30, description: 'Boulder, West side' },
      { id: 2, code: '52', x: -80, z: 70, description: 'Gully, upper part' },
      { id: 3, code: 'F', x: 0, z: 10, description: 'Finish line' }
    ];

    document.getElementById('lobby-screen')?.classList.add('hidden');
    document.getElementById('hud-container')?.classList.remove('hidden');
    document.getElementById('freeplay-drawer')?.classList.remove('hidden');
    document.getElementById('btn-toggle-options')?.classList.remove('hidden');

    this.reloadTerrainAndCourse(seed, course);
    this.hud.updateECard(course, []);

    // Snap player
    const startHeight = this.terrain.getTerrainHeight(0, 0);
    this.controls.position.set(0, startHeight + 1.0, 0);

    this.controls.lock();

    // Hook sandbox sliders/options
    const selTime = document.getElementById('sel-time') as HTMLSelectElement;
    const rngFog = document.getElementById('rng-fog') as HTMLInputElement;
    const chkFly = document.getElementById('chk-fly') as HTMLInputElement;
    const btnExit = document.getElementById('btn-exit-freeplay');

    const updateTimeSettings = () => {
      const tod = selTime.value as 'noon' | 'sunset' | 'night';
      const fogVal = parseFloat(rngFog.value);
      this.engine.setTimeOfDay(tod);
      this.engine.setFogDensity(fogVal);
      
      // Toggle Flashlight/Headlamp spotlight for spooky night orienteering!
      if (tod === 'night') {
        if (!this.headlamp) {
          this.headlamp = new THREE.SpotLight(0xffffff, 4.0, 45, Math.PI / 5, 0.5, 1.0);
          this.headlamp.castShadow = true;
          this.headlamp.shadow.bias = -0.002;
          this.engine.scene.add(this.headlamp);
        }
      } else {
        if (this.headlamp) {
          this.engine.scene.remove(this.headlamp);
          this.headlamp = null;
        }
      }
    };

    selTime.onchange = updateTimeSettings;
    rngFog.oninput = updateTimeSettings;
    
    chkFly.onchange = () => {
      this.controls.isFlightMode = chkFly.checked;
    };

    if (btnExit) {
      btnExit.onclick = () => {
        this.exitFreeplay();
      };
    }

    // Trigger initial lighting pass
    updateTimeSettings();
  }

  private exitFreeplay() {
    this.isFreeplay = false;
    this.controls.unlock();
    
    if (this.headlamp) {
      this.engine.scene.remove(this.headlamp);
      this.headlamp = null;
    }

    // Restore standard day ambient lighting
    this.engine.setTimeOfDay('noon');

    this.elements.clearStaticEntities();

    document.getElementById('hud-container')?.classList.add('hidden');
    document.getElementById('stamina-bar-container')?.classList.add('hidden');
    document.getElementById('freeplay-drawer')?.classList.add('hidden');
    document.getElementById('btn-toggle-options')?.classList.add('hidden');
    document.getElementById('lobby-screen')?.classList.remove('hidden');
  }

  // --- CORE TICK UPDATE LOOP INTERACTION ---
  public update(delta: number) {
    if (!this.network || !this.controls || !this.elements || !this.hud || !this.terrain) return;

    const serverTime = this.isTutorial || this.isFreeplay 
      ? Date.now() 
      : this.network.getServerTime();

    // 1. Update player physics/positions
    this.controls.update(delta);

    // Apply camera screen-shake during stumbles/slips
    if (this.controls.slipTimer > 0.0) {
      const shake = 0.08 * (this.controls.slipTimer / 0.6);
      this.engine.camera.position.x += (Math.random() - 0.5) * shake;
      this.engine.camera.position.z += (Math.random() - 0.5) * shake;
    }

    // Sync Headlamp rotation/direction to Camera in night sandbox
    if (this.headlamp) {
      this.headlamp.position.copy(this.engine.camera.position);
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.engine.camera.quaternion);
      this.headlamp.target.position.copy(this.engine.camera.position).add(lookDir);
      this.headlamp.target.updateMatrixWorld();
    }

    // 2. Broadcast position to server if in active lobby
    if (this.activeRoomId && this.roomState && this.roomState.status === 'racing') {
      const anim = this.isSwimming ? 'swim' : (this.controls.position.length() > 0.05 ? 'run' : 'idle');
      this.network.sendPosition(
        this.controls.position.x,
        this.controls.position.y,
        this.controls.position.z,
        this.controls.getRotation().rx,
        this.controls.getRotation().ry,
        anim
      );
    }

    // 3. Interpolate other runners meshes and flag rotations
    this.elements.update(delta);

    // 4. Update HUD panel metrics (Compass Rose + 2D map canvas)
    const yaw = this.controls.getRotation().rx;
    const speedFactor = this.controls.getSpeedFactor();
    const isGrounded = this.controls.getIsGrounded();
    this.hud.updateCompass(yaw, delta, speedFactor, isGrounded);

    // Manual Map Rotation Q/R key hooks
    if (this.hud.mapMode === 'manual') {
      if (this.keysPressed['KeyQ']) {
        this.hud.manualMapAngle -= 1.8 * delta;
      }
      if (this.keysPressed['KeyR']) {
        this.hud.manualMapAngle += 1.8 * delta;
      }
    }

    // Update glowing HUD Stamina Bar progress
    const staminaBarContainer = document.getElementById('stamina-bar-container');
    const staminaBarFill = document.getElementById('stamina-bar-fill');
    if (staminaBarContainer && staminaBarFill) {
      staminaBarContainer.classList.remove('hidden');
      staminaBarFill.style.width = `${this.controls.stamina}%`;
      
      if (this.controls.isExhausted) {
        staminaBarFill.className = 'exhausted';
      } else if (this.controls.stamina < 30.0) {
        staminaBarFill.className = 'warning';
      } else {
        staminaBarFill.className = '';
      }
    }

    const otherState = this.roomState ? this.roomState.players : {};
    this.hud.updateMapHUD(
      this.terrain.getMapSize(),
      this.controls.position.x,
      this.controls.position.z,
      yaw,
      otherState
    );

    // 5. Proximity triggers (Checkpoint punches range verification)
    this.evaluateCheckpointProximity();

    // 6. Manage race clock ticks and scoreboard sorting
    if (this.roomState) {
      this.hud.updateTimers(this.roomState.status, this.roomState.startTime, serverTime);
      this.hud.updateLeaderboard(this.roomState.scoreboard, this.localPlayerId);
    }

    // 7. Tutorial triggers checks
    this.evaluateTutorialTriggers();
  }

  // Check proximity to target checkpoint flag to render "Press E" HUD prompts
  private evaluateCheckpointProximity() {
    let activeCourse: Checkpoint[] = [];
    let punchedCps: number[] = [];

    if (this.isTutorial) {
      activeCourse = [
        { id: 1, code: '31', x: 20, z: 20, description: 'Boulder, North side' },
        { id: 2, code: 'F', x: 0, z: 10, description: 'Finish banner' }
      ];
      // Mock punched list inside tutorial
      punchedCps = Array.from({ length: this.tutorialStep - 4 }, (_, i) => i);
    } else if (this.isFreeplay) {
      activeCourse = [
        { id: 1, code: '51', x: 40, z: -30, description: 'Boulder, West side' },
        { id: 2, code: '52', x: -80, z: 70, description: 'Gully, upper part' },
        { id: 3, code: 'F', x: 0, z: 10, description: 'Finish line' }
      ];
      punchedCps = []; // mock
    } else if (this.roomState && this.localPlayerId) {
      activeCourse = this.roomState.course;
      punchedCps = this.roomState.players[this.localPlayerId].punchedCheckpoints;
    }

    if (activeCourse.length === 0) {
      this.hud.hideActionPrompt();
      return;
    }

    const targetIdx = punchedCps.length;
    
    // If finished course, hide action prompt
    if (targetIdx >= activeCourse.length) {
      this.hud.hideActionPrompt();
      return;
    }

    const targetCp = activeCourse[targetIdx];
    const dx = this.controls.position.x - targetCp.x;
    const dz = this.controls.position.z - targetCp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= 3.0) {
      // Near correct target CP! Render orange punch prompt
      this.hud.showActionPrompt(targetCp.code, true);

      // Listen for E key punch action
      if (this.keysPressed['KeyE']) {
        this.keysPressed['KeyE'] = false; // consume input
        this.executePunchAction(targetIdx);
      }
    } else {
      // Check if near a WRONG checkpoint (triggers red warning prompt!)
      let nearWrongCp = false;
      let wrongCode = '';

      for (let i = 0; i < activeCourse.length; i++) {
        if (i === targetIdx) continue;
        const cp = activeCourse[i];
        const wdx = this.controls.position.x - cp.x;
        const wdz = this.controls.position.z - cp.z;
        const wdist = Math.sqrt(wdx * wdx + wdz * wdz);

        if (wdist <= 3.0) {
          nearWrongCp = true;
          wrongCode = cp.code;
          break;
        }
      }

      if (nearWrongCp) {
        this.hud.showActionPrompt(wrongCode, false);
        if (this.keysPressed['KeyE']) {
          this.keysPressed['KeyE'] = false;
          Sound.playError(); // play error buzzer
        }
      } else {
        this.hud.hideActionPrompt();
      }
    }
  }

  private executePunchAction(index: number) {
    if (this.isTutorial) {
      // Step progress inside tutorial
      if (this.tutorialStep === 4 && index === 0) {
        this.tutorialStep = 5;
        this.hud.updateECard([
          { id: 1, code: '31', x: 20, z: 20, description: 'Boulder, North side' },
          { id: 2, code: 'F', x: 0, z: 10, description: 'Finish banner' }
        ], [0]);
        this.hud.triggerPunchAlert('31', 'Boulder, North side', 45000);
        this.updateTutorialProgress();
      } else if (this.tutorialStep === 5 && index === 1) {
        this.tutorialStep = 6;
        this.hud.updateECard([
          { id: 1, code: '31', x: 20, z: 20, description: 'Boulder, North side' },
          { id: 2, code: 'F', x: 0, z: 10, description: 'Finish banner' }
        ], [0, 1]);
        this.hud.triggerPunchAlert('F', 'Finish banner', 90000);
        this.updateTutorialProgress();
      }
    } else if (this.isFreeplay) {
      // Standard local sandbox audio feedback
      Sound.playPunch();
    } else if (this.activeRoomId) {
      // Send WebSocket stamp claim to server
      this.network.punchCheckpoint(index);
    }
  }

  // Keyboard raw click buffer for one-shot punch action
  private keysPressed: { [key: string]: boolean } = {};
  private isSwimming = false; // locally updated state
  
  public initKeyboardTriggerListener() {
    window.addEventListener('keydown', (e) => {
      this.keysPressed[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keysPressed[e.code] = false;
    });
  }
}

// Deterministic multiplier helper
function lcg(seed: number) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Start application
const app = new WebteeringApp();
app.initKeyboardTriggerListener();
export {};
