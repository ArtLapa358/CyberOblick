class MocapEngine {
  constructor() {
    this.video = null;
    this.faceMesh = null;

    this.faceLandmarks = null;

    this.isRunning = false;
    this.trackFace = true;
    this.trackBody = true;
    this.sensitivity = 1.0;

    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.currentFps = 0;

    this.onFaceDetected = null;
    this.onFpsUpdate = null;
    this.onTrackingStatus = null;

    this.audioTrack = null;
    this.audioContext = null;
    this.analyser = null;
    this.audioLevel = 0;
    this.onAudioLevelUpdate = null;

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
      modelComplexity: 0,
      refineLandmarks: false,
      minDetectionConfidence: 0.4,
      minTrackingConfidence: 0.4
    });
    this.faceMesh.onResults((r) => this._onFaceResults(r));

    console.log('[Mocap] Models initialized');
  }

  async start() {
    if (this.isRunning) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: true
    });
    this.video.srcObject = stream;
    await this.video.play();

    this.audioTrack = stream.getAudioTracks()[0];
    if (this.audioTrack) {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(new MediaStream([this.audioTrack]));
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
    }

    this.isRunning = true;
    this._trackingLoop();
    console.log('[Mocap] Camera and audio started');
  }

  getAudioTrack() {
    return this.audioTrack;
  }

  stop() {
    this.isRunning = false;
    if (this.video && this.video.srcObject) {
      this.video.srcObject.getTracks().forEach(t => t.stop());
      this.video.srcObject = null;
    }
    this.faceLandmarks = null;
    this.audioTrack = null;
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
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

    if (this.analyser) {
      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      this.analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      this.audioLevel = average / 255; 
      if (this.onAudioLevelUpdate) this.onAudioLevelUpdate(this.audioLevel);
    }

    try {
      if (this.video.readyState >= 2 && (this.trackFace || this.trackBody)) {
        await this.faceMesh.send({ image: this.video });
      }
    } catch (e) {}

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
    if (this.onTrackingStatus) {
      this.onTrackingStatus('face', detected && this.trackFace);
      this.onTrackingStatus('body', detected && this.trackBody);
    }
  }


  _extractFaceData(landmarks) {
    if (!landmarks || landmarks.length < 468) return null;
    const s = this.sensitivity;

    const nose = landmarks[1];
    const leftEar = landmarks[234];
    const rightEar = landmarks[454];
    const forehead = landmarks[10];
    const chin = landmarks[152];

    const earMidX = (leftEar.x + rightEar.x) / 2;
    const yaw = (nose.x - earMidX) * 3.0 * s;
    const faceMidY = (forehead.y + chin.y) / 2;
    const pitch = (nose.y - faceMidY) * 3.0 * s;
    const roll = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x) * s;

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

    const headPosX = nose.x - 0.5;
    const headPosY = -(nose.y - 0.5);
    const torsoLeanX = headPosX * 0.3;
    const torsoLeanZ = roll * 0.4; 
    const torsoLeanY = yaw * 0.25; 

    const shoulderWidth = Math.abs(rightEar.x - leftEar.x);
    const shoulderTilt = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);

    return {
      position: { x: headPosX, y: headPosY, z: nose.z },
      rotation: { yaw, pitch, roll },
      expressions: { mouthOpen, leftBlink, rightBlink, leftBrowRaise, rightBrowRaise, smile },
      body: {
        torsoLeanX,
        torsoLeanY,
        torsoLeanZ,
        shoulderTilt,
        shoulderWidth,
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
