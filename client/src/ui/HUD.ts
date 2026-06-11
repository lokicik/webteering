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
  
  public mapCanvas = document.getElementById('topo-map-canvas') as HTMLCanvasElement;
  private mapCtx!: CanvasRenderingContext2D;
  private offscreenMapCanvas!: HTMLCanvasElement;

  private compassStripCanvas = document.getElementById('hud-compass-strip-canvas') as HTMLCanvasElement;
  private compassStripCtx: CanvasRenderingContext2D | null = null;

  private minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  
  // Game states references
  private activeTargetIndex = 0;
  private gpsEnabled = true;

  // Compass rotational spring-mass needle physics
  private needleAngle = 0.0;
  private needleVelocity = 0.0;

  // Realistic map rotation parameters
  public mapMode: 'north' | 'heading' | 'manual' = 'north';
  public manualMapAngle = 0.0;
  public forceHideGps = false;

  // Silva compass bezel rotation & alignment states
  public bezelAngle = 0.0;
  private bezelArrowEl: HTMLElement | null = null;
  private bezelEl = document.getElementById('compass-bezel') as HTMLElement;
  private wasAligned = false;

  // Logical (CSS-pixel) sizes of the HiDPI-scaled canvases
  private stripW = 360;
  private stripH = 36;
  private miniW = 140;
  private miniH = 140;

  constructor() {
    this.mapCtx = this.mapCanvas.getContext('2d')!;
    this.offscreenMapCanvas = document.createElement('canvas');

    this.compassStripCtx = this.compassStripCanvas?.getContext('2d') || null;
    this.minimapCtx = this.minimapCanvas?.getContext('2d') || null;

    // HiDPI: render the strip + minimap at devicePixelRatio so they're sharp
    // on retina displays (both canvases are CSS-sized at width:100%)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.compassStripCanvas && this.compassStripCtx) {
      this.stripW = this.compassStripCanvas.width;
      this.stripH = this.compassStripCanvas.height;
      this.compassStripCanvas.width = Math.round(this.stripW * dpr);
      this.compassStripCanvas.height = Math.round(this.stripH * dpr);
      this.compassStripCtx.scale(dpr, dpr);
    }
    if (this.minimapCanvas && this.minimapCtx) {
      this.miniW = this.minimapCanvas.width;
      this.miniH = this.minimapCanvas.height;
      this.minimapCanvas.width = Math.round(this.miniW * dpr);
      this.minimapCanvas.height = Math.round(this.miniH * dpr);
      this.minimapCtx.scale(dpr, dpr);
    }
    
    // Inject the Silva orienting arrow div inside the bezel housing
    if (this.bezelEl) {
      this.bezelArrowEl = document.createElement('div');
      this.bezelArrowEl.className = 'bezel-orienting-arrow';
      this.bezelEl.appendChild(this.bezelArrowEl);
    }
    
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

    // M key keyboard toggle (inert while the pause menu is open)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        const pauseMenu = document.getElementById('pause-menu');
        if (pauseMenu && !pauseMenu.classList.contains('hidden')) return;
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
  public updateCompass(cameraYaw: number, delta: number, speedFactor: number = 0, isGrounded: boolean = true, isExhausted: boolean = false) {
    if (this.compassRose) {
      // The needle rotates opposite of the player rotation to stay pointed North
      let targetAngle = -cameraYaw;

      // Exhausted shaky hands wobble (erratic vibration)
      if (isExhausted) {
        targetAngle += (Math.random() - 0.5) * 0.28;
      }

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

      // Rotate Silva Bezel Orienting Arrow
      if (this.bezelArrowEl) {
        const bezelDeg = (this.bezelAngle * 180) / Math.PI;
        this.bezelArrowEl.style.transform = `translate(-50%, -50%) rotate(${bezelDeg}deg)`;
      }

      // Check alignment between magnetic needle angle and bezel orienting arrow
      let alignDiff = this.needleAngle - this.bezelAngle;
      alignDiff = Math.atan2(Math.sin(alignDiff), Math.cos(alignDiff));
      const isAligned = Math.abs(alignDiff) < 0.087; // ~5 degrees tolerance window

      if (this.bezelEl) {
        if (isAligned) {
          this.bezelEl.classList.add('aligned');
          if (!this.wasAligned) {
            Sound.playLockChime();
          }
          this.wasAligned = true;
        } else {
          this.bezelEl.classList.remove('aligned');
          this.wasAligned = false;
        }
      }
    }
  }

  // Pre-render static topographic map elements once to save rendering performance
  public preRenderStaticMap(
    terrain: { 
      getTerrainHeight(x:number, z:number):number; 
      getTerrainType(x:number, z:number):string; 
      getMapSize():number;
      getVoxelColorHex?: (type: any, height?: number) => string;
    }, 
    course: Checkpoint[]
  ) {
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
        
        const h = terrain.getTerrainHeight(gx, gz);
        
        // Parse hex color string to RGB channels
        const hex = terrain.getVoxelColorHex ? terrain.getVoxelColorHex(type, h) : (colors[type] || '#ffffff');
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);

        // Apply hypsometric elevation shading (darker/cooler at valley lowlands, lighter/warmer at mountain peaks)
        if (type !== 'water') {
          const heightFactor = Math.max(0.0, Math.min(1.0, h / 14.0)); // Heights scale from 0 to 14 units
          r = Math.max(0, Math.min(255, Math.round(r * (0.82 + heightFactor * 0.32))));
          g = Math.max(0, Math.min(255, Math.round(g * (0.82 + heightFactor * 0.18))));
          b = Math.max(0, Math.min(255, Math.round(b * (0.72 + heightFactor * 0.28))));
        }
        
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
    if (this.mapCanvas.width !== size || this.mapCanvas.height !== size) {
      this.mapCanvas.width = size;
      this.mapCanvas.height = size;
      this.mapDirty = true;
    }

    // Rotation is a cheap CSS transform — keep it per-frame for smoothness
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

    // The canvas repaint (background composite + runner dots + GPS marker)
    // only needs ~10Hz; the GPS arrow moves a few pixels per second at most
    const now = performance.now();
    const playerCount = Object.keys(otherPlayers).length;
    if (!this.mapDirty && playerCount === this.lastMapPlayers && now - this.lastMapDraw < 100) {
      return;
    }
    this.mapDirty = false;
    this.lastMapDraw = now;
    this.lastMapPlayers = playerCount;
    this.mapDrawStamp++; // consumers (handheld 3D map texture) re-upload only on repaint

    // Draw cached static background map
    this.mapCtx.drawImage(this.offscreenMapCanvas, 0, 0);

    const half = size / 2;

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
    if (this.gpsEnabled && !this.forceHideGps) {
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

  // Update e-card rows showing checklist and target checkpoint.
  // Also drives the compact chip (the always-visible summary; the full
  // list expands on hover).
  public updateECard(course: Checkpoint[], punchedCps: number[]) {
    this.activeTargetIndex = punchedCps.length;

    const progressEl = document.getElementById('ecard-chip-progress');
    const codeEl = document.getElementById('ecard-chip-code');
    if (progressEl) progressEl.textContent = `CP ${punchedCps.length}/${course.length}`;
    if (codeEl) {
      const next = course[punchedCps.length];
      codeEl.textContent = next ? `NEXT [${next.code}]` : 'DONE';
    }

    this.ecardPanel.innerHTML = '';

    course.forEach((cp, idx) => {
      const isPunched = punchedCps.includes(idx);
      const isActive = (idx === this.activeTargetIndex);
      
      const row = document.createElement('div');
      row.className = `punch-row ${isPunched ? 'punched' : ''} ${isActive ? 'active' : ''}`;
      
      const isFinish = (idx === course.length - 1);
      const codeName = isFinish ? 'Finish' : `CP ${idx + 1}`;
      const picto = this.getPictogramSVG(cp.description);

      row.innerHTML = `
        <span class="punch-lbl">${codeName}</span>
        <span class="punch-picto" title="${cp.description}">${picto}</span>
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

  // Update leaderboard rows. Rows are created once and patched in place —
  // rebuilding via innerHTML every frame caused needless DOM churn while racing.
  public updateLeaderboard(
    scoreboard: { [id: string]: any },
    localPlayerId: string | null,
    players?: { [id: string]: { skinColor: string } }
  ) {
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

    // Reconcile row count
    while (this.leaderboardPanel.children.length < sorted.length) {
      const row = document.createElement('div');
      row.innerHTML = '<span class="leader-rank"></span><span class="leader-dot"></span><span class="leader-name"></span><span class="leader-time"></span>';
      this.leaderboardPanel.appendChild(row);
    }
    while (this.leaderboardPanel.children.length > sorted.length) {
      this.leaderboardPanel.removeChild(this.leaderboardPanel.lastChild!);
    }

    sorted.forEach((entry, idx) => {
      const row = this.leaderboardPanel.children[idx] as HTMLElement;
      const isMe = (entry.id === localPlayerId);

      const className = `leader-row${entry.finished ? ' finished' : ''}${isMe ? ' me' : ''}`;
      if (row.className !== className) row.className = className;

      const timeStr = entry.finished ? this.formatTime(entry.elapsed) : `CP ${entry.splits.length}`;
      const spans = row.children;
      const rank = spans[0] as HTMLElement;
      const dot = spans[1] as HTMLElement;
      const name = spans[2] as HTMLElement;
      const time = spans[3] as HTMLElement;

      const rankText = `${idx + 1}`;
      if (rank.textContent !== rankText) rank.textContent = rankText;

      const dotColor = players?.[entry.id]?.skinColor.split('|')[0] || 'transparent';
      if (dot.style.background !== dotColor) dot.style.background = dotColor;

      if (name.textContent !== entry.name) name.textContent = entry.name;

      if (time.textContent !== timeStr) time.textContent = timeStr;
    });
  }

  // Visible punch rejection: one-shot shake on the action prompt
  public flashPromptError() {
    this.actionPrompt.classList.remove('prompt-error-shake');
    void (this.actionPrompt as HTMLElement).offsetWidth; // restart the animation
    this.actionPrompt.classList.add('prompt-error-shake');
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
    this.mapDirty = true; // punch state changed -> force the next map repaint
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

  private getPictogramSVG(description: string): string {
    const desc = description.toLowerCase();
    
    // SVG wrapper template with custom sizes
    const svgHeader = '<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align: middle; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;">';
    
    if (desc.includes('finish')) {
      // Concentric circles (Double circles)
      return svgHeader + '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/></svg>';
    } else if (desc.includes('boulder')) {
      // Hexagon block
      return svgHeader + '<polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5"/></svg>';
    } else if (desc.includes('depression')) {
      // Concentric dashed circles
      return svgHeader + '<circle cx="12" cy="12" r="8" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="4" stroke-dasharray="1 1"/></svg>';
    } else if (desc.includes('gully')) {
      // V shape
      return svgHeader + '<polyline points="3,6 12,18 21,6"/></svg>';
    } else if (desc.includes('spur')) {
      // Contour nose curve
      return svgHeader + '<path d="M6,6 C16,6 16,18 6,18"/></svg>';
    } else if (desc.includes('thicket')) {
      // Triple circular vegetation clusters
      return svgHeader + '<circle cx="8" cy="14" r="3"/><circle cx="16" cy="14" r="3"/><circle cx="12" cy="8" r="3"/></svg>';
    } else if (desc.includes('wall')) {
      // Hatching block lines representing rock barrier wall
      return svgHeader + '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="8" y1="8" x2="8" y2="16"/><line x1="16" y1="8" x2="16" y2="16"/></svg>';
    } else if (desc.includes('hill')) {
      // Double circular contours
      return svgHeader + '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5"/></svg>';
    }
    
    // Default fallback: checkpoint flag stand
    return svgHeader + '<rect x="6" y="4" width="12" height="12"/><line x1="6" y1="16" x2="6" y2="20"/></svg>';
  }

  // Pre-rendered static topo map, used by the podium replay as its backdrop
  public getStaticMapCanvas(): HTMLCanvasElement {
    return this.offscreenMapCanvas;
  }

  public drawTracksOnCanvas(
    canvas: HTMLCanvasElement,
    paths: { [id: string]: { x: number; z: number }[] },
    players: { [id: string]: { name: string; skinColor: string } }
  ) {
    const size = this.offscreenMapCanvas.width || canvas.width;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Draw static pre-rendered background map
    ctx.drawImage(this.offscreenMapCanvas, 0, 0);

    const half = size / 2;

    // Draw tracks in glowing neon colored lines
    for (const pid in paths) {
      const path = paths[pid];
      if (path.length < 2) continue;

      const playerInfo = players[pid] || { name: 'Runner', skinColor: '#00ccff' };
      
      ctx.save();
      ctx.strokeStyle = playerInfo.skinColor;
      ctx.lineWidth = 3.0;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // Glowing line shadow effect
      ctx.shadowColor = playerInfo.skinColor;
      ctx.shadowBlur = 6;

      ctx.beginPath();
      ctx.moveTo(path[0].x + half, path[0].z + half);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x + half, path[i].z + half);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Redraw throttle state (these canvases were fully repainted every frame)
  private lastStripYaw = Infinity;
  private lastMinimapYaw = Infinity;
  private lastMinimapX = Infinity;
  private lastMinimapZ = Infinity;
  private lastMinimapDraw = 0;
  private lastMinimapPunches = -1;
  private lastMapDraw = 0;
  private lastMapPlayers = -1;
  public mapDirty = true; // set by callers when punches/course change
  public mapDrawStamp = 0; // increments on every actual map canvas repaint

  public drawCompassStrip(cameraYaw: number) {
    if (!this.compassStripCanvas || !this.compassStripCtx) return;

    // Heading unchanged (< ~0.25 deg) -> the strip is already correct
    if (Math.abs(cameraYaw - this.lastStripYaw) < 0.004) return;
    this.lastStripYaw = cameraYaw;

    const ctx = this.compassStripCtx;
    const width = this.stripW;
    const height = this.stripH;

    // Clear background
    ctx.clearRect(0, 0, width, height);

    // Dynamic camera yaw heading in degrees (0 to 360, where 0 is North)
    const headingDeg = ((-cameraYaw * 180) / Math.PI + 360) % 360;

    // Drawing parameters
    const degreesPerPixel = 0.5; // 180 degrees fits in 360px width
    const centerX = width / 2;

    ctx.save();
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.0;

    // Iterate through visible degrees (-90 to +90 from center heading)
    const range = 90;
    const startDeg = Math.floor(headingDeg - range);
    const endDeg = Math.ceil(headingDeg + range);

    for (let d = startDeg; d <= endDeg; d++) {
      const actualDeg = (d + 360) % 360;
      
      // Calculate screen X coordinate
      const offsetDeg = d - headingDeg;
      const x = centerX + offsetDeg / degreesPerPixel;

      // Draw ticks and labels
      if (actualDeg % 30 === 0) {
        // Major ticks and labels (N, E, S, W, and angles)
        let label = actualDeg.toString();
        if (actualDeg === 0 || actualDeg === 360) {
          label = 'N';
          ctx.fillStyle = '#ff3333'; // Bright Red for North!
          ctx.font = 'bold 11px monospace';
        } else if (actualDeg === 90) {
          label = 'E';
          ctx.fillStyle = '#ffaa00'; // Warm Amber for East
          ctx.font = 'bold 11px monospace';
        } else if (actualDeg === 180) {
          label = 'S';
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px monospace';
        } else if (actualDeg === 270) {
          label = 'W';
          ctx.fillStyle = '#ffaa00';
          ctx.font = 'bold 11px monospace';
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.font = '9px monospace';
        }

        // Draw label
        ctx.fillText(label, x, height / 2 - 4);
        
        // Draw tick line
        ctx.beginPath();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.moveTo(x, height / 2 + 3);
        ctx.lineTo(x, height - 4);
        ctx.stroke();
      } else if (actualDeg % 10 === 0) {
        // Minor Ticks
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.moveTo(x, height / 2 + 6);
        ctx.lineTo(x, height - 4);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  public updateMinimap(
    terrainSize: number,
    playerX: number,
    playerZ: number,
    cameraYaw: number,
    course: Checkpoint[],
    punchedCps: number[],
    otherPlayers: { [id: string]: PlayerState }
  ) {
    if (!this.minimapCanvas || !this.minimapCtx) return;

    // Skip the repaint while nothing visible changed: small heading deltas keep
    // rotation smooth when turning, the time floor catches pulse animation,
    // and punch-count changes force a redraw
    const now = performance.now();
    const moved =
      Math.abs(playerX - this.lastMinimapX) > 1.0 ||
      Math.abs(playerZ - this.lastMinimapZ) > 1.0;
    const turned = Math.abs(cameraYaw - this.lastMinimapYaw) > 0.02;
    const punchesChanged = punchedCps.length !== this.lastMinimapPunches;
    if (!moved && !turned && !punchesChanged && now - this.lastMinimapDraw < 150) {
      return;
    }
    this.lastMinimapX = playerX;
    this.lastMinimapZ = playerZ;
    this.lastMinimapYaw = cameraYaw;
    this.lastMinimapDraw = now;
    this.lastMinimapPunches = punchedCps.length;

    const ctx = this.minimapCtx;
    const width = this.miniW;
    const height = this.miniH;

    // Clear background
    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;

    ctx.save();

    // Rounded-rect clip (the minimap sits inside the square corner cluster)
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(0, 0, width, height, 10);
    } else {
      ctx.rect(0, 0, width, height);
    }
    ctx.clip();

    // Fill background
    ctx.fillStyle = 'rgba(12, 15, 24, 0.95)';
    ctx.fillRect(0, 0, width, height);

    // Coordinate mapping: zoomed in minimap scale
    const scale = 1.2;

    // Translate and rotate so drawing is centered on player and aligned with player heading (Heading-Up)
    ctx.translate(centerX, centerY);
    ctx.rotate(-cameraYaw); // Rotate opposite of camera yaw to align Heading-Up

    // Draw topographic background map shifted relative to player position
    const mapHalf = terrainSize / 2;
    const mapOffsetX = -(playerX + mapHalf) * scale;
    const mapOffsetZ = -(playerZ + mapHalf) * scale;

    // Draw offscreenMapCanvas
    ctx.drawImage(
      this.offscreenMapCanvas,
      0, 0, terrainSize, terrainSize,
      mapOffsetX, mapOffsetZ, terrainSize * scale, terrainSize * scale
    );

    // Draw checkpoint course line splits
    let lastX = mapOffsetX + mapHalf * scale;
    let lastZ = mapOffsetZ + mapHalf * scale;

    course.forEach((cp, idx) => {
      const cx = mapOffsetX + (cp.x + mapHalf) * scale;
      const cz = mapOffsetZ + (cp.z + mapHalf) * scale;
      const isPunched = punchedCps.includes(idx);
      const isTarget = (idx === punchedCps.length);

      // Connection lines
      ctx.beginPath();
      ctx.strokeStyle = isPunched ? 'rgba(255, 51, 51, 0.45)' : 'rgba(255, 51, 51, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.moveTo(lastX, lastZ);
      ctx.lineTo(cx, cz);
      ctx.stroke();

      // Checkpoint rings
      ctx.beginPath();
      ctx.strokeStyle = isTarget ? '#ffaa00' : '#ff3333';
      ctx.lineWidth = isTarget ? 2.5 : 1.5;
      ctx.arc(cx, cz, isTarget ? 7 : 5, 0, Math.PI * 2);
      ctx.stroke();

      if (isTarget) {
        // Pulse ring for active target
        const pulse = Math.abs(Math.sin(Date.now() * 0.005)) * 4 + 7;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 170, 0, 0.45)';
        ctx.arc(cx, cz, pulse, 0, Math.PI * 2);
        ctx.stroke();
      }

      lastX = cx;
      lastZ = cz;
    });

    // Draw other players
    for (const pid in otherPlayers) {
      const other = otherPlayers[pid];
      const ox = mapOffsetX + (other.x + mapHalf) * scale;
      const oz = mapOffsetZ + (other.z + mapHalf) * scale;

      ctx.beginPath();
      ctx.arc(ox, oz, 4, 0, Math.PI * 2);
      ctx.fillStyle = other.skinColor;
      ctx.fill();
      ctx.lineWidth = 1.0;
      ctx.strokeStyle = 'white';
      ctx.stroke();
    }

    ctx.restore();
  }
}
