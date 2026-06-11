import * as THREE from 'three';
import { Sound } from '../ui/Sound';

export interface CollidableTerrain {
  getTerrainHeight(x: number, z: number): number;
  getTerrainType(x: number, z: number): string;
  getWaterLevel(): number;
}

export class Controls {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;
  private terrain: CollidableTerrain;

  // Keyboard state
  private keys: { [key: string]: boolean } = {
    KeyW: false,
    KeyS: false,
    KeyA: false,
    KeyD: false,
    Space: false,
    ShiftLeft: false
  };

  // Movement Physics parameters
  public position = new THREE.Vector3(0, 5, 0);
  private velocity = new THREE.Vector3();
  private rotation = new THREE.Euler(0, 0, 0, 'YXZ'); // Y-yaw, X-pitch
  
  private gravity = 22.0;
  private jumpStrength = 7.5;
  private isGrounded = false;
  private runSpeed = 8.5; // Base running speed
  private isSwimming = false;
  private wasSwimming = false;
  private stunTimer = 0.0;

  // Polish & Realism Upgrades
  public stamina = 100.0;
  public isExhausted = false;
  public slipTimer = 0.0;
  private lockCooldownTicks = 0;

  // PointerLock state
  private isLocked = false;
  
  // Joystick parameters for Mobile
  private joystickVector = new THREE.Vector2(0, 0);

  // Flight Mode
  public isFlightMode = false;
  public isRaining = false;

  // Maturity Realism properties
  private bobTimer = 0.0;
  private stepTimer = 0.0;

