# 종로맵 보조앱 (snap.html) — 2인1조 사진 분담 컴패니언

> 확정 2026-06-14 (영준님 브레인스토밍 + advisor 검증). 매번 다시 설계 말 것.

## 목적
계기팀 2인1조 작업에서 **한 폰으로 사진 돌려찍는 비효율** 해결.
- 세팅하는 사람 = 메인 종로맵(map.html)에서 계기 할당·검침값 등 다 작성
- 시공하는 사람 = 보조앱(snap.html)에서 **사진만** 빠르게. 맵·할당 신경 안 씀
- 두 사람이 같은 작업을 각자 폰으로 → `daily_seq`로 자동 연동

## 사용자/제약
- **작업자 대부분 어르신** → UI 무조건 크게, 단순하게. 작으면/어려우면 안 됨 (최우선 원칙)
- 같은 **종로 계정 공유 로그인**(jongno_auth). meter1 등
- **같은 origin 필수**: `jongno-combined/snap.html` 형제 페이지. 서브도메인이면 로그인·캐시·Storage 공유 깨짐

## UI (확정)
- **데일리시퀀스**: `이전 / 다음` 버튼 가로폭 꽉, 숫자 큼. 다음 빈번호 자동제안하되 **사람이 종이코드 대조해 수동 확정**(앱이 멋대로 안 바꿈)
- **사진 박스 2개**(철거 / 신설): 박스 **아무데나 탭 → 큰 팝업**(촬영 / 앨범 큰 버튼). "바로 촬영" 강제 X
- 철거사진 **대표 1장**으로 단순화(메인앱 검침칸별 복잡함 제거)
- 계기번호 표시(할당됐으면 / 미할당)
- 검침값 입력 = 선택(접어둠). YOLO LCD 검출은 포함

## 연동 메커니즘 (핵심)
### 데이터 위치
- 임시 보관(계기·주소 없이 seq만): `tempPhotos/jongno/{날짜KST}/{daily_seq}` = `{ removal_photo, new_meter_photo, removal_lcd_*, worker, created_at }`
- Storage 임시경로: `replacements/_temp/{날짜}/{daily_seq}/{slot}.jpg`. **결합 시 URL 그대로 재사용**(파일 이동 X — 다운로드 URL은 경로 무관 안정)
- 정식 결합 후: 기존 `workStatus/jongno/{주소}/replacement_list/{계기번호}`의 `removal_photos`/`new_meter_photo`에 기록

### 시나리오 A — 메인앱 선작업 → 보조앱 신설사진
보조앱 seq=N 선택 → workStatus 순회로 daily_seq=N인 replacement_list[계기] 역검색 → 계기·철거사진 표시 → 신설사진 촬영 → 그 계기 `.new_meter_photo` update

### 시나리오 B — 보조앱 사진 먼저 → 메인앱 나중 할당 (주 흐름)
보조앱 seq=N에 사진 → tempPhotos/{날짜}/N 저장 → 나중에 replacement_list[계기].daily_seq=N 저장됨 → temp 사진을 그 계기에 병합 + temp 삭제

### 결합 위치 = 메인앱 흡수(즉시) + 보조앱 reconcile(백업)
- **메인앱(replacement-modal.js save) 저장 직후**: `tempPhotos[날짜][seq]` 있으면 흡수. ★보조앱 폰이 잠겨도(webview freeze) 연동 보장 — 이게 즉시성의 핵심
- **보조앱**: 켜질 때 + 실시간으로 reconcile sweep(놓친 매칭 정리) = 빠짐없음 백업

### 비협상 규칙 (어느 쪽에서 돌든 안전 — 멱등)
1. **빈 칸만 채우기.** 이미 값 있는 사진/필드 절대 덮어쓰지 않음 (세터 사진·작업자 실작업 보호, jongno 오삭제 사고 교훈)
2. temp 삭제는 **병합 성공 후에만 원자적으로**
3. 멱등 → 메인앱·보조앱 양쪽에서 돌아도 먼저 한 쪽이 이기고 나머지 no-op = race 소멸

### daily_seq 충돌 방지
- 자동배정 금지. 사람이 종이 물리코드(철거계기·신계기에 순번 적어 사진으로 남김)대로 확정 → 자연히 일치
- 충돌은 두 폰이 동시에 "다음 빈번호" 자동으로 같이 집을 때만 → 수동 확정이 막음

## 자산 재사용 (종로 그대로)
config.js · firebase.js(init/statusRef) · auth.js+login.html · photo-uploader.js(compress+upload) · lcd-yolo.js + lcd-crop.js + models/lcd_detector_512.onnx + ort.min.js · utils.js
- 가벼움: 역검색·빈번호 계산은 메인앱이 채운 `jongno_work_status` localStorage 캐시 재사용. 보조앱만 깔린 폰은 1회 로드 감수

## 참고
- daily_seq = 그날 한 팀(계기2+통신2) 통합 순번. usedSeqsToday()/loadDailySeq() (replacement-modal.js 365~439)
- replacement_list 스키마·Storage 경로 = research 본 조사(이 문서 작성 근거)
