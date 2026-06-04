// qr-scanner.js — getUserMedia + BarcodeDetector 직접 구현
// 이유: Android Chrome에서 html5-qrcode가 deviceId를 안 받음
//       → 우리가 카메라 stream을 직접 잡아서 100% 통제
// BarcodeDetector 미지원 시 Html5Qrcode로 폴백

const QrScanner = (() => {
  let _stream = null;
  let _video = null;
  let _detector = null;
  let _scanLoop = null;
  let _detected = false;
  let _onSuccess = null;
  let _cameras = [];     // {id, label, groupId, facingMode}
  let _camIndex = 0;
  let _fallbackScanner = null;
  let _useFallback = false;

  const LS_CAM = 'qr_camera_id';
  const LS_CAM_LABEL = 'qr_camera_label';
  const LS_ZOOM = 'qr_zoom';

  function saveCameraId(id, label) {
    try {
      if (id) localStorage.setItem(LS_CAM, id);
      if (label) localStorage.setItem(LS_CAM_LABEL, label);
    } catch {}
  }
  function loadCameraId() { try { return localStorage.getItem(LS_CAM) || ''; } catch { return ''; } }
  function loadCameraLabel() { try { return localStorage.getItem(LS_CAM_LABEL) || ''; } catch { return ''; } }
  function clearCameraId() { try { localStorage.removeItem(LS_CAM); } catch {} }
  function saveZoom(z) { try { if (z > 0) localStorage.setItem(LS_ZOOM, String(z)); } catch {} }
  function loadZoom() {
    try { const v = parseFloat(localStorage.getItem(LS_ZOOM)); return isNaN(v) ? null : v; }
    catch { return null; }
  }

  function setLabel(text) {
    const lbl = document.getElementById('qr-cam-label');
    if (lbl) lbl.textContent = text;
  }
  // 디버그 로그는 화면 제거됨. 호출은 그대로 두고 콘솔에만 남김
  function debugLog(text) { try { console.log('[QR]', text); } catch {} }
  function clearDebugLog() {}

  // ─── BarcodeDetector 가능 여부 ─────────────────────────
  function hasBarcodeDetector() {
    return typeof window.BarcodeDetector === 'function';
  }

  async function initDetector() {
    if (!hasBarcodeDetector()) return null;
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      const wanted = ['qr_code','code_128','code_39','code_93','codabar',
                      'ean_13','ean_8','upc_a','upc_e','itf','pdf417','aztec','data_matrix'];
      const used = wanted.filter(f => formats.includes(f));
      return new BarcodeDetector({ formats: used.length ? used : formats });
    } catch (e) {
      debugLog('BarcodeDetector init 실패: ' + (e?.message||e));
      return null;
    }
  }

  // ─── 카메라 라벨 다듬기 ─────────────────────────
  function prettyCamLabel(cam, idx) {
    const raw = (cam.label || '').trim();
    let hint = '';
    if (/(ultra.?wide|wide.?angle|광각|초광각|0\.5x)/i.test(raw)) hint = ' [광각]';
    else if (/(tele|망원|줌|2x|3x|5x)/i.test(raw)) hint = ' [망원]';
    else if (/(front|전면)/i.test(raw)) hint = ' [전면]';
    else if (/(back|rear|environment|후면)/i.test(raw)) hint = ' [후면]';
    const name = raw || `카메라 ${idx + 1}`;
    return name + hint;
  }

  function populateCamSelect() {
    const sel = document.getElementById('qr-cam-select');
    if (!sel) return;
    sel.innerHTML = '';
    if (!_cameras.length) {
      const opt = document.createElement('option');
      opt.textContent = '카메라 1개';
      opt.disabled = true;
      sel.appendChild(opt);
      return;
    }
    _cameras.forEach((cam, i) => {
      const opt = document.createElement('option');
      opt.value = cam.id;
      opt.textContent = prettyCamLabel(cam, i);
      if (i === _camIndex) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // ─── 카메라 enumerate ─────────────────────────
  async function enumerateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      _cameras = devices
        .filter(d => d.kind === 'videoinput')
        .map(d => ({ id: d.deviceId, label: d.label || '', groupId: d.groupId }));
      debugLog(`enumerate → ${_cameras.length}개`);
      _cameras.forEach((c, i) => debugLog(`  ${i}: id=...${String(c.id).slice(-8)} label="${(c.label||'').slice(0,40)}"`));
      populateCamSelect();
      return _cameras;
    } catch (e) {
      debugLog('enumerate 실패: ' + (e?.message||e));
      return [];
    }
  }

  // ─── show / start ─────────────────────────
  function show(onSuccess) {
    _onSuccess = onSuccess;
    _detected = false;
    document.getElementById('qr-scan-overlay').style.display = 'flex';
    document.getElementById('qr-error-msg').style.display = 'none';
    clearDebugLog();
    _video = document.getElementById('qr-reader-video');
    if (!_video) {
      // 비디오 엘리먼트 동적 생성 (qr-reader 안에)
      const host = document.getElementById('qr-reader');
      host.innerHTML = '';
      _video = document.createElement('video');
      _video.id = 'qr-reader-video';
      _video.setAttribute('playsinline', 'true');
      _video.setAttribute('autoplay', 'true');
      _video.muted = true;
      _video.style.cssText = 'width:100%;height:100%;object-fit:cover;background:black;display:block;';
      host.appendChild(_video);
    }
    start();
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return showError('이 브라우저는 카메라 미지원 (HTTPS 필요)');
    }

    // BarcodeDetector 가능 여부 확인
    if (!hasBarcodeDetector()) {
      debugLog('BarcodeDetector 미지원 → html5-qrcode 폴백');
      _useFallback = true;
      return startFallback();
    }
    debugLog('BarcodeDetector OK');
    _detector = await initDetector();
    if (!_detector) {
      _useFallback = true;
      return startFallback();
    }

    // 권한 부여를 위해 우선 environment로 임시 stream 받기 (enumerateDevices 라벨 노출 위해)
    if (!loadCameraLabel() && _cameras.length === 0) {
      try {
        debugLog('초기 권한 요청 (facingMode environment)...');
        const tmp = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        tmp.getTracks().forEach(t => t.stop());
        debugLog('초기 권한 OK');
      } catch (e) {
        debugLog('초기 권한 실패: ' + (e?.message||e));
      }
    }

    await enumerateCameras();

    // 카메라 선택: 1) 저장 ID 매칭  2) 저장 라벨 매칭  3) 후면 추정  4) 첫 번째
    const savedId = loadCameraId();
    const savedLabel = loadCameraLabel();
    let target = null;

    if (savedId) {
      target = _cameras.find(c => c.id === savedId);
      if (target) debugLog(`저장ID 매칭 ok → ...${target.id.slice(-8)}`);
    }
    if (!target && savedLabel) {
      target = _cameras.find(c => (c.label||'') === savedLabel);
      if (target) debugLog(`저장라벨 매칭 ok → "${savedLabel.slice(0,30)}"`);
    }
    if (!target) {
      // 후면 카메라 추정 — "back/rear/environment/후면" 라벨, 광각 제외 우선
      const rears = _cameras.filter(c => /back|rear|environment|후면/i.test(c.label));
      const nonWide = rears.find(c => !/(ultra.?wide|wide.?angle|광각|초광각)/i.test(c.label));
      target = nonWide || rears[0] || _cameras[0];
      if (target) debugLog(`자동 선택 → "${(target.label||'').slice(0,30)}"`);
    }

    if (!target) {
      return showError('카메라를 찾을 수 없습니다');
    }

    _camIndex = _cameras.findIndex(c => c.id === target.id);
    await startWithDeviceId(target.id);
  }

  async function startWithDeviceId(deviceId) {
    // 기존 stream 정리
    await stopStream();

    debugLog(`getUserMedia({deviceId: ${deviceId.slice(-8)}})...`);
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        }
      });
    } catch (e) {
      debugLog('getUserMedia 실패: ' + (e?.message||e));
      // 폴백: deviceId 없이 environment
      try {
        debugLog('폴백: facingMode environment 시도');
        _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch (e2) {
        return showError('카메라 접근 실패: ' + (e2?.message||e2));
      }
    }

    _video.srcObject = _stream;
    try { await _video.play(); } catch {}

    // 연속 자동초점 적용 — 미지원 기기는 조용히 무시
    try {
      const focusTrack = _stream.getVideoTracks()[0];
      const cap = focusTrack?.getCapabilities?.() || {};
      if (cap.focusMode && Array.isArray(cap.focusMode) && cap.focusMode.includes('continuous')) {
        await focusTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        debugLog('focusMode:continuous 적용');
      }
    } catch (e) {
      debugLog('focusMode 적용 실패(무시): ' + (e?.message||e));
    }

    // 실제 잡힌 deviceId 저장
    const track = _stream.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    const actualId = settings.deviceId || deviceId;
    const actualLabel = track?.label || '';
    saveCameraId(actualId, actualLabel);
    // _camIndex 동기화
    const idx = _cameras.findIndex(c => c.id === actualId);
    if (idx >= 0) _camIndex = idx;
    populateCamSelect();

    const reqShort = deviceId.slice(-8);
    const actShort = String(actualId).slice(-8);
    if (actualId !== deviceId) {
      setLabel(`mismatch 요청:${reqShort} 실제:${actShort}`);
    } else {
      setLabel(`잡힘 → ...${actShort}`);
    }

    // zoom 적용
    await applyZoom(loadZoom() ?? 2.0);

    // detect loop 시작
    startDetectLoop();
  }

  function startDetectLoop() {
    if (_scanLoop) clearInterval(_scanLoop);
    _scanLoop = setInterval(async () => {
      if (_detected) return;
      if (!_video || _video.readyState < 2) return;
      try {
        const codes = await _detector.detect(_video);
        if (codes && codes.length) {
          _detected = true;
          const text = codes[0].rawValue || '';
          finish(text);
        }
      } catch (e) {
        // ignore — detection 매 프레임 실패 가능
      }
    }, 200);
  }

  function finish(text) {
    capturePhoto(async (blob) => {
      await stop();   // overlay까지 닫음
      _onSuccess && _onSuccess(text, blob);
    });
  }

  function capturePhoto(done) {
    try {
      if (!_video || !_video.videoWidth) return done(null);
      const c = document.createElement('canvas');
      c.width = _video.videoWidth; c.height = _video.videoHeight;
      c.getContext('2d').drawImage(_video, 0, 0);
      if (c.toBlob) {
        c.toBlob((b) => done(b || null), 'image/jpeg', 0.9);
      } else {
        done(null);
      }
    } catch { done(null); }
  }

  async function stopStream() {
    if (_scanLoop) { clearInterval(_scanLoop); _scanLoop = null; }
    if (_stream) {
      _stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      _stream = null;
    }
    if (_video) _video.srcObject = null;
  }

  async function stopAll() {
    await stopStream();
    if (_fallbackScanner) {
      try { await _fallbackScanner.stop(); } catch {}
      try { await _fallbackScanner.clear(); } catch {}
      _fallbackScanner = null;
    }
  }

  async function stop() {
    await stopAll();
    document.getElementById('qr-scan-overlay').style.display = 'none';
  }

  // ─── zoom ─────────────────────────
  async function applyZoom(z) {
    try {
      if (!_stream) return;
      const t = _stream.getVideoTracks()[0];
      const cap = t?.getCapabilities?.() || {};
      if (cap.zoom) {
        const zoom = Math.min(Math.max(z, cap.zoom.min), cap.zoom.max);
        await t.applyConstraints({ advanced: [{ zoom }] });
        saveZoom(zoom);
      }
    } catch {}
  }

  async function adjustZoom(delta) {
    try {
      if (!_stream) return;
      const t = _stream.getVideoTracks()[0];
      const cap = t?.getCapabilities?.();
      if (!cap?.zoom) return;
      const cur = t.getSettings().zoom || 1;
      const next = Math.max(cap.zoom.min, Math.min(cap.zoom.max, cur + delta));
      await t.applyConstraints({ advanced: [{ zoom: next }] });
      saveZoom(next);
    } catch {}
  }

  // ─── 카메라 전환 (select onchange) ─────────────────────────
  async function switchToDeviceId(deviceId) {
    setLabel(`전환 중 → ...${deviceId.slice(-8)}`);
    await startWithDeviceId(deviceId);
  }

  async function switchCamera() {
    if (!_cameras.length) return;
    _camIndex = (_camIndex + 1) % _cameras.length;
    await switchToDeviceId(_cameras[_camIndex].id);
  }

  function showError(msg) {
    const el = document.getElementById('qr-error-msg');
    el.textContent = msg;
    el.style.display = '';
    debugLog('ERROR: ' + msg);
  }

  // ─── 폴백: html5-qrcode ─────────────────────────
  async function startFallback() {
    if (typeof Html5Qrcode === 'undefined') {
      return showError('카메라 라이브러리 로드 실패');
    }
    // _video는 안 쓰고 qr-reader div 내부에서 라이브러리가 동작
    const host = document.getElementById('qr-reader');
    host.innerHTML = '';
    _fallbackScanner = new Html5Qrcode('qr-reader');
    try {
      await _fallbackScanner.start(
        { facingMode: 'environment' },
        { fps: 20, aspectRatio: 1.0, qrbox: (w,h) => ({ width: Math.floor(Math.min(w,h)*0.7), height: Math.floor(Math.min(w,h)*0.7) }) },
        (text) => {
          if (_detected) return;
          _detected = true;
          stopAll().then(() => _onSuccess && _onSuccess(text, null));
        },
        () => {}
      );
      setLabel('[폴백] html5-qrcode');
    } catch (e) {
      showError('카메라 시작 실패: ' + (e?.message||e));
    }
  }

  // ─── init ─────────────────────────
  function init() {
    document.getElementById('qr-close-btn').onclick = stop;
    const sw = document.getElementById('qr-switch-btn');
    if (sw) sw.onclick = switchCamera;
    document.getElementById('qr-zoom-in').onclick = () => adjustZoom(+0.5);
    document.getElementById('qr-zoom-out').onclick = () => adjustZoom(-0.5);
    const sel = document.getElementById('qr-cam-select');
    if (sel) {
      sel.onchange = async () => {
        const id = sel.value;
        if (!id) return;
        sel.disabled = true;
        try {
          await switchToDeviceId(id);
        } finally {
          sel.disabled = false;
        }
      };
    }
  }

  return { show, stop, init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', QrScanner.init);
} else {
  QrScanner.init();
}
