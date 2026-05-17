# 종로 합동시공 시스템 — 코드 리뷰 요청

## 1. 프로젝트 개요

**사업:** 한국전력 AMI(원격검침) 인프라 동행시공 작업 관리

- **계기팀** = 전기 계기 교체
- **통신팀** = 모뎀/DCU 통신 인프라
- 두 팀이 같은 주소를 차례로 작업 (동행시공)
- 현재 종로구·중구 진행. 향후 다른 구 확대 예정.

**역할:**
- 현장 작업자(계기팀/통신팀)가 작업 상태 기록
- admin이 통계·관리

## 2. 기술 스택

- **Frontend:** 바닐라 JavaScript + HTML/CSS (프레임워크 X)
- **지도:** Kakao Maps SDK (`appkey=2eae4b699110525f0dc62295ed8ed43d`)
- **DB:** Firebase Realtime Database (`ami-jongno`)
- **Storage:** Firebase Storage (사진)
- **QR:** html5-qrcode (CDN)
- **인증:** 자체 (auth.js 하드코딩 계정, localStorage)
- **호스팅:** GitHub Pages (`https://815dudwns.github.io/jongno-combined/`)
- **저장소:** https://github.com/815dudwns/jongno-combined

## 3. 디렉토리 구조

```
jongno-combined/
├── index.html              # 빈 페이지 (login으로 redirect)
├── login.html              # 로그인
├── map.html                # 지도 메인 (계기팀/통신팀 작업)
├── stats.html              # 통계 (admin만)
├── css/
│   ├── common.css          # 공통
│   ├── panel.css           # detail 패널
│   ├── marker.css          # 지도 마커 색상
│   ├── login.css
│   └── replacement-modal.css   # 계기 교체 모달
├── js/
│   ├── auth.js             # 로그인 (하드코딩)
│   ├── config.js           # Firebase 설정
│   ├── firebase.js         # workStatus 동기화 ★ 핵심
│   ├── map.js              # 카카오맵 + 마커 ★ 핵심
│   ├── detail.js           # 주소 클릭 → detail 패널 ★ 핵심
│   ├── utils.js
│   ├── replacement-modal.js # 계기 교체 입력 모달 (신규) ★
│   ├── qr-scanner.js       # QR 스캔 (html5-qrcode 래퍼)
│   ├── photo-uploader.js   # 사진 압축 + Storage 업로드
│   └── simulate-helper.js  # 테스트 시뮬레이션 헬퍼
├── data/
│   ├── jongno-site-data.json   # 9,651건 계기 마스터 데이터 (정적)
│   └── jongno-work-status.json # 초기 work status (정적)
└── backups/                # Firebase 백업 (git 제외)
```

## 4. 데이터베이스 접근

### Firebase 프로젝트
- **프로젝트 ID:** `ami-jongno`
- **DB URL:** `https://ami-jongno-default-rtdb.asia-southeast1.firebasedatabase.app`
- **Storage 버킷:** `gs://ami-jongno.firebasestorage.app`
- **인증:** 없음 (Firebase rules가 공개 read/write 허용 — PoC 단계)

### REST API 접근 예시
```bash
# 전체 dump
curl https://ami-jongno-default-rtdb.asia-southeast1.firebasedatabase.app/.json

# 특정 노드
curl https://ami-jongno-default-rtdb.asia-southeast1.firebasedatabase.app/workStatus/jongno.json

# 노드 키만 (shallow)
curl https://ami-jongno-default-rtdb.asia-southeast1.firebasedatabase.app/workStatus.json?shallow=true

# 쓰기 (PATCH multi-path)
curl -X PATCH -H "Content-Type: application/json" \
  -d '{"path1": {data}, "path2": null}' \
  https://ami-jongno-default-rtdb.asia-southeast1.firebasedatabase.app/workStatus/jongno.json
```

### Storage 접근
```bash
# 객체 리스트
curl 'https://firebasestorage.googleapis.com/v0/b/ami-jongno.firebasestorage.app/o?prefix=replacements/&maxResults=10'

# 보안 규칙 (현재): replacements/* 누구나 read/write
```

## 5. 데이터 모델

### Firebase 노드 트리 (현재)
```
ami-jongno/
├── appSettings/                    # 앱 설정
└── workStatus/
    └── jongno/                     # 종로 (구별로 노드 추가 예정)
        └── {주소}/                  # 예: "서울특별시 종로구 ..."
            # 주소 단위 작업 상태 (기존)
            meter_state: "pending" | "complete" | "hold" | "fail"
            meter_reason: string
            meter_updatedAt: ISO timestamp
            meter_updatedBy, meter_updatedByName
            comm_state: 동일
            comm_reason, comm_updatedAt, comm_updatedBy, comm_updatedByName
            meter_forced_by_comm: bool  # 통신팀 강제 완료 플래그
            meterChecks: { meter_id: bool }

            # 계기 단위 작업 (신규, 코드는 작성됐으나 Firebase에 0건)
            replacement_list/{old_meter_id}: {
              old_meter_id, new_meter_id, removal_value,
              new_meter_mfg_ym, old_meter_photo, new_meter_photo,
              worker, replaced_at, daily_seq
            }
            added_meters/{meter_id}: {
              meter_id, added_by, added_at
            }
```

