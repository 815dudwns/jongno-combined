// map.js — 지도 및 마커 로직

let map;
let markers = [];               // 현재 화면에 그려진 마커 [{overlay, address, meters}]
let sampleData = [];
let _naverMapsLoading = null;

// ── 뷰포트 컬링 ─────────────────────────────────────────────────
// _addrData: 필터(동그룹/검침일/미연계) 통과한 전체 후보 (주소→{lat,lng,meters}). 필터 변경 시만 재계산.
// _markerByAddr: 현재 화면에 떠 있는 마커 (주소→markers 항목). renderViewport가 bounds로 증분 관리.
let _addrData = new Map();
let _markerByAddr = new Map();
let _renderTimer = null;

function getNaverMapsKey() {
    const key = (typeof NAVER_MAPS_NCP_KEY_ID !== 'undefined') ? NAVER_MAPS_NCP_KEY_ID : '';
    return String(key || '').trim();
}

function getResolvedTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
}

function getNaverMapsStyleId() {
    const theme = getResolvedTheme();
    const darkId = (typeof NAVER_MAPS_DARK_STYLE_ID !== 'undefined') ? NAVER_MAPS_DARK_STYLE_ID : '';
    const lightId = (typeof NAVER_MAPS_LIGHT_STYLE_ID !== 'undefined') ? NAVER_MAPS_LIGHT_STYLE_ID : '';
    return String((theme === 'dark' ? darkId : lightId) || '').trim();
}

function getSavedMapViewOptions() {
    const saved = (() => { try { return JSON.parse(localStorage.getItem('jongno_map_view')); } catch { return null; } })();
    return {
        center: makeLatLng(saved ? saved.lat : 37.578, saved ? saved.lng : 126.983),
        zoom: saved ? (saved.zoom || (saved.level ? 18 - saved.level : 15)) : 15,
        minZoom: 7,
        zoomControl: false,
        mapDataControl: false,
        scaleControl: false,
        logoControlOptions: { position: naver.maps.Position.BOTTOM_LEFT }
    };
}

function getCurrentMapViewOptions() {
    if (!map) return getSavedMapViewOptions();
    const center = map.getCenter();
    return {
        ...getSavedMapViewOptions(),
        center: makeLatLng(center.lat(), center.lng()),
        zoom: map.getZoom()
    };
}

function getNaverMapOptions(baseOptions) {
    const options = { ...(baseOptions || getSavedMapViewOptions()) };
    const customStyleId = getNaverMapsStyleId();
    if (customStyleId) {
        options.gl = true;
        options.customStyleId = customStyleId;
    }
    // 라이트 모드는 customStyleId를 아예 넣지 않아야 네이버 기본 지도 타일로 정상 복귀한다.
    // 빈 문자열 customStyleId는 일부 환경에서 흰 지도 배경처럼 깨질 수 있다.
    return options;
}

function attachMapViewSaveListener() {
    naver.maps.Event.addListener(map, 'idle', () => {
        const c = map.getCenter();
        localStorage.setItem('jongno_map_view', JSON.stringify({ lat: c.lat(), lng: c.lng(), zoom: map.getZoom() }));
        scheduleRenderViewport();   // 지도 이동/줌 후 화면 안 마커 증분 갱신 (뷰포트 컬링)
    });
}

