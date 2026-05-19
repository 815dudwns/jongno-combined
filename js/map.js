// map.js — 지도 및 마커 로직

let map;
let markers = [];
let sampleData = [];

// 위치 추적 관련 상태
let locationOverlay = null;
let locationWatchId = null;
let locationActive = false;

// ── 동그룹 상수 ──────────────────────────────────────────────────
// 좌표추출 스크립트와 동일한 매핑
const DONG_GROUPS = {
    '북촌·삼청':       ['가회동','삼청동','화동','안국동','소격동','팔판동','사간동','재동','계동','원서동','송현동'],
    '부암·평창':       ['부암동','신영동','홍지동','평창동','구기동'],
    '청운효자·사직':   ['청운동','효자동','창성동','통의동','적선동','통인동','누상동','누하동','옥인동','신교동','궁정동','사직동','도렴동','당주동','내수동','내자동','신문로1가','신문로2가','필운동','체부동','세종로'],
    '무악·교남':       ['무악동','교남동','교북동','행촌동','평동','송월동','홍파동'],
    '종로 도심':       ['종로1가','종로2가','종로3가','종로4가','종로5가','종로6가','청진동','견지동','서린동','수송동','중학동','관철동','관수동','익선동','돈의동','봉익동','묘동','권농동','와룡동','인사동','관훈동','경운동','낙원동','운니동','공평동','인의동','예지동','장사동','훈정동'],
    '혜화·이화':       ['혜화동','이화동','동숭동','연건동','충신동','원남동','효제동','연지동'],
    '창신':            ['창신동'],
    '숭인':            ['숭인동'],
};

// 검침일 그룹 라벨 — G1~G4 (한 주 단위)
const CHECKDAY_GROUPS = {
    'G1': '1주차 (D1~D5)',
    'G2': '2주차 (D8~D12)',
    'G3': '3주차 (D15~D19)',
    'G4': '4주차 (D22~D26)',
};

// 마커 모드: 'checkday' | 'priority' | 'both'
let markerMode = localStorage.getItem('jongno_marker_mode') || 'checkday';

// admin 전용 시각 토글: 'meter' (계기팀 화면) | 'comm' (통신팀 화면)
let adminViewRole = localStorage.getItem('jongno_admin_view_role') || 'meter';

// admin은 시각 토글에 따라 effective role 결정 — 마커 표시·작업 동작 모두 적용
function getEffectiveRole() {
    const session = authGetSession();
    let role = session?.role || '';
    if (role === 'admin') role = adminViewRole;
    return role;
}

// 가장 최근 계기팀 완료 주소 — 통신팀 입장 "다음 가야 할 곳" (찐초록)
// 조건: meter_state='complete' AND comm_state!='complete', meter_updatedAt 최대
let meterLatestAddress = null;

