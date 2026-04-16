/**
 * КиберОблик v2.0 — 3D Avatar Renderer (avatar3d.js)
 * Three.js scene with proper IK arms, torso tracking, leg sway
 *
 * KEY FIX: Arms now use proper shoulder-pivot IK.
 * Uses face/body pose data for natural head and torso movement.
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
    this.lights = [];
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
    key.position.set(2, 3, 2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8b00ff, 0.4);
    fill.position.set(-2, 2, -1);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xff2d7c, 0.6, 10);
    rim.position.set(0, 2, -2);
    this.scene.add(rim);
  }

  _setupBackground() {
    this.scene.background = null;
    this.scene.fog = null;
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
    skull.scale.set(1, 1.1, 1);
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

  updateFace(faceData, options = { head: true, body: true }) {
    if (!faceData || !this.bones.head) return;
    const { rotation, expressions, position, body } = faceData;
    const L = THREE.MathUtils.lerp;
    const headActive = options.head !== false;
    const bodyActive = options.body !== false;

    if (headActive) {
      const h = this.bones.head;
      h.rotation.y = L(h.rotation.y, -rotation.yaw * 0.8, 0.3);
      h.rotation.x = L(h.rotation.x, -rotation.pitch * 0.5, 0.3);
      h.rotation.z = L(h.rotation.z, rotation.roll * 0.5, 0.3);
      h.position.x = L(h.position.x, position.x * 0.08, 0.2);
      h.position.y = L(h.position.y, 0.42 + position.y * 0.05, 0.2);

      if (this.bones.mouth) {
        this.bones.mouth.scale.y = L(this.bones.mouth.scale.y, 1 + expressions.mouthOpen * 8, 0.4);
        this.bones.mouth.position.y = L(this.bones.mouth.position.y, -0.06 - expressions.mouthOpen * 0.02, 0.4);
        this.bones.mouth.scale.x = L(this.bones.mouth.scale.x, 1 + expressions.smile * 1.5, 0.3);
      }

      if (this.bones.leftEye)
        this.bones.leftEye.scale.y = L(this.bones.leftEye.scale.y, 1 - expressions.leftBlink * 0.9, 0.5);
      if (this.bones.rightEye)
        this.bones.rightEye.scale.y = L(this.bones.rightEye.scale.y, 1 - expressions.rightBlink * 0.9, 0.5);

      const glow = 0.5 + expressions.smile * 0.5;
      if (this.bones.leftEye) this.bones.leftEye.material.emissiveIntensity = glow;
      if (this.bones.rightEye) this.bones.rightEye.material.emissiveIntensity = glow;

      if (this.bones.leftBrow)
        this.bones.leftBrow.position.y = L(this.bones.leftBrow.position.y, 0.07 + expressions.leftBrowRaise * 0.02, 0.3);
      if (this.bones.rightBrow)
        this.bones.rightBrow.position.y = L(this.bones.rightBrow.position.y, 0.07 + expressions.rightBrowRaise * 0.02, 0.3);
    }

    if (bodyActive && body) {
      if (this.bones.torso) {
        const t = this.bones.torso;
        t.rotation.y = L(t.rotation.y, body.torsoLeanY, 0.15);
        t.rotation.z = L(t.rotation.z, body.torsoLeanZ, 0.15);
        t.position.x = L(t.position.x, body.torsoLeanX * 0.1, 0.1);
      }

      if (this.bones.hipRoot) {
        const hip = this.bones.hipRoot;
        hip.position.x = L(hip.position.x, body.hipShiftX * 0.15, 0.1);
        hip.position.y = L(hip.position.y, 0.85 + body.hipShiftY * 0.05, 0.1);

        if (this.bones.leftLeg && this.bones.rightLeg) {
          const shift = body.hipShiftX;
          this.bones.leftLeg.rotation.x = L(this.bones.leftLeg.rotation.x, Math.max(0, -shift) * 0.15, 0.1);
          this.bones.rightLeg.rotation.x = L(this.bones.rightLeg.rotation.x, Math.max(0, shift) * 0.15, 0.1);
          this.bones.leftLeg.rotation.z = L(this.bones.leftLeg.rotation.z, shift * 0.08, 0.1);
          this.bones.rightLeg.rotation.z = L(this.bones.rightLeg.rotation.z, shift * 0.08, 0.1);
        }
      }
    }
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
    return { teamColors: { ...this.teamColors }, equipment: [...this.equipment] };
  }

  loadConfig(config) {
    if (config.teamColors) this.setTeamColors(config.teamColors.primary, config.teamColors.accent);
    if (config.equipment) config.equipment.forEach(e => { if (!this.equipment.has(e)) this.toggleEquipment(e); });
  }
}

window.Avatar3D = Avatar3D;
