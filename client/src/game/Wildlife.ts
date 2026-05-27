import * as THREE from 'three';

export interface CollidableTerrain {
  getTerrainHeight(x: number, z: number): number;
  getBiome(): string;
}

export class WildlifeManager {
  private scene: THREE.Scene;
  private terrain: CollidableTerrain;
  private creatures: {
    mesh: THREE.Group;
    type: 'rabbit' | 'deer';
    velocity: THREE.Vector3;
    state: 'idle' | 'fleeing';
    idleTimer: number;
    targetYaw: number;
    currentYaw: number;
    bobTimer: number;
  }[] = [];

  constructor(scene: THREE.Scene, terrain: CollidableTerrain) {
    this.scene = scene;
    this.terrain = terrain;
  }

  public spawnCreatures(count: number = 30) {
    // Clear old creatures
    this.creatures.forEach(c => this.scene.remove(c.mesh));
    this.creatures = [];

    const halfMap = 180; // map size is 384, spawn within safe bounds
    for (let i = 0; i < count; i++) {
      const type = Math.random() < 0.65 ? 'rabbit' : 'deer';
      
      // Random coordinates
      const x = (Math.random() - 0.5) * halfMap * 1.8;
      const z = (Math.random() - 0.5) * halfMap * 1.8;
      const y = this.terrain.getTerrainHeight(x, z);

      // Do not spawn in deep water
      if (y <= 4.1) continue; 

      const mesh = type === 'rabbit' ? this.buildRabbit() : this.buildDeer();
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      this.creatures.push({
        mesh,
        type,
        velocity: new THREE.Vector3(0, 0, 0),
        state: 'idle',
        idleTimer: Math.random() * 3,
        targetYaw: Math.random() * Math.PI * 2,
        currentYaw: Math.random() * Math.PI * 2,
        bobTimer: Math.random() * 10
      });
    }
  }