// ── 지도 초기화 ──────────────────────────────────────────────────
async function initMap() {
    workStatus = loadStatusLocal();
    const container = document.getElementById('map');

    // 마지막 지도 위치/줌 레벨 복원
    const saved = (() => { try { return JSON.parse(localStorage.getItem('jongno_map_view')); } catch { return null; } })();
    const options = {
        center: new kakao.maps.LatLng(saved ? saved.lat : 37.578, saved ? saved.lng : 126.983),
        level: saved ? saved.level : 4
    };
    map = new kakao.maps.Map(container, options);

    // 지도 이동/줌 변경 시 현재 뷰 저장
    kakao.maps.event.addListener(map, 'idle', () => {
        const c = map.getCenter();
        localStorage.setItem('jongno_map_view', JSON.stringify({ lat: c.getLat(), lng: c.getLng(), level: map.getLevel() }));
    });

    // 로컬 JSON에서 현장 데이터 로드
    try {
        const res = await fetch('./data/jongno-site-data.json');
        sampleData = await res.json();
    } catch (e) {
        console.error('[siteData] 로드 실패:', e);
        sampleData = [];
    }
    console.log('[siteData] 로드 완료:', sampleData.length, '개');

    populateDongGroups();
    populateCheckdayFilter();
    updateCheckdayFilterVisibility();
    loadMarkers();
    await initFirebase();
    refreshAllMarkers();

    // 마커 모드 — admin이 변경 시 Firebase 통해 모든 사용자에게 동기화
    if (typeof subscribeMarkerMode === 'function') {
        subscribeMarkerMode((mode) => {
            if (mode === markerMode) return;
            markerMode = mode;
            localStorage.setItem('jongno_marker_mode', markerMode);
            // 토글 UI 동기화 (admin 화면에서만 표시되지만 어쨌든 갱신)
            const toggle = document.getElementById('marker-mode-toggle');
            if (toggle) {
                toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === markerMode));
            }
            refreshAllMarkers();
        });
    }

    // 마커 모드 토글 — admin 전용
    const session = authGetSession();
    if (session?.role === 'admin') {
        const toggle = document.getElementById('marker-mode-toggle');
        if (toggle) {
            toggle.style.display = '';
            toggle.querySelectorAll('button').forEach(btn => {
                if (btn.dataset.mode === markerMode) btn.classList.add('active');
                btn.addEventListener('click', () => {
                    markerMode = btn.dataset.mode;
                    localStorage.setItem('jongno_marker_mode', markerMode);
                    if (typeof saveMarkerModeRemote === 'function') saveMarkerModeRemote(markerMode);
                    toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === markerMode));
                    refreshAllMarkers();
                });
            });
        }

        // 시각 토글 — 계기팀 시각 / 통신팀 시각
        const viewToggle = document.getElementById('view-role-toggle');
        if (viewToggle) {
            viewToggle.style.display = '';
            viewToggle.querySelectorAll('button').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === adminViewRole);
                btn.addEventListener('click', () => {
                    adminViewRole = btn.dataset.view;
                    localStorage.setItem('jongno_admin_view_role', adminViewRole);
                    viewToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.view === adminViewRole));
                    updateCheckdayFilterVisibility();
                    // 검침일 필터 적용/해제 → 마커 재생성
                    markers.forEach(m => m.overlay.setMap(null));
                    markers = [];
                    loadMarkers();
                    refreshAllMarkers();
                });
            });
        }
    }
}

// ── 동그룹 선택 저장/로드 ─────────────────────────────────────────
function loadSelectedGroups() {
    try {
        const saved = localStorage.getItem('jongno_selected_groups');
        if (saved) {
            const arr = JSON.parse(saved);
            return new Set(arr);
        }
    } catch {}
    // 기본값: 모두 무체크 (작업자가 본인 구역만 선택)
    return new Set();
}

function saveSelectedGroups(groupSet) {
    localStorage.setItem('jongno_selected_groups', JSON.stringify([...groupSet]));
}

// ── 동그룹 체크박스 패널 생성 ────────────────────────────────────
function populateDongGroups() {
    const panel = document.getElementById('dong-group-panel');
    const toggleBtn = document.getElementById('dong-group-toggle');
    if (!panel || !toggleBtn) return;

    const selectedGroups = loadSelectedGroups();

    // 체크박스 8개 동적 생성
    Object.keys(DONG_GROUPS).forEach(groupName => {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = groupName;
        cb.checked = selectedGroups.has(groupName);
        cb.addEventListener('change', onDongGroupChange);
        label.appendChild(cb);
        label.appendChild(document.createTextNode(groupName));
        panel.appendChild(label);
    });

    // 토글 버튼 — 패널 열기/닫기
    toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('open');
    });

    // 패널 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        const filter = document.getElementById('dong-group-filter') || toggleBtn.closest('.dong-group-filter');
        if (filter && !filter.contains(e.target)) {
            panel.classList.remove('open');
        }
    });
}

// 동그룹 체크박스 변경 시 마커 재생성
function onDongGroupChange() {
    const panel = document.getElementById('dong-group-panel');
    if (!panel) return;
    const checked = new Set();
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.checked) checked.add(cb.value);
    });
    saveSelectedGroups(checked);
    markers.forEach(m => m.overlay.setMap(null));
    markers = [];
    loadMarkers();
    refreshAllMarkers();
}

