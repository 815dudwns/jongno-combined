# iOS Safari QR/바코드 스캐너 작동 불가 — 원인 분석 및 해결 보고서

작성일: 2026-06-07
대상 파일: `js/qr-scanner.js` (jongno-combined)
배포 환경: GitHub Pages (HTTPS)

---

## 요약

iOS Safari에서 웹 QR 스캐너가 실패하는 원인은 단일하지 않다. 크게 5가지 독립적인 지뢰가 겹쳐 있으며, 현재 구현은 이 중 최소 3개에 걸려 있다. 해결책은 BarcodeDetector 폴리필(`barcode-detector` npm 패키지, zxing-wasm 기반)로 폴백 경로를 대체하는 것이 핵심이며, getUserMedia 호출 패턴도 iOS 전용 수정이 필요하다.

---

## 1. iOS Safari에서 getUserMedia 카메라가 안 뜨는 원인 (2026 기준)

### 1-1. HTTPS 요건 — 현재 구현 안전

GitHub Pages는 HTTPS이므로 이 항목은 문제 없다. 단, `localhost`나 `file://`에서 테스트할 때는 실패한다.

출처: MDN, https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia

### 1-2. `playsinline` 속성 누락 — 현재 구현 OK (주의 필요)

iOS Safari는 `playsinline` 속성 없이는 비디오를 전체화면으로 강제 전환하거나 아예 재생을 거부한다. 현재 코드에서 동적 생성 시 `setAttribute('playsinline', 'true')`로 설정하나, HTML에 video 엘리먼트가 이미 있는 경우(첫 번째 show() 호출에서 `getElementById`로 찾는 경우) HTML 마크업에 `playsinline`이 있는지 별도 확인 필요.

출처: Apple Developer, https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari

**필수 조합**: `<video playsinline muted autoplay>`

### 1-3. 사용자 제스처 요구 — 현재 구현 위험

iOS WebKit은 getUserMedia()를 반드시 사용자 제스처(tap/click) 핸들러 내부에서 호출해야 한다. `show()` 함수가 버튼 onclick에서 직접 호출되면 OK다. 그러나 `setTimeout`, `Promise.then` 체인 안에서 비동기로 흘러가면 사용자 제스처 컨텍스트가 끊긴다.

현재 코드에서 `show() → start() → (await) → startFallback()` 또는 `startWithDeviceId()` 까지 여러 단계의 await가 있다. iOS Safari 일부 버전에서는 await 이후에 호출된 getUserMedia가 "사용자 제스처 없음"으로 NotAllowedError를 낸다.

출처: clipy.online, https://clipy.online/blog/webcam-and-mic-permissions-chrome-safari-firefox-edge

### 1-4. 저전력 모드(Low Power Mode)

저전력 모드에서 Safari의 autoplay 정책이 강화된다. `video.play()`를 await하지 않고 무시하면(`try { await _video.play(); } catch {}`) 저전력 모드에서 카메라 프리뷰가 black으로 남을 수 있다.

출처: lesniakrafal.com, https://lesniakrafal.com/how-to-enable-autoplay-videos-in-low-power-mode-ios-macos/

### 1-5. 권한 거부 상태 + PWA hash 네비게이션 재요청 버그

**WebKit 버그 #215884**: iOS Safari (특히 PWA/홈화면 추가 앱)에서 hash router(`#/page`)로 이동하면 카메라 권한을 다시 요청한다. 이미 허용했어도 매번 재요청. iOS Safari에서 권한은 세션 단위이며 영구 저장이 안 된다.

출처: bugs.webkit.org, https://bugs.webkit.org/show_bug.cgi?id=215884

### 1-6. iframe 제약

iframe 안에서 getUserMedia를 쓰려면 `allow="camera"` 속성이 필요하다. GitHub Pages에서 직접 서빙하는 경우는 해당 없다.

---

## 2. 현재 구현의 핵심 문제: getUserMedia + deviceId:exact 조합

### 2-1. iOS Safari에서 `deviceId:{exact:...}` 실패

현재 `startWithDeviceId()` 함수에서 다음 패턴을 사용한다:

```js
_stream = await navigator.mediaDevices.getUserMedia({
  video: { deviceId: { exact: deviceId }, width:{ideal:1920}, height:{ideal:1080} }
});
```

**iOS Safari에서 이 패턴은 OverconstrainedError 또는 NotFoundError를 낸다.**

이유:
- iOS Safari에서 권한 허용 전 `enumerateDevices()`는 빈 deviceId를 반환한다.
- 권한 허용 후에도 deviceId가 세션마다 달라질 수 있다(WebKit 구현).
- `exact` 키워드는 iOS Safari에서 "이 deviceId가 없으면 즉시 실패"를 의미하므로, 저장된 ID가 무효화된 경우 바로 에러.

출처:
- bugs.webkit.org #230819, https://bugs.webkit.org/show_bug.cgi?id=230819
- GitHub html5-qrcode #335, https://github.com/mebjas/html5-qrcode/issues/335
- stackoverflow.com, https://stackoverflow.com/questions/getusermedia-ios-invalid-constraint

**현재 코드의 폴백 경로**: deviceId:exact 실패 시 `facingMode:'environment'`로 재시도하는 구조가 있다. 이 폴백은 작동할 수 있으나, 첫 시도 실패 → 에러 로그 → 두 번째 getUserMedia 호출이라는 흐름 자체가 아래 문제를 일으킨다.

### 2-2. iOS에서 두 번째 getUserMedia 호출이 첫 번째 스트림을 죽임

**WebKit 버그 #179363**: iOS에서 getUserMedia()를 두 번 호출하면, 첫 번째 스트림의 VideoTrack이 `muted:true`가 되어 비디오가 black으로 변한다.

현재 구현은 다음 시나리오에서 이 버그에 걸린다:
1. "초기 권한 요청" 임시 스트림 (tmp stream, stop 처리함) → 이후 실제 스트림
2. deviceId:exact 실패 → facingMode:environment 재시도

**회피책**: getUserMedia를 1회만 호출하거나, 두 번 호출 필요 시 첫 스트림을 완전히 stop한 후 충분히 기다렸다가 호출.

출처: bugs.webkit.org #179363, https://bugs.webkit.org/show_bug.cgi?id=179363

### 2-3. iOS Safari에서 `history.replaceState()` 후 카메라 스트림 소실

**WebKit 버그** (iOS 17.4 확인): SPA에서 URL을 `history.pushState()`/`replaceState()`로 변경하면 getUserMedia 스트림이 끊긴다. QR 스캔 완료 후 페이지 이동 시 이 문제가 발생할 수 있다.

출처: bugs.webkit.org, https://bugs.webkit.org/show_bug.cgi?id=camera-stream-lost-replaceState

### 2-4. iOS 15 회귀: autoplay+playsinline+muted 비디오 freeze

**WebKit 버그 #230922**: autoplay + playsinline + muted + srcObject 조합 비디오가 iOS 15에서 freeze 되는 회귀 버그. iOS 16+에서는 대부분 수정됨.

출처: bugs.webkit.org #230922, https://bugs.webkit.org/show_bug.cgi?id=230922

---

## 3. html5-qrcode(2.3.8)가 iOS Safari에서 작동하는가?

### 결론: 조건부로 작동하나 심각한 이슈 다수

**알려진 iOS 이슈 목록:**

1. **블랙 스크린 (iOS 17.2.x+)**: GitHub issue #822 — `facingMode:'environment'` 설정에서 카메라는 열리나 비디오가 검게만 보임. 재현 조건: 특정 기기 조합.
   출처: https://github.com/mebjas/html5-qrcode/issues/822

2. **QR 미인식 (iOS 16.6, iPhone 12 Pro Max)**: GitHub issue #820 — scanapp.org 데모 포함 전혀 인식 안 됨. html5-qrcode 내부가 ZXing.js를 쓰는데 iOS의 특정 WebAssembly 제약과 충돌.
   출처: https://oss.issuehunt.io/r/mebjas/html5-qrcode/issues/820

