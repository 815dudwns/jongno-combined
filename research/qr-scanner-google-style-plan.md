# QR/바코드 스캐너 구글 렌즈 수준 개선 계획

작성: 2026-06-07  
대상 파일: `jongno-combined/js/qr-scanner.js` (428줄, 현재 구현 기준)  
목표: Android Chrome 현장 앱에서 계기번호 QR·바코드를 구글 스캐너 수준으로 빠르고 강건하게 인식

---

## 1. BarcodeDetector API 2026년 현황

### 지원 브라우저

| 브라우저 | 지원 여부 | 비고 |
|---|---|---|
| Chrome 83+ (Android/데스크탑) | 지원 | 기본 내장, GPU 가속 |
| Edge 83+ | 지원 | Chromium 기반 |
| Chrome for Android | 지원 | 현장 앱 주 타겟 — 핵심 경로 |
| Samsung Internet | 지원 | Chromium 기반 |
| **iOS Safari** | **미지원** | 2026년 6월 기준도 미지원. 구현 계획 없음 확인됨 |
| Firefox (Android/데스크탑) | 미지원 | 구현 계획 없음 |

출처: [MDN BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) / [caniuse BarcodeDetector API](https://caniuse.com/?search=BarcodeDetector)

**결론**: iOS Safari와 Firefox는 BarcodeDetector를 지원하지 않는다. 폴리필 또는 별도 엔진이 반드시 필요하다. 현장이 Android Chrome 위주라면 BarcodeDetector를 1순위 엔진으로 유지하되, iOS 대비 폴백 체인을 갖춰야 한다.

---

## 2. 엔진 비교: BarcodeDetector vs ZXing-wasm vs jsQR vs html5-qrcode

### 각 엔진 특성

**BarcodeDetector (Web API)**
- 네이티브 브라우저 구현 — GPU/하드웨어 가속, Android Chrome에서 가장 빠름
- QR, Code128, Code39, EAN-13, PDF417, DataMatrix 등 다중 포맷 단일 호출
- 비동기 API, `video` 엘리먼트 직접 detect 가능 (캔버스 불필요)
- iOS/Firefox에서 미지원 — 폴백 필수
- 출처: [MDN BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)

**zxing-wasm (`@sec-ant/zxing-wasm`)**
- ZXing-C++ 를 WebAssembly로 컴파일한 패키지 (npm: `zxing-wasm`, 최신 버전 3.x, 2025년 활발히 유지보수 중)
- wasm 바이너리 약 1.26 MB — 초기 로드 비용 존재, 이후 성능은 우수
- iOS Safari 포함 모든 브라우저에서 동작
- TypeScript 지원, ES/CJS 모듈
- QR 외에도 Code128, EAN, DataMatrix, PDF417 등 폭넓은 포맷 지원
- `readBarcodesFromImageData()` API로 캔버스 ImageData 받음 — ROI 크롭 적용 용이
- 출처: [@sec-ant/zxing-wasm](https://github.com/Sec-ant/zxing-wasm) / [socket.dev zxing-wasm](https://socket.dev/npm/package/@sec-ant/zxing-wasm)

**jsQR**
- 순수 JS, 가볍고 QR 전용
- 유지보수 실질적 중단 (마지막 릴리즈 2020년대 초반)
- 단순 QR 전용이므로 Code128 바코드 미지원 — 한전 계기번호가 QR 외에 Code128도 쓰므로 부적합
- 출처: [npmtrends 비교](https://npmtrends.com/@zxing/browser-vs-html5-qrcode-vs-qr-scanner-vs-zxing-wasm)

**html5-qrcode**
- ZXing-js 래퍼. 현재 구현의 폴백으로 사용 중
- 마지막 npm 릴리즈: 2.3.8 (약 3년 전, 2022년). 사실상 유지보수 중단 상태
- Android Chrome에서 deviceId를 안 받는 버그 있음 (현재 구현이 이미 우회)
- 신규 구현에서 제거 권장
- 출처: [npmtrends html5-qrcode](https://npmtrends.com/html5-qrcode)

**nimiq/qr-scanner**
- BarcodeDetector를 우선 사용하고, 미지원 시 jsQR WebWorker로 폴백하는 래퍼
- QR 전용 (Code128 미지원). 한전 바코드 전체 커버 불가
- iOS 관련 이슈 다수 보고됨

### 추천 엔진 조합

```
1순위: BarcodeDetector (Android Chrome 네이티브, GPU 가속)
2순위: zxing-wasm (iOS Safari / Firefox / BarcodeDetector 미지원 환경)
제거: html5-qrcode (유지보수 중단, deviceId 버그)
제거: jsQR (QR 전용, 유지보수 중단)
```

---

## 3. 추천 아키텍처

### 엔진 선택 + 폴백 체인

```
시작
  |
  +-- BarcodeDetector 지원? (typeof window.BarcodeDetector === 'function')
  |     Yes --> [엔진 A] BarcodeDetector
  |     No  --> [엔진 B] zxing-wasm (동적 import로 지연 로드)
  |
프레임 루프 (requestVideoFrameCallback / rAF 폴백)
  |
  +-- ROI 크롭 캔버스 (중앙 70% 정사각 영역)
  |
  +-- 엔진 A/B detect
  |
  +-- 성공 시: 햅틱 + 하이라이트 + 콜백
```

### 프레임 루프 방식

현재 구현은 `setInterval(200ms)` — 초당 5프레임 고정, 비디오 프레임과 비동기 불일치 발생.

개선: `requestVideoFrameCallback` 사용. 비디오 프레임이 실제로 합성될 때만 콜백 실행, CPU 낭비 없음.

```
지원 여부 확인:
  'requestVideoFrameCallback' in HTMLVideoElement.prototype
  --> Yes: requestVideoFrameCallback 사용 (Chrome 83+, Edge 83+)
  --> No:  requestAnimationFrame 폴백
```

출처: [MDN requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) / [web.dev per-video-frame 처리](https://web.dev/articles/requestvideoframecallback-rvfc)

---

## 4. 인식률 향상 기법

### 4-1. ROI 크롭 (가장 효과 큰 최적화)

현재 구현: `_detector.detect(_video)` — 1920x1080 전체 프레임 매 프레임 전달.  
구글 스캐너 방식: 화면 중앙 스캔 박스 영역만 크롭해 detect.

구현 방법:
- 오프스크린 캔버스에 비디오 중앙 70% 정사각 영역만 `drawImage()`로 크롭
- 캔버스를 detect에 전달 (BarcodeDetector는 `CanvasImageSource` 허용)
- 인식 실패 시 전체 프레임으로 retry (QR이 박스 밖에 있는 경우 대비)

```
roi_size = Math.min(videoWidth, videoHeight) * 0.7
roi_x = (videoWidth - roi_size) / 2
roi_y = (videoHeight - roi_size) / 2
```

효과: CPU 부담 최대 75% 감소 (1920x1080 → 756x756), BarcodeDetector 처리 속도 향상.

### 4-2. 다운스케일

ROI 크롭 후 출력 캔버스 크기를 640x640 또는 480x480으로 제한.  
QR 코드는 640px 이상에서 인식률 개선 없음.  
Code128 바코드는 가로 640px 유지 중요, 세로만 축소해도 됨.

### 4-3. 그레이스케일 전처리 (zxing-wasm 경로에서 선택적 적용)

zxing-wasm의 `readBarcodesFromImageData()`는 RGBA ImageData를 받으므로 그레이스케일 변환이 선택사항. 저조도 환경에서 대비 보정이 유효함.

대비 보정: `ImageData`를 직접 순회해 픽셀 값을 1.3~1.5배 증폭 후 clamp(0, 255).  
단, 이 전처리는 프레임마다 O(n) 연산이므로 CPU 부하 측정 후 적용 여부 결정 권장.

### 4-4. 연속 자동초점

현재 구현에 이미 구현됨 (`focusMode: 'continuous'` applyConstraints).  
유지하되 applyConstraints 실패 시 silent ignore — 이미 처리되어 있음.

---

## 5. torch / zoom / focus UI 추가안

### torch (손전등)

**지원 현황**: Android Chrome (Chrome 59+) 에서 `applyConstraints({ advanced: [{ torch: true }] })` 지원.  
iOS Safari 미지원.  
출처: [Chrome Developers — Image Capture API](https://developer.chrome.com/blog/imagecapture) / [oberhofer.co torch 가이드](https://oberhofer.co/mediastreamtrack-and-its-capabilities/)

**구현 방법**:
```javascript
// 지원 여부 확인
const cap = track.getCapabilities();
if (cap.torch) {
  // torch 버튼 표시
  await track.applyConstraints({ advanced: [{ torch: torchOn }] });
}
```

**UI**: 카메라 오버레이에 손전등 버튼 추가. `getCapabilities().torch`가 없으면 버튼 숨김.  
저장: `localStorage('qr_torch', '1')` — 다음 스캔에서 자동 복원.

### zoom

현재 구현에 `applyZoom()`, `adjustZoom()` 이미 구현됨. 다음 개선 제안:
- 핀치-줌 제스처(`touchstart` + `touchmove` 두 손가락 거리 변화) → `adjustZoom()` 연동
- zoom 슬라이더 UI (버튼 +/- 대신) — 직관적

### focus 수동 탭-투-포커스

`touchstart` 이벤트 좌표를 `focusPointOfInterest` 로 전달:
```javascript
// 지원 여부 확인 필수 — 미지원 기기 많음
if (cap.focusMode && cap.focusPointOfInterest) {
  await track.applyConstraints({
    advanced: [{ focusMode: 'single-shot', focusPointOfInterest: { x, y } }]
  });
}
```
단, `focusPointOfInterest` 지원 기기가 제한적이므로 UI 숨김 처리 필수.

---

## 6. iOS Safari 대응

BarcodeDetector 미지원 → zxing-wasm으로 폴백.

**zxing-wasm 지연 로드 전략**:
- 페이지 로드 시 즉시 로드 금지 (wasm 1.26 MB)
- QR 스캐너 오버레이 열릴 때 동적 `import()` 시작
- 로딩 중 "카메라 초기화 중..." 표시

```javascript
// BarcodeDetector 없을 때만 로드
if (!hasBarcodeDetector()) {
  const { readBarcodesFromImageData } = await import('https://cdn.jsdelivr.net/npm/zxing-wasm/+esm');
  // 또는 npm 번들된 경우: await import('/vendor/zxing-wasm.js')
}
```

**iOS Safari camera 주의사항**:
- `getUserMedia` 지원은 iOS 11+부터 (문제 없음)
- `facingMode: 'environment'` 지원 정상
- `getCapabilities()` 반환값이 Chrome보다 제한적 — torch/zoom 미지원이 일반적
- `enumerateDevices()`에서 카메라 라벨이 권한 없을 때 빈 문자열 반환 — 현재 구현의 라벨 기반 카메라 선택 로직이 iOS에서 빈 문자열로 폴백됨 (동작은 하지만 카메라 라벨 표시 불가)

---

## 7. 성공 피드백 UX

### 햅틱 (Vibration API)

**지원**: Android Chrome 지원. iOS Safari 미지원.  
출처: [MDN Navigator.vibrate](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)

```javascript
function hapticFeedback() {
  if ('vibrate' in navigator) {
    navigator.vibrate(80); // 80ms 진동, 짧고 명확하게
  }
}
```

### 오버레이 하이라이트

BarcodeDetector의 `detect()` 결과에는 `cornerPoints` (인식 영역 4각 좌표)가 포함됨.  
스캔 박스 위 캔버스에 초록색 폴리곤 오버레이를 100~200ms 표시 후 닫음.

```javascript
// codes[0].cornerPoints: [{x, y}, {x, y}, {x, y}, {x, y}]
// canvas 2d ctx로 폴리곤 그리기
```

zxing-wasm 경로는 `cornerPoints` 제공 여부 확인 필요 (zxing-wasm 3.x API에 `position` 필드 존재).

### 사운드

`AudioContext`로 단순 비프음 생성 (외부 파일 없이):
```javascript
const ctx = new AudioContext();
const osc = ctx.createOscillator();
osc.connect(ctx.destination);
osc.frequency.value = 880;
osc.start();
osc.stop(ctx.currentTime + 0.08);
```

---

## 8. 단계별 구현 플랜 (현재 qr-scanner.js 기준)

### Phase 1 — 프레임 루프 교체 (가장 즉각적인 속도 개선)

**대상 함수**: `startDetectLoop()`

현재:
```javascript
_scanLoop = setInterval(async () => { ... }, 200);  // 5fps 고정
```

개선:
```javascript
function startDetectLoop() {
  function onFrame(now, metadata) {
    if (_detected) return;
    detectOnce().then(() => {
      if (!_detected) _video.requestVideoFrameCallback(onFrame);
    });
  }
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    _video.requestVideoFrameCallback(onFrame);
  } else {
    // rAF 폴백
    function rafLoop() {
      if (_detected) return;
      detectOnce().then(() => requestAnimationFrame(rafLoop));
    }
    requestAnimationFrame(rafLoop);
  }
}
```

`_scanLoop` (clearInterval 대상)을 `cancelVideoFrameCallback` / `cancelAnimationFrame` 핸들로 교체.

### Phase 2 — ROI 크롭 오프스크린 캔버스 추가

**신규 함수**: `createRoiCanvas()`, `captureRoiImageData()`

`startDetectLoop` / `startWithDeviceId` 내에서 비디오 크기 확인 후 오프스크린 캔버스 1개 생성.  
`detectOnce()` 내에서:
1. ROI 크롭 → detect
2. 실패 시 전체 프레임 → detect (폴백)

### Phase 3 — zxing-wasm 폴백 교체

**대상 함수**: `startFallback()`

html5-qrcode 의존 제거. `startFallback()` 내부를 zxing-wasm 동적 import + WebWorker 루프로 교체.  
WebWorker 사용 시 detect 연산이 메인 스레드를 블록하지 않음 (UI 반응성 유지).

### Phase 4 — torch 버튼 추가

**신규 함수**: `toggleTorch()`  
`startWithDeviceId()` 완료 후 `getCapabilities()` 확인 → torch 지원 시 버튼 표시.  
HTML: 오버레이에 `<button id="qr-torch-btn">` 추가 (JS에서 동적 show/hide).

### Phase 5 — 성공 피드백

**대상 함수**: `finish()`

현재: 즉시 `stop()` → 콜백 호출  
개선:
1. `navigator.vibrate(80)` 호출
2. `cornerPoints`로 오버레이 하이라이트 100ms 표시
3. AudioContext 비프음 (선택)
4. 100ms 후 `stop()` → 콜백

### Phase 6 — 핀치줌 제스처 (선택)

`startDetectLoop` 시작과 함께 `video` 엘리먼트에 touch 이벤트 리스너 등록.  
두 손가락 거리 변화량 → `adjustZoom(delta)` 호출.

---

## 9. 리스크 및 호환성 주의점

### BarcodeDetector 주의

- Android Chrome에서도 `detect(video)` 호출 빈도가 높으면 큐 오버플로 발생 가능. `requestVideoFrameCallback`으로 동기화하면 자동 해소됨.
- `getSupportedFormats()` 결과는 기기마다 다름. 현재 구현의 `wanted.filter(f => formats.includes(f))` 로직 유지.

### zxing-wasm 주의

- 번들 크기 1.26 MB wasm — CDN 사용 시 CORS 헤더 확인 필수 (`Access-Control-Allow-Origin`).
- GitHub Pages에서는 CDN 직접 참조 또는 `/vendor/` 경로 복사 권장.
- 동적 import가 작동하려면 서버가 `Content-Type: application/wasm` 를 wasm 파일에 반환해야 함.

### requestVideoFrameCallback 주의

- `video.play()` 가 실제 재생 시작되기 전에 호출하면 콜백이 발동하지 않음.
- `video.readyState >= 2` 확인 후 루프 시작 — 현재 구현의 `_video.readyState < 2` 조건 유지.
- 콜백 내에서 다시 `requestVideoFrameCallback`을 호출해야 다음 프레임에도 실행됨 (one-shot 방식).

### torch 주의

- `applyConstraints({ advanced: [{ torch }] })` 는 `getCapabilities().torch === true`일 때만 호출. 그렇지 않으면 `OverconstrainedError` 발생.
- 스캐너 `stop()` 시 `torch: false`로 해제 필수. 스트림이 닫혀도 일부 기기에서 자동 해제 안 됨.

### iOS 사용 제한

- 현장이 Android 위주라면 iOS 대응 우선순위는 낮음. zxing-wasm 폴백만 갖추면 충분.
- iOS에서 zoom/torch 미지원 → 해당 버튼은 `getCapabilities()` 결과로 조건부 표시.
- iOS Safari에서 `enumerateDevices()` 라벨이 빈 문자열 → 카메라 선택 UI 표시가 의미 없음. iOS 판별 후 select 숨김 처리 가능 (`/iPad|iPhone|iPod/.test(navigator.userAgent)`).

### html5-qrcode 제거 시점

현재 폴백으로 사용 중. zxing-wasm 폴백이 안정화되면 `<script>` 태그 및 `startFallback()` 제거.  
점진적 교체를 위해 Phase 3 완료 후 1~2주 현장 테스트 후 제거 권장.

---

## 10. 최종 추천 스택 요약

| 항목 | 현재 | 개선 후 |
|---|---|---|
| 1순위 엔진 | BarcodeDetector | BarcodeDetector (유지) |
| 폴백 엔진 | html5-qrcode (유지보수 중단) | zxing-wasm (활발히 유지, iOS 지원) |
| 프레임 루프 | setInterval 200ms (5fps) | requestVideoFrameCallback (비디오 프레임 동기) |
| ROI 처리 | 없음 (전체 프레임 detect) | 중앙 70% 크롭 오프스크린 캔버스 |
| torch | 없음 | applyConstraints torch, 미지원 시 버튼 숨김 |
| 성공 피드백 | 없음 | navigator.vibrate(80) + 하이라이트 오버레이 |
| iOS 대응 | html5-qrcode (deviceId 버그) | zxing-wasm 동적 import |

---

## 참고 출처

- MDN BarcodeDetector: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
- caniuse BarcodeDetector: https://caniuse.com/?search=BarcodeDetector
- MDN requestVideoFrameCallback: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
- web.dev per-video-frame 처리: https://web.dev/articles/requestvideoframecallback-rvfc
- Chrome Developers — Image Capture (torch/zoom): https://developer.chrome.com/blog/imagecapture
- oberhofer.co torch 가이드: https://oberhofer.co/mediastreamtrack-and-its-capabilities/
- MDN Navigator.vibrate: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
- zxing-wasm (@sec-ant): https://github.com/Sec-ant/zxing-wasm
- npmtrends 라이브러리 비교: https://npmtrends.com/@zxing/browser-vs-html5-qrcode-vs-qr-scanner-vs-zxing-wasm