// ── 검침일 필터 (계기팀 시각 전용) ──────────────────────────────
function loadSelectedCheckdays() {
    try {
        const saved = localStorage.getItem('jongno_selected_checkdays');
        if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set(Object.keys(CHECKDAY_GROUPS));  // 기본: 6개 전부 체크
}

function saveSelectedCheckdays(set) {
    localStorage.setItem('jongno_selected_checkdays', JSON.stringify([...set]));
}

function populateCheckdayFilter() {
    const panel = document.getElementById('checkday-panel');
    const toggleBtn = document.getElementById('checkday-toggle');
    if (!panel || !toggleBtn) return;

    const selected = loadSelectedCheckdays();
    Object.entries(CHECKDAY_GROUPS).forEach(([key, label]) => {
        const lbl = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = key;
        cb.checked = selected.has(key);
        cb.addEventListener('change', onCheckdayChange);
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(label));
        panel.appendChild(lbl);
    });

    toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        const filter = document.getElementById('checkday-filter');
        if (filter && !filter.contains(e.target)) {
            panel.classList.remove('open');
        }
    });
}

function onCheckdayChange() {
    const panel = document.getElementById('checkday-panel');
    if (!panel) return;
    const checked = new Set();
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.checked) checked.add(cb.value);
    });
    saveSelectedCheckdays(checked);
    markers.forEach(m => m.overlay.setMap(null));
    markers = [];
    loadMarkers();
    refreshAllMarkers();
}

// 계기팀 시각일 때만 검침일 필터 UI 표시
function updateCheckdayFilterVisibility() {
    const role = getEffectiveRole();
    const filterEl = document.getElementById('checkday-filter');
    if (filterEl) {
        filterEl.style.display = (role === 'meter') ? '' : 'none';
    }
}

// ── 전체 마커 생성 (주소 기준으로 계기 그룹핑) ──────────────────
function loadMarkers() {
    const selectedGroups = loadSelectedGroups();
    const selectedCheckdays = loadSelectedCheckdays();
    const role = getEffectiveRole();
    const applyCheckdayFilter = (role === 'meter');

    const grouped = {};
    sampleData.forEach(item => {
        if (!selectedGroups.has(item.동그룹)) return;
        if (item.lat == null || item.lng == null) return;
        // 계기팀 시각에서만 검침일 그룹 필터 적용 (통신팀/admin-comm은 무시)
        if (applyCheckdayFilter && !selectedCheckdays.has(item.검침일그룹)) return;
        const addr = item.주소;
        if (!grouped[addr]) {
            grouped[addr] = {
                meters: [],
                lat: item.lat,
                lng: item.lng,
                roadAddress: item.도로명주소
            };
        }
        grouped[addr].meters.push(item);
    });

    // 같은 좌표에 겹친 approximate 마커들 — 작은 원으로 분산 (안 겹치게)
    spreadOverlappingMarkers(grouped);

    Object.entries(grouped).forEach(([addr, data]) => {
        const coords = new kakao.maps.LatLng(data.lat, data.lng);
        createMarker(coords, addr, data.meters);
    });
}

// 같은 좌표에 겹친 approximate 주소 그룹을 작은 원형으로 분산
function spreadOverlappingMarkers(grouped) {
    const SPREAD_RADIUS = 0.0003;   // ≈ 33m
    const coordToAddrs = {};
    Object.entries(grouped).forEach(([addr, data]) => {
        const isApprox = data.meters.some(m => m.좌표정확도 === 'approximate');
        if (!isApprox) return;
        const key = `${data.lat.toFixed(6)},${data.lng.toFixed(6)}`;
        if (!coordToAddrs[key]) coordToAddrs[key] = [];
        coordToAddrs[key].push(addr);
    });
    Object.values(coordToAddrs).forEach(addrs => {
        if (addrs.length <= 1) return;
        const n = addrs.length;
        addrs.forEach((addr, i) => {
            const angle = (2 * Math.PI * i) / n;
            grouped[addr].lat += SPREAD_RADIUS * Math.cos(angle);
            grouped[addr].lng += SPREAD_RADIUS * Math.sin(angle);
        });
    });
}