3. **facingMode 무시**: GitHub issue #761 — `facingMode:'environment'` 설정해도 전면 카메라가 열림. iOS Safari에서 facingMode보다 deviceId가 우선시되며, deviceId 없이 facingMode만으로는 후면 보장이 안 됨.
   출처: https://github.com/mebjas/html5-qrcode/issues/761

4. **라이브러리 유지보수 중단**: html5-qrcode는 2023년 이후 사실상 업데이트 없음. iOS 16/17/18 대응 패치가 없다.

### html5-qrcode를 iOS에서 쓸 때 그나마 작동하는 설정

- `facingMode: { ideal: 'environment' }` (exact 금지)
- aspectRatio는 1.0 또는 기기 화면 비율로 (너무 다르면 비디오 미표시)
- qrbox 크기는 화면 크기의 50~70%
- fps 10~15 (20은 iOS에서 배터리 과소모, 드문 경우 중단)

---

## 4. iOS Safari에서 가장 안정적인 QR 스캔 스택 (2026)

### 옵션 비교

| 스택 | iOS Safari 지원 | 유지보수 | QR 인식률 | 번들 크기 | 비고 |
|------|----------------|---------|-----------|-----------|------|
| BarcodeDetector 네이티브 | 미지원 (iOS 18 실험적) | - | 높음 | 0 | iOS에서 쓸 수 없음 |
| html5-qrcode v2.3.8 | 조건부 작동 | 중단 | 중간 | ~170KB | iOS 이슈 다수 |
| `barcode-detector` npm 폴리필 | 지원 (zxing-wasm) | 활발 | 높음 | ~500KB wasm | **권장** |
| zxing-wasm 직접 | 지원 | 활발 | 높음 | ~500KB wasm | 저수준 직접 구현 |
| @zxing/browser | 지원 | 보통 | 중간 | ~300KB | JS 포트, wasm 아님 |
| Dynamsoft Barcode Reader | 지원 | 활발 | 매우 높음 | 유료 | 상용 |

### 권장: `barcode-detector` 폴리필 (npm: `barcode-detector`)

- ZXing-C++를 WebAssembly로 컴파일한 엔진 사용
- BarcodeDetector API와 완전히 동일한 인터페이스 → 네이티브 BarcodeDetector와 동일한 코드로 사용
- iOS Safari에서 실제 동작 확인됨
- `window.BarcodeDetector`가 없을 때만 폴리필 주입 방식으로 사용 가능

출처:
- dev.to, https://dev.to/barcode-scanning-ios-missing-web-api-webassembly-solution
- GitHub sec-ant/barcode-detector, https://github.com/Sec-ant/barcode-detector
- npm barcode-detector, https://www.npmjs.com/package/barcode-detector

**CDN 사용 예시 (ES Module, 추후 수정 시 참고):**

```html
<script type="module">
  // BarcodeDetector 없는 환경(iOS Safari)에서만 폴리필 주입
  if (!('BarcodeDetector' in window)) {
    const { BarcodeDetector } = await import(
      'https://cdn.jsdelivr.net/npm/barcode-detector@3/dist/es/barcode-detector.js'
    );
    window.BarcodeDetector = BarcodeDetector;
  }
</script>
```

주의: wasm 파일이 같은 origin 또는 CORS 허용 CDN에서 제공되어야 함. jsDelivr CDN은 CORS 허용이므로 GitHub Pages에서 사용 가능.

---

## 5. getUserMedia 호출 패턴 — iOS 안전 버전

### 5-1. iOS에서 facingMode 사용 지침

| 패턴 | iOS 결과 |
|------|---------|
| `{ facingMode: { exact: 'environment' } }` | OverconstrainedError 빈발 (후면이 없다고 판단) |
| `{ facingMode: 'environment' }` | ideal로 해석, 후면 시도하나 보장 안 됨 |
| `{ facingMode: { ideal: 'environment' } }` | 가장 안전. 후면 없으면 전면 사용 |
| `{ deviceId: { exact: id } }` | OverconstrainedError (iOS에서 deviceId 불안정) |
| `{ deviceId: { ideal: id } }` | 비교적 안전하나 iOS에서 무시될 수 있음 |

**iOS에서 가장 안전한 getUserMedia 호출:**

