// qr-scanner.js — html5-qrcode 래퍼
// ami-work 옛 admin.html(커밋 a74dac7) 코드를 모듈화

const QrScanner = (() => {
  let _scanner = null;
  let _cameras = [];
  let _camIndex = 0;
  let _onSuccess = null; // (text, photoDataUrl) => void

  function show(onSuccess) {
    _onSuccess = onSuccess;
    document.getElementById('qr-scan-overlay').style.display = 'flex';
    document.getElementById('qr-error-msg').style.display = 'none';
    start();
  }

  async function start() {
    console.log('[QR] start, Html5Qrcode:', typeof Html5Qrcode);
    if (typeof Html5Qrcode === 'undefined') {
      return showError('html5-qrcode 라이브러리 로드 실패 — CDN 차단 의심');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return showError('이 브라우저는 카메라 미지원 (HTTPS 필요)');
    }
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
    _camIndex = 0;
    document.getElementById('qr-switch-btn').style.display = _cameras.length > 1 ? '' : 'none';
    await startCamera(_cameras[_camIndex].id);
  }

  async function startCamera(cameraId) {
    if (_scanner) { try { await _scanner.stop(); } catch {} _scanner = null; }
    _scanner = new Html5Qrcode('qr-reader');

    const config = {
      fps: 20,
      qrbox: (w, h) => {
        // QR은 정사각형 — 화면 좁은 쪽의 70%
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

    const cam = _cameras[_camIndex];
    document.getElementById('qr-cam-label').textContent =
      `${cam.label || '카메라'} (${_camIndex + 1}/${_cameras.length})`;

    try {
      await _scanner.start(cameraId, config,
        (text) => onDetected(text),
        () => {}); // 매 프레임 디코딩 실패 무시
      await applyZoom(2.0);  // 광각 회피 + QR 인식률 향상
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
        const zoom = Math.min(z, cap.zoom.max);
        await t.applyConstraints({ advanced: [{ zoom }] });
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
      const cam = _cameras[_camIndex];
      const lbl = document.getElementById('qr-cam-label');
      if (lbl) lbl.textContent = `${cam.label || '카메라'} (${_camIndex + 1}/${_cameras.length}) · ${next.toFixed(1)}x`;
    } catch {}
  }

  async function switchCamera() {
    _camIndex = (_camIndex + 1) % _cameras.length;
    await startCamera(_cameras[_camIndex].id);
  }

  function onDetected(text) {
    // 영상 프레임 → Blob 캡처 (사진 슬롯에 자동 채움용)
    const v = document.querySelector('#qr-reader video');
    let blob = null;
    if (v && v.videoWidth && v.videoHeight) {
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        c.toBlob((b) => {
          stop();
          _onSuccess && _onSuccess(text, b);
        }, 'image/jpeg', 0.9);
        return;
      } catch (e) { console.warn('프레임 캡처 실패', e); }
    }
    stop();
    _onSuccess && _onSuccess(text, null);
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