// ── 마커 스타일 결정 함수 ────────────────────────────────────────
function decideMarkerStyle(meters, status, session) {
    let role = session?.role || 'admin';
    // admin은 토글에 따라 계기팀 시각 또는 통신팀 시각으로 봄
    if (role === 'admin') role = adminViewRole;
    const isApprox = meters.some(m => m.좌표정확도 === 'approximate');
    const failedSet = status.failedMeters || {};
    const checkedCount = (status.checkedMeters || []).length;
    const total = meters.length;
    const failedCount = Object.keys(failedSet).length;
    const meter_state = status.meter_state || 'pending';
    const comm_state  = status.comm_state  || 'pending';

    let colorClass = '';
    let labelMain = total.toString();
    let labelSub = '';
    let extraClass = '';

    // 1. 통신팀 시각
    if (role === 'comm') {
        // 계기팀 활성 계기 수 = replacement_list 길이 (계기팀이 교체 완료한 것)
        // 통신팀 완료 수 = comm_completed_list 중 replacement_list와 교집합만 (코덱스 #5)
        const addedCount = Object.keys(status.added_meters || {}).length;
        const totalAll = total + addedCount;
        const replList = status.replacement_list || {};
        const commCompletedList = status.comm_completed_list || {};
        const replacedCount = Object.keys(replList).length;
        const commDoneCount = Object.keys(commCompletedList).filter(m => replList[m]).length;
        const activeCount = replacedCount;  // 통신팀에게 활성된 계기 수
        const isCommAllDone = (activeCount > 0 && commDoneCount >= activeCount);
        const isCommPartial = (commDoneCount > 0 && !isCommAllDone);

        if (comm_state === 'complete' || isCommAllDone) {
            // 통신팀이 활성 계기 모두 완료 → 회색
            colorClass = 'comm-done';
            labelMain = activeCount > 0 ? `${commDoneCount}/${activeCount}` : '✓';
        } else if (comm_state === 'hold') {
            colorClass = 'blue';
        } else if (comm_state === 'fail') {
            colorClass = 'red';
        } else if (isCommPartial) {
            // 통신팀 부분 완료 → 보류색 + 분수
            colorClass = 'blue';
            labelMain = `${commDoneCount}/${activeCount}`;
        } else if (activeCount === totalAll && totalAll > 0) {
            // 계기팀 전체 완료, 통신팀 미작업 → 활성 (초록)
            colorClass = (status.address === meterLatestAddress) ? 'comm-last' : 'comm-target';
            labelMain = String(activeCount);
        } else if (activeCount > 0) {
            // 계기팀 부분 완료 → 일부만 활성 + 분수 (계기팀 진행률)
            colorClass = 'comm-target';
            labelMain = `${activeCount}/${totalAll}`;
        } else {
            // 계기팀 미작업 — 검침일 색 + 옅게 (비활성)
            colorClass = checkDayClass(meters);
            extraClass = 'comm-bg';
        }
    }
    // 2. 계기팀 / admin(meter) 시각
    else {
        // 자동 계산 (영준님 명세):
        // - 모두 교체 완료 → gray (완료)
        // - 일부 완료 → blue (보류 + N/M)
        // - 불가만 있고 완료 없음 → red
        // 추가된 계기(added_meters)도 작업 대상에 포함
        const addedCount = Object.keys(status.added_meters || {}).length;
        const totalAll = total + addedCount;
        const replacedCount = Object.keys(status.replacement_list || {}).length;
        const isAllReplaced = (totalAll > 0 && replacedCount === totalAll);
        const isPartialReplaced = (replacedCount > 0 && !isAllReplaced);

        const partial = (meter_state === 'pending') &&
                        (checkedCount + failedCount > 0) &&
                        (checkedCount + failedCount < total);
        if (meter_state === 'complete' || isAllReplaced) {
            colorClass = 'gray';
            labelMain = String(totalAll);
        } else if (meter_state === 'hold') {
            colorClass = 'blue';
        } else if (meter_state === 'fail') {
            colorClass = 'red';
        } else if (isPartialReplaced) {
            colorClass = 'blue';
            labelMain = `${replacedCount}/${totalAll}`;
        } else if (partial) {
            colorClass = 'blue';
            labelMain = `${checkedCount + failedCount}/${total}`;
        } else {
            // pending — markerMode에 따라 색
            if (markerMode === 'priority') {
                colorClass = priorityClass(meters);
            } else {
                // 'checkday' 또는 'both'
                colorClass = checkDayClass(meters);
            }
        }

        // 라벨에 검침일 D17 + 순위 표시 (mode에 따라)
        if (meter_state === 'pending' && !partial) {
            const day = meters[0]?.검침일;
            const pri = meters[0]?.순위;
            if (markerMode === 'checkday' && day) {
                labelSub = `D${day}`;
            } else if (markerMode === 'priority' && pri) {
                labelSub = priLabel(pri);
            } else if (markerMode === 'both') {
                const parts = [];
                if (day) parts.push(`D${day}`);
                if (pri) parts.push(priLabel(pri));
                labelSub = parts.join(' ');
            }
        }

        if (isApprox && meter_state === 'pending') labelMain = '?';
    }

    return { colorClass, extraClass, labelMain, labelSub };
}