function loadNaverMapsSdk() {
    if (window.naver && window.naver.maps) return Promise.resolve();
    if (_naverMapsLoading) return _naverMapsLoading;
    const key = getNaverMapsKey();
    if (!key || key === 'YOUR_NCP_KEY_ID') {
        return Promise.reject(new Error('네이버 지도 NCP Key ID가 설정되지 않았습니다. js/config.js의 NAVER_MAPS_NCP_KEY_ID를 입력하세요.'));
    }
    _naverMapsLoading = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-naver-map-sdk]');
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('네이버 지도 SDK 로드 실패')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(key)}`;
        script.async = true;
        script.defer = true;
        script.dataset.naverMapSdk = '1';
        script.onload = () => {
            loadNaverMapsGlSdk().then(resolve).catch(reject);
        };
        script.onerror = () => reject(new Error('네이버 지도 SDK 로드 실패'));
        document.head.appendChild(script);
    });
    return _naverMapsLoading;
}

function loadNaverMapsGlSdk() {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-naver-map-gl-sdk]') ||
            Array.from(document.scripts).find(s => s.src && s.src.includes('/maps-gl.js'));
        if (existing) {
            if (existing.dataset.loaded === '1') return resolve();
            existing.addEventListener('load', () => { existing.dataset.loaded = '1'; resolve(); }, { once: true });
            existing.addEventListener('error', () => reject(new Error('네이버 지도 GL SDK 로드 실패')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://oapi.map.naver.com/openapi/v3/maps-gl.js';
        script.async = true;
        script.defer = true;
        script.dataset.naverMapGlSdk = '1';
        script.onload = () => { script.dataset.loaded = '1'; resolve(); };
        script.onerror = () => reject(new Error('네이버 지도 GL SDK 로드 실패'));
        document.head.appendChild(script);
    });
}

function makeLatLng(lat, lng) {
    return new naver.maps.LatLng(Number(lat), Number(lng));
}

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
let hideDone = localStorage.getItem('jongno_hide_done') === '1';   // '완료 마커 숨김' 토글
let phaseFilter = localStorage.getItem('jongno_phase_filter') || 'normal';   // 계기 종류 필터: normal/dansang/samsang/both

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


function setupNaverMapThemeSync() {
    window.addEventListener('jongno:themechange', () => {
        if (!map) return;
        const container = document.getElementById('map');
        if (!container) return;
        try {
            const viewOptions = getCurrentMapViewOptions();
            // 마커는 재생성(loadMarkers)하지 않는다. 데이터로 다시 그리면
            // workStatus 재읽기 과정에서 완료 상태가 미완료로 뒤집힐 수 있다.
            // 다크/라이트 마커 스타일은 전부 [data-theme] CSS라 속성 변경만으로 자동 적용되므로,
            // 기존 마커를 새 map에 그대로 재바인딩해 상태를 보존한다.
            if (locationOverlay) { locationOverlay.setMap(null); locationOverlay = null; }
            if (_searchPulseOverlay) { _searchPulseOverlay.setMap(null); _searchPulseOverlay = null; }

            // 네이버 지도는 customStyleId를 비우는 setOptions만으로 기본 타일 복귀가 안정적이지 않다.
            // 라이트/시스템 라이트로 돌아갈 때는 지도 인스턴스를 새로 만들어 기본 타일을 확실히 복원한다.
            map = new naver.maps.Map(container, getNaverMapOptions(viewOptions));
            attachMapViewSaveListener();
            clearAllMarkers();   // 옛 map 인스턴스 마커 제거 (새 map으로 교체됨)
            renderViewport();    // 새 테마로 화면 안 마커 재생성 (_addrData 유지, 색은 createMarker 최신 반영)
        } catch (e) {
            console.warn('[naverMap] 스타일 전환 실패, 새로고침 후 적용됩니다:', e);
        }
    });
}

// ── 지도 초기화 ──────────────────────────────────────────────────
async function initMap() {
    try {
        await loadNaverMapsSdk();
    } catch (e) {
        console.error('[naverMap] 로드 실패:', e);
        const container = document.getElementById('map');
        if (container) container.innerHTML = `<div style="padding:16px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;margin:12px;font-size:13px;line-height:1.5;">${e.message}</div>`;
        return;
    }
    workStatus = loadStatusLocal();
    const container = document.getElementById('map');

    // 마지막 지도 위치/줌 레벨 복원 + 현재 테마 지도 타일 적용
    map = new naver.maps.Map(container, getNaverMapOptions());
    setupNaverMapThemeSync();

    // 지도 이동/줌 변경 시 현재 뷰 저장
    attachMapViewSaveListener();

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
    initCommMissingFilter();
    initHideDoneFilter();
    initPhaseFilter();
    updateCheckdayFilterVisibility();
    // workStatus(완료 포함)를 Firebase에서 먼저 받은 뒤 마커 생성 → 완료가 첫 화면부터 표시
    // (이전: loadMarkers를 먼저 그려서 첫 로드 시 완료 미반영 → 필터를 한 번 거쳐야 보이던 버그)
    await initFirebase();
    buildAddrCandidates();
    // bounds 준비됐으면 즉시, 아니면 첫 idle(attachMapViewSaveListener)이 렌더 — 새로고침 직후 빈 지도 방지
    renderViewport();

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
                    // 검침일 필터 적용/해제 → 후보 재계산 + 화면 렌더
                    clearAllMarkers();
                    loadMarkers();
                    // 디테일 열려있으면 현재 역할로 재렌더 (토글 즉시 반영)
                    if (typeof window.rerenderDetailIfOpen === 'function') window.rerenderDetailIfOpen();
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

// ── 동그룹 라디오 패널 생성 (단일선택 — 마커 과다 방지, ami맵 방식) ──
function _dongToggleLabel(groupName) {
    const btn = document.getElementById('dong-group-toggle');
    if (btn) btn.textContent = (groupName ? groupName : '동그룹') + ' ▾';
}
function populateDongGroups() {
    const panel = document.getElementById('dong-group-panel');
    const toggleBtn = document.getElementById('dong-group-toggle');
    if (!panel || !toggleBtn) return;

    let selectedGroups = loadSelectedGroups();
    const groupNames = Object.keys(DONG_GROUPS);
    // 단일선택: 저장값 없거나 비었으면 첫 동그룹 기본 선택 (마커 0 방지)
    if (selectedGroups.size === 0 && groupNames.length) {
        selectedGroups = new Set([groupNames[0]]);
        saveSelectedGroups(selectedGroups);
    } else if (selectedGroups.size > 1) {
        // 구버전 다중선택 저장값 → 첫 1개만 유지
        const first = [...selectedGroups][0];
        selectedGroups = new Set([first]);
        saveSelectedGroups(selectedGroups);
    }

    // 라디오 8개 동적 생성 (하나만 선택)
    groupNames.forEach(groupName => {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'radio';
        cb.name = 'dong-group-radio';
        cb.value = groupName;
        cb.checked = selectedGroups.has(groupName);
        cb.addEventListener('change', onDongGroupChange);
        label.appendChild(cb);
        label.appendChild(document.createTextNode(groupName));
        panel.appendChild(label);
    });
    _dongToggleLabel([...selectedGroups][0] || '');

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

// 동그룹 라디오 변경 시 마커 재생성 (단일선택 — 1개만 체크됨)
function onDongGroupChange() {
    const panel = document.getElementById('dong-group-panel');
    if (!panel) return;
    const checked = new Set();
    panel.querySelectorAll('input[type="radio"]').forEach(cb => {
        if (cb.checked) checked.add(cb.value);
    });
    saveSelectedGroups(checked);
    _dongToggleLabel([...checked][0] || '');
    panel.classList.remove('open');   // 선택 후 패널 닫기
    clearAllMarkers();
    loadMarkers();   // 후보 재계산(buildAddrCandidates) + 화면 렌더(renderViewport)
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
    clearAllMarkers();
    loadMarkers();
}

// 계기팀 시각일 때만 검침일 필터 UI 표시
function updateCheckdayFilterVisibility() {
    const role = getEffectiveRole();
    const filterEl = document.getElementById('checkday-filter');
    if (filterEl) {
        filterEl.style.display = (role === 'meter') ? '' : 'none';
    }
    // 미연계(통신팀 누락만) 필터 — 통신팀 시각에서만 표시
    const commMissingEl = document.getElementById('comm-missing-filter');
    if (commMissingEl) {
        commMissingEl.style.display = (role === 'meter') ? 'none' : '';
    }
}

// ── 전체 마커 생성 (주소 기준으로 계기 그룹핑) ──────────────────
// ── 통신팀 누락만 필터 ────────────────────────────────────────
function loadCommMissingOnly() {
    return localStorage.getItem('jongno_comm_missing_only') === '1';
}
function saveCommMissingOnly(v) {
    localStorage.setItem('jongno_comm_missing_only', v ? '1' : '0');
}
// 통신팀이 방문해 일부만 하고 빼먹은 주소 = 계기팀완료(replacement) 중 일부는 통신완료, 일부는 미완료
function hasCommPartialMissing(addr) {
    const st = workStatus[addr];
    if (!st) return false;
    const rl = st.replacement_list || {};
    const ccl = st.comm_completed_list || {};
    const oks = Object.keys(rl);
    if (!oks.length) return false;
    let done = 0, miss = 0;
    oks.forEach(ok => { if (ccl[ok]) done++; else miss++; });
    return done > 0 && miss > 0;
}

// 필터(동그룹/검침일/미연계) 통과한 전체 후보를 _addrData에 캐시 (마커 생성 X — renderViewport가 함)
function buildAddrCandidates() {
    const selectedGroups = loadSelectedGroups();
    const selectedCheckdays = loadSelectedCheckdays();
    const role = getEffectiveRole();
    const applyCheckdayFilter = (role === 'meter');
    // 미연계(통신팀 누락만)는 통신팀 개념 — 계기팀 시각에서는 적용 안 함
    const commMissingOnly = (role !== 'meter') && loadCommMissingOnly();

    const grouped = {};
    sampleData.forEach(item => {
        if (item.lat == null || item.lng == null) return;
        // 통신팀 누락만 모드 = 동그룹/검침일 필터 전부 무시
        if (!commMissingOnly) {
            if (!selectedGroups.has(item.동그룹)) return;
            // 계기팀 시각에서만 검침일 그룹 필터 적용 (통신팀/admin-comm은 무시)
            if (applyCheckdayFilter && !selectedCheckdays.has(item.검침일그룹)) return;
        }
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

    // 통신팀 누락만 모드 — 빼먹은 주소만 남김
    if (commMissingOnly) {
        Object.keys(grouped).forEach(addr => {
            if (!hasCommPartialMissing(addr)) delete grouped[addr];
        });
    }

    // 같은 좌표에 겹친 approximate 마커들 — 작은 원으로 분산 (안 겹치게)
    spreadOverlappingMarkers(grouped);

    _addrData = new Map();
    Object.entries(grouped).forEach(([addr, data]) => {
        _addrData.set(addr, { lat: data.lat, lng: data.lng, meters: data.meters });
    });
}

// 화면에 그려진 마커 전부 제거 (markers + _markerByAddr 동시)
function clearAllMarkers() {
    markers.forEach(m => { if (m.overlay) m.overlay.setMap(null); });
    markers = [];
    _markerByAddr.clear();
}

// 뷰포트 컬링 — 화면(+여유 20%) 안 후보만 마커 유지, 밖은 제거
function renderViewport() {
    if (!map) return;
    const b = map.getBounds();
    if (!b) return;   // bounds 미준비(초기) — 다음 idle에서 재시도
    const sw = b.getSW(), ne = b.getNE();
    const latPad = (ne.lat() - sw.lat()) * 0.2;
    const lngPad = (ne.lng() - sw.lng()) * 0.2;
    const minLat = sw.lat() - latPad, maxLat = ne.lat() + latPad;
    const minLng = sw.lng() - lngPad, maxLng = ne.lng() + lngPad;
    const inView = (d) => d.lat >= minLat && d.lat <= maxLat && d.lng >= minLng && d.lng <= maxLng;

    // 화면에 새로 들어온 후보 → 마커 생성
    _addrData.forEach((data, addr) => {
        if (inView(data) && !_markerByAddr.has(addr)) {
            createMarker(makeLatLng(data.lat, data.lng), addr, data.meters);
        }
    });
    // 화면 밖으로 나갔거나 후보에서 사라진 마커 → 제거
    const toRemove = [];
    _markerByAddr.forEach((m, addr) => {
        const data = _addrData.get(addr);
        if (!data || !inView(data)) toRemove.push(addr);
    });
    if (toRemove.length) {
        toRemove.forEach(addr => {
            const m = _markerByAddr.get(addr);
            if (m && m.overlay) m.overlay.setMap(null);
            _markerByAddr.delete(addr);
        });
        const rm = new Set(toRemove);
        markers = markers.filter(m => !rm.has(m.address));
    }
}

// idle 디바운스 렌더
function scheduleRenderViewport() {
    if (_renderTimer) clearTimeout(_renderTimer);
    _renderTimer = setTimeout(() => { _renderTimer = null; renderViewport(); }, 120);
}

// 호환 래퍼: 필터 변경 시 후보 재계산 + 화면 렌더
function loadMarkers() {
    buildAddrCandidates();
    renderViewport();
}

// 통신팀 누락만 체크박스 초기화
function initCommMissingFilter() {
    const cb = document.getElementById('comm-missing-only');
    if (!cb) return;
    cb.checked = loadCommMissingOnly();
    cb.addEventListener('change', () => {
        saveCommMissingOnly(cb.checked);
        clearAllMarkers();
        loadMarkers();
    });
}

// '완료 마커 숨김' 체크박스 — 완료(gray/comm-done) 마커를 렌더에서 제외
function initHideDoneFilter() {
    const cb = document.getElementById('hide-done-chk');
    if (!cb) return;
    cb.checked = hideDone;
    cb.addEventListener('change', () => {
        hideDone = cb.checked;
        localStorage.setItem('jongno_hide_done', hideDone ? '1' : '0');
        clearAllMarkers();
        loadMarkers();
    });
}

// 계기 종류 토글 (일반/단상/삼상/단·삼) — 해당 타입 마커만 렌더
function initPhaseFilter() {
    const toggle = document.getElementById('phase-filter-toggle');
    if (!toggle) return;
    toggle.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.phase === phaseFilter);
        btn.onclick = () => {
            phaseFilter = btn.dataset.phase;
            localStorage.setItem('jongno_phase_filter', phaseFilter);
            toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.phase === phaseFilter));
            clearAllMarkers();
            loadMarkers();
        };
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
        // replacement_list를 완료(done)/이어서(draft) 분리 — draft를 완료로 오인 방지 (영준님 2026-06-09)
        // 마커당 호출되므로 2회 filter 대신 1패스 카운트 (대규모 지도 누적비용 절감)
        let doneCount = 0, draftCount = 0;
        for (const r of Object.values(status.replacement_list || {})) {
            if (r && r.draft) draftCount++; else doneCount++;
        }
        const isAllReplaced = (totalAll > 0 && doneCount === totalAll);
        const isPartialReplaced = (doneCount > 0 && !isAllReplaced);
        const hasDraft = draftCount > 0;

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
        } else if (hasDraft) {
            // 이어서(draft) 작업 진행 중 → 노란색 (완료/보류/불가 아닐 때)
            colorClass = 'yellow';
            labelMain = `${doneCount + draftCount}/${totalAll}`;
        } else if (isPartialReplaced) {
            colorClass = 'blue';
            labelMain = `${doneCount}/${totalAll}`;
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

// ── 마커 이미지 캐시 (canvas → dataURL) — DOM 마커 대신 이미지 아이콘으로 경량화 ──
const _markerImgCache = {};
const MARKER_FILL = {
    green: '#54b485', gray: '#6f6a5d', blue: '#5f95cf', red: '#d56e6e', yellow: '#dcb152',
    'day-g1': '#f5cbb1', 'day-g2': '#b5dfc7', 'day-g3': '#d0c0dc', 'day-g4': '#d9b8c5',
    'pri-1': '#e8b8b8', 'pri-2': '#e8d3b8', 'pri-3': '#d6cfa0', 'pri-4': '#bfd5a8', 'pri-past': '#b0b0b0',
    'comm-target': '#54b485', 'comm-last': '#2c5e44', 'comm-done': '#6f6a5d',
};
// 흰 원(밝은 핀) 표시 + 번호 어둡게 = green/yellow/day/pri 계열
const CIRCLE_CLASSES = new Set(['green', 'yellow', 'day-g1', 'day-g2', 'day-g3', 'day-g4', 'pri-1', 'pri-2', 'pri-3', 'pri-4', 'pri-past']);
const PIN_PATH = 'M10 0C4.48 0 0 4.48 0 10c0 6.72 10 16 10 16s10-9.28 10-16C20 4.48 15.52 0 10 0z';
function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function getMarkerImage(style) {
    const theme = (typeof getResolvedTheme === 'function') ? getResolvedTheme() : 'light';
    const main = (style.labelMain == null ? '' : String(style.labelMain));
    const sub = (style.labelSub == null ? '' : String(style.labelSub));
    const key = [style.colorClass, main, sub, style.extraClass || '', theme].join('|');
    if (_markerImgCache[key]) return _markerImgCache[key];

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = 40, H = 44;
    const PIN_X = 10, PIN_Y = 12;   // 핀 좌상단 offset (위쪽 검침일 칩 공간)
    const c = document.createElement('canvas');
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);

    const fill = MARKER_FILL[style.colorClass] || '#5f95cf';
    const showCircle = CIRCLE_CLASSES.has(style.colorClass);
    // 통신팀 시각의 계기팀 미완료(comm-bg): 다크모드에선 투명도 10% 더 낮춰 덜 튀게
    const alpha = (style.extraClass && style.extraClass.indexOf('comm-bg') >= 0) ? (theme === 'dark' ? 0.5 : 0.6) : 1;
    ctx.globalAlpha = alpha;

    // 핀 (물방울)
    ctx.save();
    ctx.translate(PIN_X, PIN_Y);
    const pin = new Path2D(PIN_PATH);
    ctx.fillStyle = fill;
    ctx.fill(pin);
    ctx.lineWidth = 0.8; ctx.strokeStyle = '#ffffff'; ctx.stroke(pin);   // 흰 링
    if (showCircle) {
        ctx.beginPath();
        ctx.arc(10, 10, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = (theme === 'dark') ? '#cfcfcf' : '#ffffff';
        ctx.fill();
    }
    ctx.restore();

    // 번호 (핀 흰원 중심)
    if (main) {
        ctx.fillStyle = showCircle ? '#1f2937' : '#ffffff';
        const fs = main.length > 3 ? 8.5 : 10.5;
        ctx.font = `800 ${fs}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(main, PIN_X + 10, PIN_Y + 10);
    }
    ctx.globalAlpha = 1;

    // 검침일 D-칩 (labelSub) — 핀 위 중앙
    if (sub) {
        ctx.font = '900 8px -apple-system, BlinkMacSystemFont, sans-serif';
        const tw = ctx.measureText(sub).width;
        const chipW = Math.ceil(tw) + 8, chipH = 12, cx = W / 2, cyT = 0.5;
        _roundRect(ctx, cx - chipW / 2, cyT, chipW, chipH, 3.5);
        ctx.fillStyle = (theme === 'dark') ? '#23211d' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = (theme === 'dark') ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.18)';
        ctx.stroke();
        ctx.fillStyle = (theme === 'dark') ? '#ffffff' : '#23211d';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(sub, cx, cyT + chipH / 2);
    }

    const img = {
        url: c.toDataURL('image/png'),
        size: new naver.maps.Size(W, H),
        scaledSize: new naver.maps.Size(W, H),
        anchor: new naver.maps.Point(PIN_X + 10, PIN_Y + 26),
    };
    _markerImgCache[key] = img;
    return img;
}

