/**
 * КиберОблик v2.0 — Main App Controller (app.js)
 * - WebM recording (canvas capture → download)
 * - Resizable/draggable camera PiP
 * - WebRTC stream with viewer link + proper close
 * - Full body tracking wiring
 */

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
    streamRoomId: null,
    streamPC: null
  };

  let mocap = null;
  let avatar = null;

  // ══════════════════════════════════════════
  //  Init
  // ══════════════════════════════════════════

  async function init() {
    console.log('[App] КиберОблик v2.0 starting...');
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

    // ── Connect mocap → avatar (face + body) ──
    mocap.onFaceDetected = (faceData) => {
      avatar._hasExternalInput = mocap.trackFace || mocap.trackBody;
      avatar.updateFace(faceData, { head: mocap.trackFace, body: mocap.trackBody });
    };

    mocap.onFpsUpdate = (fps) => {
      document.getElementById('fps-counter').textContent = `${fps} FPS`;
    };

    mocap.onTrackingStatus = (type, active) => {
      const el = document.getElementById(`track-${type}`);
      if (el) el.classList.toggle('active', active);
    };

    loaderStatus.textContent = 'Настройка интерфейса...';
    setupUI();
    setupResizablePiP();
    await loadTeams();
    await sleep(200);

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

    document.getElementById('toggle-pro').addEventListener('change', (e) => {
      state.isPro = e.target.checked;
      updateTierUI();
    });

    document.getElementById('render-quality').addEventListener('change', (e) => {
      const dpr = e.target.value === 'low' ? 1 : e.target.value === 'high' ? 2 : 1.5;
      avatar.renderer.setPixelRatio(Math.min(dpr, window.devicePixelRatio));
    });

    document.getElementById('btn-save-avatar').addEventListener('click', saveAvatar);
  }

  // ══════════════════════════════════════════
  //  Resizable + Draggable Camera PiP
  // ══════════════════════════════════════════

  function setupResizablePiP() {
    const pip = document.getElementById('cam-pip');
    const handle = document.getElementById('pip-resize-handle');
    let isDragging = false, isResizing = false;
    let startX, startY, startW, startH, startLeft, startTop;

    // ── Drag ──
    pip.addEventListener('pointerdown', (e) => {
      if (e.target === handle) return; // let resize handle it
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

    // ── Resize handle ──
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

    // ── Pinch to zoom (touch) ──
    let lastTouchDist = 0;
    pip.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        lastTouchDist = getTouchDist(e.touches);
      }
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
  //  WebRTC Streaming (with viewer support)
  // ══════════════════════════════════════════

  async function toggleStreaming() {
    const btn = document.getElementById('btn-stream');

    if (state.isStreaming) {
      // ── Stop stream ──
      if (state.streamPC) {
        state.streamPC.close();
        state.streamPC = null;
      }
      if (state.streamRoomId) {
        await fetch(`/api/rtc/room/${state.streamRoomId}/close`, { method: 'POST' });
      }
      state.isStreaming = false;
      state.streamRoomId = null;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Стрим (WebRTC)`;
      showToast('Стрим остановлен', 'info');

      const info = document.getElementById('stream-info');
      if (info) info.remove();
      return;
    }

    try {
      const res = await fetch('/api/rtc/room', { method: 'POST' });
      const { roomId } = await res.json();
      state.streamRoomId = roomId;

      const canvasStream = avatar.getCanvasStream(30);

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      state.streamPC = pc;

      canvasStream.getTracks().forEach(track => pc.addTrack(track, canvasStream));

      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          await fetch(`/api/rtc/room/${roomId}/candidate/streamer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event.candidate)
          });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await fetch(`/api/rtc/room/${roomId}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offer)
      });

      state.isStreaming = true;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Остановить стрим`;

      const watchUrl = `${window.location.origin}/watch/${roomId}`;
      showStreamInfo(roomId, watchUrl);
      showToast(`Стрим запущен! Комната: ${roomId}`, 'success');

      pollForAnswer(roomId, pc);

    } catch (err) {
      console.error('[Stream] Error:', err);
      showToast('Ошибка запуска стрима', 'error');
    }
  }

  function toggleRecording() {
    state.isRecording ? stopRecording() : startRecording();
  }

  function startRecording() {
    const canvasStream = avatar.getCanvasStream(30);
    state.recordedChunks = [];

    const selectedMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
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
      videoBitsPerSecond: 2500000
    });

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.recordedChunks.push(e.data);
    };

    state.mediaRecorder.onstop = () => {
      const webmBlob = new Blob(state.recordedChunks, { type: selectedMime });
      downloadBlob(webmBlob, `cyberoblik_${Date.now()}.webm`);
      showToast('Запись сохранена в WebM', 'success');
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
    // Remove old info
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
      <div style="font-family:'Orbitron',sans-serif;font-size:9px;color:#00ff88;letter-spacing:2px;margin-bottom:4px;">СТРИМ АКТИВЕН</div>
      <div>Комната: <strong style="color:#00f0ff;letter-spacing:1px;">${roomId}</strong></div>
      <div style="margin-top:4px;">Ссылка для зрителя:</div>
      <div style="display:flex;gap:8px;margin-top:4px;">
        <input type="text" value="${watchUrl}" readonly style="
          flex:1;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);
          background:rgba(0,0,0,0.3);color:#00f0ff;font-size:10px;font-family:'Exo 2',sans-serif;
        " id="stream-url-input">
        <button onclick="navigator.clipboard.writeText('${watchUrl}');this.textContent='✓'" style="
          padding:6px 12px;border-radius:6px;border:1px solid rgba(0,240,255,0.3);
          background:rgba(0,240,255,0.1);color:#00f0ff;cursor:pointer;font-size:11px;
        ">Копировать</button>
      </div>
    `;
    document.getElementById('viewport').appendChild(info);
  }

  async function pollForAnswer(roomId, pc) {
    let attempts = 0;
    const interval = setInterval(async () => {
      if (!state.isStreaming || ++attempts > 120) {
        clearInterval(interval);
        return;
      }
      try {
        const res = await fetch(`/api/rtc/room/${roomId}/answer`);
        const answer = await res.json();
        if (answer && !pc.remoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          showToast('Зритель подключился!', 'success');

          // Now poll for viewer's ICE candidates
          let cidx = 0;
          const cInterval = setInterval(async () => {
            if (!state.isStreaming) { clearInterval(cInterval); return; }
            try {
              const cRes = await fetch(`/api/rtc/room/${roomId}/candidates/viewer?since=${cidx}`);
              const candidates = await cRes.json();
              for (const c of candidates) {
                await pc.addIceCandidate(new RTCIceCandidate(c));
                cidx++;
              }
            } catch (e) {}
            if (pc.connectionState === 'connected') clearInterval(cInterval);
          }, 500);

          clearInterval(interval);
        }
      } catch (e) {}
    }, 500);
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
    } else {
      badge.className = 'tier-badge free'; badge.textContent = 'FREE';
      wm.classList.remove('hidden-wm');
      note.textContent = 'Бесплатная версия — с водяным знаком';
    }
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