function checkDayClass(meters) {
    const g = meters[0]?.검침일그룹;
    return g ? `day-${g.toLowerCase()}` : 'day-g1';
}

function priorityClass(meters) {
    const p = meters[0]?.순위;
    if (p === '1순위') return 'pri-1';
    if (p === '2순위') return 'pri-2';
    if (p === '3순위') return 'pri-3';
    if (p === '4순위') return 'pri-4';
    if (p === '과년도') return 'pri-past';
    return 'pri-4';
}

function priLabel(p) {
    if (p === '1순위') return '1';
    if (p === '2순위') return '2';
    if (p === '3순위') return '3';
    if (p === '4순위') return '4';
    if (p === '과년도') return '과';
    return '';
}

// ── 계기팀 가장 최근 완료 주소 갱신 (통신팀 화면 찐초록) ──────────
// meter_state='complete' AND comm_state≠'complete' 중 meter_updatedAt 최대
function updateMeterLatestAddress() {
    let latest = null, latestTs = 0;
    Object.entries(workStatus).forEach(([addr, st]) => {
        if (st.meter_state === 'complete' && st.comm_state !== 'complete' && st.meter_updatedAt) {
            const ts = new Date(st.meter_updatedAt).getTime();
            if (ts > latestTs) { latestTs = ts; latest = addr; }
        }
    });
    meterLatestAddress = latest;
}

// ── 단일 마커 생성 및 지도에 추가 ────────────────────────────────
function createMarker(position, address, meters) {
    const status = workStatus[address] || makeEmptyEntry();
    const session = authGetSession();
    const style = decideMarkerStyle(meters, { ...status, address }, session);

    const markerContent = `
        <div class="custom-marker ${style.colorClass}${style.extraClass ? ' ' + style.extraClass : ''}">
            <svg viewBox="0 0 20 26" xmlns="http://www.w3.org/2000/svg">
                <path class="pin-body" d="M10 0C4.48 0 0 4.48 0 10c0 6.72 10 16 10 16s10-9.28 10-16C20 4.48 15.52 0 10 0z"/>
                <circle class="pin-circle" cx="10" cy="10" r="5.5" fill="white"/>
            </svg>
            <div class="marker-number">${style.labelMain}</div>
            ${style.labelSub ? `<div class="marker-fraction">${style.labelSub}</div>` : ''}
        </div>
    `;

    // DOM 엘리먼트로 직접 생성 (문자열 대신 — DOM 재구성 시 이벤트 유실 방지)
    const markerEl = document.createElement('div');
    markerEl.innerHTML = markerContent;

    // 클릭 이벤트를 직접 생성한 DOM에 붙임
    markerEl.addEventListener('click', () => {
        showDetail(address, meters);
    });

    const customOverlay = new kakao.maps.CustomOverlay({
        position: position,
        content: markerEl,  // DOM 엘리먼트로 전달
        yAnchor: 1
    });

    customOverlay.setMap(map);

    markers.push({ overlay: customOverlay, address, meters, element: markerEl });
}

