(function () {
  'use strict';

  const state = {
    isPro: false,
    isCameraActive: false,
    isStreaming: false,
    isRecording: false,
    mediaRecorder: null,
    recordedChunks: [],
    selectedTeam: null,

    // Streaming (multi-viewer)
    streamRoomId: null,
    streamStream: null,                 // MediaStream from avatar composite canvas
    streamerPeers: new Map(),           // peerId -> { pc, iceIndex, candidatePollTimer, connected }
    streamerPollTimer: null,            // polls for new pending viewers

    recordQuality: '720p',
    streamQuality: '720p'
  };

  let mocap = null;
  let avatar = null;

  // ══════════════════════════════════════════
  //  Init
  // ══════════════════════════════════════════

  async function init() {
    console.log('[App] КиберОблик v2.1 starting...');
    const loaderStatus = document.querySelector('.loader__status');

    loaderStatus.textContent = 'Загрузка 3D движка...';
    avatar = new Avatar3D(document.getElementById('three-canvas'));
    avatar.init();
    if (avatar && typeof avatar._onResize === 'function') avatar._onResize();
    await sleep(300);

    loaderStatus.textContent = 'Подготовка нейросети...';
    mocap = new MocapEngine();
    await mocap.init(document.getElementById('cam-video'));
    await sleep(300);

    mocap.onFaceDetected = (faceData) => {
      avatar._hasExternalInput = mocap.trackFace || mocap.trackBody;
      avatar.updateFace(faceData, { head: mocap.trackFace, body: mocap.trackBody });
    };

    mocap.onFpsUpdate = (fps) => {
      const el = document.getElementById('fps-counter');
      if (el) el.textContent = `${fps} FPS`;
    };

    mocap.onTrackingStatus = (type, active) => {
      const el = document.getElementById(`track-${type}`);
      if (el) el.classList.toggle('active', active);
    };

    mocap.onAudioLevelUpdate = (level) => {
      updateAudioLevelIndicator(level);
    };

    loaderStatus.textContent = 'Настройка интерфейса...';
    setupUI();
    setupResizablePiP();
    await loadTeams();
    await sleep(200);

    // Initial watermark sync
    avatar.setWatermarkEnabled(!state.isPro);

    const loader = document.getElementById('loader');
    loader.classList.add('fade-out');
    setTimeout(() => {
      loader.classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      if (avatar && typeof avatar._onResize === 'function') avatar._onResize();
    }, 600);

    console.log('[App] Ready!');
  }

  // ══════════════════════════════════════════
  //  UI Setup
  // ══════════════════════════════════════════

  function setupUI() {
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
      });
    });

    document.getElementById('btn-start-cam').addEventListener('click', toggleCamera);

    document.getElementById('toggle-face').addEventListener('change', (e) => { mocap.trackFace = e.target.checked; });
    document.getElementById('toggle-body').addEventListener('change', (e) => { mocap.trackBody = e.target.checked; });

    const sensSlider = document.getElementById('sensitivity-slider');
    const sensVal = document.getElementById('sensitivity-val');
    sensSlider.addEventListener('input', () => {
      mocap.sensitivity = parseFloat(sensSlider.value);
      sensVal.textContent = parseFloat(sensSlider.value).toFixed(1);
    });

    // Equipment
    document.querySelectorAll('.equip-card').forEach(card => {
      card.addEventListener('click', () => {
        const active = avatar.toggleEquipment(card.dataset.equip);
        card.classList.toggle('active', active);
      });
    });

    // Team colors
    document.getElementById('color-primary').addEventListener('input', (e) => {
      avatar.setTeamColors(e.target.value, document.getElementById('color-accent').value);
    });
    document.getElementById('color-accent').addEventListener('input', (e) => {
      avatar.setTeamColors(document.getElementById('color-primary').value, e.target.value);
    });

    document.getElementById('btn-record').addEventListener('click', toggleRecording);
    document.getElementById('btn-stream').addEventListener('click', toggleStreaming);
    document.getElementById('btn-join-room').addEventListener('click', joinRoom);
    document.getElementById('stream-room-id').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') joinRoom();
    });

    document.getElementById('record-quality').addEventListener('change', (e) => {
      state.recordQuality = e.target.value;
      updateQualitySelectors();
    });
    document.getElementById('stream-quality').addEventListener('change', (e) => {
      state.streamQuality = e.target.value;
      updateQualitySelectors();
    });

    // Settings modal
    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('modal-settings').classList.remove('hidden');
    });
    document.getElementById('btn-close-settings').addEventListener('click', () => {
      document.getElementById('modal-settings').classList.add('hidden');
    });
    document.getElementById('modal-settings').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay'))
        document.getElementById('modal-settings').classList.add('hidden');
    });

    // Help modal
    const btnHelp = document.getElementById('btn-help');
    const modalHelp = document.getElementById('modal-help');
    if (btnHelp && modalHelp) {
      btnHelp.addEventListener('click', () => modalHelp.classList.remove('hidden'));
      document.getElementById('btn-close-help').addEventListener('click', () => modalHelp.classList.add('hidden'));
      modalHelp.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) modalHelp.classList.add('hidden');
      });
    }

    document.getElementById('toggle-pro').addEventListener('change', (e) => {
      state.isPro = e.target.checked;
      updateTierUI();
    });

    document.getElementById('render-quality').addEventListener('change', (e) => {
      const dpr = e.target.value === 'low' ? 1 : e.target.value === 'high' ? 2 : 1.5;
      avatar.renderer.setPixelRatio(Math.min(dpr, window.devicePixelRatio));
    });

    document.getElementById('btn-save-avatar').addEventListener('click', saveAvatar);

    document.getElementById('record-quality').value = state.recordQuality;
    document.getElementById('stream-quality').value = state.streamQuality;

    updateQualitySelectors();
  }

  function updateQualitySelectors() {
    const recordSelect = document.getElementById('record-quality');
    const streamSelect = document.getElementById('stream-quality');
    const options = recordSelect.querySelectorAll('option');

    options.forEach(option => {
      if (option.value === '1080p') {
        option.disabled = !state.isPro;
        if (!state.isPro && (state.recordQuality === '1080p' || state.streamQuality === '1080p')) {
          state.recordQuality = '720p';
          state.streamQuality = '720p';
          recordSelect.value = '720p';
          streamSelect.value = '720p';
        }
      }
    });
  }

  function getResolution(quality) {
    return quality === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  }

  function getBitrate(quality) {
    return quality === '1080p' ? 5000000 : 2500000;
  }

  // ══════════════════════════════════════════
  //  Resizable + Draggable Camera PiP
  // ══════════════════════════════════════════

  function setupResizablePiP() {
    const pip = document.getElementById('cam-pip');
    const handle = document.getElementById('pip-resize-handle');
    let isDragging = false, isResizing = false;
    let startX, startY, startW, startH, startLeft, startTop;

    pip.addEventListener('pointerdown', (e) => {
      if (e.target === handle) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = pip.getBoundingClientRect();
      const parentRect = pip.parentElement.getBoundingClientRect();
      startLeft = rect.left - parentRect.left;
      startTop = rect.top - parentRect.top;
      pip.style.transition = 'none';
      pip.setPointerCapture(e.pointerId);
    });

    pip.addEventListener('pointermove', (e) => {
      if (isDragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        pip.style.right = 'auto';
        pip.style.left = (startLeft + dx) + 'px';
        pip.style.top = (startTop + dy) + 'px';
      }
    });

    pip.addEventListener('pointerup', () => {
      isDragging = false;
      pip.style.transition = '';
    });

    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = pip.offsetWidth;
      startH = pip.offsetHeight;
      pip.style.transition = 'none';
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newW = Math.max(80, Math.min(400, startW + dx));
      const newH = Math.max(60, Math.min(300, startH + dy));
      pip.style.width = newW + 'px';
      pip.style.height = newH + 'px';
    });

    handle.addEventListener('pointerup', () => {
      isResizing = false;
      pip.style.transition = '';
    });

    let lastTouchDist = 0;
    pip.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) lastTouchDist = getTouchDist(e.touches);
    }, { passive: true });

    pip.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const dist = getTouchDist(e.touches);
        const scale = dist / lastTouchDist;
        const newW = Math.max(80, Math.min(400, pip.offsetWidth * scale));
        const newH = Math.max(60, Math.min(300, pip.offsetHeight * scale));
        pip.style.width = newW + 'px';
        pip.style.height = newH + 'px';
        lastTouchDist = dist;
      }
    }, { passive: true });
  }

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function updateAudioLevelIndicator(level) {
    let el = document.getElementById('audio-level');
    if (!el) {
      el = document.createElement('div');
      el.id = 'audio-level';
      el.className = 'audio-level';
      el.innerHTML = `
        <div class="audio-level__bar">
          <div class="audio-level__fill"></div>
        </div>
        <span class="audio-level__icon">🎤</span>
      `;
      document.getElementById('viewport').appendChild(el);
    }
    const fill = el.querySelector('.audio-level__fill');
    fill.style.width = (level * 100) + '%';
  }

  // ══════════════════════════════════════════
  //  Camera
  // ══════════════════════════════════════════

  async function toggleCamera() {
    const btn = document.getElementById('btn-start-cam');
    const pip = document.getElementById('cam-pip');

    if (state.isCameraActive) {
      mocap.stop();
      pip.classList.remove('active');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> Запустить камеру`;
      state.isCameraActive = false;
      avatar._hasExternalInput = false;
      document.getElementById('track-face').classList.remove('active');
      document.getElementById('track-body').classList.remove('active');
      // Hide audio level indicator
      const audioEl = document.getElementById('audio-level');
      if (audioEl) audioEl.remove();
    } else {
      try {
        btn.innerHTML = 'Подключение...'; btn.disabled = true;
        await mocap.start();
        pip.classList.add('active');
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m3-3h6l2 3h4a2 2 0 012 2v9.34"/></svg> Остановить камеру`;
        btn.disabled = false;
        state.isCameraActive = true;
      } catch (err) {
        btn.innerHTML = 'Камера недоступна'; btn.disabled = false;
        showToast('Разрешите доступ к камере', 'error');
        setTimeout(() => {
          btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> Запустить камеру`;
        }, 2000);
      }
    }
  }

  // ══════════════════════════════════════════
  //  WebRTC Streaming (multi-viewer)
  // ══════════════════════════════════════════

  async function toggleStreaming() {
    const btn = document.getElementById('btn-stream');

    if (state.isStreaming) {
      await stopStreaming();
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Стрим (WebRTC)`;
      showToast('Стрим остановлен', 'info');
      return;
    }

    try {
      const res = await fetch('/api/rtc/room', { method: 'POST' });
      const { roomId } = await res.json();
      state.streamRoomId = roomId;

      // Single composited MediaStream — created ONCE and reused for every viewer.
      const { width, height } = getResolution(state.streamQuality);
      state.streamStream = avatar.getCanvasStream(30, width, height);

      // Add audio track if available
      const audioTrack = mocap.getAudioTrack();
      if (audioTrack) {
        state.streamStream.addTrack(audioTrack);
      }

      // Warm up the composite canvas — give it ~200ms to generate real frames
      // before peers start asking for offers. Otherwise the outgoing track can
      // be "empty" at negotiation time, which some browsers handle badly.
      await sleep(300);

      state.isStreaming = true;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Остановить стрим`;

      const watchUrl = `${window.location.origin}/watch/${roomId}`;
      showStreamInfo(roomId, watchUrl);
      showToast(`Стрим запущен! Комната: ${roomId}`, 'success');

      startStreamerViewerPolling(roomId);

    } catch (err) {
      console.error('[Stream] Error:', err);
      showToast('Ошибка запуска стрима', 'error');
    }
  }

  async function stopStreaming() {
    // Stop polling
    if (state.streamerPollTimer) {
      clearInterval(state.streamerPollTimer);
      state.streamerPollTimer = null;
    }
    // Close all peer connections
    state.streamerPeers.forEach((peer) => {
      if (peer.candidatePollTimer) clearInterval(peer.candidatePollTimer);
      try { peer.pc.close(); } catch (e) {}
    });
    state.streamerPeers.clear();

    if (state.streamRoomId) {
      try {
        await fetch(`/api/rtc/room/${state.streamRoomId}/close`, { method: 'POST' });
      } catch (e) {}
    }

    // Stop composite loop inside avatar
    avatar.stopCanvasStream();
    state.streamStream = null;

    state.isStreaming = false;
    state.streamRoomId = null;

    const info = document.getElementById('stream-info');
    if (info) info.remove();
    updateViewerCount(0);
  }

  function startStreamerViewerPolling(roomId) {
    if (state.streamerPollTimer) clearInterval(state.streamerPollTimer);
    state.streamerPollTimer = setInterval(async () => {
      if (!state.isStreaming) return;
      try {
        const res = await fetch(`/api/rtc/room/${roomId}/pending-viewers`);
        if (!res.ok) return;
        const { peerIds } = await res.json();
        if (peerIds && peerIds.length > 0) {
          for (const peerId of peerIds) {
            if (!state.streamerPeers.has(peerId)) {
              console.log('[Stream] New viewer:', peerId);
              createPeerForViewer(roomId, peerId);
            }
          }
        }
      } catch (e) {}
    }, 400);
  }

  async function createPeerForViewer(roomId, peerId) {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      const peerState = {
        pc,
        iceIndex: 0,
        candidatePollTimer: null,
        connected: false,
        remoteSet: false,
        pendingIce: []
      };
      state.streamerPeers.set(peerId, peerState);

      // Add all tracks from composite stream (video + audio).
      if (state.streamStream) {
        state.streamStream.getTracks().forEach(track => {
          pc.addTrack(track, state.streamStream);
        });
      }

      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          try {
            await fetch(`/api/rtc/room/${roomId}/peer/${peerId}/candidate/streamer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(event.candidate.toJSON ? event.candidate.toJSON() : event.candidate)
            });
          } catch (e) {}
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('[Stream] Peer', peerId, 'ICE:', pc.iceConnectionState);
      };

      pc.onconnectionstatechange = () => {
        console.log('[Stream] Peer', peerId, 'state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          if (!peerState.connected) {
            peerState.connected = true;
            updateViewerCount(getConnectedViewerCount());
            showToast('Зритель подключился!', 'success');
          }
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          if (peerState.connected) {
            peerState.connected = false;
            updateViewerCount(getConnectedViewerCount());
          }
          if (peerState.candidatePollTimer) clearInterval(peerState.candidatePollTimer);
          try { pc.close(); } catch (e) {}
          state.streamerPeers.delete(peerId);
        } else if (pc.connectionState === 'disconnected') {
          // Viewer's page may be reloading — wait a bit; failed will fire if gone
          if (peerState.connected) {
            peerState.connected = false;
            updateViewerCount(getConnectedViewerCount());
          }
        }
      };

      // Create and send offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      await fetch(`/api/rtc/room/${roomId}/peer/${peerId}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offer)
      });
      console.log('[Stream] Sent offer to', peerId);

      // Poll for answer + viewer ICE candidates
      let attempts = 0;
      peerState.candidatePollTimer = setInterval(async () => {
        attempts++;
        if (!state.isStreaming || attempts > 240) {
          clearInterval(peerState.candidatePollTimer);
          return;
        }
        try {
          // Fetch answer first if we haven't set it yet
          if (!peerState.remoteSet) {
            const ansRes = await fetch(`/api/rtc/room/${roomId}/peer/${peerId}/answer`);
            if (ansRes.ok) {
              const answer = await ansRes.json();
              if (answer && answer.type === 'answer') {
                try {
                  await pc.setRemoteDescription(new RTCSessionDescription(answer));
                  peerState.remoteSet = true;
                  console.log('[Stream] Got answer from', peerId);
                  // Flush queued candidates
                  for (const c of peerState.pendingIce) {
                    try { await pc.addIceCandidate(c); } catch (e) {}
                  }
                  peerState.pendingIce = [];
                } catch (e) {
                  console.error('[Stream] setRemoteDescription failed:', e);
                }
              }
            }
          }

          // Fetch viewer's ICE candidates (can arrive even before answer in some flows)
          const cRes = await fetch(`/api/rtc/room/${roomId}/peer/${peerId}/candidates/viewer?since=${peerState.iceIndex}`);
          if (cRes.ok) {
            const candidates = await cRes.json();
            for (const c of candidates) {
              try {
                const iceCandidate = new RTCIceCandidate(c);
                if (peerState.remoteSet) {
                  await pc.addIceCandidate(iceCandidate);
                } else {
                  peerState.pendingIce.push(iceCandidate);
                }
              } catch (e) {
                console.warn('[Stream] ICE add failed for peer', peerId, e);
              }
              peerState.iceIndex++;
            }
          }
        } catch (e) {}
      }, 500);

    } catch (err) {
      console.error('[Stream] Peer setup error for', peerId, err);
      state.streamerPeers.delete(peerId);
    }
  }

  function getConnectedViewerCount() {
    let n = 0;
    state.streamerPeers.forEach(p => { if (p.connected) n++; });
    return n;
  }

  function updateViewerCount(n) {
    const el = document.getElementById('stream-viewer-count');
    if (el) el.textContent = n;
  }

  function toggleRecording() {
    state.isRecording ? stopRecording() : startRecording();
  }

  function startRecording() {
    const { width, height } = getResolution(state.recordQuality);
    // Use composite stream so watermark is baked in
    const canvasStream = avatar.getCanvasStream(30, width, height);

    // Add audio track if available
    const audioTrack = mocap.getAudioTrack();
    if (audioTrack) {
      canvasStream.addTrack(audioTrack);
    }

    state.recordedChunks = [];

    const selectedMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : '';

    if (!selectedMime) {
      showToast('WebM не поддерживается в этом браузере', 'error');
      return;
    }

    state.mediaRecorder = new MediaRecorder(canvasStream, {
      mimeType: selectedMime,
      videoBitsPerSecond: getBitrate(state.recordQuality)
    });

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.recordedChunks.push(e.data);
    };

    state.mediaRecorder.onstop = () => {
      const webmBlob = new Blob(state.recordedChunks, { type: selectedMime });
      downloadBlob(webmBlob, `cyberoblik_${Date.now()}.webm`);
      showToast('Запись сохранена в WebM', 'success');
      // Stop composite loop ONLY if we're not also streaming
      if (!state.isStreaming) avatar.stopCanvasStream();
    };

    state.mediaRecorder.start(100);
    state.isRecording = true;
    updateRecordingUI(true);
  }

  function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    }
    state.isRecording = false;
    updateRecordingUI(false);
  }

  function updateRecordingUI(recording) {
    const btn = document.getElementById('btn-record');
    const viewport = document.getElementById('viewport');

    if (recording) {
      btn.classList.add('btn--danger');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Стоп`;
      if (!document.getElementById('rec-indicator')) {
        const ind = document.createElement('div');
        ind.className = 'rec-indicator'; ind.id = 'rec-indicator';
        ind.innerHTML = `<div class="rec-indicator__dot"></div><span class="rec-indicator__text">REC</span>`;
        viewport.appendChild(ind);
      }
    } else {
      btn.classList.remove('btn--danger');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg> Запись (WEBM)`;
      const ind = document.getElementById('rec-indicator');
      if (ind) ind.remove();
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function joinRoom() {
    const roomId = document.getElementById('stream-room-id').value.trim();
    if (!roomId) {
      showToast('Введите ID комнаты', 'warning');
      return;
    }
    window.open(`/watch/${roomId}`, '_blank');
  }

  function showStreamInfo(roomId, watchUrl) {
    const old = document.getElementById('stream-info');
    if (old) old.remove();

    const info = document.createElement('div');
    info.id = 'stream-info';
    info.style.cssText = `
      position: absolute; bottom: 8px; left: 12px; right: 12px;
      padding: 10px 14px; border-radius: 10px; z-index: 55;
      background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.3);
      font-size: 11px; color: #e8e8f0; line-height: 1.6;
    `;
    info.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-family:'Orbitron',sans-serif;font-size:9px;color:#00ff88;letter-spacing:2px;">СТРИМ АКТИВЕН</div>
        <div style="font-size:10px;color:#8888a8;">Зрителей: <span id="stream-viewer-count" style="color:#00f0ff;font-weight:700;">0</span></div>
      </div>
      <div>Комната: <strong style="color:#00f0ff;letter-spacing:1px;">${roomId}</strong></div>
      <div style="margin-top:4px;">Ссылка для зрителя:</div>
      <div style="display:flex;gap:8px;margin-top:4px;">
        <input type="text" value="${watchUrl}" readonly style="
          flex:1;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);
          background:rgba(0,0,0,0.3);color:#00f0ff;font-size:10px;font-family:'Exo 2',sans-serif;
        " id="stream-url-input">
        <button id="stream-copy-btn" style="
          padding:6px 12px;border-radius:6px;border:1px solid rgba(0,240,255,0.3);
          background:rgba(0,240,255,0.1);color:#00f0ff;cursor:pointer;font-size:11px;
        ">Копировать</button>
      </div>
    `;
    document.getElementById('viewport').appendChild(info);

    document.getElementById('stream-copy-btn').addEventListener('click', () => {
      try {
        navigator.clipboard.writeText(watchUrl);
        document.getElementById('stream-copy-btn').textContent = '✓';
        setTimeout(() => {
          const b = document.getElementById('stream-copy-btn');
          if (b) b.textContent = 'Копировать';
        }, 1500);
      } catch (e) {
        // Fallback
        const inp = document.getElementById('stream-url-input');
        inp.select(); document.execCommand('copy');
      }
    });
  }

  // ══════════════════════════════════════════
  //  Teams
  // ══════════════════════════════════════════

  async function loadTeams() {
    try {
      const res = await fetch('/api/teams');
      const teams = await res.json();
      renderTeams(teams);
    } catch (e) { console.error('[Teams]', e); }
  }

  function renderTeams(teams) {
    const c = document.getElementById('team-list');
    c.innerHTML = '';
    teams.forEach(team => {
      const card = document.createElement('div');
      card.className = 'team-card';
      card.innerHTML = `
        <div class="team-card__colors">
          ${team.colors.map(cl => `<div class="team-card__swatch" style="background:${cl}"></div>`).join('')}
        </div>
        <span class="team-card__name">${team.name}</span>`;
      card.addEventListener('click', () => {
        document.querySelectorAll('.team-card').forEach(x => x.classList.remove('active'));
        card.classList.add('active');
        state.selectedTeam = team.id;
        avatar.setTeamColors(team.colors[0], team.colors[1]);
        document.getElementById('color-primary').value = team.colors[0];
        document.getElementById('color-accent').value = team.colors[1];
      });
      c.appendChild(card);
    });
  }

  // ══════════════════════════════════════════
  //  Save
  // ══════════════════════════════════════════

  async function saveAvatar() {
    const config = avatar.getConfig();
    config.selectedTeam = state.selectedTeam;
    config.sensitivity = mocap.sensitivity;
    try {
      const res = await fetch('/api/avatar/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Облик сохранён! ID: ${data.id.slice(0, 8)}`, 'success');
        document.getElementById('modal-settings').classList.add('hidden');
      }
    } catch (e) { showToast('Ошибка сохранения', 'error'); }
  }

  // ══════════════════════════════════════════
  //  Tier
  // ══════════════════════════════════════════

  function updateTierUI() {
    const badge = document.querySelector('.tier-badge');
    const wm = document.getElementById('watermark');
    const note = document.getElementById('export-note');
    if (state.isPro) {
      badge.className = 'tier-badge pro'; badge.textContent = 'PRO';
      wm.classList.add('hidden-wm');
      note.textContent = 'Pro — без водяного знака, экспорт до 1080p WEBM';
      avatar.setWatermarkEnabled(false);
    } else {
      badge.className = 'tier-badge free'; badge.textContent = 'FREE';
      wm.classList.remove('hidden-wm');
      note.textContent = 'Бесплатная версия — с водяным знаком';
      avatar.setWatermarkEnabled(true);
    }
    updateQualitySelectors();
  }

  // ══════════════════════════════════════════
  //  Toast
  // ══════════════════════════════════════════

  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const colors = {
      info: 'rgba(0,240,255,0.15)', success: 'rgba(0,255,136,0.15)',
      warning: 'rgba(255,107,0,0.15)', error: 'rgba(255,23,68,0.15)'
    };
    const borders = {
      info: 'rgba(0,240,255,0.4)', success: 'rgba(0,255,136,0.4)',
      warning: 'rgba(255,107,0,0.4)', error: 'rgba(255,23,68,0.4)'
    };

    if (!document.getElementById('toast-styles')) {
      const s = document.createElement('style'); s.id = 'toast-styles';
      s.textContent = `
        @keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(-10px); } }
        @keyframes toastOut { to { opacity:0; transform:translateX(-50%) translateY(-10px); } }
      `;
      document.head.appendChild(s);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
      position:fixed;top:64px;left:50%;transform:translateX(-50%);
      padding:10px 20px;border-radius:10px;z-index:9999;
      background:${colors[type]};border:1px solid ${borders[type]};
      backdrop-filter:blur(12px);
      font-family:'Exo 2',sans-serif;font-size:13px;font-weight:600;
      color:#e8e8f0;max-width:90%;text-align:center;
      animation:toastIn 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
