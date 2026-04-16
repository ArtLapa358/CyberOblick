/**
 * КиберОблик v2.0 — 3D Avatar Renderer (avatar3d.js)
 * Three.js scene with proper IK arms, torso tracking, leg sway
 *
 * KEY FIX: Arms now use proper shoulder-pivot IK.
 * MediaPipe hand coords (0..1 normalized, mirrored) are mapped to
 * avatar-space shoulder-relative angles, not raw rotation.
 */

class Avatar3D {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.avatar = null;
    this.bones = {};
    this.clock = new THREE.Clock();

    this.teamColors = { primary: '#00F0FF', accent: '#8B00FF' };
    this.equipment = new Set();
    this.equipMeshes = {};
    this.background = 'cyber-grid';

    this.gridHelper = null;
    this.lights = [];
    this.particles = null;
    this._hasExternalInput = false;

    // Rest poses for arms (when no hand tracking)
    this._restPose = {
      leftArm: { x: 0, z: 0.15 },
      rightArm: { x: 0, z: -0.15 }
    };
  }

  init() {
    const w = this.canvas.parentElement.clientWidth;
    const h = this.canvas.parentElement.clientHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, alpha: true, antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    this._setupBackground();

    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    this.camera.position.set(0, 1.2, 4.0);
    this.camera.lookAt(0, 0.9, 0);

    this._setupLights();
    this._createAvatar();
    this._createParticles();

    window.addEventListener('resize', () => this._onResize());
    this._animate();
    console.log('[Avatar3D] Scene initialized');
  }

  // ══════════════════════════════════════════
  //  Scene Setup
  // ══════════════════════════════════════════

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x334455, 0.4));
    const key = new THREE.DirectionalLight(0x00f0ff, 0.8);
    key.position.set(2, 3, 2); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8b00ff, 0.4);
    fill.position.set(-2, 2, -1);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xff2d7c, 0.6, 10);
    rim.position.set(0, 2, -2);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.ShadowMaterial({ opacity: 0.3 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  _setupBackground() {
    if (this.gridHelper) { this.scene.remove(this.gridHelper); this.gridHelper = null; }
    if (this.background === 'cyber-grid') {
      this.scene.background = new THREE.Color(0x0a0a0f);
      this.scene.fog = new THREE.FogExp2(0x0a0a0f, 0.12);
      const grid = new THREE.GridHelper(20, 40, 0x00f0ff, 0x111128);
      grid.material.opacity = 0.15; grid.material.transparent = true;
      this.scene.add(grid); this.gridHelper = grid;
    } else if (this.background === 'dark') {
      this.scene.background = new THREE.Color(0x0a0a0f); this.scene.fog = null;
    } else if (this.background === 'gradient') {
      this.scene.background = new THREE.Color(0x0f0a1a);
      this.scene.fog = new THREE.FogExp2(0x0f0a1a, 0.08);
    } else {
      this.scene.background = null; this.scene.fog = null;
    }
  }

  _createParticles() {
    const count = 200;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3] = (Math.random()-0.5)*10;
      pos[i*3+1] = Math.random()*5;
      pos[i*3+2] = (Math.random()-0.5)*10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x00f0ff, size: 0.02, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending
    }));
    this.scene.add(this.particles);
  }

  // ══════════════════════════════════════════
  //  Procedural Avatar — full body with proper pivots
  // ══════════════════════════════════════════

  _createAvatar() {
    this.avatar = new THREE.Group();
    const pc = new THREE.Color(this.teamColors.primary);
    const ac = new THREE.Color(this.teamColors.accent);

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc8a88a, roughness: 0.7, metalness: 0.1 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: pc, roughness: 0.3, metalness: 0.6, emissive: pc, emissiveIntensity: 0.05 });
    const accentMat = new THREE.MeshStandardMaterial({ color: ac, roughness: 0.2, metalness: 0.8, emissive: ac, emissiveIntensity: 0.1 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a28, roughness: 0.5, metalness: 0.3 });

    // ═══ HIP ROOT (everything pivots from here) ═══
    const hipRoot = new THREE.Group();
    hipRoot.position.set(0, 0.85, 0);
    this.bones.hipRoot = hipRoot;

    // ── Torso (child of hip) ──
    const torsoGroup = new THREE.Group();
    torsoGroup.position.set(0, 0.3, 0); // relative to hip
    this.bones.torso = torsoGroup;

    const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.2), bodyMat);
    torsoMesh.castShadow = true;
    torsoGroup.add(torsoMesh);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.21), accentMat);
    stripe.position.y = 0.1;
    torsoGroup.add(stripe);

    // ── Neck ──
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 12), skinMat);
    neck.position.set(0, 0.3, 0);
    this.bones.neck = neck;
    torsoGroup.add(neck);

    // ── Head (child of torso) ──
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.42, 0);
    this.bones.head = headGroup;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 24), skinMat);
    skull.scale.set(1, 1.1, 1); skull.castShadow = true;
    headGroup.add(skull);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.025, 12, 12);
    const lEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
    lEye.position.set(-0.05, 0.02, 0.13);
    this.bones.leftEye = lEye;
    headGroup.add(lEye);

    const rEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
    rEye.position.set(0.05, 0.02, 0.13);
    this.bones.rightEye = rEye;
    headGroup.add(rEye);

    // Mouth
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.005, 0.02), darkMat);
    mouth.position.set(0, -0.06, 0.13);
    this.bones.mouth = mouth;
    headGroup.add(mouth);

    // Brows
    const browGeo = new THREE.BoxGeometry(0.04, 0.008, 0.01);
    const lBrow = new THREE.Mesh(browGeo, darkMat);
    lBrow.position.set(-0.05, 0.07, 0.14);
    this.bones.leftBrow = lBrow;
    headGroup.add(lBrow);
    const rBrow = new THREE.Mesh(browGeo, darkMat);
    rBrow.position.set(0.05, 0.07, 0.14);
    this.bones.rightBrow = rBrow;
    headGroup.add(rBrow);

    torsoGroup.add(headGroup);

    // ═══ ARMS — proper shoulder pivot IK ═══
    // Arms are Groups at shoulder position. The upper arm mesh hangs DOWN from origin.
    // When we rotate the group, the arm swings naturally from the shoulder.

    // LEFT ARM
    const leftShoulderPivot = new THREE.Group();
    leftShoulderPivot.position.set(-0.2, 0.2, 0); // shoulder pos relative to torso
    this.bones.leftShoulder = leftShoulderPivot;

    const leftUpperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, 0.3, 8), bodyMat
    );
    leftUpperArm.position.y = -0.15; // hanging down from pivot
    leftUpperArm.castShadow = true;
    leftShoulderPivot.add(leftUpperArm);

    // Left elbow pivot
    const leftElbowPivot = new THREE.Group();
    leftElbowPivot.position.set(0, -0.3, 0);
    this.bones.leftElbow = leftElbowPivot;

    const leftForearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 0.25, 8), bodyMat
    );
    leftForearm.position.y = -0.125;
    leftElbowPivot.add(leftForearm);

    // Left hand
    const leftHand = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8), skinMat
    );
    leftHand.position.set(0, -0.27, 0);
    leftHand.scale.set(1, 0.6, 0.8);
    this.bones.leftHand = leftHand;
    leftElbowPivot.add(leftHand);

    leftShoulderPivot.add(leftElbowPivot);
    torsoGroup.add(leftShoulderPivot);

    // RIGHT ARM (mirror)
    const rightShoulderPivot = new THREE.Group();
    rightShoulderPivot.position.set(0.2, 0.2, 0);
    this.bones.rightShoulder = rightShoulderPivot;

    const rightUpperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, 0.3, 8), bodyMat
    );
    rightUpperArm.position.y = -0.15;
    rightUpperArm.castShadow = true;
    rightShoulderPivot.add(rightUpperArm);

    const rightElbowPivot = new THREE.Group();
    rightElbowPivot.position.set(0, -0.3, 0);
    this.bones.rightElbow = rightElbowPivot;

    const rightForearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 0.25, 8), bodyMat
    );
    rightForearm.position.y = -0.125;
    rightElbowPivot.add(rightForearm);

    const rightHand = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8), skinMat
    );
    rightHand.position.set(0, -0.27, 0);
    rightHand.scale.set(1, 0.6, 0.8);
    this.bones.rightHand = rightHand;
    rightElbowPivot.add(rightHand);

    rightShoulderPivot.add(rightElbowPivot);
    torsoGroup.add(rightShoulderPivot);

    hipRoot.add(torsoGroup);

    // ═══ LEGS (children of hip) ═══
    const legGeo = new THREE.CylinderGeometry(0.04, 0.035, 0.4, 8);

    // Left leg pivot
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.08, -0.05, 0);
    this.bones.leftLeg = leftLegPivot;

    const leftLegMesh = new THREE.Mesh(legGeo, darkMat);
    leftLegMesh.position.y = -0.2;
    leftLegMesh.castShadow = true;
    leftLegPivot.add(leftLegMesh);

    // Left shin
    const leftShinPivot = new THREE.Group();
    leftShinPivot.position.set(0, -0.4, 0);
    this.bones.leftShin = leftShinPivot;

    const leftShin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.03, 0.38, 8), darkMat
    );
    leftShin.position.y = -0.19;
    leftShinPivot.add(leftShin);

    // Left foot
    const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.1), accentMat);
    leftFoot.position.set(0, -0.4, 0.02);
    this.bones.leftFoot = leftFoot;
    leftShinPivot.add(leftFoot);

    leftLegPivot.add(leftShinPivot);
    hipRoot.add(leftLegPivot);

    // Right leg (mirror)
    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.08, -0.05, 0);
    this.bones.rightLeg = rightLegPivot;

    const rightLegMesh = new THREE.Mesh(legGeo, darkMat);
    rightLegMesh.position.y = -0.2;
    rightLegMesh.castShadow = true;
    rightLegPivot.add(rightLegMesh);

    const rightShinPivot = new THREE.Group();
    rightShinPivot.position.set(0, -0.4, 0);
    this.bones.rightShin = rightShinPivot;

    const rightShin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.03, 0.38, 8), darkMat
    );
    rightShin.position.y = -0.19;
    rightShinPivot.add(rightShin);

    const rightFoot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.1), accentMat);
    rightFoot.position.set(0, -0.4, 0.02);
    this.bones.rightFoot = rightFoot;
    rightShinPivot.add(rightFoot);

    rightLegPivot.add(rightShinPivot);
    hipRoot.add(rightLegPivot);

    this.avatar.add(hipRoot);
    this.scene.add(this.avatar);
  }

  // ══════════════════════════════════════════
  //  Bone Updates — Face + Body
  // ══════════════════════════════════════════

  updateFace(faceData) {
    if (!faceData || !this.bones.head) return;
    const { rotation, expressions, position, body } = faceData;
    const L = THREE.MathUtils.lerp;

    // ── Head ──
    const h = this.bones.head;
    h.rotation.y = L(h.rotation.y, -rotation.yaw * 0.8, 0.3);
    h.rotation.x = L(h.rotation.x, -rotation.pitch * 0.5, 0.3);
    h.rotation.z = L(h.rotation.z, rotation.roll * 0.5, 0.3);

    // Subtle head position shift
    h.position.x = L(h.position.x, position.x * 0.08, 0.2);
    h.position.y = L(h.position.y, 0.42 + position.y * 0.05, 0.2);

    // ── Mouth ──
    if (this.bones.mouth) {
      this.bones.mouth.scale.y = L(this.bones.mouth.scale.y, 1 + expressions.mouthOpen * 8, 0.4);
      this.bones.mouth.position.y = L(this.bones.mouth.position.y, -0.06 - expressions.mouthOpen * 0.02, 0.4);
      this.bones.mouth.scale.x = L(this.bones.mouth.scale.x, 1 + expressions.smile * 1.5, 0.3);
    }

    // ── Eyes ──
    if (this.bones.leftEye)
      this.bones.leftEye.scale.y = L(this.bones.leftEye.scale.y, 1 - expressions.leftBlink * 0.9, 0.5);
    if (this.bones.rightEye)
      this.bones.rightEye.scale.y = L(this.bones.rightEye.scale.y, 1 - expressions.rightBlink * 0.9, 0.5);

    // Eye glow on smile
    const glow = 0.5 + expressions.smile * 0.5;
    if (this.bones.leftEye) this.bones.leftEye.material.emissiveIntensity = glow;
    if (this.bones.rightEye) this.bones.rightEye.material.emissiveIntensity = glow;

    // ── Brows ──
    if (this.bones.leftBrow)
      this.bones.leftBrow.position.y = L(this.bones.leftBrow.position.y, 0.07 + expressions.leftBrowRaise * 0.02, 0.3);
    if (this.bones.rightBrow)
      this.bones.rightBrow.position.y = L(this.bones.rightBrow.position.y, 0.07 + expressions.rightBrowRaise * 0.02, 0.3);

    // ═══ TORSO TRACKING ═══
    if (body && this.bones.torso) {
      const t = this.bones.torso;
      // Torso leans with head movement
      t.rotation.y = L(t.rotation.y, body.torsoLeanY, 0.15);
      t.rotation.z = L(t.rotation.z, body.torsoLeanZ, 0.15);
      t.position.x = L(t.position.x, body.torsoLeanX * 0.1, 0.1);
    }

    // ═══ HIP / LEG TRACKING ═══
    if (body && this.bones.hipRoot) {
      const hip = this.bones.hipRoot;
      // Subtle hip sway following head
      hip.position.x = L(hip.position.x, body.hipShiftX * 0.15, 0.1);
      hip.position.y = L(hip.position.y, 0.85 + body.hipShiftY * 0.05, 0.1);

      // Legs: weight shift
      if (this.bones.leftLeg && this.bones.rightLeg) {
        // When leaning left, left leg bends slightly, right extends
        const shift = body.hipShiftX; // negative = left
        this.bones.leftLeg.rotation.x = L(
          this.bones.leftLeg.rotation.x, Math.max(0, -shift) * 0.15, 0.1
        );
        this.bones.rightLeg.rotation.x = L(
          this.bones.rightLeg.rotation.x, Math.max(0, shift) * 0.15, 0.1
        );
        // Z rotation: slight outward lean
        this.bones.leftLeg.rotation.z = L(
          this.bones.leftLeg.rotation.z, shift * 0.08, 0.1
        );
        this.bones.rightLeg.rotation.z = L(
          this.bones.rightLeg.rotation.z, shift * 0.08, 0.1
        );
      }
    }
  }

  /**
   * Update arms from hand tracking data.
   *
   * MediaPipe hand landmarks are in normalized screen coords (0..1).
   * Camera is mirrored, so we already flipped L/R labels in mocap.js.
   *
   * Strategy: map wrist position to shoulder-relative angle using simple 2-bone IK.
   * - Wrist.x → shoulder Z rotation (abduction: arm out to side)
   * - Wrist.y → shoulder X rotation (arm forward/up/down)
   * - Elbow angle derived from wrist-to-shoulder distance
   */
  updateHands(handsData) {
    if (!handsData) return;
    const L = THREE.MathUtils.lerp;

    // ── LEFT HAND ──
    if (handsData.left && this.bones.leftShoulder) {
      const wrist = handsData.left[0];
      const middleTip = handsData.left[12];

      // Map wrist screen position to arm angles
      // wrist.x: 0 = right side of screen, 1 = left (mirrored camera)
      // wrist.y: 0 = top, 1 = bottom

      // Shoulder abduction (Z): arm goes out when hand moves away from body center
      // For left arm: higher x values (toward left of screen) = arm goes out
      const abduction = (wrist.x - 0.3) * 2.5; // centered around body
      const shoulderZ = THREE.MathUtils.clamp(abduction * 0.8, -0.3, Math.PI * 0.6);

      // Shoulder flexion (X): arm goes forward/up when hand goes up
      const elevation = (0.5 - wrist.y) * 3.0;
      const shoulderX = THREE.MathUtils.clamp(elevation * 0.6, -Math.PI * 0.4, Math.PI * 0.5);

      // Elbow bend: based on distance from wrist to estimated shoulder position
      const elbowAngle = this._calcElbowAngle(wrist, middleTip);

      this.bones.leftShoulder.rotation.z = L(this.bones.leftShoulder.rotation.z, shoulderZ, 0.25);
      this.bones.leftShoulder.rotation.x = L(this.bones.leftShoulder.rotation.x, shoulderX, 0.25);

      if (this.bones.leftElbow) {
        this.bones.leftElbow.rotation.x = L(this.bones.leftElbow.rotation.x, elbowAngle, 0.25);
      }

      // Hand curl
      if (this.bones.leftHand) {
        const curl = this._getFingerCurl(handsData.left);
        this.bones.leftHand.scale.x = L(this.bones.leftHand.scale.x, 1 - curl * 0.3, 0.3);
      }
    } else if (this.bones.leftShoulder) {
      // Return to rest pose
      this.bones.leftShoulder.rotation.z = L(this.bones.leftShoulder.rotation.z, 0.15, 0.08);
      this.bones.leftShoulder.rotation.x = L(this.bones.leftShoulder.rotation.x, 0, 0.08);
      if (this.bones.leftElbow) {
        this.bones.leftElbow.rotation.x = L(this.bones.leftElbow.rotation.x, 0, 0.08);
      }
    }

    // ── RIGHT HAND ── (mirrored logic)
    if (handsData.right && this.bones.rightShoulder) {
      const wrist = handsData.right[0];
      const middleTip = handsData.right[12];

      // Right arm: lower x values = arm goes out
      const abduction = (0.7 - wrist.x) * 2.5;
      const shoulderZ = THREE.MathUtils.clamp(-abduction * 0.8, -Math.PI * 0.6, 0.3);

      const elevation = (0.5 - wrist.y) * 3.0;
      const shoulderX = THREE.MathUtils.clamp(elevation * 0.6, -Math.PI * 0.4, Math.PI * 0.5);

      const elbowAngle = this._calcElbowAngle(wrist, middleTip);

      this.bones.rightShoulder.rotation.z = L(this.bones.rightShoulder.rotation.z, shoulderZ, 0.25);
      this.bones.rightShoulder.rotation.x = L(this.bones.rightShoulder.rotation.x, shoulderX, 0.25);

      if (this.bones.rightElbow) {
        this.bones.rightElbow.rotation.x = L(this.bones.rightElbow.rotation.x, elbowAngle, 0.25);
      }

      if (this.bones.rightHand) {
        const curl = this._getFingerCurl(handsData.right);
        this.bones.rightHand.scale.x = L(this.bones.rightHand.scale.x, 1 - curl * 0.3, 0.3);
      }
    } else if (this.bones.rightShoulder) {
      this.bones.rightShoulder.rotation.z = L(this.bones.rightShoulder.rotation.z, -0.15, 0.08);
      this.bones.rightShoulder.rotation.x = L(this.bones.rightShoulder.rotation.x, 0, 0.08);
      if (this.bones.rightElbow) {
        this.bones.rightElbow.rotation.x = L(this.bones.rightElbow.rotation.x, 0, 0.08);
      }
    }
  }

  /**
   * Calculate elbow bend from wrist/fingertip relationship
   */
  _calcElbowAngle(wrist, middleTip) {
    if (!middleTip) return 0;
    // When fingers point up relative to wrist → elbow is bent
    const dy = wrist.y - middleTip.y;
    const dx = Math.abs(wrist.x - middleTip.x);
    const angle = Math.atan2(dy, dx + 0.01);
    return THREE.MathUtils.clamp(angle * 0.8, -0.2, Math.PI * 0.5);
  }

  _getFingerCurl(landmarks) {
    if (!landmarks || landmarks.length < 21) return 0;
    const wrist = landmarks[0];
    let totalCurl = 0;
    [8, 12, 16, 20].forEach(tipIdx => {
      const tip = landmarks[tipIdx];
      const dist = Math.sqrt((tip.x - wrist.x) ** 2 + (tip.y - wrist.y) ** 2);
      totalCurl += Math.max(0, 1 - dist * 5);
    });
    return totalCurl / 4;
  }

  // ══════════════════════════════════════════
  //  Equipment
  // ══════════════════════════════════════════

  toggleEquipment(equipId) {
    if (this.equipment.has(equipId)) {
      this.equipment.delete(equipId);
      this._removeEquipMesh(equipId);
      return false;
    }
    this.equipment.add(equipId);
    this._addEquipMesh(equipId);
    return true;
  }

  _addEquipMesh(equipId) {
    const ac = new THREE.Color(this.teamColors.accent);
    const glowMat = new THREE.MeshStandardMaterial({
      color: ac, emissive: ac, emissiveIntensity: 0.3,
      metalness: 0.8, roughness: 0.2, transparent: true, opacity: 0.9
    });
    let mesh;
    switch (equipId) {
      case 'helmet-cyber':
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.17, 16, 16, 0, Math.PI*2, 0, Math.PI*0.6), glowMat
        );
        mesh.position.set(0, 0.04, 0);
        this.bones.head.add(mesh);
        break;
      case 'visor-holo':
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.04, 0.05),
          new THREE.MeshStandardMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.5, emissive: 0x00f0ff, emissiveIntensity: 0.4 })
        );
        mesh.position.set(0, 0.02, 0.15);
        this.bones.head.add(mesh);
        break;
      case 'mask-neon':
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.1, 0.03),
          new THREE.MeshStandardMaterial({ color: 0xff2d7c, transparent: true, opacity: 0.7, emissive: 0xff2d7c, emissiveIntensity: 0.5 })
        );
        mesh.position.set(0, -0.03, 0.15);
        this.bones.head.add(mesh);
        break;
      case 'ears-cat': {
        const earGeo = new THREE.ConeGeometry(0.04, 0.08, 4);
        const l = new THREE.Mesh(earGeo, glowMat.clone());
        l.position.set(-0.1, 0.16, 0); l.rotation.z = -0.2;
        const r = new THREE.Mesh(earGeo, glowMat.clone());
        r.position.set(0.1, 0.16, 0); r.rotation.z = 0.2;
        mesh = new THREE.Group(); mesh.add(l, r);
        this.bones.head.add(mesh);
        break;
      }
      case 'jacket-tech':
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.52, 0.22), glowMat);
        this.bones.torso.add(mesh);
        break;
      case 'wings-holo': {
        const wMat = new THREE.MeshStandardMaterial({
          color: ac, transparent: true, opacity: 0.3,
          emissive: ac, emissiveIntensity: 0.4, side: THREE.DoubleSide
        });
        const lw = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), wMat);
        lw.position.set(-0.3, 0.1, -0.12); lw.rotation.y = 0.5;
        const rw = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), wMat);
        rw.position.set(0.3, 0.1, -0.12); rw.rotation.y = -0.5;
        mesh = new THREE.Group(); mesh.add(lw, rw);
        this.bones.torso.add(mesh);
        break;
      }
    }
    if (mesh) this.equipMeshes[equipId] = mesh;
  }

  _removeEquipMesh(equipId) {
    const m = this.equipMeshes[equipId];
    if (m && m.parent) m.parent.remove(m);
    delete this.equipMeshes[equipId];
  }

  // ══════════════════════════════════════════
  //  Customization
  // ══════════════════════════════════════════

  setTeamColors(primary, accent) {
    this.teamColors.primary = primary;
    this.teamColors.accent = accent;
    document.documentElement.style.setProperty('--accent', primary);
    document.documentElement.style.setProperty('--accent-2', accent);
    if (this.avatar) {
      this.scene.remove(this.avatar);
      this._createAvatar();
      const eq = [...this.equipment]; this.equipment.clear(); this.equipMeshes = {};
      eq.forEach(e => this.toggleEquipment(e));
    }
  }

  setBackground(type) {
    this.background = type;
    this._setupBackground();
  }

  getCanvasStream(fps = 30) { return this.canvas.captureStream(fps); }

  captureFrame(w, h) {
    const pw = this.renderer.domElement.width, ph = this.renderer.domElement.height;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setSize(pw, ph);
    this.camera.aspect = pw / ph; this.camera.updateProjectionMatrix();
    return url;
  }

  // ══════════════════════════════════════════
  //  Render Loop
  // ══════════════════════════════════════════

  _animate() {
    requestAnimationFrame(() => this._animate());
    const time = this.clock.getElapsedTime();

    // Idle animations when no mocap
    if (this.bones.torso) {
      // Breathing
      const breathOffset = Math.sin(time * 2) * 0.003;
      if (!this._hasExternalInput) {
        this.bones.torso.position.y = 0.3 + breathOffset;
      }
    }
    if (this.bones.head && !this._hasExternalInput) {
      this.bones.head.rotation.y = Math.sin(time * 0.5) * 0.05;
      this.bones.head.rotation.x = Math.sin(time * 0.7) * 0.02;
    }

    // Idle arm sway when no hand tracking
    if (!this._hasExternalInput) {
      if (this.bones.leftShoulder) {
        this.bones.leftShoulder.rotation.x = Math.sin(time * 0.8) * 0.03;
      }
      if (this.bones.rightShoulder) {
        this.bones.rightShoulder.rotation.x = Math.sin(time * 0.8 + Math.PI) * 0.03;
      }
    }

    // Particles
    if (this.particles) {
      this.particles.rotation.y = time * 0.02;
      const p = this.particles.geometry.attributes.position.array;
      for (let i = 1; i < p.length; i += 3) {
        p[i] += Math.sin(time + i) * 0.0005;
        if (p[i] > 5) p[i] = 0;
      }
      this.particles.geometry.attributes.position.needsUpdate = true;
    }

    // Wing flap
    if (this.equipMeshes['wings-holo']) {
      const w = this.equipMeshes['wings-holo'];
      w.children[0].rotation.y = 0.5 + Math.sin(time * 3) * 0.15;
      w.children[1].rotation.y = -0.5 - Math.sin(time * 3) * 0.15;
    }

    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const w = this.canvas.parentElement.clientWidth;
    const h = this.canvas.parentElement.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  getConfig() {
    return { teamColors: { ...this.teamColors }, equipment: [...this.equipment], background: this.background };
  }

  loadConfig(config) {
    if (config.teamColors) this.setTeamColors(config.teamColors.primary, config.teamColors.accent);
    if (config.background) this.setBackground(config.background);
    if (config.equipment) config.equipment.forEach(e => { if (!this.equipment.has(e)) this.toggleEquipment(e); });
  }
}

window.Avatar3D = Avatar3D;