// ── 마커 색상 갱신 (상태 변경 시 호출) ──────────────────────────
function updateMarkerColor(address) {
    const marker = markers.find(m => m.address === address);
    if (!marker) return;

    const status = workStatus[address] || makeEmptyEntry();
    const session = authGetSession();
    const style = decideMarkerStyle(marker.meters, { ...status, address }, session);

    const el = marker.element.querySelector('.custom-marker');
    if (el) {
        el.className = `custom-marker ${style.colorClass}${style.extraClass ? ' ' + style.extraClass : ''}`;
    }

    const labelEl = marker.element.querySelector('.marker-number');
    if (labelEl) labelEl.textContent = style.labelMain;

    // labelSub 처리 — 있으면 marker-fraction 업데이트/생성, 없으면 제거
    let fracEl = marker.element.querySelector('.marker-fraction');
    if (style.labelSub) {
        if (!fracEl) {
            fracEl = document.createElement('div');
            fracEl.className = 'marker-fraction';
            marker.element.querySelector('.custom-marker').appendChild(fracEl);
        }
        fracEl.textContent = style.labelSub;
    } else if (fracEl) {
        fracEl.remove();
    }
}

// ── 전체 마커 색상 일괄 갱신 (Firebase 동기화 후 호출) ──────────
function refreshAllMarkers() {
    updateMeterLatestAddress();
    markers.forEach(m => updateMarkerColor(m.address));
}

// ── 현재 위치 추적 토글 ──────────────────────────────────────────
function toggleLocation() {
    const btn = document.getElementById('loc-btn');
    if (!locationActive) {
        if (!navigator.geolocation) { alert('위치 서비스를 지원하지 않는 브라우저입니다.'); return; }
        locationWatchId = navigator.geolocation.watchPosition(pos => {
            const latlng = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
            if (!locationOverlay) {
                const dot = document.createElement('div');
                dot.style.cssText = 'width:14px;height:14px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(59,130,246,0.25);';
                locationOverlay = new kakao.maps.CustomOverlay({ position: latlng, content: dot, zIndex: 10 });
                locationOverlay.setMap(map);
            } else {
                locationOverlay.setPosition(latlng);
            }
            map.setCenter(latlng);
        }, () => alert('위치를 가져올 수 없습니다.'), { enableHighAccuracy: true });
        locationActive = true;
        btn.classList.add('active');
    } else {
        if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId);
        if (locationOverlay) { locationOverlay.setMap(null); locationOverlay = null; }
        locationWatchId = null;
        locationActive = false;
        btn.classList.remove('active');
    }
}

// ── 검색 기능 ─────────────────────────────────────────
function openSearch() {
    const overlay = document.getElementById('search-overlay');
    if (!overlay) return;
    overlay.classList.add('active');
    const input = document.getElementById('search-input');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-hint').textContent = '4자 이상 입력하세요';
}

function closeSearch() {
    const overlay = document.getElementById('search-overlay');
    if (overlay) overlay.classList.remove('active');
}

