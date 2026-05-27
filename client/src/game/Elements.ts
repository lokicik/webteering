import * as THREE from 'three';
import { PlayerState, Checkpoint } from '../sharedTypes';

export class Elements {
  private scene: THREE.Scene;
  
  // Cache lists
  private otherPlayers: { [id: string]: THREE.Group } = {};
  private otherPlayersTarget: { [id: string]: { pos: THREE.Vector3; yaw: number; pitch: number; anim: string } } = {};
  
  private staticModelsGroup = new THREE.Group();
  private controlFlags: THREE.Group[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.staticModelsGroup);
  }

  // --- STATIC VOXEL ASSETS GENERATION ---

  // Build a charming low-poly spruce tree
  public createVoxelTree(x: number, y: number, z: number): THREE.Group {
    const tree = new THREE.Group();
    tree.position.set(x, y, z);

    // 1. Trunk (brown smooth cylinder post)
    const trunkGeom = new THREE.CylinderGeometry(0.12, 0.18, 3.2, 8);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c4033 });
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.y = 1.6;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    // 2. Conical spruce foliage layers (layered green branches)
    const foliageMat = new THREE.MeshLambertMaterial({ color: 0x14401e });
    
    // Bottom branch layer
    const fol1 = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.4, 8), foliageMat);
    fol1.position.y = 2.4;
    fol1.castShadow = true;
    tree.add(fol1);

    // Middle branch layer
    const fol2 = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.2, 8), foliageMat);
    fol2.position.y = 3.2;
    fol2.castShadow = true;
    tree.add(fol2);

    // Top spike branch layer
    const fol3 = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 8), foliageMat);
    fol3.position.y = 3.9;
    fol3.castShadow = true;
    tree.add(fol3);

    this.staticModelsGroup.add(tree);
    return tree;
  }

  // Build an organic stone boulder
  public createVoxelBoulder(x: number, y: number, z: number): THREE.Group {
    const boulder = new THREE.Group();
    boulder.position.set(x, y, z);

    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x707070 });
    
    // Stack multiple slightly overlapping Dodecahedrons for an organic stone shape
    const sizes = [
      { w: 1.1, ox: 0, oy: 0.5, oz: 0 },
      { w: 0.7, ox: 0.3, oy: 0.9, oz: -0.2 },
      { w: 0.6, ox: -0.4, oy: 0.7, oz: 0.3 }
    ];

    for (const s of sizes) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s.w, 1), stoneMat);
      rock.position.set(s.ox, s.oy, s.oz);
      rock.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
      rock.castShadow = true;
      rock.receiveShadow = true;
      boulder.add(rock);
    }

    this.staticModelsGroup.add(boulder);
    return boulder;
  }

  private flagMaterial: THREE.MeshLambertMaterial | null = null;

  private getFlagMaterial(): THREE.MeshLambertMaterial {
    if (!this.flagMaterial) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;

      // 100% compliant with IOF official rules: split diagonally from top-left to bottom-right
      ctx.fillStyle = '#ffffff'; // White upper-left triangle
      ctx.fillRect(0, 0, 256, 256);

      ctx.fillStyle = '#ff6600'; // Vibrant IOF orange lower-right triangle
      ctx.beginPath();
      ctx.moveTo(0, 256); // Bottom-left
      ctx.lineTo(256, 256); // Bottom-right
      ctx.lineTo(256, 0); // Top-right
      ctx.closePath();
      ctx.fill();

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      
      this.flagMaterial = new THREE.MeshLambertMaterial({
        map: texture,
        side: THREE.DoubleSide
      });
    }
    return this.flagMaterial;
  }

  // Build a glowing orange and white diagonal Voxel Control Flag
  public createControlFlag(cp: Checkpoint, y: number): THREE.Group {
    const flagGroup = new THREE.Group();
    flagGroup.position.set(cp.x, y, cp.z);
    flagGroup.name = `cp-${cp.id}`;

    // 1. Thin metal post
    const postGeom = new THREE.CylinderGeometry(0.03, 0.03, 2.0, 8);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
    const post = new THREE.Mesh(postGeom, postMat);
    post.position.y = 1.0;
    post.castShadow = true;
    flagGroup.add(post);

    // 2. The Orange/White diagonal prism flag (size: 0.6m)
    const flagBase = new THREE.Group();
    flagBase.position.y = 1.5;
    
    // Build the 3-sided voxel flag shape using panels
    const pSize = 0.55;
    
    // Create 3 sides of prism
    for (let i = 0; i < 3; i++) {
      const side = new THREE.Group();
      const angle = (i * Math.PI * 2) / 3;
      side.position.set(Math.sin(angle) * 0.28, 0, Math.cos(angle) * 0.28);
      side.rotation.y = angle + Math.PI;

      // Single plane split diagonally via procedural texture matching official IOF specifications
      const face = new THREE.Mesh(new THREE.PlaneGeometry(pSize, pSize), this.getFlagMaterial());
      face.position.y = 0;
      face.castShadow = true;
      side.add(face);

      flagBase.add(side);
    }
    
    flagGroup.add(flagBase);


    // 3. Faint orange locator point-light (stunning for night runs!)
    const light = new THREE.PointLight(0xff6600, 1.2, 8.0);
    light.position.y = 1.6;
    flagGroup.add(light);

    // 4. Code label (facing upward/ outward)
    const plateGeom = new THREE.BoxGeometry(0.2, 0.08, 0.2);
    const plateMat = new THREE.MeshLambertMaterial({ color: 0xff3333 });
    const plate = new THREE.Mesh(plateGeom, plateMat);
    plate.position.y = 2.0;
    flagGroup.add(plate);

    this.staticModelsGroup.add(flagGroup);
    this.controlFlags.push(flagGroup);
    
    return flagGroup;
  }

  // Clear static objects on map transition
  public clearStaticEntities() {
    while (this.staticModelsGroup.children.length > 0) {
      const child = this.staticModelsGroup.children[0];
      this.staticModelsGroup.remove(child);
    }
    this.controlFlags = [];
  }

  // --- MULTIPLAYER OTHER RUNNERS SYNCHRONIZATION ---

  // Build a charming voxel character skin model
  private buildVoxelRunner(colorHex: string): THREE.Group {
    const runner = new THREE.Group();

    // Materials
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffdbac }); // light beige head
    const jerseyMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(colorHex) });
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x222222 }); // black pants

    // 1. Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), jerseyMat);
    torso.position.y = 0.9;
    torso.castShadow = true;
    torso.receiveShadow = true;
    runner.add(torso);

    // 2. Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skinMat);
    head.position.y = 1.5;
    head.castShadow = true;
    runner.add(head);

    // Hair voxel
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.42), new THREE.MeshLambertMaterial({ color: 0x332211 }));
    hair.position.set(0, 1.63, -0.01);
    runner.add(hair);

    // 3. Legs
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), pantsMat);
    leftLeg.position.set(-0.18, 0.25, 0);
    leftLeg.castShadow = true;
    runner.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), pantsMat);
    rightLeg.position.set(0.18, 0.25, 0);
    rightLeg.castShadow = true;
    runner.add(rightLeg);

    // 4. Arms
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.38, 1.2, 0);
    const leftArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.18), jerseyMat);
    leftArmMesh.position.y = -0.3;
    leftArmMesh.castShadow = true;
    leftArm.add(leftArmMesh);
    runner.add(leftArm);

    const rightArm = new THREE.Group();
    rightArm.position.set(0.38, 1.2, 0);
    const rightArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.18), jerseyMat);
    rightArmMesh.position.y = -0.3;
    rightArmMesh.castShadow = true;
    rightArm.add(rightArmMesh);
    runner.add(rightArm);

    // Save leg/arm references inside sub-elements list
    runner.userData = { leftLeg, rightLeg, leftArm, rightArm };

    return runner;
  }

  // Update or Spawn other players from lobby lists
  public updateOtherPlayers(players: { [id: string]: PlayerState }, localPlayerId: string | null) {
    // 1. Clean disconnected players
    for (const pid in this.otherPlayers) {
      if (!players[pid] || pid === localPlayerId) {
        this.scene.remove(this.otherPlayers[pid]);
        delete this.otherPlayers[pid];
        delete this.otherPlayersTarget[pid];
      }
    }

    // 2. Spawn and cache targets
    for (const pid in players) {
      if (pid === localPlayerId) continue;
      
      const p = players[pid];

      if (!this.otherPlayers[pid]) {
        // Spawn voxel runner
        const runner = this.buildVoxelRunner(p.skinColor);
        this.scene.add(runner);
        this.otherPlayers[pid] = runner;
        
        // Initial position snap
        runner.position.set(p.x, p.y, p.z);
        
        this.otherPlayersTarget[pid] = {
          pos: new THREE.Vector3(p.x, p.y, p.z),
          yaw: p.rx,
          pitch: p.ry,
          anim: p.anim
        };
      } else {
        // Update interpolation target
        const target = this.otherPlayersTarget[pid];
        target.pos.set(p.x, p.y, p.z);
        target.yaw = p.rx;
        target.pitch = p.ry;
        target.anim = p.anim;
      }
    }
  }

  // Interpolate player positions and swing legs/arms if moving ( lerp looping )
  public update(delta: number) {
    const now = Date.now();

    for (const pid in this.otherPlayers) {
      const runner = this.otherPlayers[pid];
      const target = this.otherPlayersTarget[pid];
      if (!runner || !target) continue;

      // 1. Lerp Position
      runner.position.lerp(target.pos, 0.15);

      // 2. Lerp Yaw Rotation
      runner.rotation.y = THREE.MathUtils.lerp(runner.rotation.y, target.yaw, 0.15);

      // 3. Legs/Arms swinging animation based on speed/anim state
      const uData = runner.userData;
      if (target.anim === 'run') {
        const swingSpeed = 16.0;
        const swingAngle = Math.sin(now * 0.001 * swingSpeed) * 0.6;
        
        // Opposite swing
        uData.leftLeg.rotation.x = swingAngle;
        uData.rightLeg.rotation.x = -swingAngle;
        
        uData.leftArm.rotation.x = -swingAngle;
        uData.rightArm.rotation.x = swingAngle;
      } else if (target.anim === 'swim') {
        // Slow swimming motion
        const swimSpeed = 8.0;
        const swingAngle = Math.sin(now * 0.001 * swimSpeed) * 0.4;
        
        uData.leftLeg.rotation.x = swingAngle * 0.2;
        uData.rightLeg.rotation.x = -swingAngle * 0.2;
        
        uData.leftArm.rotation.x = Math.PI / 2 + swingAngle;
        uData.rightArm.rotation.x = Math.PI / 2 - swingAngle;
      } else {
        // Return to idle (zero swing)
        uData.leftLeg.rotation.x = 0;
        uData.rightLeg.rotation.x = 0;
        uData.leftArm.rotation.x = 0;
        uData.rightArm.rotation.x = 0;
      }
    }

    // Slowly rotate control flag prisms to look alive
    for (const flag of this.controlFlags) {
      const flagBase = flag.children[1];
      if (flagBase) {
        flagBase.rotation.y += 0.8 * delta;
      }

      // Slowly interpolate flashed green lights back to orange
      const light = flag.children.find(child => child instanceof THREE.PointLight) as THREE.PointLight;
      if (light && light.color.getHex() === 0x00ff00) {
        light.intensity = THREE.MathUtils.lerp(light.intensity, 1.2, 2.5 * delta);
        if (light.intensity <= 1.4) {
          light.color.setHex(0xff6600); // revert to orange
          light.intensity = 1.2;
        }
      }

      if (flagBase) {
        flagBase.traverse(child => {
          if (child instanceof THREE.Mesh && child.userData.originalEmissive !== undefined) {
            const mat = child.material as THREE.MeshLambertMaterial;
            if (mat.emissive && mat.emissive.getHex() === 0x00ff00) {
              const lerpColor = new THREE.Color(0x00ff00).clone().lerp(new THREE.Color(0xff6600), 2.5 * delta);
              mat.emissive.copy(lerpColor);
              mat.color.copy(lerpColor);
              if (mat.emissive.getHex() === 0xff6600) {
                delete child.userData.originalEmissive;
              }
            }
          }
        });
      }
    }
  }

  // Flash a specific flag green temporarily upon successfully punching it!
  public flashFlagGreen(cpId: number) {
    const flag = this.scene.getObjectByName(`cp-${cpId}`);
    if (flag) {
      // Find the PointLight child
      const light = flag.children.find(child => child instanceof THREE.PointLight) as THREE.PointLight;
      if (light) {
        light.color.setHex(0x00ff00); // neon green
        light.intensity = 4.5; // flash bright!
      }
      
      const flagBase = flag.children[1] as THREE.Group;
      if (flagBase) {
        flagBase.traverse(child => {
          if (child instanceof THREE.Mesh && child.material) {
            const mat = child.material as THREE.MeshLambertMaterial;
            if (mat.color && (mat.color.getHex() === 0xff6600 || mat.emissive?.getHex() === 0xff6600)) {
              child.userData.originalEmissive = 0xff6600;
              mat.emissive.setHex(0x00ff00);
              mat.color.setHex(0x00ff00);
            }
          }
        });
      }
    }
  }

  public removeOtherPlayers() {
    for (const pid in this.otherPlayers) {
      this.scene.remove(this.otherPlayers[pid]);
    }
    this.otherPlayers = {};
    this.otherPlayersTarget = {};
  }
}