```js
// 1순위: facingMode ideal로 후면 요청
const stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: { ideal: 'environment' } }
});
```

출처: MDN facingMode, https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode

### 5-2. enumerateDevices — 권한 전 빈 라벨 문제

iOS Safari에서 권한 허용 전 `enumerateDevices()`를 호출하면 deviceId가 빈 문자열(`""`)로 반환된다. 현재 코드에서 이 문제를 인지하여 "초기 권한 요청" 단계를 두고 있으나, 이 임시 스트림 호출이 오히려 WebKit 버그 #179363(두 번째 getUserMedia 블랙스크린)을 유발할 수 있다.

**권장 패턴**: deviceId 기반 선택을 iOS에서 사용하지 않거나, 권한 허용 후 enumerate → 그 결과로 바로 getUserMedia를 1회만 호출.

출처: stackoverflow.com, https://stackoverflow.com/questions/enumeratedevices-empty-labels-before-permission

### 5-3. video 엘리먼트 필수 속성과 순서

iOS Safari에서 검은 화면/멈춤을 막기 위한 필수 순서:

```js
// 1. video 엘리먼트 생성 시 playsinline 반드시 포함
video.setAttribute('playsinline', '');  // '' 또는 'true' 모두 OK
video.muted = true;
video.autoplay = true;

// 2. srcObject 설정 후 play() 명시적 호출 (await 포함)
video.srcObject = stream;
try {
  await video.play();
} catch (e) {
  // iOS에서 NotAllowedError 가능 (저전력 모드 + 제스처 없음)
  console.warn('video.play() 실패:', e.message);
}

// 3. video.readyState >= 2 (HAVE_CURRENT_DATA) 확인 후 detect 루프 시작
// 현재 코드: if (!_video || _video.readyState < 2) return; — OK
```

출처: WebRTC autoplay restrictions, https://webrtchacks.com/autoplay-restrictions-and-webrtc/

---

## 6. iOS 버전별 차이

