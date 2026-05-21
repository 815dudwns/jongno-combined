// qr-scanner.js — html5-qrcode 래퍼
// ami-work 옛 admin.html(커밋 a74dac7) 코드를 모듈화

const QrScanner = (() => {
  let _scanner = null;
  let _cameras = [];
  let _camIndex = 0;
  let _onSuccess = null; // (text, photoDataUrl) => void
  let _detected = false; // 한 번 인식되면 후속 콜백 차단

  const LS_CAM = 'qr_camera_id';
  const LS_ZOOM = 'qr_zoom';

  function saveCameraId(id) { try { if (id) localStorage.setItem(LS_CAM, id); } catch {} }
  function loadCameraId() { try { return localStorage.getItem(LS_CAM) || ''; } catch { return ''; } }
  function clearCameraId() { try { localStorage.removeItem(LS_CAM); } catch {} }
  function saveZoom(z) { try { if (z > 0) localStorage.setItem(LS_ZOOM, String(z)); } catch {} }
  function loadZoom() {
    try { const v = parseFloat(localStorage.getItem(LS_ZOOM)); return isNaN(v) ? null : v; }
    catch { return null; }
  }
  function currentDeviceId() {
    try {
      const v = document.querySelector('#qr-reader video');
      const t = v?.srcObject?.getVideoTracks?.()[0];
      return t?.getSettings?.()?.deviceId || '';
    } catch { return ''; }
  }

  function show(onSuccess) {
    _onSuccess = onSuccess;
    _detected = false;
    document.getElementById('qr-scan-overlay').style.display = 'flex';
    document.getElementById('qr-error-msg').style.display = 'none';
    start();
  }

  function buildConfig() {
    return {
      fps: 20,
      aspectRatio: 1.0,
      qrbox: (w, h) => {
        const size = Math.floor(Math.min(w, h) * 0.7);
        return { width: size, height: size };
      },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.PDF_417,
        Html5QrcodeSupportedFormats.AZTEC,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ]
    };
  }

  async function start() {
    console.log('[QR] start, Html5Qrcode:', typeof Html5Qrcode);
    if (typeof Html5Qrcode === 'undefined') {
      return showError('html5-qrcode 라이브러리 로드 실패 — CDN 차단 의심');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return showError('이 브라우저는 카메라 미지원 (HTTPS 필요)');
    }

    // 0차: 저장된 카메라 ID 우선 (사용자가 마지막에 쓴 것)
    // 1차: facingMode exact environment (후면 강제)
    // 2차: facingMode ideal environment (후면 선호)
    // 3차: getCameras() + 라벨 매칭 폴백
    const savedId = loadCameraId();
    if (savedId && await startWithSavedId(savedId)) return;
    if (await startWithFacing({ exact: 'environment' }, '후면(강제)')) return;
    if (await startWithFacing('environment', '후면(선호)'))         return;
    await startWithCameraList();
  }

  async function startWithSavedId(id) {
    if (_scanner) { try { await _scanner.stop(); } catch {} _scanner = null; }
    _scanner = new Html5Qrcode('qr-reader');
    try {
      await _scanner.start(id, buildConfig(),
        (text) => onDetected(text),
        () => {});
      // 라벨·전환버튼은 카메라 목록 비동기 로드
      Html5Qrcode.getCameras().then(cs => {
        _cameras = cs || [];
        const idx = _cameras.findIndex(c => c.id === id);
        _camIndex = idx >= 0 ? idx : 0;
        const cam = _cameras[_camIndex];
        const lbl = document.getElementById('qr-cam-label');
        if (lbl && cam) lbl.textContent = `${cam.label || '카메라'} (${_camIndex + 1}/${_cameras.length})`;
        document.getElementById('qr-switch-btn').style.display = _cameras.length > 1 ? '' : 'none';
      }).catch(() => {});
      await applyZoom(loadZoom() ?? 2.0);
      return true;
    } catch (e) {
      console.warn('[QR] 저장된 cameraId 실패 — 폴백 진행:', e?.message || e);
      clearCameraId(); // 사라진 디바이스일 수 있으니 정리
      try { await _scanner.stop(); } catch {}
      _scanner = null;
      return false;
    }
  }

  async function startWithFacing(facingMode, labelHint) {
    if (_scanner) { try { await _scanner.stop(); } catch {} _scanner = null; }
    _scanner = new Html5Qrcode('qr-reader');
    try {
      await _scanner.start({ facingMode }, buildConfig(),
        (text) => onDetected(text),
        () => {});
      _cameras = []; _camIndex = 0;
      const lbl = document.getElementById('qr-cam-label');
      if (lbl) lbl.textContent = labelHint;
      document.getElementById('qr-switch-btn').style.display = 'none';
      // 권한 부여된 뒤 카메라 목록 로드 (전환 버튼용 — 비동기, 실패 무시)
      Html5Qrcode.getCameras().then(cs => {
        _cameras = cs || [];
        const did = currentDeviceId();
        const idx = _cameras.findIndex(c => c.id === did);
        if (idx >= 0) _camIndex = idx;
        document.getElementById('qr-switch-btn').style.display = _cameras.length > 1 ? '' : 'none';
      }).catch(() => {});
      saveCameraId(currentDeviceId());
      await applyZoom(loadZoom() ?? 2.0);
      return true;
    } catch (e) {
      console.warn(`[QR] facingMode ${JSON.stringify(facingMode)} 실패:`, e?.message || e);
      try { await _scanner.stop(); } catch {}
      _scanner = null;
      return false;
    }
  }

  async function startWithCameraList() {
    try {
      _cameras = await Html5Qrcode.getCameras();
      console.log('[QR] cameras:', _cameras);
    } catch (e) {
      console.error('[QR] getCameras 실패:', e);
      return showError(camErrorMsg(e));
    }
    if (!_cameras || _cameras.length === 0) {
      return showError('카메라를 찾을 수 없습니다 (권한 거부 또는 미지원)');
    }
    const rearIdx = _cameras.findIndex(c =>
      /back|rear|environment|후면/i.test(c.label || '')
    );
    _camIndex = rearIdx >= 0 ? rearIdx : (_cameras.length > 1 ? _cameras.length - 1 : 0);
    document.getElementById('qr-switch-btn').style.display = _cameras.length > 1 ? '' : 'none';
    await startCamera(_cameras[_camIndex].id);
  }

  async function startCamera(cameraId) {
    if (_scanner) { try { await _scanner.stop(); } catch {} _scanner = null; }
    _scanner = new Html5Qrcode('qr-reader');

    const cam = _cameras[_camIndex];
    document.getElementById('qr-cam-label').textContent =
      `${cam.label || '카메라'} (${_camIndex + 1}/${_cameras.length})`;

    try {
      await _scanner.start(cameraId, buildConfig(),
        (text) => onDetected(text),
        () => {});
      saveCameraId(cameraId);
      await applyZoom(loadZoom() ?? 2.0);
    } catch (e) {
      showError(camErrorMsg(e));
    }
  }

  async function applyZoom(z) {
    try {
      const v = document.querySelector('#qr-reader video');
      if (!v?.srcObject) return;
      const t = v.srcObject.getVideoTracks()[0];
      const cap = t?.getCapabilities?.() || {};
      if (cap.zoom) {
        const zoom = Math.min(Math.max(z, cap.zoom.min), cap.zoom.max);
        await t.applyConstraints({ advanced: [{ zoom }] });
        saveZoom(zoom);
        const lbl = document.getElementById('qr-cam-label');
        if (lbl) lbl.textContent += ` · ${zoom}x`;
      }
    } catch {}
  }

  async function adjustZoom(delta) {
    try {
      const v = document.querySelector('#qr-reader video');
      if (!v?.srcObject) return;
      const t = v.srcObject.getVideoTracks()[0];
      const cap = t?.getCapabilities?.();
      if (!cap?.zoom) return;
      const cur = t.getSettings().zoom || 1;
      const next = Math.max(cap.zoom.min, Math.min(cap.zoom.max, cur + delta));
      await t.applyConstraints({ advanced: [{ zoom: next }] });
      saveZoom(next);
      const cam = _cameras[_camIndex];
      const lbl = document.getElementById('qr-cam-label');
      const camName = cam ? `${cam.label || '카메라'} (${_camIndex + 1}/${_cameras.length})` : '카메라';
      if (lbl) lbl.textContent = `${camName} · ${next.toFixed(1)}x`;
    } catch {}
  }

  async function switchCamera() {
    if (!_cameras.length) return;
    _camIndex = (_camIndex + 1) % _cameras.length;
    await startCamera(_cameras[_camIndex].id);
  }

  function onDetected(text) {
    // 매 프레임 detect 콜백이 여러 번 올 수 있어 첫 번째만 처리
    if (_detected) return;
    _detected = true;

    const finish = (blob) => {
      stop();
      _onSuccess && _onSuccess(text, blob);
    };

    const v = document.querySelector('#qr-reader video');
    if (!v || !v.videoWidth || !v.videoHeight) {
      console.warn('[QR] 비디오 준비 안 됨 — 사진 캡처 스킵');
      return finish(null);
    }

    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);

      // 1차: toBlob
      if (c.toBlob) {
        c.toBlob((b) => {
          if (b && b.size > 0) return finish(b);
          // 폴백: toDataURL → fetch → blob
          captureViaDataUrl(c, finish);
        }, 'image/jpeg', 0.9);
      } else {
        captureViaDataUrl(c, finish);
      }
    } catch (e) {
      console.warn('[QR] 프레임 캡처 실패', e);
      finish(null);
    }
  }

  function captureViaDataUrl(c, done) {
    try {
      const url = c.toDataURL('image/jpeg', 0.9);
      fetch(url).then(r => r.blob()).then(b => done(b || null))
        .catch((e) => { console.warn('[QR] dataURL→blob 실패', e); done(null); });
    } catch (e) {
      console.warn('[QR] toDataURL 실패', e);
      done(null);
    }
  }

  async function stop() {
    if (_scanner) {
      try { await _scanner.stop(); } catch {}
      _scanner = null;
    }
    document.getElementById('qr-scan-overlay').style.display = 'none';
  }

  function showError(msg) {
    const el = document.getElementById('qr-error-msg');
    el.textContent = msg;
    el.style.display = '';
  }

  function camErrorMsg(e) {
    const m = String(e?.message || e || '');
    if (m.includes('Permission') || m.includes('NotAllowed')) return '카메라 권한 거부됨 — 브라우저 설정 확인';
    if (m.includes('NotFound')) return '카메라 없음';
    if (m.includes('NotReadable')) return '다른 앱이 카메라 사용 중';
    return `스캔 시작 실패: ${m}`;
  }

  function init() {
    document.getElementById('qr-close-btn').onclick = stop;
    document.getElementById('qr-switch-btn').onclick = switchCamera;
    document.getElementById('qr-zoom-in').onclick = () => adjustZoom(+0.5);
    document.getElementById('qr-zoom-out').onclick = () => adjustZoom(-0.5);
  }

  return { show, stop, init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', QrScanner.init);
} else {
  QrScanner.init();
}
