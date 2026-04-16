/**
 * КиберОблик v2.0 — Motion Capture Module (mocap.js)
 * MediaPipe Face Mesh + Hands + Body estimation
 * Extracts: head rotation, expressions, arm IK, torso lean, shoulder estimation
 */

class MocapEngine {
  constructor() {
    this.video = null;
    this.faceMesh = null;
    this.hands = null;

    this.faceLandmarks = null;
    this.leftHandLandmarks = null;
    this.rightHandLandmarks = null;

    this.isRunning = false;
    this.trackFace = true;
    this.trackHands = true;
    this.sensitivity = 1.0;

    // Performance
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.currentFps = 0;

    // Callbacks
    this.onFaceDetected = null;
    this.onHandsDetected = null;
    this.onFpsUpdate = null;
    this.onTrackingStatus = null;

    // Smoothing
    this._faceSmoothBuffer = [];
    this._smoothFrames = 3;
  }

  async init(videoElement) {
    this.video = videoElement;

    this.faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    this.faceMesh.onResults((r) => this._onFaceResults(r));

    this.hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    this.hands.onResults((r) => this._onHandsResults(r));

    console.log('[Mocap] Models initialized');
  }

  async start() {
    if (this.isRunning) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false
    });
    this.video.srcObject = stream;
    await this.video.play();
    this.isRunning = true;
    this._trackingLoop();
    console.log('[Mocap] Camera started');
  }

  stop() {
    this.isRunning = false;
    if (this.video && this.video.srcObject) {
      this.video.srcObject.getTracks().forEach(t => t.stop());
      this.video.srcObject = null;
    }
    this.faceLandmarks = null;
    this.leftHandLandmarks = null;
    this.rightHandLandmarks = null;
  }

  async _trackingLoop() {
    if (!this.isRunning) return;

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
      if (this.onFpsUpdate) this.onFpsUpdate(this.currentFps);
    }

    try {
      if (this.video.readyState >= 2) {
        if (this.trackFace) await this.faceMesh.send({ image: this.video });
        if (this.trackHands) await this.hands.send({ image: this.video });
      }
    } catch (e) { /* skip dropped frames */ }

    requestAnimationFrame(() => this._trackingLoop());
  }

  _onFaceResults(results) {
    const detected = results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0;
    if (detected) {
      const raw = results.multiFaceLandmarks[0];
      this.faceLandmarks = this._smoothLandmarks(raw, this._faceSmoothBuffer);
      if (this.onFaceDetected) {
        this.onFaceDetected(this._extractFaceData(this.faceLandmarks));
      }
    } else {
      this.faceLandmarks = null;
    }
    if (this.onTrackingStatus) this.onTrackingStatus('face', detected);
  }

  _onHandsResults(results) {
    const detected = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
    this.leftHandLandmarks = null;
    this.rightHandLandmarks = null;

    if (detected) {
      results.multiHandLandmarks.forEach((landmarks, i) => {
        const label = results.multiHandedness[i].label;
        // MediaPipe mirrors: 'Left' label = right hand on screen → mirror back
        if (label === 'Left') {
          this.rightHandLandmarks = landmarks;
        } else {
          this.leftHandLandmarks = landmarks;
        }
      });

      if (this.onHandsDetected) {
        this.onHandsDetected({
          left: this.leftHandLandmarks,
          right: this.rightHandLandmarks
        });
      }
    }
    if (this.onTrackingStatus) this.onTrackingStatus('hands', detected);
  }

  /**
   * Extract face data: head rotation, expressions, torso estimation
   */
  _extractFaceData(landmarks) {
    if (!landmarks || landmarks.length < 468) return null;
    const s = this.sensitivity;

    const nose = landmarks[1];
    const leftEar = landmarks[234];
    const rightEar = landmarks[454];
    const forehead = landmarks[10];
    const chin = landmarks[152];

    // ── Head Rotation ──
    const earMidX = (leftEar.x + rightEar.x) / 2;
    const yaw = (nose.x - earMidX) * 3.0 * s;
    const faceMidY = (forehead.y + chin.y) / 2;
    const pitch = (nose.y - faceMidY) * 3.0 * s;
    const roll = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x) * s;

    // ── Expressions ──
    const upperLip = landmarks[13];
    const lowerLip = landmarks[14];
    const mouthOpen = Math.min(Math.abs(lowerLip.y - upperLip.y) * 10 * s, 1);

    const leftEyeTop = landmarks[159], leftEyeBot = landmarks[145];
    const rightEyeTop = landmarks[386], rightEyeBot = landmarks[374];
    const leftBlink = Math.min(1 - Math.abs(leftEyeBot.y - leftEyeTop.y) * 30, 1);
    const rightBlink = Math.min(1 - Math.abs(rightEyeBot.y - rightEyeTop.y) * 30, 1);

    const leftBrow = landmarks[66], rightBrow = landmarks[296];
    const leftBrowRaise = Math.min((leftEyeTop.y - leftBrow.y) * 15 * s, 1);
    const rightBrowRaise = Math.min((rightEyeTop.y - rightBrow.y) * 15 * s, 1);

    const leftMouth = landmarks[61], rightMouth = landmarks[291];
    const mouthWidth = Math.abs(rightMouth.x - leftMouth.x);
    const smile = Math.min(Math.max(0, (mouthWidth - 0.08) * 10) * s, 1);

    // ── Torso estimation from face position ──
    // When head moves left/right → torso leans slightly
    // When head tilts → shoulders follow
    const headPosX = nose.x - 0.5;  // -0.5..0.5 range
    const headPosY = -(nose.y - 0.5);
    const torsoLeanX = headPosX * 0.3; // subtle follow
    const torsoLeanZ = roll * 0.4;     // shoulder tilt follows head roll
    const torsoLeanY = yaw * 0.25;     // torso turns slightly with head

    // Shoulder estimation from ear positions (approximates shoulder line)
    const shoulderWidth = Math.abs(rightEar.x - leftEar.x);
    const shoulderTilt = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);

    return {
      position: { x: headPosX, y: headPosY, z: nose.z },
      rotation: { yaw, pitch, roll },
      expressions: { mouthOpen, leftBlink, rightBlink, leftBrowRaise, rightBrowRaise, smile },
      // Body estimation from face
      body: {
        torsoLeanX,
        torsoLeanY,
        torsoLeanZ,
        shoulderTilt,
        shoulderWidth,
        // Leg sway (subtle, derived from torso)
        hipShiftX: headPosX * 0.15,
        hipShiftY: headPosY * 0.08
      },
      landmarks
    };
  }

  _smoothLandmarks(current, buffer) {
    buffer.push(current);
    if (buffer.length > this._smoothFrames) buffer.shift();
    if (buffer.length === 1) return current;
    return current.map((point, i) => {
      let x = 0, y = 0, z = 0;
      buffer.forEach(frame => { x += frame[i].x; y += frame[i].y; z += frame[i].z; });
      const n = buffer.length;
      return { x: x / n, y: y / n, z: z / n };
    });
  }

  getStream() {
    return this.video ? this.video.srcObject : null;
  }
}

window.MocapEngine = MocapEngine;
