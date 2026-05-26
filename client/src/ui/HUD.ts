import { Checkpoint, PlayerState } from '../sharedTypes';
import { Sound } from './Sound';

export class HUD {
  // Elements
  private timerEl = document.getElementById('race-timer') as HTMLElement;
  private statusMsgEl = document.getElementById('status-msg') as HTMLElement;
  
  private ecardPanel = document.getElementById('checkpoint-punch-list') as HTMLElement;
  private leaderboardPanel = document.getElementById('leaderboard-entries') as HTMLElement;
  
  private compassRose = document.getElementById('compass-rose') as HTMLElement;
  
  private actionPrompt = document.getElementById('action-prompt') as HTMLElement;
  private promptMsg = document.getElementById('prompt-msg') as HTMLElement;
  
  private punchAlert = document.getElementById('punch-alert') as HTMLElement;
  
  private mapCanvas = document.getElementById('topo-map-canvas') as HTMLCanvasElement;
  private mapCtx!: CanvasRenderingContext2D;
  private offscreenMapCanvas!: HTMLCanvasElement;
  
  // Game states references
  private activeTargetIndex = 0;
  private gpsEnabled = true;

  // Compass rotational spring-mass needle physics
  private needleAngle = 0.0;
  private needleVelocity = 0.0;

  // Realistic map rotation parameters
  public mapMode: 'north' | 'heading' | 'manual' = 'north';
  public manualMapAngle = 0.0;

  constructor() {
    this.mapCtx = this.mapCanvas.getContext('2d')!;
    this.offscreenMapCanvas = document.createElement('canvas');
    
    this.initMapToggles();
  }