// 단상/삼상 필터 시 마커 숫자·색을 해당 상(相) 계기만으로 계산하도록
// meters와 status(계기번호 키 목록)를 그 상으로만 좁힌 뷰를 반환.
// status의 list 키(replacement_list/comm_completed_list/added_meters/failedMeters)와
// checkedMeters 원소는 전부 계기번호이므로 phaseOf로 직접 판정.
function scopeStatusToPhase(meters, status, phase) {
    const want = phase === 'dansang' ? '단상' : '삼상';
    const keep = no => phaseOf(no) === want;
    const filterObj = obj => {
        const out = {};
        for (const k in (obj || {})) if (keep(k)) out[k] = obj[k];
        return out;
    };
    return {
        vMeters: (meters || []).filter(m => phaseOf(m && m.계기번호) === want),
        vStatus: {
            ...status,
            replacement_list: filterObj(status.replacement_list),
            comm_completed_list: filterObj(status.comm_completed_list),
            added_meters: filterObj(status.added_meters),
            failedMeters: filterObj(status.failedMeters),
            checkedMeters: (status.checkedMeters || []).filter(keep),
        },
    };
}

// ── 단일 마커 생성 및 지도에 추가 ────────────────────────────────
function createMarker(position, address, meters) {
    // 계기 종류 필터 (단상/삼상) — 주소 계기 중 해당 타입 있는지 (구계기번호 기준)
    if (phaseFilter !== 'normal') {
        let hasDan = false, hasSam = false;
        for (const m of (meters || [])) {
            const p = (typeof phaseOf === 'function') ? phaseOf(m && m.계기번호) : null;
            if (p === '단상') hasDan = true; else if (p === '삼상') hasSam = true;
        }
        if (phaseFilter === 'dansang' && !hasDan) return null;
        if (phaseFilter === 'samsang' && !hasSam) return null;
        if (phaseFilter === 'both' && !(hasDan || hasSam)) return null;   // 미분류(기타)만 제외
    }
    const status = workStatus[address] || makeEmptyEntry();
    const session = authGetSession();
    // 단상/삼상 필터: 라벨 숫자·완료 판정을 해당 상 계기만으로 (normal/both는 전체)
    let styleMeters = meters, styleStatus = status;
    if (phaseFilter === 'dansang' || phaseFilter === 'samsang') {
        const sc = scopeStatusToPhase(meters, status, phaseFilter);
        styleMeters = sc.vMeters;
        styleStatus = sc.vStatus;
    }
    const style = decideMarkerStyle(styleMeters, { ...styleStatus, address }, session);
    // 단·삼(both): 마커 숫자를 "단상수/삼상수"로 표시 (색·완료판정은 전체 유지)
    if (phaseFilter === 'both') {
        let dan = 0, sam = 0;
        for (const m of (meters || [])) {
            const p = phaseOf(m && m.계기번호);
            if (p === '단상') dan++; else if (p === '삼상') sam++;
        }
        style.labelMain = `${dan}/${sam}`;
    }

    // 겹칠 때: 완료(gray/comm-done)는 맨 아래, 미완료(작업할 것)는 위로 + 순위 높을수록 더 위로
    const isDoneMarker = (style.colorClass === 'gray' || style.colorClass === 'comm-done');
    if (hideDone && isDoneMarker) return null;   // '완료 마커 숨김' ON → 완료(gray/comm-done) 렌더 제외
    let _zi;
    if (isDoneMarker) {
        _zi = 10;
    } else {
        const _pr = { '1순위': 5, '2순위': 4, '3순위': 3, '4순위': 2, '과년도': 1 }[meters[0] && meters[0].순위] || 2;
        _zi = 30 + _pr;   // 32~35: 미완료, 순위 높을수록 위
    }
    const customOverlay = new naver.maps.Marker({
        position: position,
        map: map,
        icon: getMarkerImage(style),   // canvas 이미지 아이콘 (DOM 마커 대비 대폭 경량)
        zIndex: _zi
    });
    naver.maps.Event.addListener(customOverlay, 'click', () => showDetail(address, meters));

    const _m = { overlay: customOverlay, address, meters };
    markers.push(_m);
    _markerByAddr.set(address, _m);   // 뷰포트 컬링 추적
}