  private buildRabbit(): THREE.Group {
    const rabbit = new THREE.Group();
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
    const pinkMat = new THREE.MeshLambertMaterial({ color: 0xffb6c1 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x333333 });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.42), whiteMat);
    body.position.y = 0.11;
    body.castShadow = true;
    body.receiveShadow = true;
    rabbit.add(body);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), whiteMat);
    head.position.set(0, 0.22, -0.16);
    head.castShadow = true;
    rabbit.add(head);

    // Ears
    const earL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), whiteMat);
    earL.position.set(-0.06, 0.40, -0.16);
    earL.castShadow = true;
    rabbit.add(earL);

    const innerL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.01), pinkMat);
    innerL.position.set(-0.06, 0.40, -0.195);
    rabbit.add(innerL);

    const earR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), whiteMat);
    earR.position.set(0.06, 0.40, -0.16);
    earR.castShadow = true;
    rabbit.add(earR);

    const innerR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.01), pinkMat);
    innerR.position.set(0.06, 0.40, -0.195);
    rabbit.add(innerR);

    // Eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), eyeMat);
    eyeL.position.set(-0.095, 0.24, -0.22);
    rabbit.add(eyeL);

    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), eyeMat);
    eyeR.position.set(0.095, 0.24, -0.22);
    rabbit.add(eyeR);

    // Tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), whiteMat);
    tail.position.set(0, 0.18, 0.22);
    rabbit.add(tail);

    return rabbit;
  }

  private buildDeer(): THREE.Group {
    const deer = new THREE.Group();
    const brownMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const blackMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.95), brownMat);
    body.position.y = 0.65;
    body.castShadow = true;
    body.receiveShadow = true;
    deer.add(body);

    // Belly patch
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.75), whiteMat);
    patch.position.set(0, 0.42, 0);
    deer.add(patch);

    // Legs
    const legGeom = new THREE.BoxGeometry(0.09, 0.6, 0.09);
    
    const legFL = new THREE.Mesh(legGeom, brownMat);
    legFL.position.set(-0.18, 0.3, -0.36);
    legFL.castShadow = true;
    deer.add(legFL);

    const legFR = new THREE.Mesh(legGeom, brownMat);
    legFR.position.set(0.18, 0.3, -0.36);
    legFR.castShadow = true;
    deer.add(legFR);

    const legBL = new THREE.Mesh(legGeom, brownMat);
    legBL.position.set(-0.18, 0.3, 0.36);
    legBL.castShadow = true;
    deer.add(legBL);

    const legBR = new THREE.Mesh(legGeom, brownMat);
    legBR.position.set(0.18, 0.3, 0.36);
    legBR.castShadow = true;
    deer.add(legBR);

    // Neck (angled up)
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.45, 0.18), brownMat);
    neck.position.set(0, 1.0, -0.42);
    neck.rotation.x = -Math.PI / 6;
    neck.castShadow = true;
    deer.add(neck);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.36), brownMat);
    head.position.set(0, 1.25, -0.58);
    head.castShadow = true;
    deer.add(head);

    // Nose tip
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.06), blackMat);
    nose.position.set(0, 1.20, -0.77);
    deer.add(nose);

    // Eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), eyeMat);
    eyeL.position.set(-0.105, 1.28, -0.68);
    deer.add(eyeL);

    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), eyeMat);
    eyeR.position.set(0.105, 1.28, -0.68);
    deer.add(eyeR);

    // Small white tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.08), whiteMat);
    tail.position.set(0, 0.85, 0.48);
    tail.rotation.x = Math.PI / 4;
    deer.add(tail);

    return deer;
  }

  public update(delta: number, playerPos: THREE.Vector3) {
    this.creatures.forEach(c => {
      // Distance check
      const dist = c.mesh.position.distanceTo(playerPos);

      // Flee trigger
      if (dist < 12.0) {
        c.state = 'fleeing';
      } else if (c.state === 'fleeing' && dist > 24.0) {
        c.state = 'idle';
        c.idleTimer = 1.0 + Math.random() * 4;
      }

      if (c.state === 'fleeing') {
        // Run away: calculate vector directly from player to creature
        const fleeDir = new THREE.Vector3()
          .copy(c.mesh.position)
          .sub(playerPos);
        fleeDir.y = 0;
        fleeDir.normalize();

        // Speed
        const speed = c.type === 'rabbit' ? 6.5 : 8.5;
        c.velocity.copy(fleeDir).multiplyScalar(speed);

        // Turn smoothly to face movement direction (Three.js standard is facing -Z)
        c.targetYaw = Math.atan2(fleeDir.x, fleeDir.z);
        
        // Bobbing/hopping motion
        c.bobTimer += delta * (c.type === 'rabbit' ? 16.0 : 11.0);
        const jumpY = Math.abs(Math.sin(c.bobTimer)) * (c.type === 'rabbit' ? 0.35 : 0.65);
        
        // Update horizontal position
        const nextX = c.mesh.position.x + c.velocity.x * delta;
        const nextZ = c.mesh.position.z + c.velocity.z * delta;
        const terrainY = this.terrain.getTerrainHeight(nextX, nextZ);

        c.mesh.position.set(nextX, terrainY + jumpY, nextZ);
      } else {
        // Idle wandering
        c.idleTimer -= delta;
        if (c.idleTimer <= 0) {
          c.idleTimer = 2.0 + Math.random() * 5.0;
          if (Math.random() < 0.35) {
            // Pick a new random wandering direction
            c.targetYaw = Math.random() * Math.PI * 2;
            c.velocity.set(Math.sin(c.targetYaw), 0, Math.cos(c.targetYaw)).multiplyScalar(0.5 + Math.random() * 0.8);
          } else {
            c.velocity.set(0, 0, 0); // rest
          }
        }

        // Slowly decay wandering bob
        if (c.velocity.lengthSq() > 0.01) {
          c.bobTimer += delta * 6.0;
          const jumpY = Math.abs(Math.sin(c.bobTimer)) * 0.08;
          
          const nextX = c.mesh.position.x + c.velocity.x * delta;
          const nextZ = c.mesh.position.z + c.velocity.z * delta;
          const terrainY = this.terrain.getTerrainHeight(nextX, nextZ);
          c.mesh.position.set(nextX, terrainY + jumpY, nextZ);
        } else {
          const terrainY = this.terrain.getTerrainHeight(c.mesh.position.x, c.mesh.position.z);
          c.mesh.position.y = terrainY; // rest on ground
        }
      }

      // Smooth yaw rotation
      let diff = c.targetYaw - c.currentYaw;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      c.currentYaw += diff * 8.0 * delta;
      c.mesh.rotation.y = c.currentYaw;
    });
  }

  public dispose() {
    this.creatures.forEach(c => this.scene.remove(c.mesh));
    this.creatures = [];
  }
}
