import * as THREE from 'three';
import { QualityLevel, QUALITY_PRESETS, loadQualityLevel, saveQualityLevel } from './game/Quality';
import { Engine } from './game/Engine';
import { Terrain } from './game/Terrain';
import { Controls } from './game/Controls';
import { Elements } from './game/Elements';
import { Network } from './net/Network';
import { HUD } from './ui/HUD';
import { Sound } from './ui/Sound';
import { Checkpoint, RoomState } from './sharedTypes';
import { Foliage } from './game/Foliage';
import { WildlifeManager } from './game/Wildlife';

class WebteeringApp {
  private engine!: Engine;
  private terrain!: Terrain;
  private controls!: Controls;
  private elements!: Elements;
  private network!: Network;
  private hud!: HUD;
  private foliage!: Foliage;
  private wildlife!: WildlifeManager;

  // App States
  private activeRoomId: string | null = null;
  private localPlayerId: string | null = null;
  private roomState: RoomState | null = null;
  
  private isTutorial = false;
  private tutorialStep = 0;
  
  private isFreeplay = false;
  private headlamp: THREE.SpotLight | null = null;
  private activeBiome = 'alpine';
  private isRogaine = false;
  private rogainePunchedCps: number[] = [];
  private rogainePoints = 0;

  // Advanced Upgrades tracking
  private playerPaths: { [id: string]: { x: number; z: number }[] } = {};
  private pathRecordTimer = 0.0;
  
  // Blind Search Mode (Relaxed Mode)
  private isRelaxed = false;
  private relaxedStartTime = 0;
  private activeCourse: Checkpoint[] = [];
  private relaxedPunchedCps: number[] = [];
  
  // Dynamic audio synthesiser timer
  private breathingTimer = 0.0;

  // 3D Handheld & Silva Bezel properties
  private mapDisplayMode: '2d' | '3d' = '2d';
  private is3DMapOpen = false;
  private handheldGroup: THREE.Group | null = null;
  private handheldMapMesh: THREE.Mesh | null = null;
  private handheldMapTexture: THREE.CanvasTexture | null = null;
  private handheldCompassGroup: THREE.Group | null = null;
  private handheldNeedle: THREE.Group | null = null;
  private handheldBezelRing: THREE.Group | null = null;
  private bezelClickTimer = 0.0;