function runSearch() {
    const q = (document.getElementById('search-input').value || '').trim();
    const hintEl = document.getElementById('search-hint');
    const resultsEl = document.getElementById('search-results');
    if (q.length < 4) {
        hintEl.textContent = '4자 이상 입력하세요';
        resultsEl.innerHTML = '';
        return;
    }

    const results = [];
    const addrSeen = new Set();
    for (const item of sampleData) {
        const meterNo = String(item.계기번호 || '');
        const road = String(item.도로명주소 || '');
        const addr = String(item.주소 || '');
        const apt = String(item.공동주택명 || '');
        if (meterNo.includes(q)) {
            results.push({
                type: 'meter',
                primary: meterNo,
                secondary: addr,
                tertiary: road && road !== addr ? road : '',
                item,
            });
        } else if (addr.includes(q) || road.includes(q) || apt.includes(q)) {
            const key = addr;
            if (addrSeen.has(key)) continue;
            addrSeen.add(key);
            let primary, secondary;
            if (addr.includes(q)) {
                primary = addr;
                secondary = apt ? `${apt} · ${road}` : road;
            } else if (apt.includes(q)) {
                primary = apt;
                secondary = `${addr} · ${road}`;
            } else {
                primary = road;
                secondary = apt ? `${apt} · ${addr}` : addr;
            }
            results.push({ type: 'address', primary, secondary, item });
        }
    }

    hintEl.textContent = `${results.length}건 검색됨`;
    if (results.length === 0) {
        resultsEl.innerHTML = '<div class="search-empty">결과 없음</div>';
        return;
    }

    const MAX = 200;
    const shown = results.slice(0, MAX);
    const rows = shown.map((r, i) => {
        const it = r.item;
        const grp = it.동그룹 || '';
        const ckGrp = it.검침일그룹 || '';
        const wk = ckGrp === 'G1' ? '1주차' : ckGrp === 'G2' ? '2주차' : ckGrp === 'G3' ? '3주차' : ckGrp === 'G4' ? '4주차' : '';
        const sec = r.secondary ? `<div class="sr-secondary">${escapeSearchHtml(r.secondary)}</div>` : '';
        return `<div class="search-result-row" data-idx="${i}">
            <div class="sr-main">
                <div class="sr-primary">${escapeSearchHtml(r.primary)}</div>
                ${sec}
            </div>
            <div class="sr-meta">
                ${grp ? `<span class="sr-cond">${escapeSearchHtml(grp)}</span>` : ''}
                ${wk ? `<span class="sr-cond wk">${wk}</span>` : ''}
            </div>
        </div>`;
    }).join('');

    resultsEl.innerHTML = rows + (results.length > MAX ? `<div class="search-empty">+ ${results.length - MAX}건 더 — 검색어를 좁혀주세요</div>` : '');
    resultsEl.querySelectorAll('.search-result-row').forEach((el, i) => {
        el.addEventListener('click', () => gotoSearchResult(shown[i]));
    });
}

function gotoSearchResult(r) {
    const it = r.item;
    if (it.lat == null || it.lng == null) {
        alert('좌표가 없는 항목입니다');
        return;
    }
    closeSearch();
    const latlng = new kakao.maps.LatLng(it.lat, it.lng);
    map.setLevel(1);
    map.setCenter(latlng);

    showSearchPulse(latlng);

    if (r.type === 'meter') {
        setTimeout(() => {
            const groupMeters = sampleData.filter(s => s.주소 === it.주소);
            if (typeof showDetail === 'function') showDetail(it.주소, groupMeters);
        }, 200);
    }
}

let _searchPulseOverlay = null;
let _searchPulseTimer = null;
function showSearchPulse(latlng) {
    if (_searchPulseTimer) { clearTimeout(_searchPulseTimer); _searchPulseTimer = null; }
    if (_searchPulseOverlay) { _searchPulseOverlay.setMap(null); _searchPulseOverlay = null; }
    const el = document.createElement('div');
    el.className = 'search-pulse';
    _searchPulseOverlay = new kakao.maps.CustomOverlay({
        position: latlng,
        content: el,
        yAnchor: 0.5,
        xAnchor: 0.5,
        zIndex: 999,
    });
    _searchPulseOverlay.setMap(map);
    _searchPulseTimer = setTimeout(() => {
        if (_searchPulseOverlay) { _searchPulseOverlay.setMap(null); _searchPulseOverlay = null; }
        _searchPulseTimer = null;
    }, 10000);
}

function escapeSearchHtml(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 카카오맵 SDK 로드 완료 후 지도 초기화 실행
kakao.maps.load(() => {
    initMap();
});