### site-data 정적 파일
```
data/jongno-site-data.json (9.8MB, 9,651건)
[
  {
    "주소": "서울특별시 종로구 ...",    # 지번 — Firebase workStatus 키
    "도로명주소": "서울 종로구 ...",
    "계기번호": "92190425264",         # 11자리 (AMIGO는 A0552735841 같이 영문 prefix)
    "계기타입": "G", "변대주": "...",
    "lat": 37.5..., "lng": 126.9...,
    "검침일": "D17", "검침일그룹": "...",
    "동그룹": "...", "순위": ...,
    ...
  }
]
```

### 키 인코딩 (firebase.js)
Firebase 키 금지 문자(`. # $ [ ] /`)는 `_dot_` 등으로 치환:
```js
encodeKey('a.b/c') → 'a_dot_b_sl_c'
decodeKey('a_dot_b_sl_c') → 'a.b/c'
```

## 6. 핵심 흐름

### 초기 로드 (firebase.js initFirebase)
```
페이지 진입 (map.html)
  ↓
1. localStorage('jongno_work_status') 우선 로드 → workStatus
   (★ 문제: Firebase보다 localStorage 우선)
2. 없으면 data/jongno-work-status.json fetch
  ↓
Firebase OK 시:
  3. syncFromFirebase() → mergeFirebaseData
     - meter/comm state는 updatedAt 비교, 최신 우선
     - replacement_list/added_meters 병합 (방금 추가)
  4. 실시간 리스너 statusRef.on('value', ...)
```

### 계기 교체 등록 (replacement-modal.js)
```
사용자가 detail 패널에서 "📝 교체" 클릭
  ↓
모달: 사진 2장 + 검침값 + 새 계기번호(QR) + 제조년월
  ↓
저장:
  1. 사진 압축 (Canvas, 1280px, JPEG q=0.7) → photo-uploader.js
  2. Firebase Storage 업로드 → URL 받음
  3. workStatus[addr].replacement_list[old_id] = {data, URLs, daily_seq, ...}
  4. Firebase DB 저장: statusRef.child(addrKey).child('replacement_list').child(id).set()
  5. updateMarkerColor(addr) → 마커 색 자동 계산
```

### 마커 색 자동 계산 (map.js decideMarkerStyle)
```
계기팀 시각:
  - replacement_list.length == site-data 계기 수 → 회색 (완료)
  - 일부 완료 → 파랑 + 분수 (N/M)
  - 작업 안 함 → 검침일 색 (기본)

통신팀 시각:
  - 계기팀 전체 완료 → 초록 (활성)
  - 부분 완료 → 초록 + 분수
  - 통신팀 자체 완료/보류 = comm_state 별도
```

## 7. 현재 알려진 문제

1. **localStorage 우선 로드** — Firebase 변경이 캐시된 폰에 안 반영
2. **영준님 모달 작업이 Firebase에 안 들어감** (replacement_list 0건) — 사진 업로드 실패 의심
3. **QR 인식률 낮음** — 카메라 화면은 뜨지만 QR 잘 안 잡힘 (줌 2x + 정사각 박스로 시도 중)
4. **통신팀 시각 UI 재설계 필요** — 계기팀 완료한 계기만 활성 + 체크 + 일괄 완료 (영준님 명세)
5. **daily_seq atomic 보장 X** — 동시 작업 시 같은 번호 받을 위험

## 8. 영준님 향후 명세 (미구현)

### 데이터 구조 확장
```
workStatus/jongno/{주소}/
  comm_completed_list/{meter_id}: { done_at, worker }  # 통신팀 작업 (신규)

dailyCounter/{YYYY-MM-DD}/{worker_id}: 5   # atomic 카운터 (신규)
```

### 통신팀 시각 재설계
- 계기팀이 교체 완료한 계기만 활성
- 활성 계기 표시: `기존번호 → 신번호`
- 체크박스 + 완료/보류 일괄 처리
- 부분 완료 = "2/4" 분수 표시
- 통신팀이 못 한 작업 = 다음 날에도 잔존
- 계기팀 추가 작업 시 = 통신팀에 활성 신호

### 강제 완료 import
- 상용화 시 과거 작업 데이터를 한전 awms에서 가져와 import
- `force_completed` 플래그 추가

### 구별 확장 (multi-district)
- 종로 → 중구 → ... 단일 Firebase + `siteDataByDistrict/{district}` prefix

## 9. 인증·계정

```js
// js/auth.js
const ACCOUNTS = [
  { id: 'admin',  pw: '8414', name: '우영준', role: 'admin' },
  { id: 'meter1', pw: '1111', name: '계기팀', role: 'meter' },
  { id: 'comm1',  pw: '1111', name: '통신팀', role: 'comm'  },
];
```
- localStorage `jongno_auth`에 세션 저장
- 페이지 진입 시 head에서 즉시 체크 → 없으면 login.html로 redirect

## 10. 리뷰 요청 사항

다음 관점에서 평가:
- 데이터 모델 적절성 (확장성, 정합성)
- localStorage vs Firebase 우선순위 정책
- 계기 교체 데이터 흐름 (사진 업로드 → URL → workStatus 저장)
- 마커 색 자동 계산 로직 정확성
- 통신팀 UI 재설계 방향
- daily_seq atomic 보장 방법
- 향후 multi-district 확장 시 구조
