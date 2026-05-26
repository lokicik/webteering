import * as THREE from 'three';
import { Sound } from '../ui/Sound';

export interface CollidableTerrain {
  getTerrainHeight(x: number, z: number): number;
  getTerrainType(x: number, z: number): string;
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

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, terrain: CollidableTerrain) {
    this.camera = camera;
    this.domElement = domElement;
    this.terrain = terrain;

    this.initKeyboard();
    this.initMouse();
    
    // Set initial position
    this.position.copy(camera.position);
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
      
      // Developer flight toggle shortcut (F key)
      if (e.code === 'KeyF') {
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

    // --- 1. GET RUNNABILITY SPEED MULTIPLIER ---
    const currentTerrainType = this.terrain.getTerrainType(this.position.x, this.position.z);
    let speedMultiplier = 1.0;
    this.isSwimming = false;

    switch (currentTerrainType) {
      case 'field':
        speedMultiplier = 1.0;
        break;
      case 'forest':
        speedMultiplier = 0.85;
        break;
      case 'walk':
        speedMultiplier = 0.60;
        break;
      case 'thicket':
        speedMultiplier = 0.35;
        break;
      case 'water':
        speedMultiplier = 0.25;
        this.isSwimming = true;
        break;
      case 'path':
        speedMultiplier = 1.10; // Extra speed on clear tracks!
        break;
      default:
        speedMultiplier = 1.0;
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

    if (isMoving && !this.keys.ShiftLeft && !this.isFlightMode) {
      // Draining stamina
      let drainRate = 6.0; // base running drain
      if (currentTerrainType === 'walk') drainRate = 10.0;
      else if (currentTerrainType === 'thicket') drainRate = 14.0;
      else if (currentTerrainType === 'water') drainRate = 12.0;
      
      this.stamina = Math.max(0.0, this.stamina - drainRate * delta);
    } else {
      // Recovering stamina
      const recoveryRate = isMoving ? 10.0 : 18.0;
      this.stamina = Math.min(100.0, this.stamina + recoveryRate * delta);
    }

    // Exhaustion state locks
    if (this.stamina <= 0.0) {
      this.isExhausted = true;
    } else if (this.isExhausted && this.stamina >= 35.0) {
      this.isExhausted = false; // must recover to 35% to clear fatigue
    }

    // Apply exhaustion speed caps (40% speed)
    if (this.isExhausted) {
      speedMultiplier *= 0.40;
    }

    // Apply steep slip stumble speed penalty (25% speed)
    if (this.slipTimer > 0) {
      speedMultiplier *= 0.25;
    }

    // Walking / jogging toggle (Slow Shift)
    if (this.keys.ShiftLeft) {
      speedMultiplier *= 0.45;
    }

    // Map reading speed penalty (15% slower when map is open)
    const mapPanel = document.getElementById('map-panel');
    const isMapOpen = mapPanel && !mapPanel.classList.contains('hidden');
    if (isMapOpen) {
      speedMultiplier *= 0.85;
    }

    // Stun recovery multiplier
    if (this.stunTimer > 0) {
      speedMultiplier *= 0.3;
    }

    const currentSpeed = this.runSpeed * speedMultiplier;

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
      const waterHeight = this.terrain.getTerrainHeight(this.position.x, this.position.z);
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
        // Jump trigger
        this.velocity.y = this.jumpStrength;
        this.isGrounded = false;
      }
    }

    // Horizontal velocity interpolation (inertia/friction)
    const targetVelX = rotatedMove.x * currentSpeed;
    const targetVelZ = rotatedMove.z * currentSpeed;
    
    const accelRate = this.isGrounded ? 15.0 : 4.0; // Less control in air
    this.velocity.x += (targetVelX - this.velocity.x) * accelRate * delta;
    this.velocity.z += (targetVelZ - this.velocity.z) * accelRate * delta;

    // --- 4. STEP CLIMB & COLLISION VERIFICATION ---
    const nextPos = this.position.clone().addScaledVector(new THREE.Vector3(this.velocity.x, 0, this.velocity.z), delta);
    const targetFloorHeight = this.terrain.getTerrainHeight(nextPos.x, nextPos.z);
    
    const heightDiff = targetFloorHeight - this.position.y;

    if (heightDiff > 1.2) {
      // Wall block: Height is too high to step up. Block horizontal velocity!
      this.velocity.x = 0;
      this.velocity.z = 0;
    } else {
      // Step up: Height is low, slide player onto next height elevation smoothly
      this.position.x = nextPos.x;
      this.position.z = nextPos.z;
      
      if (heightDiff > 0 && this.isGrounded) {
        // Upward slope running penalty: slows climbing slightly
        this.position.y += heightDiff * 0.8;
      }

      // Slope slipping check (descending slope slips)
      if (this.isGrounded && !this.isSwimming && !this.isFlightMode && this.slipTimer <= 0.0) {
        if (heightDiff < -0.8 && isMoving && !this.keys.ShiftLeft) {
          // 10% chance per second of slipping on steep declines
          const slipChance = 0.10 * delta;
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
    
    if (this.position.y <= currentFloorHeight) {
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
    this.camera.quaternion.setFromEuler(this.rotation);
  }
}