// ── 마커 색상 갱신 (상태 변경 시 호출) ──────────────────────────
function updateMarkerColor(address) {
    const idx = markers.findIndex(m => m.address === address);
    if (idx < 0) return;
    const old = markers[idx];
    const pos = (old.overlay && old.overlay.getPosition) ? old.overlay.getPosition() : null;
    const meters = old.meters;
    if (!pos) return;

    // setIcon이 이미지 마커를 안정적으로 다시 안 그리는 케이스가 있어(첫 동기화 완료 미반영),
    // 검증된 경로인 '마커 재생성'으로 갱신한다. 이미지는 캐시되므로 재생성 비용은 낮다.
    old.overlay.setMap(null);
    markers.splice(idx, 1);
    createMarker(pos, address, meters);  // 최신 workStatus로 색/번호/검침일/zIndex 재계산
}

// ── 전체 마커 색상 일괄 갱신 (Firebase 동기화 후 호출) ──────────
function refreshAllMarkers() {
    updateMeterLatestAddress();
    // 뷰포트 컬링: 화면 안 마커만 비우고 재생성(workStatus/테마 색 갱신) → O(화면 마커).
    // _addrData(필터 후보)는 그대로, 색은 createMarker가 workStatus 최신 조회로 반영.
    clearAllMarkers();
    renderViewport();
    updateTopbarInfo();
}