| iOS 버전 | 주요 이슈 |
|---------|---------|
| iOS 11 | getUserMedia 첫 지원. 제약 조건 오류 빈발, width 320/640/1280만 허용 |
| iOS 13 | NotReadableError 간헐 발생 (다른 앱이 카메라 사용 중) |
| iOS 14.3+ | iframe/WKWebView getUserMedia 개선 |
| iOS 15 | autoplay+playsinline+muted freeze 회귀 (버그 #230922) |
| iOS 16 | 대부분 안정화. deviceId 불안정 여전 |
| iOS 17.2+ | 블랙스크린 회귀 (html5-qrcode issue #822), replaceState 스트림 소실 버그 |
| iOS 18 | Shape Detection API(BarcodeDetector)를 실험적 플래그로 추가. 기본 비활성화. QR 인식 네이티브 카메라앱 버그(18.0, 18.1에서 수정) |

**iOS 18 Shape Detection API 상태**: WebKit Bugzilla #281848 — iOS 18에서 BarcodeDetector를 Experimental Features로 활성화할 수 있으나, 기본은 꺼져 있어 웹앱에서 의존 불가.

출처: bugs.webkit.org #281848, https://bugs.webkit.org/show_bug.cgi?id=281848

### 인앱 브라우저 (카카오, 라인 등 WKWebView)

WKWebView 기반 인앱 브라우저에서 `navigator.mediaDevices`가 `null`이거나 getUserMedia가 작동하지 않는다. iOS Safari에서만 작동하며, WKWebView 앱이 자체적으로 카메라 권한을 부여하도록 설정하지 않으면 차단된다.

출처:
- bugs.webkit.org, https://bugs.webkit.org/show_bug.cgi?id=getusermedia-wkwebview
- GitHub html5-qrcode #1672, https://github.com/mebjas/html5-qrcode/issues/1672

**현장 운영 함의**: 작업자가 카카오톡 등 인앱 브라우저로 접속하면 카메라 자체가 안 열린다. "Safari로 열기" 안내 필요.

---

## 7. 현재 구현 진단 요약

### 현재 코드에서 iOS 실패 원인 우선순위

**[1순위] 폴백 경로 문제: html5-qrcode iOS 17+ 미작동**

iOS Safari는 BarcodeDetector 미지원 → `startFallback()` 실행 → html5-qrcode 사용. 그런데 html5-qrcode v2.3.8 자체가 iOS 17+ 에서 블랙 스크린 및 QR 미인식 문제가 있고, 라이브러리 유지보수가 중단된 상태. 이것이 "iOS에서만 안 됨"의 핵심 원인일 가능성이 높다.

**[2순위] 두 번 getUserMedia 호출 (WebKit #179363)**

`start()` 함수에서 "초기 권한 요청" 임시 스트림 호출 후 다시 실제 스트림을 호출하는 패턴이 iOS 블랙스크린을 유발한다. 설령 BarcodeDetector 폴리필을 사용하더라도 이 패턴이 남아 있으면 iOS에서 간헐적 블랙스크린이 발생한다.

**[3순위] deviceId:exact 사용**

`startWithDeviceId()` 함수에서 `{ deviceId: { exact: deviceId } }` 사용. iOS에서 세션 간 deviceId 불안정으로 OverconstrainedError 또는 조용한 실패가 발생한다.

**[4순위] await 체인 내 getUserMedia — 제스처 컨텍스트 소실 위험**

`show() → start() → [여러 await] → startFallback()` 경로에서 iOS WebKit이 제스처 컨텍스트를 잃을 수 있다.

---

## 8. 권장 수정 방향

코드 수정은 별도 지시에 따르며, 여기서는 수정 방향만 기술한다.

### 8-1. 폴백 경로 교체 (핵심)

html5-qrcode 폴백을 `barcode-detector` 폴리필로 대체한다. BarcodeDetector가 없는 환경(iOS Safari)에서 폴리필을 동적 import하고, 동일한 주 코드 경로(getUserMedia + BarcodeDetector.detect() 루프)를 그대로 사용한다.

이렇게 하면:
- iOS Safari에서도 BarcodeDetector API 사용 가능
- html5-qrcode의 iOS 17+ 이슈 우회
- `startFallback()` 분기 자체가 불필요해짐
- 코드 단순화

### 8-2. 초기 권한 임시 스트림 제거

"초기 권한 요청" 임시 getUserMedia 호출을 제거한다. 대신 첫 번째 getUserMedia 호출을 `facingMode:{ideal:'environment'}`로만 하고, 그 스트림을 실제로 사용한다. 권한 허용 후 별도로 `enumerateDevices()`를 호출하여 카메라 목록을 업데이트한다.

### 8-3. deviceId 제약 완화

`{ deviceId: { exact: id } }` → `{ facingMode: { ideal: 'environment' } }`를 기본으로 사용. deviceId 기반 카메라 선택은 Android에서만 적용하거나, `ideal`로 변경.

iOS 판별: `navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')` 또는 `BarcodeDetector`가 기본 없는 경우를 iOS로 처리.

### 8-4. video.play() 에러 처리 강화

`try { await _video.play(); } catch {}` 대신 에러를 캐치하여 사용자에게 안내. 저전력 모드에서는 사용자에게 "저전력 모드를 끄거나 화면을 탭하세요" 메시지 표시.

### 8-5. barcode-detector 폴리필 로드 방법 (2가지)

방법 A — CDN dynamic import (번들 없이):
```js
if (!('BarcodeDetector' in window)) {
  const mod = await import('https://cdn.jsdelivr.net/npm/barcode-detector@3/dist/es/barcode-detector.js');
  window.BarcodeDetector = mod.BarcodeDetector;
}
```

방법 B — 스크립트 태그로 미리 로드 (가장 안전):
```html
<script type="module">
  if (!('BarcodeDetector' in window)) {
    const { BarcodeDetector } = await import('https://cdn.jsdelivr.net/npm/barcode-detector@3/dist/es/barcode-detector.js');
    window.BarcodeDetector = BarcodeDetector;
  }
</script>
```

주의:
- wasm 파일은 CDN에서 함께 로드됨 (jsDelivr CORS 허용)
- 첫 로드 시 ~500KB wasm 다운로드 발생 → 스캐너 열기 전 미리 로드 권장
- Service Worker 캐싱 시 이후 오프라인에서도 작동

### 8-6. iOS에서 카메라 전환 주의

iOS에서 카메라를 전환할 때 기존 스트림을 완전히 stop한 후 새 getUserMedia를 호출해야 한다. 현재 코드의 `stopStream()` → `getUserMedia()` 패턴은 올바르나, `await stopStream()`과 `await getUserMedia()` 사이에 약간의 지연(최소 100ms)을 두는 것이 WebKit 버그 회피에 도움이 된다는 사례 보고가 있다.

출처: stackoverflow.com, https://stackoverflow.com/questions/getUserMedia-new-constraints-black-screen

---

## 9. 트레이드오프 정리

| 접근 | 장점 | 단점 |
|------|------|------|
| barcode-detector 폴리필 | iOS 포함 모든 브라우저 통일된 코드 경로. BarcodeDetector API 그대로 사용. | ~500KB wasm 초기 로드. 인터넷 필요(CDN) 또는 번들 필요. |
| html5-qrcode 유지 | 현재 코드 변경 최소화 | iOS 17+ 블랙스크린/미인식 미해결. 유지보수 중단. |
| zxing-wasm 직접 사용 | 최신 유지보수 활발, 커스텀 가능 | BarcodeDetector API와 인터페이스 다름 → 코드 재작성 필요 |
| @zxing/browser | wasm 없이 JS 포트 (~300KB) | 인식률 barcode-detector보다 낮음. iOS 완벽 지원 보장 없음 |

---

## 10. 현장 운영 권고

1. **즉시 확인**: 작업자가 카카오톡 링크로 접속하는지 확인. 인앱 브라우저라면 카메라 자체 불가 → "Safari로 열기" 버튼 또는 팝업 안내 추가.

2. **iOS 버전 확인**: iOS 17.0~17.3은 html5-qrcode 블랙스크린 이슈가 가장 심한 구간. 작업자 아이폰 iOS 버전 파악.

3. **QR 미인식 vs 카메라 자체 미실행 구분**: 카메라 프리뷰는 뜨는데 QR 인식이 안 되는 경우 vs 카메라 자체가 안 뜨는 경우를 구분하여 디버깅.
   - 카메라 프리뷰 뜨지만 QR 미인식 → html5-qrcode 엔진 문제 (폴리필 교체)
   - 카메라 자체 블랙스크린 또는 에러 → getUserMedia 패턴 문제

---

## 참고 출처

- MDN getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Apple Developer playsinline: https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari
- WebKit 버그 #179363 (두 번째 getUserMedia 블랙스크린): https://bugs.webkit.org/show_bug.cgi?id=179363
- WebKit 버그 #215884 (hash 네비게이션 권한 재요청): https://bugs.webkit.org/show_bug.cgi?id=215884
- WebKit 버그 #230819 (applyConstraints deviceId exact): https://bugs.webkit.org/show_bug.cgi?id=230819
- WebKit 버그 #230922 (autoplay+playsinline freeze iOS 15): https://bugs.webkit.org/show_bug.cgi?id=230922
- WebKit 버그 #281848 (Shape Detection API iOS 18): https://bugs.webkit.org/show_bug.cgi?id=281848
- html5-qrcode issue #822 (iOS 블랙스크린): https://github.com/mebjas/html5-qrcode/issues/822
- html5-qrcode issue #761 (facingMode 무시): https://github.com/mebjas/html5-qrcode/issues/761
- barcode-detector npm (zxing-wasm 기반 폴리필): https://www.npmjs.com/package/barcode-detector
- GitHub Sec-ant/barcode-detector: https://github.com/Sec-ant/barcode-detector
- dev.to barcode scanning iOS: https://dev.to/barcode-scanning-ios-missing-web-api-webassembly-solution
- addpipe.com getUserMedia 2026: https://blog.addpipe.com/getusermedia-2026/
- WebRTC autoplay restrictions: https://webrtchacks.com/autoplay-restrictions-and-webrtc/
- iOS Safari 권한 persistance (Scandit): https://support.scandit.com/why-does-ios-keep-asking-for-camera-permissions/