  // Tactical simulation states
  public isVaulting = false;
  public vaultTimer = 0.0;
  private vaultSpeedBoost = 1.0;
  public isSliding = false;
  private slideCooldown = 0; // brief lockout after a slide ends (no chatter on bumpy slopes)
  private slideScrapeCooldown = 0.0;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, terrain: CollidableTerrain) {
    this.camera = camera;
    this.domElement = domElement;
    this.terrain = terrain;

    this.initKeyboard();
    this.initMouse();
    
    // Set initial position
    this.position.copy(camera.position);
  }

  public setTerrain(terrain: CollidableTerrain) {
    this.terrain = terrain;
  }

  private initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.isLocked && !this.isFlightMode) return;
      
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keys.KeyW = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keys.KeyS = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.KeyA = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.KeyD = true;
      if (e.code === 'Space') this.keys.Space = true;
      if (e.code === 'ShiftLeft') this.keys.ShiftLeft = true;
      
      // Developer flight toggle shortcut (Ctrl + Shift + F)
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
        // Toggle flight mode
        this.isFlightMode = !this.isFlightMode;
        const flyChk = document.getElementById('chk-fly') as HTMLInputElement;
        if (flyChk) flyChk.checked = this.isFlightMode;
        if (this.isFlightMode) {
          this.velocity.set(0, 0, 0);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keys.KeyW = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keys.KeyS = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.KeyA = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.KeyD = false;
      if (e.code === 'Space') this.keys.Space = false;
      if (e.code === 'ShiftLeft') this.keys.ShiftLeft = false;
    });
  }

  private initMouse() {
    // Request pointer lock when clicking on canvas container
    this.domElement.addEventListener('click', () => {
      if (!this.isLocked && document.pointerLockElement !== this.domElement) {
        this.domElement.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = (document.pointerLockElement === this.domElement);
      const reticle = document.getElementById('reticle');
      if (reticle) reticle.style.display = this.isLocked ? 'block' : 'none';
      
      // Trigger PointerLock cooldown
      if (this.isLocked) {
        this.lockCooldownTicks = 3;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      
      // Ignore mouse movement during lock spike cooldown
      if (this.lockCooldownTicks > 0) {
        this.lockCooldownTicks--;
        return;
      }

      // Safeguard spike clamp (cursor wraps on lock change)
      if (Math.abs(e.movementX) > 120 || Math.abs(e.movementY) > 120) return;

      const sensitivity = 0.0022;
      this.rotation.y -= e.movementX * sensitivity;
      this.rotation.x -= e.movementY * sensitivity;

      // Limit look up/down to prevent rolling camera (90 degrees limit)
      this.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.rotation.x));
    });
  }

  public resetRotation(yaw: number, pitch: number) {
    this.rotation.set(pitch, yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.rotation);
  }

  public setJoystickVector(x: number, y: number) {
    this.joystickVector.set(x, y);
  }

  public lock() {
    this.domElement.requestPointerLock();
  }

  public unlock() {
    document.exitPointerLock();
  }

  public getRotation() {
    return { rx: this.rotation.y, ry: this.rotation.x };
  }

  public getSpeedFactor(): number {
    const horizontalVel = new THREE.Vector2(this.velocity.x, this.velocity.z);
    return horizontalVel.length() / this.runSpeed;
  }

  public getIsGrounded(): boolean {
    return this.isGrounded;
  }

  public update(delta: number) {
    if (this.stunTimer > 0) {
      this.stunTimer -= delta;
    }
    if (this.slipTimer > 0) {
      this.slipTimer -= delta;
    }
    if (this.vaultTimer > 0) {
      this.vaultTimer -= delta;
      if (this.vaultTimer <= 0) {
        this.isVaulting = false;
        this.vaultSpeedBoost = 1.0;
      }
    }

    // --- 1. GET RUNNABILITY BASE SPEED BY TERRAIN ---
    const currentTerrainType = this.terrain.getTerrainType(this.position.x, this.position.z);
    let baseTerrainSpeed = 7.5; // Very healthy standard running speed (27 km/h)
    this.isSwimming = false;

    switch (currentTerrainType) {
      case 'field':
        baseTerrainSpeed = 7.5;
        break;
      case 'forest':
        baseTerrainSpeed = 6.2; // Slowed by scattered trees
        break;
      case 'walk':
        baseTerrainSpeed = 4.8; // Slow forest floor/weeds
        break;
      case 'thicket':
        baseTerrainSpeed = 3.0; // Thick bushes/obstructions
        break;
      case 'water':
        baseTerrainSpeed = 2.2; // Swimming speed
        this.isSwimming = true;
        break;
      case 'path':
        baseTerrainSpeed = 8.5; // High-performance sprint on clear paths!
        break;
      default:
        baseTerrainSpeed = 7.5;
    }

    // Play swimming splash sound on transition
    if (this.isSwimming && !this.wasSwimming) {
      Sound.playSplash();
    }
    this.wasSwimming = this.isSwimming;

    // --- REALISTIC STAMINA & FATIGUE SYSTEM ---
    const staminaMoveDirection = new THREE.Vector3(0, 0, 0);
    if (this.keys.KeyW) staminaMoveDirection.z -= 1;
    if (this.keys.KeyS) staminaMoveDirection.z += 1;
    if (this.keys.KeyA) staminaMoveDirection.x -= 1;
    if (this.keys.KeyD) staminaMoveDirection.x += 1;
    if (this.joystickVector.lengthSq() > 0.01) {
      staminaMoveDirection.set(this.joystickVector.x, 0, -this.joystickVector.y);
    }
    const isMoving = staminaMoveDirection.lengthSq() > 0.01;
    const isSprinting = isMoving && !this.keys.ShiftLeft && !this.isFlightMode;

    if (isSprinting) {
      // Sprinting stamina drain (much more balanced, takes ~33-40s on flat ground)
      let drainRate = 2.5;
      if (currentTerrainType === 'forest') drainRate = 3.2;
      else if (currentTerrainType === 'walk') drainRate = 4.2;
      else if (currentTerrainType === 'thicket') drainRate = 6.0;
      else if (currentTerrainType === 'water') drainRate = 5.5; // swimming shortcuts cost real energy
      
      this.stamina = Math.max(0.0, this.stamina - drainRate * delta);
    } else {
      // Recovering stamina when stationary or walking/jogging
      const recoveryRate = isMoving ? 8.0 : 15.0; // recovers at 8.0/s during jog recovery vs 15.0/s standing still
      this.stamina = Math.min(100.0, this.stamina + recoveryRate * delta);
    }

    // Exhaustion state locks
    if (this.stamina <= 0.0) {
      this.isExhausted = true;
    } else if (this.isExhausted && this.stamina >= 30.0) {
      this.isExhausted = false; // must recover to 30% to clear fatigue
    }

    // --- 1.5. APPLY SPEED MODIFIERS AND NON-PUNISHING CLAMPED CAPS ---
    let currentSpeed = baseTerrainSpeed;

    if (this.isExhausted) {
      // Exhaustion limits dry land speed to a jog of 3.5 m/s, or applies a mild 35% penalty
      currentSpeed = Math.min(currentSpeed * 0.65, 3.5);
    }

    if (this.keys.ShiftLeft) {
      // Shift limits speed to a gentle recovery walk/jog of 3.8 m/s, or applies a 50% penalty
      currentSpeed = Math.min(currentSpeed * 0.50, 3.8);
    }

    // Map reading speed penalty (15% slower when map is open)
    const mapPanel = document.getElementById('map-panel');
    const isMapOpen = mapPanel && !mapPanel.classList.contains('hidden');
    if (isMapOpen) {
      currentSpeed *= 0.85;
    }

    // Slipped or stumbled penalty (steep slides)
    if (this.slipTimer > 0) {
      currentSpeed *= 0.35;
    }

    // Vaulting speed boost
    if (this.isVaulting) {
      currentSpeed *= this.vaultSpeedBoost;
    }

    // Stun recovery multiplier
    if (this.stunTimer > 0) {
      currentSpeed *= 0.3;
    }


    // --- 2. CALCULATE INPUT DIRECTION ---
    const moveDirection = new THREE.Vector3(0, 0, 0);

    // Keyboard inputs
    if (this.keys.KeyW) moveDirection.z -= 1;
    if (this.keys.KeyS) moveDirection.z += 1;
    if (this.keys.KeyA) moveDirection.x -= 1;
    if (this.keys.KeyD) moveDirection.x += 1;

    // Mobile Joystick input override
    if (this.joystickVector.lengthSq() > 0.01) {
      moveDirection.set(this.joystickVector.x, 0, -this.joystickVector.y);
    }

    moveDirection.normalize();

    // Rotate movement vector matching the yaw look angle
    const rotatedMove = new THREE.Vector3()
      .copy(moveDirection)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y);

    // --- 3. APPLY PHYSICS FLIGHT MODE VS NORMAL PHYSICS ---
    if (this.isFlightMode) {
      // Direct flying movement
      const flySpeed = 30.0;
      const flyDir = new THREE.Vector3();
      
      if (this.keys.KeyW) flyDir.z -= 1;
      if (this.keys.KeyS) flyDir.z += 1;
      if (this.keys.KeyA) flyDir.x -= 1;
      if (this.keys.KeyD) flyDir.x += 1;
      
      flyDir.normalize().applyQuaternion(this.camera.quaternion);

      if (this.keys.Space) flyDir.y += 1;
      if (this.keys.ShiftLeft) flyDir.y -= 1;

      this.position.addScaledVector(flyDir, flySpeed * delta);
      this.camera.position.copy(this.position);
      return;
    }

    // Normal Physics (Walk / Jump / Collide)
    
    // Vertical velocity (Gravity / Swimming buoyancy)
    if (this.isSwimming) {
      // Bouyant floating physics in water
      const waterHeight = this.terrain.getWaterLevel();
      const submergedDepth = waterHeight - this.position.y;
      
      if (submergedDepth > 0) {
        // Floating upward force
        this.velocity.y += (submergedDepth * 8.0 - this.velocity.y) * 4.0 * delta;
      } else {
        this.velocity.y -= this.gravity * 0.3 * delta; // Faint gravity near surface
      }

      // Swim jump/bobbing
      if (this.keys.Space) {
        this.velocity.y = 2.5;
      }
    } else {
      // Grounded falling physics
      if (!this.isGrounded) {
        this.velocity.y -= this.gravity * delta;
      } else if (this.keys.Space) {
        // Vault check: Check if there's a low obstacle (stone wall, boulder, hedge) to vault over!
        const speed = new THREE.Vector2(this.velocity.x, this.velocity.z).length();
        let vaulted = false;
        
        if (speed > 4.5 && this.isGrounded && !this.isSwimming && !this.isFlightMode) {
          const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y);
          const checkX = this.position.x + forward.x * 1.4;
          const checkZ = this.position.z + forward.z * 1.4;
          const forwardHeight = this.terrain.getTerrainHeight(checkX, checkZ);
          const fHeightDiff = forwardHeight - this.position.y;

          // Dual probe: a vaultable WALL is already high at 0.7m out, while a
          // steep ramp is only ~half-height there — ramps get a jump, not a vault
          const nearHeight = this.terrain.getTerrainHeight(
            this.position.x + forward.x * 0.7,
            this.position.z + forward.z * 0.7
          );
          const nearDiff = nearHeight - this.position.y;

          if (fHeightDiff >= 0.45 && fHeightDiff <= 1.25 && nearDiff >= 0.35) {
            // Trigger physical hurdle vault!
            this.isVaulting = true;
            this.vaultTimer = 0.45;
            this.vaultSpeedBoost = 1.35;
            this.velocity.y = 5.2; // smaller upward launch
            this.isGrounded = false;
            Sound.playVault();
            vaulted = true;
          }
        }
        
        if (!vaulted) {
          // Standard jump trigger
          this.velocity.y = this.jumpStrength;
          this.isGrounded = false;
        }
      }
    }

    // Apply slope factor when grounded and moving (uphill penalty, downhill boost)
    if (this.isGrounded && isMoving) {
      const checkDist = 0.8;
      const checkX = this.position.x + rotatedMove.x * checkDist;
      const checkZ = this.position.z + rotatedMove.z * checkDist;
      const checkHeight = this.terrain.getTerrainHeight(checkX, checkZ);
      const slopeDiff = checkHeight - this.position.y;

      if (slopeDiff > 0.05) {
        // Uphill: slow down up to 40% (at slopeDiff >= 1.0m)
        const factor = Math.max(0.6, 1.0 - (slopeDiff / 1.0) * 0.4);
        currentSpeed *= factor;
      } else if (slopeDiff < -0.05) {
        // Downhill: boost speed up to 15% (at slopeDiff <= -1.2m)
        const factor = Math.min(1.15, 1.0 + (Math.abs(slopeDiff) / 1.2) * 0.15);
        currentSpeed *= factor;
      }
    }

    // Horizontal velocity interpolation (inertia/friction)
    const targetVelX = rotatedMove.x * currentSpeed;
    const targetVelZ = rotatedMove.z * currentSpeed;
    
    const accelRate = this.isGrounded ? 10.0 : 4.0; // Smooth physical inertia
    this.velocity.x += (targetVelX - this.velocity.x) * accelRate * delta;
    this.velocity.z += (targetVelZ - this.velocity.z) * accelRate * delta;


    // --- 4. STEP CLIMB & COLLISION VERIFICATION ---
    // Split X and Z axis movements to allow smooth sliding along walls and trees!

    // Ground-align BEFORE the step tests so heightDiffX/Z measure true step
    // height from the actual current floor, not last frame's snapped height
    // (removes the 1-frame float/false-cliff on ramps)
    if (this.isGrounded) {
      this.position.y = this.terrain.getTerrainHeight(this.position.x, this.position.z);
    }

    // 4a. X-Axis Movement and Collision (climb steps up to 0.65m smoothly)
    const nextPosX = this.position.x + this.velocity.x * delta;
    const targetFloorHeightX = this.terrain.getTerrainHeight(nextPosX, this.position.z);
    const heightDiffX = targetFloorHeightX - this.position.y;

    if (heightDiffX > 0.65) {
      this.velocity.x = 0; // block X speed
    } else {
      this.position.x = nextPosX;
    }

    // 4b. Z-Axis Movement and Collision (climb steps up to 0.65m smoothly)
    const nextPosZ = this.position.z + this.velocity.z * delta;
    const targetFloorHeightZ = this.terrain.getTerrainHeight(this.position.x, nextPosZ);
    const heightDiffZ = targetFloorHeightZ - this.position.y;

    if (heightDiffZ > 0.65) {
      this.velocity.z = 0; // block Z speed
    } else {
      this.position.z = nextPosZ;
    }

    // 4c. Slope & Elevation Snap (using the final combined position)
    const targetFloorHeight = this.terrain.getTerrainHeight(this.position.x, this.position.z);
    const heightDiff = targetFloorHeight - this.position.y;

    if (this.isGrounded) {
      if (heightDiff < -3.5) {
        // Ledge drop: player walks off a cliff! Become ungrounded and fall.
        this.isGrounded = false;
      } else {
        // Walkable slope: keep player perfectly aligned to the terrain height!
        this.position.y = targetFloorHeight;
      }
    }

      // Slope slipping & sliding check (descending slope slides)
      if (this.isGrounded && !this.isSwimming && !this.isFlightMode) {
        if (this.isSliding) {
          // If already sliding, check if we reached flatter ground
          if (heightDiff >= -0.6) {
            this.isSliding = false;
            this.slipTimer = 0.45; // brief landing recovery slowdown
            this.slideCooldown = 0.3; // no immediate re-trigger on bumpy slopes
          } else {
            // Apply downhill sliding force: override velocity
            const slideSpeed = 16.5;
            this.velocity.x = rotatedMove.x * slideSpeed;
            this.velocity.z = rotatedMove.z * slideSpeed;

            // Tick sliding scrapings
            this.slideScrapeCooldown -= delta;
            if (this.slideScrapeCooldown <= 0) {
              Sound.playSlideScrape();
              this.slideScrapeCooldown = 0.08 + Math.random() * 0.04;
            }
          }
        } else if (this.slipTimer <= 0.0) {
          if (this.slideCooldown > 0) {
            this.slideCooldown -= delta;
          } else if (heightDiff < -1.1 && isMoving && !this.keys.ShiftLeft) {
            // Enter Sliding state!
            this.isSliding = true;
            this.slideScrapeCooldown = 0.0;
          } else if (heightDiff < -0.8 && isMoving && !this.keys.ShiftLeft) {
            // 10% chance per second (or 30% if raining) of slipping on steep declines
            const slipChance = (this.isRaining ? 0.30 : 0.10) * delta;
            if (Math.random() < slipChance) {
              this.slipTimer = 0.6; // stumble!
              Sound.playError(); // trigger stumble buzz
            }
          }
        }
      }

    // --- 5. VERTICAL MOVEMENT & LANDING STUNS ---
    this.position.y += this.velocity.y * delta;

    const currentFloorHeight = this.terrain.getTerrainHeight(this.position.x, this.position.z);
    
    // Snapping with a 0.8m recovery shell if falling or walking down (velocity.y <= 0) to prevent slope launch
    // If rising (velocity.y > 0), only snap if they actually penetrate the terrain (this.position.y <= currentFloorHeight)
    let landed = false;
    if (this.velocity.y <= 0.0) {
      if (this.position.y <= currentFloorHeight + 0.8) {
        landed = true;
      }
    } else {
      if (this.position.y <= currentFloorHeight) {
        landed = true;
      }
    }
    
    if (landed) {
      // Landed!
      
      // Fall stun check: if fell too hard
      if (this.velocity.y < -11.0) {
        this.stunTimer = 1.2; // Stunned for 1.2 seconds!
        // Shake screen or trigger buzz (handled in UI)
      }

      this.position.y = currentFloorHeight;
      
      if (!this.isSwimming) {
        this.velocity.y = 0;
        this.isGrounded = true;
      }
    } else {
      // In the air
      this.isGrounded = false;
    }

    // Sync Three.js Camera to Physics position
    // View height offset (eye-level at 1.6m, except when swimming)
    const eyeHeight = this.isSwimming ? 0.6 : 1.6;
    this.camera.position.copy(this.position).y += eyeHeight;

    // Apply vaulting vertical dip/rise arc
    if (this.isVaulting && this.vaultTimer > 0) {
      const progress = (0.45 - this.vaultTimer) / 0.45;
      const vaultHeight = Math.sin(progress * Math.PI) * 0.45 - Math.cos(progress * Math.PI * 2) * 0.16;
      this.camera.position.y += vaultHeight;
    }

    // --- MATURITY REALISM: HEAD-BOB, CHEST HEAVE & FOOTSTEP AUDIO ---
    const horizontalVel = new THREE.Vector2(this.velocity.x, this.velocity.z);
    const horizontalSpeed = horizontalVel.length();
    const isPhysMoving = horizontalSpeed > 0.15;

    // 1. Rhythmic Footsteps Trigger
    if (isPhysMoving && this.isGrounded && !this.isSwimming) {
      this.stepTimer += delta * horizontalSpeed;
      const stepInterval = this.keys.ShiftLeft ? 1.9 : 1.15; // spacing in meters
      if (this.stepTimer >= stepInterval) {
        this.stepTimer = 0.0;
        Sound.playStep(currentTerrainType, this.getSpeedFactor());
      }
    } else {
      this.stepTimer = 0.0;
    }

    // 2. Camera Head-Bobbing
    if (isPhysMoving && this.isGrounded && !this.isSwimming) {
      const stepFrequency = this.keys.ShiftLeft ? 9.5 : (this.stamina < 30.0 ? 15.0 : 13.0);
      this.bobTimer += delta * stepFrequency;

      const speedRatio = horizontalSpeed / this.runSpeed;
      const bobAmtY = Math.sin(this.bobTimer) * 0.065 * speedRatio;
      const bobAmtX = Math.cos(this.bobTimer * 0.5) * 0.03 * speedRatio;

      this.camera.position.y += bobAmtY;
      this.camera.position.x += bobAmtX;
    } else {
      this.bobTimer = 0.0;
    }

    // 3. Heaving Chest Breathing Sway
    const breatheSway = Math.sin(Date.now() * 0.003) * 0.045 * (1.0 - this.stamina / 100.0);
    this.camera.position.y += breatheSway;

    // Sync baseline rotation
    this.camera.quaternion.setFromEuler(this.rotation);

    // Apply vaulting forward camera rotation dip
    if (this.isVaulting && this.vaultTimer > 0) {
      const progress = (0.45 - this.vaultTimer) / 0.45;
      this.camera.rotation.x += Math.sin(progress * Math.PI) * 0.14;
    }

    // 4. Apply camera rolls & shaky eyes rotations after base sync
    if (isPhysMoving && this.isGrounded && !this.isSwimming) {
      const speedRatio = horizontalSpeed / this.runSpeed;
      const bobAmtX = Math.cos(this.bobTimer * 0.5) * 0.03 * speedRatio;
      this.camera.rotation.z += bobAmtX * 0.45; // camera roll tilt
    }

    if (this.isExhausted) {
      const fatigueFactor = 1.0 - this.stamina / 35.0;
      const shakeAmt = 0.0015 * fatigueFactor;
      this.camera.rotation.x += (Math.random() - 0.5) * shakeAmt;
      this.camera.rotation.y += (Math.random() - 0.5) * shakeAmt;
    }

    // Dynamic low-pass sound sweep
    Sound.updateFilter(this.isSwimming, this.stamina);
  }
}