// ── 계기번호 → 검침일 인덱스 (updateTopbarInfo의 sampleData.find O(12,745) 제거) ──
let _checkdayByMeter = null;
function _checkdayOf(meterNo) {
    if (!_checkdayByMeter) {
        _checkdayByMeter = new Map();
        if (Array.isArray(sampleData)) {
            for (const s of sampleData) { if (s && s.계기번호 != null) _checkdayByMeter.set(s.계기번호, s.검침일); }
        }
    }
    return _checkdayByMeter.get(meterNo) || '';
}

// ── 우상단 작업정보: 다음에 쓸 daily_seq + 마지막 작업 계기 검침일 ──
function updateTopbarInfo() {
    const el = document.getElementById('topbar-info');
    if (!el) return;
    // 오늘(KST) 자정 ms — daily_seq는 그날 기준이므로 오늘 작업만 집계 (오늘 없으면 1)
    const todayStart = Math.floor((Date.now() + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000;
    let maxSeq = 0, maxNo = '';
    Object.values(workStatus).forEach(st => {
        const rl = (st && st.replacement_list) || {};
        for (const no in rl) {
            const r = rl[no];
            if (!r || typeof r.replaced_at !== 'number' || r.replaced_at < todayStart) continue;  // 오늘 작업만
            if (typeof r.daily_seq === 'number' && r.daily_seq > maxSeq) { maxSeq = r.daily_seq; maxNo = no; }
        }
    });
    const day = maxNo ? _checkdayOf(maxNo) : '';
    el.textContent = maxSeq ? `다음 No.${maxSeq + 1}${day ? ' · 검침일 ' + day : ''}` : '';
}

// ── 현재 위치 추적 토글 ──────────────────────────────────────────
function toggleLocation() {
    const btn = document.getElementById('loc-btn');
    if (!locationActive) {
        if (!navigator.geolocation) { alert('위치 서비스를 지원하지 않는 브라우저입니다.'); return; }
        locationWatchId = navigator.geolocation.watchPosition(pos => {
            const latlng = makeLatLng(pos.coords.latitude, pos.coords.longitude);
            if (!locationOverlay) {
                const dot = document.createElement('div');
                dot.style.cssText = 'width:14px;height:14px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(59,130,246,0.25);';
                locationOverlay = new naver.maps.Marker({
                    position: latlng,
                    map: map,
                    icon: { content: dot, anchor: new naver.maps.Point(7, 7) },
                    zIndex: 10
                });
                map.setCenter(latlng);  // 최초 1회만 — 이후엔 마커만 갱신(지도 자유 이동)
            } else {
                locationOverlay.setPosition(latlng);
            }
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
    const latlng = makeLatLng(it.lat, it.lng);
    map.setZoom(18);
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
    _searchPulseOverlay = new naver.maps.Marker({
        position: latlng,
        map: map,
        icon: { content: el, anchor: new naver.maps.Point(7, 7) },
        zIndex: 999,
    });
    _searchPulseTimer = setTimeout(() => {
        if (_searchPulseOverlay) { _searchPulseOverlay.setMap(null); _searchPulseOverlay = null; }
        _searchPulseTimer = null;
    }, 10000);
}

function escapeSearchHtml(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 네이버 지도 SDK 로드 후 지도 초기화 실행
initMap();
