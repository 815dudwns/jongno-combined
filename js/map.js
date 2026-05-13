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

// 마커 모드: 'checkday' | 'priority' | 'both'
let markerMode = localStorage.getItem('jongno_marker_mode') || 'checkday';

// admin 전용 시각 토글: 'meter' (계기팀 화면) | 'comm' (통신팀 화면)
let adminViewRole = localStorage.getItem('jongno_admin_view_role') || 'meter';

// 통신팀 마지막 작업 주소 (comm_done=true 중 가장 최근 updatedAt)
let commLastAddress = null;

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
    loadMarkers();
    await initFirebase();
    refreshAllMarkers();

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
    } catch {
        // 파싱 실패 시 전체 선택
    }
    // 기본값: 8개 전부 체크
    return new Set(Object.keys(DONG_GROUPS));
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

// ── 전체 마커 생성 (주소 기준으로 계기 그룹핑) ──────────────────
function loadMarkers() {
    const selectedGroups = loadSelectedGroups();
    const grouped = {};
    sampleData.forEach(item => {
        if (!selectedGroups.has(item.동그룹)) return;
        if (item.lat == null || item.lng == null) return;
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

    Object.entries(grouped).forEach(([addr, data]) => {
        const coords = new kakao.maps.LatLng(data.lat, data.lng);
        createMarker(coords, addr, data.meters);
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

    // 부분완료 판정: 체크+불가 합이 0보다 크고 total 미만, state는 pending
    const partial = (status.state === 'pending') &&
                    (checkedCount + failedCount > 0) &&
                    (checkedCount + failedCount < total);

    let colorClass = '';
    let labelMain = total.toString();
    let labelSub = '';
    let extraClass = '';

    // 1. 통신팀 시각
    if (role === 'comm') {
        if (status.comm_done && status.address === commLastAddress) {
            colorClass = 'comm-last';
            labelMain = '✓';
        } else if (status.comm_done) {
            colorClass = 'comm-done';
            labelMain = '✓';
        } else if (status.meter_done) {
            colorClass = 'comm-target';   // 초록 (가야 할 곳)
            labelMain = total.toString();
        } else if (status.state === 'hold') {
            colorClass = 'blue';
        } else if (status.state === 'fail') {
            colorClass = 'red';
        } else if (partial) {
            // 계기팀이 부분 진행 중 — 통신팀에게도 동선 예측 위해 N/M 표시
            colorClass = 'blue';
            labelMain = `${checkedCount + failedCount}/${total}`;
        } else {
            // 계기팀 미완료 — 검침일 색 + 옅게
            colorClass = checkDayClass(meters);
            extraClass = 'comm-bg';
        }
    }
    // 2. 계기팀 / admin 시각
    else {
        if (status.state === 'complete') {
            colorClass = 'gray';
        } else if (status.state === 'hold') {
            colorClass = 'blue';
        } else if (status.state === 'fail') {
            colorClass = 'red';
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
        if (status.state === 'pending' && !partial) {
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

        if (isApprox && status.state === 'pending') labelMain = '?';
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
    if (p === '과년도') return '過';
    return '';
}

// ── 통신팀 마지막 작업 주소 갱신 ─────────────────────────────────
function updateCommLastAddress() {
    let latest = null, latestTs = 0;
    Object.entries(workStatus).forEach(([addr, st]) => {
        if (st.comm_done && st.updatedAt) {
            const ts = new Date(st.updatedAt).getTime();
            if (ts > latestTs) { latestTs = ts; latest = addr; }
        }
    });
    commLastAddress = latest;
}

// ── 단일 마커 생성 및 지도에 추가 ────────────────────────────────
function createMarker(position, address, meters) {
    const status = workStatus[address] || { state: 'pending', checkedMeters: [], reason: '' };
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

    const status = workStatus[address] || { state: 'pending' };
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
    updateCommLastAddress();
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

// 카카오맵 SDK 로드 완료 후 지도 초기화 실행
kakao.maps.load(() => {
    initMap();
});
