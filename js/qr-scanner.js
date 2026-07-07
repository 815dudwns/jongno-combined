// qr-scanner.js — getUserMedia + BarcodeDetector 직접 구현
// 이유: Android Chrome에서 html5-qrcode가 deviceId를 안 받음
//       → 우리가 카메라 stream을 직접 잡아서 100% 통제
// BarcodeDetector 미지원 시 Html5Qrcode로 폴백

const QrScanner = (() => {
  let _stream = null;
  let _video = null;
  let _detector = null;
  let _scanLoop = null;     // 폴백(html5-qrcode) 경로 전용
  let _frameHandle = null;  // requestVideoFrameCallback / rAF 핸들
  let _roiCanvas = null;
  let _roiCtx = null;
  let _torchOn = false;
  let _detected = false;
  let _onSuccess = null;
  let _cameras = [];     // {id, label, groupId, facingMode}
  let _camIndex = 0;
  let _fallbackScanner = null;
  let _useFallback = false;

  const LS_CAM = 'qr_camera_id';
  const LS_CAM_LABEL = 'qr_camera_label';

  function saveCameraId(id, label) {
    try {
      if (id) localStorage.setItem(LS_CAM, id);
      if (label) localStorage.setItem(LS_CAM_LABEL, label);
    } catch {}
  }
  function loadCameraId() { try { return localStorage.getItem(LS_CAM) || ''; } catch { return ''; } }
  function loadCameraLabel() { try { return localStorage.getItem(LS_CAM_LABEL) || ''; } catch { return ''; } }
  function clearCameraId() { try { localStorage.removeItem(LS_CAM); } catch {} }
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

  // iOS Safari 등 BarcodeDetector 미지원 환경: barcode-detector(ZXing wasm) 폴리필을 주입해
  // iOS/안드로이드 모두 동일하게 getUserMedia + BarcodeDetector 경로로 처리한다.
  let _polyfillTried = false;
  async function ensureBarcodeDetector() {
    if (typeof window.BarcodeDetector === 'function') {
      try { await window.BarcodeDetector.getSupportedFormats(); return true; } catch (e) {}
    }
    if (_polyfillTried) return typeof window.BarcodeDetector === 'function';
    _polyfillTried = true;
    try {
      await import('https://cdn.jsdelivr.net/npm/barcode-detector@2/dist/es/side-effects.min.js');
      debugLog('barcode-detector 폴리필 로드 OK');
    } catch (e) {
      debugLog('폴리필 로드 실패: ' + (e?.message || e));
    }
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

    // BarcodeDetector 확보 (iOS는 폴리필 주입). 실패 시에만 html5-qrcode 폴백
    const hasBD = await ensureBarcodeDetector();
    if (!hasBD) {
      debugLog('BarcodeDetector 미지원(폴리필도 실패) → html5-qrcode 폴백');
      _useFallback = true;
      return startFallback();
    }
    debugLog('BarcodeDetector OK');
    _detector = await initDetector();
    if (!_detector) {
      _useFallback = true;
      return startFallback();
    }

    // 임시 권한 스트림은 받지 않는다 — iOS Safari에서 두 번째 getUserMedia가
    // 첫 스트림을 muted/검은 화면으로 만드는 WebKit 버그(#179363) 회피.
    // 카메라 라벨은 실제 스트림을 잡은 뒤 채워진다.

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

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    try {
      if (isIOS || !deviceId) {
        // iOS Safari는 deviceId:{exact}가 OverconstrainedError 빈발 + 세션마다 deviceId 바뀜
        // → facingMode:{ideal:environment}로 후면 카메라 요청
        debugLog('getUserMedia(facingMode environment)...');
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
      } else {
        debugLog(`getUserMedia({deviceId: ${deviceId.slice(-8)}})...`);
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
      }
    } catch (e) {
      debugLog('getUserMedia 실패: ' + (e?.message||e));
      // 폴백: 제약 최소화 facingMode
      try {
        debugLog('폴백: facingMode environment 시도');
        _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      } catch (e2) {
        return showError('카메라 접근 실패: ' + (e2?.message||e2));
      }
    }

    _video.srcObject = _stream;
    try { await _video.play(); } catch (e) { debugLog('video.play 실패(무시): ' + (e?.message||e)); }

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

    // torch 버튼 표시 여부 갱신 (새 스트림은 torch 꺼진 상태)
    _torchOn = false;
    updateTorchBtn();

    // detect loop 시작
    startDetectLoop();
  }

  // ─── ROI 중앙크롭 (구글 스캐너식: 중앙 70% 정사각만 detect → CPU 절감·인식↑) ───
  function getRoiCanvas() {
    if (!_roiCanvas) {
      _roiCanvas = document.createElement('canvas');
      _roiCtx = _roiCanvas.getContext('2d');
    }
    return _roiCanvas;
  }
  function captureRoi() {
    const vw = _video.videoWidth, vh = _video.videoHeight;
    if (!vw || !vh) return null;
    const roi = Math.floor(Math.min(vw, vh) * 0.7);   // 중앙 70% 정사각
    const sx = Math.floor((vw - roi) / 2);
    const sy = Math.floor((vh - roi) / 2);
    const out = Math.min(roi, 640);                    // 다운스케일 ≤640 (QR 인식엔 충분)
    const c = getRoiCanvas();
    if (c.width !== out) { c.width = out; c.height = out; }
    _roiCtx.drawImage(_video, sx, sy, roi, roi, 0, 0, out, out);
    return c;
  }

  let _detecting = false;
  async function detectOnce() {
    if (_detected || _detecting || !_video || _video.readyState < 2) return;
    _detecting = true;
    try {
      // ROI 중앙크롭(640px)만 detect — 전체 1080p보다 가벼움. QR은 중앙에 대고 스캔.
      const roi = captureRoi();
      if (!roi) return;
      let codes = null;
      try { codes = await _detector.detect(roi); } catch {}
      if (codes && codes.length && !_detected) {
        _detected = true;
        finish(codes[0].rawValue || '');
      }
    } finally {
      _detecting = false;
    }
  }

  // 프레임 루프: setInterval 5fps (안드로이드 BarcodeDetector엔 rVFC 60fps가 과부하 → 렉)
  function startDetectLoop() {
    stopDetectLoop();
    _scanLoop = setInterval(() => { if (!_detected) detectOnce(); }, 200);
  }

  function stopDetectLoop() {
    if (_scanLoop) { clearInterval(_scanLoop); _scanLoop = null; }
    if (_frameHandle != null) {
      try { if (_video && 'cancelVideoFrameCallback' in HTMLVideoElement.prototype) _video.cancelVideoFrameCallback(_frameHandle); } catch {}
      try { cancelAnimationFrame(_frameHandle); } catch {}
      _frameHandle = null;
    }
  }

  function finish(text) {
    try { if (navigator.vibrate) navigator.vibrate(80); } catch {}  // 인식 성공 햅틱(안드로이드)
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
    stopDetectLoop();
    if (_torchOn) { try { await setTorch(false); } catch {} }
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

  // ─── torch (손전등) ─────────────────────────
  function trackHasTorch() {
    try {
      const cap = _stream?.getVideoTracks?.()[0]?.getCapabilities?.() || {};
      return !!cap.torch;
    } catch { return false; }
  }
  async function setTorch(on) {
    try {
      const t = _stream?.getVideoTracks?.()[0];
      const cap = t?.getCapabilities?.() || {};
      if (!t || !cap.torch) return;
      await t.applyConstraints({ advanced: [{ torch: !!on }] });
      _torchOn = !!on;
      paintTorchBtn();
    } catch {}
  }
  async function toggleTorch() { await setTorch(!_torchOn); }
  function paintTorchBtn() {
    // 정적 qr-torch-btn(QR모드) + 동적 cam-torch-btn(카메라모드) 모두 갱신
    [document.getElementById('qr-torch-btn'), document.getElementById('cam-torch-btn')].forEach(btn => {
      if (!btn) return;
      btn.style.background = _torchOn ? '#f59e0b' : '#374151';
      btn.style.borderColor = _torchOn ? '#f59e0b' : '#6b7280';
      btn.style.color = _torchOn ? '#1f2937' : 'white';
    });
  }
  function updateTorchBtn() {
    const has = trackHasTorch();
    // 정적 qr-torch-btn(QR모드)
    const btn = document.getElementById('qr-torch-btn');
    if (btn) btn.style.display = has ? '' : 'none';
    // 동적 cam-torch-btn(카메라모드) — display:none(미지원) or ''(지원)
    const camBtn = document.getElementById('cam-torch-btn');
    if (camBtn) camBtn.style.display = has ? '' : 'none';
    paintTorchBtn();
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

  // ─── 카메라 모드 (신설 사진 촬영용) ─────────────────────────
  // showCamera({onQr, onShutter, onError})
  //   onQr(raw)      — 실시간 QR 인식 시 1회 호출 (카메라 유지, 반복 호출 없음)
  //   onShutter(blob) — 셔터 버튼 → 현재 프레임 jpeg blob (카메라 닫힘)
  //   onError(msg)   — getUserMedia 실패 등 (카메라 닫힘)
  let _mode = 'qr';           // 'qr' | 'camera'
  let _onShutter = null;
  let _onQr = null;
  let _onCamError = null;
  let _qrDone = false;        // 카메라 모드: QR 1회 저장 후 추가 인식 억제

  // QR 인식 박스(초록 사각형) 캔버스 — #qr-reader 위에 절대위치
  function ensureQrBoxCanvas() {
    if (document.getElementById('cam-qr-box')) return;
    const host = document.getElementById('qr-reader');
    if (!host) return;
    const cv = document.createElement('canvas');
    cv.id = 'cam-qr-box';
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    host.appendChild(cv);
  }
  function clearQrBox() {
    const cv = document.getElementById('cam-qr-box');
    if (!cv) return;
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  }
  function drawQrBox(bx, by, bw, bh, out) {
    // ROI = 중앙 70% 정사각. #qr-reader는 정사각 D×D + object-fit:cover.
    // 따라서 ROI = 0.7D 정사각 (중앙 offset 0.15D).
    // out(ROI 캔버스 픽셀) → 화면 좌표: x_screen = 0.15D + (bx/out)*0.7D
    const cv = document.getElementById('cam-qr-box');
    if (!cv) return;
    const D = cv.offsetWidth || cv.clientWidth || 300;
    cv.width = D; cv.height = D;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, D, D);
    const scale = 0.7 * D / out;
    const offX = 0.15 * D;
    const offY = 0.15 * D;
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = Math.max(3, Math.round(D * 0.008));
    ctx.strokeRect(offX + bx * scale, offY + by * scale, bw * scale, bh * scale);
  }

  // 카메라 모드용 오버레이 요소 생성/참조 (DOM에 없으면 동적 삽입)
  function ensureCamOverlay() {
    if (document.getElementById('cam-shutter-bar')) return;
    const overlay = document.getElementById('qr-scan-overlay');
    if (!overlay) return;
    // 셔터 버튼 바 (오버레이 하단에 삽입)
    const bar = document.createElement('div');
    bar.id = 'cam-shutter-bar';
    bar.style.cssText = 'display:none;flex-direction:column;align-items:center;' +
      'padding:14px 16px calc(14px + env(safe-area-inset-bottom));background:#111;gap:10px;';
    // QR 결과 표시 (프리뷰 위에)
    const qrTag = document.createElement('div');
    qrTag.id = 'cam-qr-tag';
    qrTag.style.cssText = 'display:none;background:rgba(0,0,0,.75);color:#34d399;' +
      'font-size:17px;font-weight:800;padding:12px 18px;border-radius:14px;' +
      'text-align:center;max-width:90%;word-break:break-all;';
    bar.appendChild(qrTag);
    // 버튼 행 (QR재인식 + 손전등 + 촬영)
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;align-items:center;width:100%;justify-content:center;';
    // QR 재인식 버튼
    const reBtn = document.createElement('button');
    reBtn.id = 'cam-rescan-btn';
    reBtn.textContent = 'QR 재인식';
    reBtn.style.cssText = 'flex:1;max-width:140px;padding:18px 12px;background:#374151;color:#fff;border:2px solid #6b7280;' +
      'border-radius:999px;font-size:18px;font-weight:800;cursor:pointer;min-height:64px;';
    reBtn.onclick = () => {
      _qrDone = false;
      setCamQrTag('');
      clearQrBox();
    };
    btnRow.appendChild(reBtn);
    // 손전등 버튼
    const torchBtn = document.createElement('button');
    torchBtn.id = 'cam-torch-btn';
    torchBtn.textContent = '손전등';
    torchBtn.style.cssText = 'flex:1;max-width:140px;padding:18px 12px;background:#374151;color:#fff;border:2px solid #6b7280;' +
      'border-radius:999px;font-size:18px;font-weight:800;cursor:pointer;min-height:64px;display:none;';
    torchBtn.onclick = () => toggleTorch();
    btnRow.appendChild(torchBtn);
    // 촬영 버튼
    const btn = document.createElement('button');
    btn.id = 'cam-shutter-btn';
    btn.textContent = '촬영';
    btn.style.cssText = 'flex:1;max-width:180px;padding:18px 16px;background:linear-gradient(145deg,#5fe0c0,#2bb89a);' +
      'color:#04261f;border:none;border-radius:999px;font-size:24px;font-weight:800;' +
      'box-shadow:0 8px 20px rgba(43,184,154,.35);cursor:pointer;min-height:64px;';
    btn.onclick = shutterClick;
    btnRow.appendChild(btn);
    bar.appendChild(btnRow);
    overlay.appendChild(bar);
    // QR 박스 캔버스 (#qr-reader 안에)
    ensureQrBoxCanvas();
  }

  function setCamOverlayVisible(visible) {
    const bar = document.getElementById('cam-shutter-bar');
    if (bar) bar.style.display = visible ? 'flex' : 'none';
  }

  function setCamQrTag(text) {
    const tag = document.getElementById('cam-qr-tag');
    if (!tag) return;
    if (text) { tag.textContent = text; tag.style.display = ''; }
    else { tag.textContent = ''; tag.style.display = 'none'; }
  }

  async function shutterClick() {
    // 현재 video 프레임을 원본 해상도(jpeg 0.95)로 캡처 → onShutter
    // ★ drawImage(동기)로 프레임을 먼저 그래브한 뒤 카메라 즉시 닫음 → toBlob(비동기) 중 프리뷰 잔류 방지
    try {
      if (!_video || !_video.videoWidth) { return; }
      const c = document.createElement('canvas');
      c.width = _video.videoWidth; c.height = _video.videoHeight;
      c.getContext('2d').drawImage(_video, 0, 0);  // 프레임 그래브 (동기)
      await stopCameraMode();                       // 카메라 즉시 닫기 (toBlob 전)
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.95));
      _onShutter && _onShutter(blob || null);
    } catch(e) {
      await stopCameraMode();
      _onCamError && _onCamError('셔터 캡처 실패: ' + (e?.message || e));
    }
  }

  function showCamera({ onQr, onShutter, onError } = {}) {
    _mode = 'camera';
    _onQr = onQr || null;
    _onShutter = onShutter || null;
    _onCamError = onError || null;
    _qrDone = false;
    _onSuccess = null;  // QR 모드 콜백 비움
    _detected = false;

    ensureCamOverlay();
    setCamQrTag('');

    document.getElementById('qr-scan-overlay').style.display = 'flex';
    document.getElementById('qr-error-msg').style.display = 'none';

    // 기존 QR 모드 close 버튼 → 카메라 모드에서는 stopCameraMode 경유
    const closeBtn = document.getElementById('qr-close-btn');
    if (closeBtn) closeBtn.onclick = () => stopCameraMode();

    _video = document.getElementById('qr-reader-video');
    if (!_video) {
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

    setCamOverlayVisible(true);
    startCamera();
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      await stopCameraMode();
      _onCamError && _onCamError('카메라 미지원 (HTTPS 필요)');
      return;
    }
    const hasBD = await ensureBarcodeDetector();
    if (hasBD) {
      _detector = await initDetector();
    }

    await enumerateCameras();

    const savedId = loadCameraId();
    const savedLabel = loadCameraLabel();
    let target = null;
    if (savedId) target = _cameras.find(c => c.id === savedId);
    if (!target && savedLabel) target = _cameras.find(c => (c.label||'') === savedLabel);
    if (!target) {
      const rears = _cameras.filter(c => /back|rear|environment|후면/i.test(c.label));
      const nonWide = rears.find(c => !/(ultra.?wide|wide.?angle|광각|초광각)/i.test(c.label));
      target = nonWide || rears[0] || _cameras[0];
    }
    if (!target) {
      await stopCameraMode();
      _onCamError && _onCamError('카메라를 찾을 수 없습니다');
      return;
    }
    _camIndex = _cameras.findIndex(c => c.id === target.id);
    await startCameraWithDeviceId(target.id);
  }

  async function startCameraWithDeviceId(deviceId) {
    await stopStream();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    try {
      if (isIOS || !deviceId) {
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }
        });
      } else {
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId }, width: { ideal: 2560 }, height: { ideal: 1920 } }
        });
      }
    } catch(e) {
      try {
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
      } catch(e2) {
        try {
          _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        } catch(e3) {
          await stopCameraMode();
          _onCamError && _onCamError('카메라 접근 실패: ' + (e3?.message || e3));
          return;
        }
      }
    }

    _video.srcObject = _stream;
    try { await _video.play(); } catch(e) {}

    try {
      const focusTrack = _stream.getVideoTracks()[0];
      const cap = focusTrack?.getCapabilities?.() || {};
      if (cap.focusMode && cap.focusMode.includes('continuous')) {
        await focusTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
    } catch(e) {}

    const track = _stream.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    const actualId = settings.deviceId || deviceId;
    const actualLabel = track?.label || '';
    saveCameraId(actualId, actualLabel);
    const idx = _cameras.findIndex(c => c.id === actualId);
    if (idx >= 0) _camIndex = idx;
    populateCamSelect();
    setLabel('카메라 준비됨');

    _torchOn = false;
    updateTorchBtn();

    // 카메라 모드: QR 디텍션 루프 (BarcodeDetector 없으면 QR 인식 없이 촬영만)
    if (_detector) startCameraDetectLoop();
  }

  let _camDetectLoop = null;
  function startCameraDetectLoop() {
    if (_camDetectLoop) clearInterval(_camDetectLoop);
    _camDetectLoop = setInterval(() => detectOnceCam(), 300);
  }
  function stopCameraDetectLoop() {
    if (_camDetectLoop) { clearInterval(_camDetectLoop); _camDetectLoop = null; }
  }

  let _camDetecting = false;
  async function detectOnceCam() {
    if (_qrDone || _camDetecting || !_video || _video.readyState < 2) return;
    _camDetecting = true;
    try {
      const roi = captureRoi();
      if (!roi) return;
      let codes = null;
      try { codes = await _detector.detect(roi); } catch {}
      if (codes && codes.length && !_qrDone) {
        _qrDone = true;
        try { if (navigator.vibrate) navigator.vibrate(80); } catch {}
        const raw = codes[0].rawValue || '';
        // 인식 위치 초록 박스 표시
        try {
          const bb = codes[0].boundingBox;
          if (bb) drawQrBox(bb.x, bb.y, bb.width, bb.height, roi.width);
        } catch(e) {}
        _onQr && _onQr(raw);
      }
    } finally {
      _camDetecting = false;
    }
  }

  // 카메라 모드 전용 stop (camDetectLoop 정리 포함)
  const _origStopAll = stopAll;
  async function stopCameraMode() {
    stopCameraDetectLoop();
    await stopAll();
    setCamOverlayVisible(false);
    setCamQrTag('');
    clearQrBox();
    document.getElementById('qr-scan-overlay').style.display = 'none';
    _mode = 'qr';
    // close 버튼 복원 (QR 모드 init 설정값)
    const closeBtn = document.getElementById('qr-close-btn');
    if (closeBtn) closeBtn.onclick = stop;
  }

  // stop 오버라이드: 카메라 모드면 stopCameraMode 경유
  const _origStop = stop;
  async function stopUnified() {
    if (_mode === 'camera') return stopCameraMode();
    return _origStop();
  }

  // ─── init ─────────────────────────
  function init() {
    // QR 스캐너 DOM이 없는 페이지(stats.html 등 공통 로드)에서는 초기화 스킵
    const closeBtn = document.getElementById('qr-close-btn');
    if (!closeBtn) return;
    closeBtn.onclick = stopUnified;
    const sw = document.getElementById('qr-switch-btn');
    if (sw) sw.onclick = switchCamera;
    const torchBtn = document.getElementById('qr-torch-btn');
    if (torchBtn) torchBtn.onclick = toggleTorch;
    const sel = document.getElementById('qr-cam-select');
    if (sel) {
      sel.onchange = async () => {
        const id = sel.value;
        if (!id) return;
        sel.disabled = true;
        try {
          if (_mode === 'camera') await startCameraWithDeviceId(id);
          else await switchToDeviceId(id);
        } finally {
          sel.disabled = false;
        }
      };
    }
  }

  return { show, stop: stopUnified, init, showCamera,
         saveCameraId, loadCameraId, loadCameraLabel, enumerateCameras, prettyCamLabel };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', QrScanner.init);
} else {
  QrScanner.init();
}