  // Breath condensation puffs
  private breathPuffs: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number; maxAge: number }[] = [];

  // Fortnite Lobby custom tracking properties
  private isSoundtrackPlaying = false;
  private isLocalReady = false;
  private selectedJerseyColor = '#ff3333';
  private lobbyPedestals: THREE.Mesh[] = [];
  private lobbyPlayersMeshes: THREE.Group[] = [];
  private isLobbyActive = true; // Starts in the Landing screen / Lobby loop
  private activeTimeOfDayState: 'noon' | 'sunset' | 'night' = 'noon';

  constructor() {
    this.initCore();
    this.initLobbyUI();
  }

  private initCore() {
    // 1. Initialise main 3D engine
    this.engine = new Engine('canvas-container');
    
    // 2. Initialise HUD UI
    this.hud = new HUD();
    
    // 2.5. Initialize 3D Handheld Map and Compass parented to camera
    this.init3DHandheldObjects();

    // 3. Initialise procedural terrain
    // Start with a temporary placeholder seed, we reload on join
    this.terrain = new Terrain(this.engine.scene, 12345);
    this.engine.setTerrain(this.terrain);
    
    // 4. Initialise First Person controls with terrain heights hook
    this.controls = new Controls(this.engine.camera, this.engine.renderer.domElement, this.terrain);
    
    // 5. Initialise static & dynamic voxel models manager
    this.elements = new Elements(this.engine.scene);
    
    // 5.5. Initialise instanced nature assets manager
    this.foliage = new Foliage(this.engine.scene);
    
    // 5.6. Initialise procedural voxel wildlife manager
    this.wildlife = new WildlifeManager(this.engine.scene, this.terrain);

    // Register active loops
    this.engine.addUpdatable(this);

    // Hide HUD initially
    document.getElementById('hud-container')?.classList.add('hidden');
    
    // Remove loader and landing screen
    document.getElementById('loading-screen')?.classList.add('hidden');
    document.getElementById('landing-screen')?.classList.remove('hidden');

    // Generate terrain visual in the background for landing scene preview immediately
    this.terrain.generateTerrainMeshes();
    this.foliage.generateFoliage(this.terrain, 12345, 'alpine');
    this.wildlife.spawnCreatures(35);

    // Build the rotating player model on landing
    this.rebuildLobby3D();

    // Hook graphics quality selectors (lobby + in-game panels stay in sync)
    this.initQualityControls();

    // 6. Start the engine loop
    this.engine.start();
  }

  private initQualityControls() {
    const selects = document.querySelectorAll<HTMLSelectElement>('select.sel-quality');
    const level = loadQualityLevel();
    selects.forEach((sel) => {
      sel.value = level;
      sel.onchange = () => {
        const lvl = sel.value as QualityLevel;
        saveQualityLevel(lvl);
        selects.forEach((other) => { other.value = lvl; });
        this.engine.applyQuality(QUALITY_PRESETS[lvl]);
        this.foliage.applyQuality(QUALITY_PRESETS[lvl]);
      };
    });
  }

  private getCustomizationString(): string {
    const hairVal = (document.getElementById('sel-hair-style') as HTMLSelectElement)?.value || 'spiky';
    const torsoVal = (document.getElementById('sel-torso-pattern') as HTMLSelectElement)?.value || 'solid';
    const accVal = (document.getElementById('sel-accessory') as HTMLSelectElement)?.value || 'none';
    return `${this.selectedJerseyColor}|${hairVal}|${torsoVal}|${accVal}`;
  }

  // --- 3D PEDESTALS PARTY GENERATION ---
  private rebuildLobby3D() {
    if (!this.isLobbyActive) return;

    // 1. Clean up old lobby objects
    this.cleanupLobby3D();

    const yCenter = this.terrain.getTerrainHeight(0, 0);
    const yLeft = this.terrain.getTerrainHeight(-1.5, -0.6);
    const yRight = this.terrain.getTerrainHeight(1.5, -0.6);

    // Pedestal disk helper
    const createPedestal = (x: number, y: number, z: number, colorHex: number) => {
      const geom = new THREE.CylinderGeometry(0.8, 0.9, 0.15, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x111622,
        roughness: 0.2,
        metalness: 0.8,
        emissive: colorHex,
        emissiveIntensity: 0.8
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, y + 0.075, z);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.engine.scene.add(mesh);
      this.lobbyPedestals.push(mesh);
    };

    // Spawn Me (Center platform)
    const myReadyColor = this.isLocalReady ? 0x33ff33 : 0x00ccff;
    createPedestal(0, yCenter, 0, myReadyColor);

    const myRunner = this.elements.buildVoxelRunner(this.getCustomizationString());
    myRunner.position.set(0, yCenter + 0.15, 0);
    this.engine.scene.add(myRunner);
    this.lobbyPlayersMeshes.push(myRunner);

    // Synchronize current local customizers details into Top Badges & Nameplates UI
    const nameInput = document.getElementById('player-name') as HTMLInputElement;
    const currentName = nameInput?.value || 'Runner_01';
    
    const headerName = document.getElementById('header-runner-lbl');
    if (headerName) headerName.innerText = currentName;
    const headerDot = document.getElementById('header-color-dot');
    if (headerDot) headerDot.style.backgroundColor = this.selectedJerseyColor;

    // Platform nameplates HUD updates
    const tagP1 = document.getElementById('tag-p1');
    const tagP2 = document.getElementById('tag-p2');
    const tagP3 = document.getElementById('tag-p3');

    if (tagP1) {
      tagP1.classList.remove('hidden');
      const tagColor = tagP1.querySelector('.tag-color-indicator') as HTMLElement;
      if (tagColor) tagColor.style.backgroundColor = this.selectedJerseyColor;
      const tagName = tagP1.querySelector('.tag-name') as HTMLElement;
      if (tagName) tagName.innerText = currentName;
      const tagStatus = tagP1.querySelector('.tag-status') as HTMLElement;
      if (tagStatus) {
        if (this.activeRoomId) {
          const isHost = this.isRoomHost();
          tagStatus.innerText = this.isLocalReady ? 'READY' : (isHost ? 'LEADER' : 'WAITING');
          if (this.isLocalReady) {
            tagP1.classList.add('ready');
          } else {
            tagP1.classList.remove('ready');
          }
        } else {
          tagStatus.innerText = 'SOLO';
          tagP1.classList.remove('ready');

          // Dynamically adjust Ready/Play button and Match details for Solo play
          const btnReadyPlay = document.getElementById('btn-ready-play') as HTMLElement;
          const msgHost = document.getElementById('wait-host-msg') as HTMLElement;
          const matchModeLabel = document.querySelector('.match-mode-label') as HTMLElement;

          if (btnReadyPlay) {
            btnReadyPlay.innerText = 'PLAY SOLO ➔';
            btnReadyPlay.className = 'btn-fortnite-play animate-pulse-glow';
          }
          if (msgHost) msgHost.classList.add('hidden');
          if (matchModeLabel) matchModeLabel.innerText = 'SOLO PRACTICE MATCH';

          const settingsSum = document.getElementById('match-settings-summary');
          if (settingsSum) {
            const selBiome = document.getElementById('sel-biome') as HTMLSelectElement;
            const biomeText = selBiome ? selBiome.options[selBiome.selectedIndex].text : 'Alpine';
            const selTime = document.getElementById('sel-time') as HTMLSelectElement;
            const timeText = selTime ? selTime.options[selTime.selectedIndex].text : 'Sunny Noon';
            const selGameMode = document.getElementById('sel-game-mode-lobby') as HTMLSelectElement;
            const modeText = selGameMode ? selGameMode.options[selGameMode.selectedIndex].text : 'Classic';
            settingsSum.innerText = `${modeText} • ${biomeText} • ${timeText}`;
          }
        }
      }
    }

    // Spawn other connected squad runners in party pedestals (Me + 2 friends)
    let extraIndex = 0;
    if (this.roomState && this.localPlayerId) {
      const playersList = Object.values(this.roomState.players).filter(p => p.id !== this.localPlayerId);
      
      playersList.forEach((p, idx) => {
        if (idx >= 2) return; // Cap 3D screen rendering to fit layout nicely

        const isLeft = (idx === 0);
        const px = isLeft ? -1.5 : 1.5;
        const pz = -0.6;
        const py = isLeft ? yLeft : yRight;

        // Visual pedestal glow matching squad
        createPedestal(px, py, pz, 0x00ccff);

        // Spawn runner model
        const runner = this.elements.buildVoxelRunner(p.skinColor);
        runner.position.set(px, py + 0.15, pz);
        
        // Tilt runner slightly toward me
        runner.rotation.y = isLeft ? 0.35 : -0.35;

        this.engine.scene.add(runner);
        this.lobbyPlayersMeshes.push(runner);

        // Update squad HTML overlays
        const tag = isLeft ? tagP2 : tagP3;
        if (tag) {
          tag.classList.remove('hidden');
          const tColor = tag.querySelector('.tag-color-indicator') as HTMLElement;
          if (tColor) tColor.style.backgroundColor = p.skinColor.split('|')[0];
          const tName = tag.querySelector('.tag-name') as HTMLElement;
          if (tName) tName.innerText = p.name;
          const tStatus = tag.querySelector('.tag-status') as HTMLElement;
          if (tStatus) tStatus.innerText = 'SQUAD';
        }
        extraIndex++;
      });
    }

    // Hide empty/inactive squad nametags
    if (extraIndex < 2) {
      if (extraIndex < 1 && tagP2) tagP2.classList.add('hidden');
      if (tagP3) tagP3.classList.add('hidden');
    }
  }

  private cleanupLobby3D() {
    this.lobbyPedestals.forEach(m => this.engine.scene.remove(m));
    this.lobbyPlayersMeshes.forEach(m => this.engine.scene.remove(m));
    this.lobbyPedestals = [];
    this.lobbyPlayersMeshes = [];
    
    // Hide squad plates
    document.getElementById('tag-p2')?.classList.add('hidden');
    document.getElementById('tag-p3')?.classList.add('hidden');
  }

  private isRoomHost(): boolean {
    if (!this.roomState) return true;
    const players = Object.values(this.roomState.players);
    return players[0]?.id === this.localPlayerId;
  }

  private initLobbyUI() {
    // Connect to WebSocket server
    this.network = new Network();

    const nameInput = document.getElementById('player-name') as HTMLInputElement;
    const roomInput = document.getElementById('new-room-id') as HTMLInputElement;
    const btnCreate = document.getElementById('btn-create-room');
    const btnLeaveRoom = document.getElementById('btn-leave-room');
    const btnPodiumClose = document.getElementById('btn-podium-close');

    // Generate random room name on startup
    if (roomInput) {
      roomInput.value = Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    // 1. Landing Screen CTA triggers
    document.getElementById('btn-enter-lobby')?.addEventListener('click', () => {
      Sound.playTick(true);
      document.getElementById('landing-screen')?.classList.add('hidden');
      document.getElementById('lobby-screen')?.classList.remove('hidden');
      this.isLobbyActive = true;
      this.rebuildLobby3D();
    });

    // 2. Soundtrack toggles
    const btnSoundtrack = document.getElementById('btn-toggle-soundtrack');
    const selSoundtrack = document.getElementById('sel-soundtrack') as HTMLSelectElement;
    
    btnSoundtrack?.addEventListener('click', () => {
      this.isSoundtrackPlaying = !this.isSoundtrackPlaying;
      if (this.isSoundtrackPlaying) {
        Sound.startSoundtrack('ambient');
        if (btnSoundtrack) btnSoundtrack.innerHTML = 'Mute Soundtrack 🔇';
        if (selSoundtrack) selSoundtrack.value = 'ambient';
      } else {
        Sound.stopSoundtrack();
        if (btnSoundtrack) btnSoundtrack.innerHTML = 'Toggle Soundtrack 🔊';
        if (selSoundtrack) selSoundtrack.value = 'none';
      }
    });

    // 3. Tab Navigation buttons click events
    const tabNames = ['play', 'locker', 'leaderboard', 'guide'];
    tabNames.forEach(tabName => {
      const tabBtn = document.getElementById(`tab-btn-${tabName}`);
      tabBtn?.addEventListener('click', () => {
        Sound.playDialClick();
        tabNames.forEach(t => {
          document.getElementById(`tab-btn-${t}`)?.classList.remove('active');
          document.getElementById(`tab-content-${t}`)?.classList.add('hidden');
          document.getElementById(`tab-content-${t}`)?.classList.remove('active');
        });
        tabBtn.classList.add('active');
        const activePane = document.getElementById(`tab-content-${tabName}`);
        activePane?.classList.remove('hidden');
        activePane?.classList.add('active');
        this.rebuildLobby3D(); // refresh pedestals
      });
    });

    // Nickname input sync change
    nameInput?.addEventListener('input', () => {
      this.rebuildLobby3D();
    });

    // Connect color picker buttons
    const colorBtns = document.querySelectorAll('.color-btn');
    colorBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        colorBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedJerseyColor = (btn as HTMLElement).dataset.color || '#ff3333';
        this.rebuildLobby3D();
      });
    });

    // Connect new character model and parameter selectors
    const selHair = document.getElementById('sel-hair-style') as HTMLSelectElement;
    const selTorso = document.getElementById('sel-torso-pattern') as HTMLSelectElement;
    const selAccessory = document.getElementById('sel-accessory') as HTMLSelectElement;
    const selBiomeLobby = document.getElementById('sel-biome') as HTMLSelectElement;
    const selTimeLobby = document.getElementById('sel-time') as HTMLSelectElement;
    const selGameModeLobby = document.getElementById('sel-game-mode-lobby') as HTMLSelectElement;

    const handleModelChange = () => {
      Sound.playDialClick();
      this.rebuildLobby3D();
    };
    selHair?.addEventListener('change', handleModelChange);
    selTorso?.addEventListener('change', handleModelChange);
    selAccessory?.addEventListener('change', handleModelChange);

    const handleLobbyParamChange = () => {
      Sound.playDialClick();
      const biome = selBiomeLobby?.value || 'alpine';
      const tod = selTimeLobby?.value as 'noon' | 'sunset' | 'night' | 'cycle' || 'noon';
      
      // Regenerate preview terrain matching selections immediately!
      if (this.terrain) {
        this.terrain.dispose();
      }
      this.terrain = new Terrain(this.engine.scene, 12345, biome);
      this.controls.setTerrain(this.terrain);
      this.engine.setTerrain(this.terrain);
      this.terrain.generateTerrainMeshes();
      this.foliage.clear();
      this.foliage.generateFoliage(this.terrain, 12345, biome);
      this.wildlife.spawnCreatures(35);
      if (tod !== 'cycle') {
        this.engine.setTimeOfDay(tod as any);
      }

      this.rebuildLobby3D();
    };
    selBiomeLobby?.addEventListener('change', handleLobbyParamChange);
    selTimeLobby?.addEventListener('change', handleLobbyParamChange);
    selGameModeLobby?.addEventListener('change', handleLobbyParamChange);

    const selEmote = document.getElementById('sel-lobby-emote') as HTMLSelectElement;
    selEmote?.addEventListener('change', () => {
      Sound.playDialClick();
      if (selEmote.value === 'jump' || selEmote.value === 'dance') {
        Sound.playLockChime();
      }
    });

    selSoundtrack?.addEventListener('change', () => {
      Sound.playDialClick();
      const track = selSoundtrack.value;
      if (track === 'none') {
        Sound.stopSoundtrack();
        this.isSoundtrackPlaying = false;
        if (btnSoundtrack) btnSoundtrack.innerHTML = 'Toggle Soundtrack 🔊';
      } else {
        Sound.startSoundtrack(track as any);
        this.isSoundtrackPlaying = true;
        if (btnSoundtrack) btnSoundtrack.innerHTML = 'Mute Soundtrack 🔇';
      }
    });

    // 4. Real-time Lobby chat hooks
    const chatInput = document.getElementById('chat-input') as HTMLInputElement;
    const btnSendChat = document.getElementById('btn-send-chat');

    const handleSendChat = () => {
      const msg = chatInput.value.trim();
      if (!msg) return;
      
      if (!this.activeRoomId) {
        // Echo solo message
        const log = document.getElementById('chat-messages-log');
        if (log) {
          const entry = document.createElement('p');
          entry.className = 'chat-system-msg';
          entry.innerText = `You: ${msg} (Join a multiplayer room to chat with others!)`;
          log.appendChild(entry);
          log.parentElement!.scrollTop = log.parentElement!.scrollHeight;
        }
        chatInput.value = '';
        Sound.playDialClick();
        return;
      }

      this.network.sendChatMessage(msg);
      chatInput.value = '';
    };

    btnSendChat?.addEventListener('click', handleSendChat);
    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSendChat();
    });

    // Sync Chat Message callbacks
    this.network.onChatMessage = (data) => {
      const log = document.getElementById('chat-messages-log');
      if (!log) return;
      const entry = document.createElement('div');
      entry.className = 'chat-msg-entry';
      entry.innerHTML = `<span class="sender" style="color: ${data.color}">${data.sender}:</span><span>${data.msg}</span>`;
      log.appendChild(entry);
      
      const parent = log.parentElement;
      if (parent) {
        parent.scrollTop = parent.scrollHeight;
      }
      Sound.playTick(false);
    };

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
            this.getCustomizationString()
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
        this.getCustomizationString()
      );
    });

    // Leave Room wait triggers
    btnLeaveRoom?.addEventListener('click', () => {
      this.network.leaveRoom();
      this.activeRoomId = null;
      this.roomState = null;
      this.isLocalReady = false;
      this.elements.clearStaticEntities();
      this.foliage.clear();
      
      document.getElementById('room-active-footer')?.classList.add('hidden');
      
      const log = document.getElementById('chat-messages-log');
      if (log) log.innerHTML = '<p class="chat-system-msg">System: Left party room. Joined public sandbox channel.</p>';
      
      this.rebuildLobby3D();
    });

    // Ready/Play button click triggers (Fortnite orange ready up button)
    const btnReadyPlay = document.getElementById('btn-ready-play');
    btnReadyPlay?.addEventListener('click', () => {
      if (!this.activeRoomId) {
        Sound.playTick(true);
        const selGameMode = document.getElementById('sel-game-mode-lobby') as HTMLSelectElement;
        const mode = selGameMode?.value || 'classic';
        if (mode === 'tutorial') {
          this.startTutorialMode();
        } else if (mode === 'relaxed') {
          this.startRelaxedMode();
        } else {
          this.startFreeplayMode();
        }
      } else {
        if (this.isRoomHost()) {
          // Host starts countdown
          this.network.startRace();
        } else {
          // Client toggles ready up status
          this.isLocalReady = !this.isLocalReady;
          this.rebuildLobby3D();
          Sound.playTick(true);
        }
      }
    });

    // Close scoreboard triggers
    btnPodiumClose?.addEventListener('click', () => {
      document.getElementById('podium-screen')?.classList.add('hidden');
      document.getElementById('lobby-screen')?.classList.remove('hidden');
      if (this.activeRoomId) {
        // Return to lobby
        this.isLobbyActive = true;
        this.rebuildLobby3D();
      } else {
        if (this.isRelaxed) {
          this.exitRelaxedMode();
        } else {
          this.isLobbyActive = true;
          this.rebuildLobby3D();
        }
      }
    });

    // In-game Exit Race Button trigger
    const btnExitRace = document.getElementById('btn-exit-race');
    btnExitRace?.addEventListener('click', () => {
      if (this.isTutorial) {
        this.exitTutorial();
      } else if (this.isFreeplay) {
        this.exitFreeplay();
      } else if (this.isRelaxed) {
        this.exitRelaxedMode();
      } else if (this.activeRoomId) {
        this.network.leaveRoom();
        this.activeRoomId = null;
        this.roomState = null;
        this.isLocalReady = false;
        this.elements.clearStaticEntities();
        this.foliage.clear();
        
        document.getElementById('room-active-footer')?.classList.add('hidden');
        document.getElementById('hud-container')?.classList.add('hidden');
        document.getElementById('lobby-screen')?.classList.remove('hidden');
        
        this.isLobbyActive = true;
        this.rebuildLobby3D();
      }
    });

    // In-game Rules & Manual guide toggles (unused but keep reference for safety)
    const btnOpenGuide = document.getElementById('btn-open-guide');
    const btnCloseGuide = document.getElementById('btn-close-guide');
    const guideDrawer = document.getElementById('guide-drawer');

    if (btnOpenGuide && guideDrawer) {
      btnOpenGuide.addEventListener('click', () => {
        guideDrawer.classList.remove('hidden');
      });
    }
    if (btnCloseGuide && guideDrawer) {
      btnCloseGuide.addEventListener('click', () => {
        guideDrawer.classList.add('hidden');
      });
    }

    // Blind Search button trigger
    const btnRelaxStart = document.getElementById('btn-relax-start');
    btnRelaxStart?.addEventListener('click', () => {
      this.startRelaxedMode();
    });

    // Lobby network callbacks
    this.network.onJoinedRoom = ({ roomId, playerId, roomState }) => {
      this.activeRoomId = roomId;
      this.localPlayerId = playerId;
      this.roomState = roomState;
      this.isLocalReady = false;

      // Reveal room active labels and sync chat
      document.getElementById('room-active-footer')?.classList.remove('hidden');
      const badge = document.getElementById('active-room-code-badge');
      if (badge) badge.innerText = `ROOM: ${roomId.toUpperCase()}`;

      const log = document.getElementById('chat-messages-log');
      if (log) {
        log.innerHTML = `<p class="chat-system-msg">System: Joined room "${roomState.name}". Chat with your party!</p>`;
      }

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

    this.rebuildLobby3D();

    const btnReadyPlay = document.getElementById('btn-ready-play') as HTMLElement;
    const msgHost = document.getElementById('wait-host-msg') as HTMLElement;

    // Update bottom match details card
    const settingsSum = document.getElementById('match-settings-summary');
    if (settingsSum) {
      settingsSum.innerText = `Classic Sequential • Seed ${this.roomState.mapSeed} • Squad of ${Object.keys(this.roomState.players).length}`;
    }

    // Host controller check (first player in grid is host)
    const isHost = this.isRoomHost();
    if (btnReadyPlay) {
      if (isHost) {
        btnReadyPlay.innerText = 'START RACE ➔';
        btnReadyPlay.className = 'btn-fortnite-play animate-pulse-glow';
        msgHost.classList.add('hidden');
      } else {
        btnReadyPlay.innerText = this.isLocalReady ? 'READY UPED [✔]' : 'READY UP';
        btnReadyPlay.className = `btn-fortnite-play ${this.isLocalReady ? 'ready-active' : ''}`;
        msgHost.classList.remove('hidden');
      }
    }
  }

  // --- MULTIPLAYER IN-GAME SESSION SYNC ---
  private syncActiveRaceState() {
    if (!this.roomState) return;

    const status = this.roomState.status;

    if (status === 'countdown' || status === 'racing') {
      // 1. Hide Lobby overlays and pedestals visual
      this.isLobbyActive = false;
      this.cleanupLobby3D();

      document.getElementById('lobby-screen')?.classList.add('hidden');
      document.getElementById('hud-container')?.classList.remove('hidden');

      // Lock mouse cursor to start racing!
      this.controls.lock();

      // Start forest wind ambience
      Sound.startWindAmbience();

      // Reset flight mode to false for fair competitive multiplayer racing!
      this.controls.isFlightMode = false;

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

  private reloadTerrainAndCourse(seed: number, course: Checkpoint[], biome: string = 'alpine') {
    // Reset path recordings
    this.playerPaths = {};
    this.pathRecordTimer = 0;
    this.activeCourse = course;

    // Dispose old terrain chunk group and materials to prevent leaks & ghost overlays
    if (this.terrain) {
      this.terrain.dispose();
    }

    // Regenerate heightfield meshes
    this.terrain = new Terrain(this.engine.scene, seed, biome);
    this.controls.setTerrain(this.terrain);
    this.engine.setTerrain(this.terrain);
    this.terrain.generateTerrainMeshes();

    // Redraw HUD compass/legend once
    this.elements.clearStaticEntities();

    // Scatter instanced foliage matching active biome
    this.foliage.generateFoliage(this.terrain, seed, biome);
    this.wildlife.spawnCreatures(35);

    // Snap local player to dry start position height
    const startHeight = this.terrain.getTerrainHeight(0, 0);
    this.controls.position.set(0, startHeight + 1.0, 0);


    // Build 3D Control flags
    course.forEach(cp => {
      const h = this.terrain.getTerrainHeight(cp.x, cp.z);
      this.elements.createControlFlag(cp, h);
    });

    // Cache topographic background overlay canvas
    this.hud.preRenderStaticMap(this.terrain, course);
  }

  private showScoreboardSummary() {
    if (!this.roomState && !this.isRelaxed) return;

    this.controls.unlock();
    
    Sound.stopWindAmbience();
    
    document.getElementById('hud-container')?.classList.add('hidden');
    document.getElementById('stamina-bar-container')?.classList.add('hidden');
    document.getElementById('relaxed-mode-banner')?.classList.add('hidden');
    document.getElementById('podium-screen')?.classList.remove('hidden');

    // Render post-race paths on podium canvas
    const canvas = document.getElementById('podium-map-canvas') as HTMLCanvasElement;
    if (canvas && this.terrain) {
      const playersMapping: { [id: string]: { name: string; skinColor: string } } = {};
      
      // Map local player details
      const localId = this.localPlayerId || 'local';
      const nameInput = document.getElementById('player-name') as HTMLInputElement;
      const activeColorBtn = document.querySelector('.color-btn.active') as HTMLElement;
      const localColor = activeColorBtn?.dataset.color || '#ff3333';
      playersMapping[localId] = {
        name: nameInput?.value || 'You',
        skinColor: localColor
      };

      // Map other runners details
      if (this.roomState) {
        for (const pid in this.roomState.players) {
          const p = this.roomState.players[pid];
          playersMapping[pid] = {
            name: p.name,
            skinColor: p.skinColor.split('|')[0]
          };
        }
      }

      this.hud.drawTracksOnCanvas(canvas, this.playerPaths, playersMapping);
      
      // Dynamically populate map legend in podium panel
      const legendEl = document.getElementById('podium-map-legend');
      if (legendEl) {
        legendEl.innerHTML = '';
        for (const pid in this.playerPaths) {
          const info = playersMapping[pid] || { name: 'Runner', skinColor: '#00ccff' };
          const legendItem = document.createElement('span');
          legendItem.className = 'legend-item';
          legendItem.innerHTML = `<span class="legend-dot" style="background:${info.skinColor}; display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:4px;"></span>${info.name}`;
          legendEl.appendChild(legendItem);
        }
      }
    }

    const tbody = document.getElementById('podium-tbody') as HTMLElement;
    tbody.innerHTML = '';

    if (this.roomState) {
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
    } else {
      // Single-player Relaxed mode result
      const tr = document.createElement('tr');
      tr.className = 'is-me-row';
      const nameInput = document.getElementById('player-name') as HTMLInputElement;
      tr.innerHTML = `
        <td class="rank-cell">#1</td>
        <td style="font-weight:bold">${nameInput?.value || 'You'}</td>
        <td>1 / 1</td>
        <td style="font-family:var(--font-mono); font-weight:bold;">COMPLETED 🧭</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // --- GAME MODE: INTERACTIVE TUTORIAL STATE MACHINE ---
  private startTutorialMode() {
    this.isTutorial = true;
    this.isFreeplay = false;
    this.controls.isFlightMode = false;
    this.tutorialStep = 1;

    this.isLobbyActive = false;
    this.cleanupLobby3D();

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

    // Start wind ambience
    Sound.startWindAmbience();

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
    this.foliage.clear();

    Sound.stopWindAmbience();

    document.getElementById('hud-container')?.classList.add('hidden');
    document.getElementById('stamina-bar-container')?.classList.add('hidden');
    document.getElementById('relaxed-mode-banner')?.classList.add('hidden');
    document.getElementById('tutorial-box')?.classList.add('hidden');
    document.getElementById('leaderboard-panel')?.classList.remove('hidden');
    document.getElementById('lobby-screen')?.classList.remove('hidden');

    this.isLobbyActive = true;
    this.rebuildLobby3D();
  }

  // --- GAME MODE: FREEPLAY SANDBOX ---
  private startFreeplayMode() {
    this.isFreeplay = true;
    this.isTutorial = false;
    this.controls.isFlightMode = false;

    this.isLobbyActive = false;
    this.cleanupLobby3D();

    this.rogainePunchedCps = [];
    this.rogainePoints = 0;
    this.relaxedStartTime = Date.now(); // Store start time for splits and Rogaine time limits

    // Load random freeplay seed (seed = random)
    const seed = Math.floor(Math.random() * 1000000);
    
    // Matured freeplay course matching the 5-point checkpoints + 1 Finish checkpoint
    const course = [
      { id: 1, code: '31', x: 40, z: -30, description: 'Boulder, West side' },
      { id: 2, code: '32', x: -80, z: 70, description: 'Gully, upper part' },
      { id: 3, code: '33', x: 60, z: 80, description: 'Spur, foot of slope' },
      { id: 4, code: '34', x: -100, z: -80, description: 'Thicket, South edge' },
      { id: 5, code: '35', x: 20, z: -100, description: 'Hill, top' },
      { id: 6, code: 'F', x: 0, z: 10, description: 'Finish banner' }
    ];

    const selBiomeLobby = document.getElementById('sel-biome') as HTMLSelectElement;
    if (selBiomeLobby) this.activeBiome = selBiomeLobby.value;

    const selGameMode = document.getElementById('sel-game-mode-lobby') as HTMLSelectElement;
    this.isRogaine = selGameMode ? (selGameMode.value === 'rogaine') : false;

    // Toggle score HUD panels on freeplay reload
    const scoreCounterContainer = document.getElementById('score-counter-container');
    const rogaineTimerContainer = document.getElementById('rogaine-timer-container');
    if (this.isRogaine) {
      scoreCounterContainer?.classList.remove('hidden');
      rogaineTimerContainer?.classList.remove('hidden');
      const scoreVal = document.getElementById('score-val');
      if (scoreVal) scoreVal.innerText = '0';
    } else {
      scoreCounterContainer?.classList.add('hidden');
      rogaineTimerContainer?.classList.add('hidden');
    }

    document.getElementById('lobby-screen')?.classList.add('hidden');
    document.getElementById('hud-container')?.classList.remove('hidden');
    document.getElementById('freeplay-drawer')?.classList.remove('hidden');
    document.getElementById('btn-toggle-options')?.classList.remove('hidden');

    this.reloadTerrainAndCourse(seed, course, this.activeBiome);
    this.hud.updateECard(course, []);

    // Start wind ambience
    Sound.startWindAmbience();

    // Snap player
    const startHeight = this.terrain.getTerrainHeight(0, 0);
    this.controls.position.set(0, startHeight + 1.0, 0);

    this.controls.lock();

    // Hook sandbox sliders/options
    const selTime = document.getElementById('sel-time') as HTMLSelectElement;
    const selBiome = document.getElementById('sel-biome') as HTMLSelectElement;
    const selGameModeOpt = document.getElementById('sel-game-mode-ingame') as HTMLSelectElement;
    const rngFog = document.getElementById('rng-fog') as HTMLInputElement;
    const chkFly = document.getElementById('chk-fly') as HTMLInputElement;
    const chkRain = document.getElementById('chk-rain') as HTMLInputElement;
    const btnExit = document.getElementById('btn-exit-freeplay');

    const selMapView = document.getElementById('sel-map-view') as HTMLSelectElement;
    if (selMapView) {
      selMapView.value = this.mapDisplayMode;
      selMapView.onchange = () => {
        this.mapDisplayMode = selMapView.value as '2d' | '3d';
        this.syncMapViewMode();
      };
    }

    if (selGameModeOpt) {
      selGameModeOpt.value = this.isRogaine ? 'rogaine' : 'classic';
      selGameModeOpt.onchange = () => {
        this.isRogaine = (selGameModeOpt.value === 'rogaine');
        this.rogainePunchedCps = [];
        this.rogainePoints = 0;

        // Sync back to lobby selector for robustness
        const selLobby = document.getElementById('sel-game-mode-lobby') as HTMLSelectElement;
        if (selLobby) selLobby.value = selGameModeOpt.value;

        // Toggle Score Overlay HUD
        const scoreCounterContainer = document.getElementById('score-counter-container');
        const rogaineTimerContainer = document.getElementById('rogaine-timer-container');
        if (this.isRogaine) {
          scoreCounterContainer?.classList.remove('hidden');
          rogaineTimerContainer?.classList.remove('hidden');
          const scoreVal = document.getElementById('score-val');
          if (scoreVal) scoreVal.innerText = '0';
        } else {
          scoreCounterContainer?.classList.add('hidden');
          rogaineTimerContainer?.classList.add('hidden');
        }

        this.reloadTerrainAndCourse(seed, course, this.activeBiome);
        const startHeight = this.terrain.getTerrainHeight(0, 0);
        this.controls.position.set(0, startHeight + 1.0, 0);
      };
    }

    if (chkRain) {
      chkRain.checked = this.controls.isRaining;
      chkRain.onchange = () => {
        const active = chkRain.checked;
        this.controls.isRaining = active;
        this.engine.setRainActive(active);
      };
    }

    if (selBiome) {
      selBiome.value = this.activeBiome;
      selBiome.onchange = () => {
        this.activeBiome = selBiome.value;
        this.reloadTerrainAndCourse(seed, course, this.activeBiome);
        const startHeight = this.terrain.getTerrainHeight(0, 0);
        this.controls.position.set(0, startHeight + 1.0, 0);
      };
    }

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
    
    chkFly.checked = this.controls.isFlightMode;
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

    this.mapDisplayMode = '2d';
    this.syncMapViewMode();
    const selMapView = document.getElementById('sel-map-view') as HTMLSelectElement;
    if (selMapView) selMapView.value = '2d';
    
    if (this.headlamp) {
      this.engine.scene.remove(this.headlamp);
      this.headlamp = null;
    }

    // Restore standard day ambient lighting
    this.engine.setTimeOfDay('noon');
    this.engine.setRainActive(false);
    this.controls.isRaining = false;
    const chkRain = document.getElementById('chk-rain') as HTMLInputElement;
    if (chkRain) chkRain.checked = false;

    this.elements.clearStaticEntities();
    this.foliage.clear();

    Sound.stopWindAmbience();

    document.getElementById('hud-container')?.classList.add('hidden');
    document.getElementById('stamina-bar-container')?.classList.add('hidden');
    document.getElementById('relaxed-mode-banner')?.classList.add('hidden');
    document.getElementById('score-counter-container')?.classList.add('hidden');
    document.getElementById('rogaine-timer-container')?.classList.add('hidden');
    document.getElementById('freeplay-drawer')?.classList.add('hidden');
    document.getElementById('btn-toggle-options')?.classList.add('hidden');
    document.getElementById('lobby-screen')?.classList.remove('hidden');

    this.isLobbyActive = true;
    this.rebuildLobby3D();
  }

  private startRelaxedMode() {
    this.isRelaxed = true;
    this.isTutorial = false;
    this.isFreeplay = false;
    this.controls.isFlightMode = false;

    this.isLobbyActive = false;
    this.cleanupLobby3D();

    this.relaxedStartTime = Date.now();

    // 1. Generate random seed
    const seed = Math.floor(Math.random() * 1000000);
    
    // 2. Hide a target flag 50m to 80m away at a random angle
    const angle = Math.random() * Math.PI * 2;
    const dist = 50.0 + Math.random() * 30.0;
    const targetX = Math.round(Math.cos(angle) * dist);
    const targetZ = Math.round(Math.sin(angle) * dist);

    const course: Checkpoint[] = [
      { id: 1, code: '99', x: targetX, z: targetZ, description: 'Hidden Search Feature' }
    ];

    // 3. Clear lobby & load wilderness
    document.getElementById('lobby-screen')?.classList.add('hidden');
    document.getElementById('hud-container')?.classList.remove('hidden');
    document.getElementById('relaxed-mode-banner')?.classList.remove('hidden');
    document.getElementById('leaderboard-panel')?.classList.add('hidden');

    this.reloadTerrainAndCourse(seed, course);
    this.hud.updateECard(course, []);
    this.hud.forceHideGps = true;

    // 4. Position player & lock
    const startHeight = this.terrain.getTerrainHeight(0, 0);
    this.controls.position.set(0, startHeight + 1.0, 0);
    this.controls.lock();

    Sound.startWindAmbience();
  }

  private exitRelaxedMode() {
    this.isRelaxed = false;
    this.controls.unlock();

    Sound.stopWindAmbience();

    this.hud.forceHideGps = false;
    this.elements.clearStaticEntities();
    this.foliage.clear();

    document.getElementById('hud-container')?.classList.add('hidden');
    document.getElementById('stamina-bar-container')?.classList.add('hidden');
    document.getElementById('relaxed-mode-banner')?.classList.add('hidden');
    document.getElementById('leaderboard-panel')?.classList.remove('hidden');
    document.getElementById('lobby-screen')?.classList.remove('hidden');

    this.isLobbyActive = true;
    this.rebuildLobby3D();
  }

  // --- CORE TICK UPDATE LOOP INTERACTION ---
  public update(delta: number) {
    if (!this.network || !this.controls || !this.elements || !this.hud || !this.terrain) return;

    if (this.isLobbyActive) {
      // 1. Slow cinematic orbit camera sway around the party squad pedestals
      const yCenter = this.terrain.getTerrainHeight(0, 0);
      const angle = Date.now() * 0.00045;
      this.engine.camera.position.set(Math.sin(angle) * 0.7, yCenter + 1.8 + Math.sin(angle * 2) * 0.1, 3.2 + Math.cos(angle) * 0.4);
      this.engine.camera.lookAt(new THREE.Vector3(0, yCenter + 1.15, -0.3));

      // Real-time day/night cycle progression inside Lobby
      const selTime = document.getElementById('sel-time') as HTMLSelectElement;
      if (selTime && selTime.value === 'cycle') {
        const cycleProgress = (Date.now() * 0.00003) % 3;
        const times: ('noon' | 'sunset' | 'night')[] = ['noon', 'sunset', 'night'];
        const activeIdx = Math.floor(cycleProgress);
        const activeTime = times[activeIdx];
        
        if (this.activeTimeOfDayState !== activeTime) {
          this.activeTimeOfDayState = activeTime;
          this.engine.setTimeOfDay(activeTime);
        }
      }

      // Rotate and animate player models slowly based on active Locker emotes!
      const myMesh = this.lobbyPlayersMeshes[0];
      if (myMesh) {
        const uData = myMesh.userData;
        const time = Date.now() * 0.001;
        const selEmote = document.getElementById('sel-lobby-emote') as HTMLSelectElement;
        const activeEmote = selEmote ? selEmote.value : 'none';

        // Base limb defaults
        if (uData.leftLeg) uData.leftLeg.rotation.x = 0;
        if (uData.rightLeg) uData.rightLeg.rotation.x = 0;
        if (uData.leftArm) {
          uData.leftArm.rotation.x = 0;
          uData.leftArm.rotation.z = 0;
        }
        if (uData.rightArm) {
          uData.rightArm.rotation.x = 0;
          uData.rightArm.rotation.z = 0;
        }
        myMesh.position.y = yCenter + 0.15; // default height

        if (activeEmote === 'wave') {
          myMesh.rotation.y += 0.85 * delta;
          if (uData.rightArm) {
            uData.rightArm.rotation.z = 2.4; // raise right arm
            uData.rightArm.rotation.x = Math.sin(time * 10.0) * 0.45; // wave motion
          }
        } else if (activeEmote === 'jump') {
          // Jump and spin!
          const jumpCycle = time * 4.5;
          const jumpHeight = Math.max(0, Math.sin(jumpCycle)) * 0.45;
          myMesh.position.y = yCenter + 0.15 + jumpHeight;
          myMesh.rotation.y += 6.8 * delta; // rapid spin!

          const spread = jumpHeight > 0.05 ? 0.35 : 0.0;
          if (uData.leftLeg) uData.leftLeg.rotation.z = spread;
          if (uData.rightLeg) uData.rightLeg.rotation.z = -spread;
          if (uData.leftArm) uData.leftArm.rotation.z = spread;
          if (uData.rightArm) uData.rightArm.rotation.z = -spread;
        } else if (activeEmote === 'dance') {
          // Hip-sway dance
          const sway = Math.sin(time * 6.0);
          myMesh.rotation.y += sway * 0.45 * delta;
          
          if (uData.leftArm) uData.leftArm.rotation.x = sway * 0.8;
          if (uData.rightArm) uData.rightArm.rotation.x = -sway * 0.8;
          if (uData.leftLeg) uData.leftLeg.rotation.x = -sway * 0.45;
          if (uData.rightLeg) uData.rightLeg.rotation.x = sway * 0.45;
        } else {
          // Stand tall with standard slow rotation
          myMesh.rotation.y += 0.85 * delta;
        }
      }

      // Animate instanced foliage and terrain background visuals
      const time = Date.now() * 0.001;
      this.foliage.update(time);
      this.terrain.update(time);
      return;
    }

    const serverTime = this.isTutorial || this.isFreeplay 
      ? Date.now() 
      : this.network.getServerTime();

    // 1. Update player physics/positions
    this.controls.update(delta);

    // Record player paths for post-race analysis
    const isRacingState = (this.activeRoomId && this.roomState && this.roomState.status === 'racing') || this.isFreeplay || this.isTutorial;
    if (isRacingState) {
      this.pathRecordTimer += delta;
      if (this.pathRecordTimer >= 0.25) { // record every 250ms
        this.pathRecordTimer = 0;
        
        // Local player path
        const localId = this.localPlayerId || 'local';
        if (!this.playerPaths[localId]) this.playerPaths[localId] = [];
        this.playerPaths[localId].push({ x: this.controls.position.x, z: this.controls.position.z });

        // Other players paths
        if (this.roomState) {
          for (const pid in this.roomState.players) {
            if (pid === this.localPlayerId) continue;
            const other = this.roomState.players[pid];
            if (!this.playerPaths[pid]) this.playerPaths[pid] = [];
            this.playerPaths[pid].push({ x: other.x, z: other.z });
          }
        }
      }
    }

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

    // In-game dynamic day/night cycle progression
    const selTime = document.getElementById('sel-time') as HTMLSelectElement;
    if (selTime && selTime.value === 'cycle') {
      const cycleProgress = (Date.now() * 0.00003) % 3;
      const times: ('noon' | 'sunset' | 'night')[] = ['noon', 'sunset', 'night'];
      const activeIdx = Math.floor(cycleProgress);
      const activeTime = times[activeIdx];
      
      if (this.activeTimeOfDayState !== activeTime) {
        this.activeTimeOfDayState = activeTime;
        this.engine.setTimeOfDay(activeTime);
        
        // Dynamically toggle night flashlight spot!
        if (activeTime === 'night') {
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
      }
    }

    // 2. Broadcast position to server if in active lobby
    if (this.activeRoomId && this.roomState && this.roomState.status === 'racing') {
      const isMoving = this.controls.getSpeedFactor() > 0.05;
      const anim = this.isSwimming ? 'swim' : (isMoving ? 'run' : 'idle');
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

    // Animate instanced foliage swaying and water surface ripples
    const time = Date.now() * 0.001;
    this.foliage.update(time, this.controls.position);
    this.terrain.update(time, this.controls.position);

    // Sync locally tracked swimming state
    this.isSwimming = (this.terrain.getTerrainType(this.controls.position.x, this.controls.position.z) === 'water');

    // 4. Update HUD panel metrics (Compass Rose + 2D map canvas)
    const yaw = this.controls.getRotation().rx;

    // Sync 3D Handheld raising/lowering and visual alignments
    if (this.handheldGroup) {
      const mapPanel = document.getElementById('map-panel');
      const isMapOpen = mapPanel && !mapPanel.classList.contains('hidden');
      
      this.is3DMapOpen = !!isMapOpen;

      const targetY = (this.is3DMapOpen && this.mapDisplayMode === '3d') ? 0.0 : -1.5;
      this.handheldGroup.position.y += (targetY - this.handheldGroup.position.y) * 8.0 * delta;

      // Update visibility of 3D meshes to avoid occlusion when closed
      this.handheldGroup.visible = (this.handheldGroup.position.y > -1.45);

      if (this.handheldGroup.visible) {
        // Rotate 3D Magnetic Needle (stays aligned with absolute North)
        if (this.handheldNeedle) {
          this.handheldNeedle.rotation.y = -yaw;
        }

        // Rotate 3D Bezel Ring (Silva Orienting Arrow)
        if (this.handheldBezelRing) {
          this.handheldBezelRing.rotation.y = this.hud.bezelAngle;
        }

        // Flag dynamic canvas texture upload to GPU
        if (this.handheldMapTexture) {
          this.handheldMapTexture.needsUpdate = true;
        }
      }
    }

    // Manual Bezel Rotation key hooks ([ / ])
    if (this.keysPressed['BracketLeft']) {
      this.hud.bezelAngle -= 1.8 * delta;
      this.bezelClickTimer -= delta;
      if (this.bezelClickTimer <= 0) {
        Sound.playDialClick();
        this.bezelClickTimer = 0.07;
      }
    } else if (this.keysPressed['BracketRight']) {
      this.hud.bezelAngle += 1.8 * delta;
      this.bezelClickTimer -= delta;
      if (this.bezelClickTimer <= 0) {
        Sound.playDialClick();
        this.bezelClickTimer = 0.07;
      }
    } else {
      this.bezelClickTimer = 0.0;
    }
    const speedFactor = this.controls.getSpeedFactor();
    const isGrounded = this.controls.getIsGrounded();
    this.hud.updateCompass(yaw, delta, speedFactor, isGrounded, this.controls.isExhausted);

    // Update procedural wildlife positions
    if (this.wildlife) {
      this.wildlife.update(delta, this.controls.position);
    }

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

    // Rhythmic heavy breathing sound triggers dynamically based on exhaustion heart-rate levels
    const needsBreathing = (this.controls.isExhausted || this.controls.stamina < 55.0) && !this.isTutorial && !this.controls.isFlightMode;
    if (needsBreathing) {
      this.breathingTimer += delta;
      
      // Calculate heart-rate breathing tempo factor (0.0 = exhausted/full pulse, 1.0 = moderately tired)
      const staminaFactor = Math.max(0.0, Math.min(1.0, (this.controls.stamina - 30.0) / 25.0));
      const breathingInterval = 0.85 + staminaFactor * 0.75; // Ranges dynamically from 0.85s to 1.60s
      
      if (this.breathingTimer >= breathingInterval) {
        this.breathingTimer = 0.0;
        Sound.playSingleBreath(staminaFactor);
        
        // Spawn stamina condensation vapor puffs in cold weather
        this.spawnBreathPuff();
      }
    } else {
      this.breathingTimer = 0.0;
    }

    const otherState = this.roomState ? this.roomState.players : {};
    this.hud.updateMapHUD(
      this.terrain.getMapSize(),
      this.controls.position.x,
      this.controls.position.z,
      yaw,
      otherState
    );

    // Draw Dynamic Mini-map and Top Sliding Compass strip
    const courseData = this.getActiveCourseAndPunched();
    this.hud.updateMinimap(
      this.terrain.getMapSize(),
      this.controls.position.x,
      this.controls.position.z,
      yaw,
      courseData.course,
      courseData.punched,
      otherState
    );
    this.hud.drawCompassStrip(yaw);

    // 5. Proximity triggers (Checkpoint punches range verification)
    this.evaluateCheckpointProximity();

    // 6. Manage race clock ticks and scoreboard sorting
    if (this.roomState) {
      this.hud.updateTimers(this.roomState.status, this.roomState.startTime, serverTime);
      this.hud.updateLeaderboard(this.roomState.scoreboard, this.localPlayerId);
    } else if (this.isRelaxed) {
      this.hud.updateTimers('racing', this.relaxedStartTime, serverTime);
    } else if (this.isFreeplay) {
      // Offline Sandbox Race Timer
      this.hud.updateTimers('racing', this.relaxedStartTime, serverTime);

      // Rogaine Score mode real-time countdown progress and penalties
      if (this.isRogaine) {
        const elapsedSecs = (Date.now() - this.relaxedStartTime) / 1000;
        const remaining = Math.max(0, 120 - elapsedSecs);
        
        const timerFill = document.getElementById('rogaine-timer-fill');
        if (timerFill) {
          const pct = (remaining / 120) * 100;
          timerFill.style.width = `${pct}%`;
          
          if (remaining <= 0) {
            timerFill.style.background = '#ff3333'; // warning red
            
            const exceeded = elapsedSecs - 120;
            const penalty = Math.ceil(exceeded / 10) * 10;
            const scoreVal = document.getElementById('score-val');
            if (scoreVal) {
              scoreVal.innerHTML = `${Math.max(0, this.rogainePoints - penalty)} <span style="color: #ff3333; font-size: 0.75rem;">(Penalty -${penalty})</span>`;
            }
          } else {
            timerFill.style.background = '#ffaa00';
          }
        }
      }
    }

    // 7. Tutorial triggers checks
    this.evaluateTutorialTriggers();

    // 8. Update breath vapor puffs physics
    this.updateBreathPuffs(delta);
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
      activeCourse = this.activeCourse;
      punchedCps = this.isRogaine ? this.rogainePunchedCps : [];
    } else if (this.isRelaxed) {
      activeCourse = this.activeCourse;
      punchedCps = this.relaxedPunchedCps;
    } else if (this.roomState && this.localPlayerId) {
      activeCourse = this.roomState.course;
      punchedCps = this.roomState.players[this.localPlayerId].punchedCheckpoints;
    }

    if (activeCourse.length === 0) {
      this.hud.hideActionPrompt();
      return;
    }

    if (this.isRogaine) {
      let nearCpIndex = -1;
      for (let i = 0; i < activeCourse.length; i++) {
        if (punchedCps.includes(i)) continue;
        
        const cp = activeCourse[i];
        const dx = this.controls.position.x - cp.x;
        const dz = this.controls.position.z - cp.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist <= 3.0) {
          nearCpIndex = i;
          break;
        }
      }

      if (nearCpIndex !== -1) {
        const targetCp = activeCourse[nearCpIndex];
        this.hud.showActionPrompt(targetCp.code, true);

        if (this.keysPressed['KeyE']) {
          this.keysPressed['KeyE'] = false; // consume input
          this.executePunchAction(nearCpIndex);
        }
      } else {
        this.hud.hideActionPrompt();
      }
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
      if (this.isRogaine) {
        if (this.rogainePunchedCps.includes(index)) return;
        this.rogainePunchedCps.push(index);
        this.hud.updateECard(this.activeCourse, this.rogainePunchedCps);

        const cp = this.activeCourse[index];
        if (cp.code === 'F') {
          // Finish banner!
          Sound.playPunch();
          
          // Calculate time overrun penalty: limit is 120 seconds
          const elapsedSecs = (Date.now() - this.relaxedStartTime) / 1000;
          if (elapsedSecs > 120) {
            const exceeded = elapsedSecs - 120;
            const penalty = Math.ceil(exceeded / 10) * 10;
            this.rogainePoints = Math.max(0, this.rogainePoints - penalty);
            const scoreVal = document.getElementById('score-val');
            if (scoreVal) scoreVal.innerText = `${this.rogainePoints} (Penalty -${penalty})`;
          }
          
          this.hud.triggerPunchAlert('F', 'Finish banner', Date.now() - this.relaxedStartTime);
          this.controls.unlock();
          
          // Generate a fake multiplayer scoreboard entry to show on podium screen
          this.roomState = {
            id: 'freeplay',
            name: 'Sandbox Rogaine',
            players: {
              local: {
                id: 'local',
                name: 'Runner (You)',
                x: this.controls.position.x,
                y: this.controls.position.y,
                z: this.controls.position.z,
                rx: 0,
                ry: 0,
                anim: 'idle',
                skinColor: '#ffaa00',
                punchedCheckpoints: this.rogainePunchedCps
              }
            },
            status: 'finished',
            mapSeed: 123,
            startTime: this.relaxedStartTime,
            course: this.activeCourse,
            scoreboard: {
              local: {
                id: 'local',
                name: 'Runner (You)',
                finished: true,
                elapsed: Date.now() - this.relaxedStartTime,
                splits: this.rogainePunchedCps.map(() => Date.now() - this.relaxedStartTime) // mock splits
              }
            }
          };

          setTimeout(() => {
            this.showScoreboardSummary();
          }, 1200);
        } else {
          // Punching a regular control checkpoint flag!
          Sound.playPunch();
          this.elements.flashFlagGreen(cp.id);
          
          const pts = (parseInt(cp.code) - 30) * 10;
          this.rogainePoints += pts;
          
          const scoreVal = document.getElementById('score-val');
          if (scoreVal) scoreVal.innerText = this.rogainePoints.toString();
          
          this.hud.triggerPunchAlert(cp.code, cp.description, Date.now() - this.relaxedStartTime);
        }
      } else {
        // Classic sequential freeplay
        Sound.playPunch();
      }
    } else if (this.isRelaxed) {
      Sound.playPunch();
      this.relaxedPunchedCps.push(0);
      this.hud.updateECard(this.activeCourse, this.relaxedPunchedCps);
      this.hud.triggerPunchAlert('99', 'Hidden Search Feature', Date.now() - this.relaxedStartTime);
      this.controls.unlock();
      setTimeout(() => {
        this.showScoreboardSummary();
      }, 1200);
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

  // --- 3D HANDHELD MAP & COMPASS INITIALIZATION ---
  private init3DHandheldObjects() {
    this.handheldGroup = new THREE.Group();
    // Start collapsed below view
    this.handheldGroup.position.set(0, -1.5, 0);
    this.engine.camera.add(this.handheldGroup);

    // 1. 3D Map Sheet Mesh (Canvas Texture)
    const mapGeom = new THREE.PlaneGeometry(0.35, 0.35);
    const mapMat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      toneMapped: false // keep exact IOF map colors under filmic tone mapping
    });
    
    // Canvas texture linked to active map HUD canvas
    this.handheldMapTexture = new THREE.CanvasTexture(this.hud.mapCanvas);
    this.handheldMapTexture.colorSpace = THREE.SRGBColorSpace;
    mapMat.map = this.handheldMapTexture;

    this.handheldMapMesh = new THREE.Mesh(mapGeom, mapMat);
    // Tilted beautifully in left handheld viewport space
    this.handheldMapMesh.position.set(-0.16, -0.22, -0.42);
    this.handheldMapMesh.rotation.set(-0.6, 0.3, 0.1);
    this.handheldGroup.add(this.handheldMapMesh);

    // 2. 3D Compass Capsule Mesh Group
    this.handheldCompassGroup = new THREE.Group();
    this.handheldCompassGroup.position.set(0.16, -0.24, -0.42);
    this.handheldCompassGroup.rotation.set(-0.6, -0.3, -0.1);
    this.handheldGroup.add(this.handheldCompassGroup);

    // A. Metal Casing
    const caseGeom = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 16);
    const caseMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      metalness: 0.82,
      roughness: 0.2
    });
    const compassCase = new THREE.Mesh(caseGeom, caseMat);
    compassCase.rotation.x = Math.PI / 2;
    this.handheldCompassGroup.add(compassCase);

    // B. Rotatable Bezel Ring
    this.handheldBezelRing = new THREE.Group();
    this.handheldBezelRing.position.y = 0.007; // On top of base
    this.handheldCompassGroup.add(this.handheldBezelRing);

    const ringGeom = new THREE.CylinderGeometry(0.046, 0.046, 0.004, 16);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x1f1f1f,
      roughness: 0.8
    });
    const bezelRingMesh = new THREE.Mesh(ringGeom, ringMat);
    bezelRingMesh.rotation.x = Math.PI / 2;
    this.handheldBezelRing.add(bezelRingMesh);

    // Yellow orienting arrow on bezel
    const indicatorGeom = new THREE.BoxGeometry(0.004, 0.002, 0.024);
    const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, toneMapped: false });
    const indicator = new THREE.Mesh(indicatorGeom, indicatorMat);
    indicator.position.set(0, 0.003, -0.026);
    this.handheldBezelRing.add(indicator);

    // C. Glass capsule cover
    const glassGeom = new THREE.CylinderGeometry(0.040, 0.040, 0.002, 16);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      roughness: 0.1
    });
    const glassCover = new THREE.Mesh(glassGeom, glassMat);
    glassCover.position.y = 0.009;
    glassCover.rotation.x = Math.PI / 2;
    this.handheldCompassGroup.add(glassCover);

    // D. 3D Magnetic Needle Dial
    this.handheldNeedle = new THREE.Group();
    this.handheldNeedle.position.y = 0.004; // inside capsule
    this.handheldCompassGroup.add(this.handheldNeedle);

    // North Pointer (Red Cone)
    const needleNorthGeom = new THREE.ConeGeometry(0.005, 0.032, 4);
    const needleNorthMat = new THREE.MeshBasicMaterial({ color: 0xff3333, toneMapped: false });
    const needleNorth = new THREE.Mesh(needleNorthGeom, needleNorthMat);
    needleNorth.position.z = -0.016;
    needleNorth.rotation.x = Math.PI / 2;
    this.handheldNeedle.add(needleNorth);

    // South Pointer (White Cone)
    const needleSouthGeom = new THREE.ConeGeometry(0.005, 0.032, 4);
    const needleSouthMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const needleSouth = new THREE.Mesh(needleSouthGeom, needleSouthMat);
    needleSouth.position.z = 0.016;
    needleSouth.rotation.x = -Math.PI / 2;
    this.handheldNeedle.add(needleSouth);
  }

  // Synchronize 2D flat panel overlays and 3D raising animations
  private syncMapViewMode() {
    const mapPanel = document.getElementById('map-panel');
    if (!mapPanel) return;

    if (this.mapDisplayMode === '3d') {
      mapPanel.style.visibility = 'hidden';
    } else {
      mapPanel.style.visibility = 'visible';
      this.is3DMapOpen = false;
    }
  }

  // Spawn dynamic white condensation stamina vapor puffs
  private spawnBreathPuff() {
    const todSelect = document.getElementById('sel-time') as HTMLSelectElement;
    const isNight = todSelect ? (todSelect.value === 'night') : false;
    const isCold = this.controls.isRaining || isNight;
    
    if (!isCold) return;

    const puffGeom = new THREE.SphereGeometry(0.04, 5, 5);
    const puffMat = new THREE.MeshBasicMaterial({
      color: 0xeeeeee,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });
    
    const mesh = new THREE.Mesh(puffGeom, puffMat);
    
    const pos = this.engine.camera.position.clone();
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.engine.camera.quaternion);
    
    pos.addScaledVector(lookDir, 0.45); // mouth forward distance
    pos.y -= 0.15; // mouth vertical height
    mesh.position.copy(pos);
    
    this.engine.scene.add(mesh);
    
    // Random velocity drift
    const vel = lookDir.clone()
      .multiplyScalar(0.42)
      .add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.08,
        0.22 + Math.random() * 0.12,
        (Math.random() - 0.5) * 0.08
      ));
      
    this.breathPuffs.push({
      mesh,
      vel,
      age: 0.0,
      maxAge: 1.2 + Math.random() * 0.4
    });
  }

  // Update scale drift and disposals of vapor meshes
  private updateBreathPuffs(delta: number) {
    for (let i = this.breathPuffs.length - 1; i >= 0; i--) {
      const puff = this.breathPuffs[i];
      puff.age += delta;
      
      if (puff.age >= puff.maxAge) {
        this.engine.scene.remove(puff.mesh);
        puff.mesh.geometry.dispose();
        (puff.mesh.material as THREE.Material).dispose();
        this.breathPuffs.splice(i, 1);
      } else {
        puff.mesh.position.addScaledVector(puff.vel, delta);
        
        const scale = 1.0 + (puff.age / puff.maxAge) * 4.5;
        puff.mesh.scale.set(scale, scale, scale);
        
        const mat = puff.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.35 * (1.0 - puff.age / puff.maxAge);
      }
    }
  }

  private getActiveCourseAndPunched(): { course: Checkpoint[]; punched: number[] } {
    let course: Checkpoint[] = [];
    let punched: number[] = [];

    if (this.roomState) {
      course = this.roomState.course;
      const localP = this.roomState.players[this.localPlayerId || ''];
      if (localP) {
        punched = localP.punchedCheckpoints || [];
      }
    } else {
      course = this.activeCourse || [];
      if (this.isRelaxed) {
        punched = this.relaxedPunchedCps || [];
      } else if (this.isFreeplay) {
        punched = [];
      } else {
        punched = this.rogainePunchedCps || [];
      }
    }
    return { course, punched };
  }
}


// Start application
const app = new WebteeringApp();
app.initKeyboardTriggerListener();
export {};
