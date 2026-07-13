# 종로맵 (AMI 하위 시스템)

> 정본 지식 = 옵시디언 카드. 작업 전 반드시 읽기:
> - 시스템: `/Users/woodelight/Projects/obsidian/Projects/AMI/systems/종로맵/_종로맵-인덱스.md`
>   (+ 하위: `지도-workStatus.md` `교체모달-검침.md` `통계.md` `디자인.md` `보조앱-snap.md` `명륜-팀배분.md`)
> - 공용코어: `core/계기도메인.md` `core/데이터규칙.md` `core/Firebase.md`
> auto-memory가 원자적 함정을 자동 recall. 상세 research 원본은 카드가 링크.

## 핵심 함정 (자세한 건 카드)
- workStatus는 무조건 Firebase(ami-jongno)가 권위. localStorage/IndexedDB는 미러로만. 정적·독립 폴백 금지. merge는 timestamp 게이트(stale complete가 최신 덮는 사고 방지).
- workStatus 미러 저장은 localStorage 아닌 IndexedDB(iOS 5MB quota로 불가버튼 죽던 근본원인). setItem은 safeSetItem으로, 큐 실패 시 Firebase 직접전송.
- 주소당 meter_state 1개 제약 — 아파트 등 주소 내 일부완료를 complete로 찍으면 미완료 묻힘. 완전완료만 complete, 일부완료는 hold(파랑).
- UI 작업은 clay 정식 토큰만(css/clay.css). `--line`·`--accent`는 없음(만들지 말 것). 버튼=알약형+그림자, border 없음. 이모지/한자/원문자 금지.
- 배포 = APP_VERSION + 메뉴 버전라벨 + `?v=` 캐시쿼리 3종 세트 함께 갱신(안 하면 작업자 폰 옛화면 잔존).

## 코드 위치
- `map.html` — 메인 지도 / `stats.html` — 통계 / `myungroon.html` — 명륜 팀배분
- `snap.html` — 사진분담 보조앱 / `tools/sync-meter-from-awms.html` — awms 완료 동기화
- `css/clay.css` — 디자인 토큰 단일출처 / `js/`, `replacement-modal.js` — 교체모달
- Firebase DB = `ami-jongno` (ami-work와 별개 프로젝트)