  private initMapToggles() {
    const btnToggle = document.getElementById('btn-toggle-map');
    const btnClose = document.getElementById('btn-close-map');
    const mapPanel = document.getElementById('map-panel');

    const toggle = () => {
      if (mapPanel) mapPanel.classList.toggle('hidden');
    };

    if (btnToggle) btnToggle.addEventListener('click', toggle);
    if (btnClose) btnClose.addEventListener('click', toggle);

    // M key keyboard toggle
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        toggle();
      }
    });

    // Option toggles for GPS
    const chkGps = document.getElementById('chk-gps') as HTMLInputElement;
    if (chkGps) {
      chkGps.addEventListener('change', () => {
        this.gpsEnabled = chkGps.checked;
      });
    }

    // Map Mode Selection Buttons
    const btnNorth = document.getElementById('btn-map-mode-north');
    const btnHead = document.getElementById('btn-map-mode-head');
    const btnMan = document.getElementById('btn-map-mode-man');
    const modeBtns = [btnNorth, btnHead, btnMan];

    const setActiveMode = (mode: 'north' | 'heading' | 'manual', activeBtn: HTMLElement | null) => {
      this.mapMode = mode;
      modeBtns.forEach(btn => btn?.classList.remove('active'));
      activeBtn?.classList.add('active');
    };

    if (btnNorth) {
      btnNorth.addEventListener('click', () => setActiveMode('north', btnNorth));
    }
    if (btnHead) {
      btnHead.addEventListener('click', () => setActiveMode('heading', btnHead));
    }
    if (btnMan) {
      btnMan.addEventListener('click', () => setActiveMode('manual', btnMan));
    }
  }

  // Format milliseconds into MM:SS.CC (standard orienteering timing)
  public formatTime(ms: number): string {
    if (ms <= 0) return '00:00.00';
    
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);

    const minStr = minutes.toString().padStart(2, '0');
    const secStr = seconds.toString().padStart(2, '0');
    const csStr = centiseconds.toString().padStart(2, '0');

    return `${minStr}:${secStr}.${csStr}`;
  }

  // Rotate compass bezel opposite of camera view yaw (Spring-Mass-Damper oscillation with dynamic acceleration wobble)
  public updateCompass(cameraYaw: number, delta: number, speedFactor: number = 0, isGrounded: boolean = true) {
    if (this.compassRose) {
      // The needle rotates opposite of the player rotation to stay pointed North
      let targetAngle = -cameraYaw;

      // If moving or airborne, add physical acceleration dip/tilt/shaking wobble
      if (speedFactor > 0.05 || !isGrounded) {
        const time = Date.now() * 0.001;
        // Rhythmic runner step vibration
        const stepWobble = Math.sin(time * 16.0) * 0.08 * speedFactor;
        // Random terrain bump/shake noise
        const shakeWobble = (Math.random() - 0.5) * 0.05 * speedFactor;
        // Float oscillation if airborne/jumping
        const airWobble = !isGrounded ? Math.sin(time * 8.0) * 0.15 : 0.0;

        targetAngle += stepWobble + shakeWobble + airWobble;
      }
      
      const kSpring = 240.0; // Magnet pulling torque coefficient
      const cDamping = 15.0; // Fluid friction/damping coefficient
      
      // Calculate shortest angular distance using atan2 to prevent wild spinning on boundary crosses
      let diff = targetAngle - this.needleAngle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      
      const torqueSpring = kSpring * diff;
      const torqueDamping = -cDamping * this.needleVelocity;
      
      const acceleration = torqueSpring + torqueDamping;
      this.needleVelocity += acceleration * delta;
      
      // Cap maximum rotational velocity to prevent runaway values
      this.needleVelocity = Math.max(-25.0, Math.min(25.0, this.needleVelocity));
      
      this.needleAngle += this.needleVelocity * delta;
      
      const degrees = (this.needleAngle * 180) / Math.PI;
      this.compassRose.style.transform = `rotate(${degrees}deg)`;
    }
  }

  // Pre-render static topographic map elements once to save rendering performance
  public preRenderStaticMap(terrain: { getTerrainHeight(x:number, z:number):number; getTerrainType(x:number, z:number):string; getMapSize():number }, course: Checkpoint[]) {
    const size = terrain.getMapSize();
    this.offscreenMapCanvas.width = size;
    this.offscreenMapCanvas.height = size;
    const ctx = this.offscreenMapCanvas.getContext('2d')!;
    
    ctx.clearRect(0, 0, size, size);

    // Colors mapping
    const colors: { [key: string]: string } = {
      field: '#ffdd00',  // Yellow fields
      forest: '#ffffff', // White forest
      walk: '#d0f0d0',   // Light green walk
      thicket: '#60c060', // Medium green thicket
      water: '#00a0f0',   // Blue water
      cliff: '#aaaaaa',   // Gray cliffs
      path: '#a06020'     // Brown paths
    };

    // 1. Draw solid feature pixels
    const half = size / 2;
    const imgData = ctx.createImageData(size, size);
    
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const gx = x - half;
        const gz = z - half;
        const type = terrain.getTerrainType(gx, gz);
        
        // Parse hex color string to RGB channels
        const hex = colors[type] || '#ffffff';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        
        const idx = (z * size + x) * 4;
        imgData.data[idx] = r;
        imgData.data[idx+1] = g;
        imgData.data[idx+2] = b;
        imgData.data[idx+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // 2. Draw Topographic Contour Lines (Crucial for Orienteering!)
    // Scan pixel boundaries where elevation crosses a multiple of 4 voxels height
    ctx.strokeStyle = '#c07040'; // contour brown color
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    
    for (let z = 0; z < size - 1; z++) {
      for (let x = 0; x < size - 1; x++) {
        const h = terrain.getTerrainHeight(x - half, z - half);
        const hRight = terrain.getTerrainHeight(x + 1 - half, z - half);
        const hDown = terrain.getTerrainHeight(x - half, z + 1 - half);
        
        const interval = 4; // draw contour every 4 height units
        
        const cThis = Math.floor(h / interval);
        const cRight = Math.floor(hRight / interval);
        const cDown = Math.floor(hDown / interval);
        
        if (cThis !== cRight || cThis !== cDown) {
          ctx.rect(x, z, 1, 1);
        }
      }
    }
    ctx.stroke();

    // 3. Draw Checkpoint Course Lines (Red Rings connected by lines)
    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 2.0;
    ctx.font = 'bold 11px Outfit, sans-serif';
    ctx.fillStyle = '#ff3333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Start coordinate is always (0,0) -> mapped to (half, half)
    const startX = half;
    const startZ = half;

    // Draw Start Triangle
    ctx.beginPath();
    ctx.moveTo(startX, startZ - 6);
    ctx.lineTo(startX - 6, startZ + 4);
    ctx.lineTo(startX + 6, startZ + 4);
    ctx.closePath();
    ctx.stroke();

    let lastX = startX;
    let lastZ = startZ;

    course.forEach((cp, idx) => {
      const cx = cp.x + half;
      const cz = cp.z + half;
      const isFinish = (idx === course.length - 1);

      // Draw connection line from last checkpoint
      ctx.beginPath();
      ctx.strokeStyle = '#ff3333';
      ctx.moveTo(lastX, lastZ);
      ctx.lineTo(cx, cz);
      ctx.stroke();

      if (isFinish) {
        // Draw double Finish concentric rings
        ctx.beginPath();
        ctx.arc(cx, cz, 6, 0, Math.PI * 2);
        ctx.arc(cx, cz, 9, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Draw control point ring
        ctx.beginPath();
        ctx.arc(cx, cz, 7, 0, Math.PI * 2);
        ctx.stroke();
        
        // Draw control point sequence label beside ring
        ctx.fillText((idx + 1).toString(), cx + 13, cz - 4);
      }

      lastX = cx;
      lastZ = cz;
    });
  }

  // Draw pre-rendered static map background layer, and overlay player GPS pointer on top
  public updateMapHUD(
    terrainSize: number,
    playerX: number,
    playerZ: number,
    cameraYaw: number,
    otherPlayers: { [id: string]: PlayerState }
  ) {
    const size = terrainSize;
    this.mapCanvas.width = size;
    this.mapCanvas.height = size;
    
    // Draw cached static background map
    this.mapCtx.drawImage(this.offscreenMapCanvas, 0, 0);

    const half = size / 2;

    // Apply CSS 2D Rotation matching Map Modes
    const degrees = (cameraYaw * 180) / Math.PI;
    if (this.mapMode === 'north') {
      this.mapCanvas.style.transform = 'none';
    } else if (this.mapMode === 'heading') {
      // Heading-up: rotates canvas in reverse, so player faces UP on screen
      this.mapCanvas.style.transform = `rotate(${degrees}deg)`;
    } else if (this.mapMode === 'manual') {
      const manDegrees = (this.manualMapAngle * 180) / Math.PI;
      this.mapCanvas.style.transform = `rotate(${manDegrees}deg)`;
    }

    // Draw other runners on map (faint colored dots)
    for (const pid in otherPlayers) {
      const other = otherPlayers[pid];
      this.mapCtx.save();
      this.mapCtx.beginPath();
      this.mapCtx.arc(other.x + half, other.z + half, 3.5, 0, Math.PI * 2);
      this.mapCtx.fillStyle = other.skinColor;
      this.mapCtx.fill();
      this.mapCtx.lineWidth = 1.0;
      this.mapCtx.strokeStyle = 'white';
      this.mapCtx.stroke();
      this.mapCtx.restore();
    }

    // Draw local player GPS marker
    if (this.gpsEnabled) {
      const px = playerX + half;
      const pz = playerZ + half;

      this.mapCtx.save();
      this.mapCtx.translate(px, pz);
      
      // Arrow pointing direction relative to canvas
      if (this.mapMode === 'heading') {
        // Since the canvas itself is rotated opposite of cameraYaw,
        // the arrow should remain pointing straight UP relative to screen!
        this.mapCtx.rotate(0);
      } else {
        // Arrow rotates relative to map North
        this.mapCtx.rotate(cameraYaw);
      }

      // Arrow pointing direction
      this.mapCtx.beginPath();
      this.mapCtx.moveTo(0, -7);
      this.mapCtx.lineTo(-5, 5);
      this.mapCtx.lineTo(0, 2);
      this.mapCtx.lineTo(5, 5);
      this.mapCtx.closePath();
      
      this.mapCtx.fillStyle = '#00ccff'; // neon cyan
      this.mapCtx.fill();
      this.mapCtx.strokeStyle = 'white';
      this.mapCtx.lineWidth = 1.5;
      this.mapCtx.stroke();
      
      this.mapCtx.restore();
    }
  }

  // Update e-card rows showing checklist and target checkpoint
  public updateECard(course: Checkpoint[], punchedCps: number[]) {
    this.activeTargetIndex = punchedCps.length;
    this.ecardPanel.innerHTML = '';

    course.forEach((cp, idx) => {
      const isPunched = punchedCps.includes(idx);
      const isActive = (idx === this.activeTargetIndex);
      
      const row = document.createElement('div');
      row.className = `punch-row ${isPunched ? 'punched' : ''} ${isActive ? 'active' : ''}`;
      
      const isFinish = (idx === course.length - 1);
      const codeName = isFinish ? 'Finish' : `CP ${idx + 1}`;

      row.innerHTML = `
        <span class="punch-lbl">${codeName}</span>
        <span class="punch-code">[${cp.code}]</span>
        <span class="punch-time">${isPunched ? 'Stamped' : isActive ? 'Active' : 'Locked'}</span>
      `;

      this.ecardPanel.appendChild(row);
    });
  }

  // Update live race timers and banners
  public updateTimers(status: string, startTime: number, serverTime: number) {
    if (status === 'lobby') {
      this.statusMsgEl.innerText = 'WAITING';
      this.timerEl.innerText = '00:00.00';
    } else if (status === 'countdown') {
      const remaining = Math.max(0, startTime - serverTime);
      const seconds = Math.ceil(remaining / 1000);
      
      this.statusMsgEl.innerText = 'PREPARE!';
      this.timerEl.innerText = seconds > 0 ? `00:0${seconds}.00` : '00:00.00';
    } else if (status === 'racing') {
      const elapsed = Math.max(0, serverTime - startTime);
      this.statusMsgEl.innerText = 'RUN!';
      this.timerEl.innerText = this.formatTime(elapsed);
    } else if (status === 'finished') {
      this.statusMsgEl.innerText = 'COMPLETED';
    }
  }

  // Update leaderboard rows
  public updateLeaderboard(scoreboard: { [id: string]: any }, localPlayerId: string | null) {
    this.leaderboardPanel.innerHTML = '';
    
    // Sort scoreboard entries (1. Finished runners sorted by time, 2. Active runners sorted by CPs count, 3. alphabetically)
    const sorted = Object.values(scoreboard).sort((a, b) => {
      if (a.finished && b.finished) return a.elapsed - b.elapsed;
      if (a.finished) return -1;
      if (b.finished) return 1;

      // Sort by CPs punched
      if (a.splits.length !== b.splits.length) {
        return b.splits.length - a.splits.length;
      }
      return a.name.localeCompare(b.name);
    });

    sorted.forEach((entry, idx) => {
      const row = document.createElement('div');
      const isMe = (entry.id === localPlayerId);
      row.className = `leader-row ${entry.finished ? 'finished' : ''}`;
      if (isMe) row.style.borderColor = '#00ccff';

      const timeStr = entry.finished ? this.formatTime(entry.elapsed) : `CP ${entry.splits.length}`;

      row.innerHTML = `
        <span class="leader-rank" style="color: ${idx===0 ? '#ffdd00' : 'inherit'}">#${idx + 1}</span>
        <span class="leader-name" style="${isMe ? 'color:#00ccff; font-weight:bold;' : ''}">${entry.name}</span>
        <span class="leader-time">${timeStr}</span>
      `;
      this.leaderboardPanel.appendChild(row);
    });
  }

  // Proximity prompts triggering when near checkpoint flag
  public showActionPrompt(cpCode: string, isActiveTarget: boolean) {
    this.actionPrompt.classList.remove('hidden');
    if (isActiveTarget) {
      this.promptMsg.innerText = `Punch Checkpoint [${cpCode}]`;
      this.actionPrompt.style.borderColor = '#ff6600';
    } else {
      this.promptMsg.innerText = `Wrong Checkpoint! Needs Code [${cpCode}]`;
      this.actionPrompt.style.borderColor = '#ff3333';
    }
  }

  public hideActionPrompt() {
    this.actionPrompt.classList.add('hidden');
  }

  private alertTimeout: any = null;
  // Dynamic slide-down punch alert banner
  public triggerPunchAlert(code: string, description: string, elapsed: number) {
    if (this.alertTimeout) clearTimeout(this.alertTimeout);

    const codeEl = document.getElementById('alert-cp-code') as HTMLElement;
    const descEl = document.getElementById('alert-cp-desc') as HTMLElement;
    const timeEl = document.getElementById('alert-cp-time') as HTMLElement;

    if (codeEl) codeEl.innerText = code;
    if (descEl) descEl.innerText = description;
    if (timeEl) timeEl.innerText = `PUNCHED! SPLIT: ${this.formatTime(elapsed)}`;

    this.punchAlert.classList.remove('hidden');

    Sound.playPunch();

    this.alertTimeout = setTimeout(() => {
      this.punchAlert.classList.add('hidden');
    }, 2500);
  }
}
