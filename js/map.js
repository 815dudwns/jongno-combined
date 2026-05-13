// map.js — 지도 및 마커 로직

let map;
let markers = [];
let sampleData = [];

// 위치 추적 관련 상태
let locationOverlay = null;
let locationWatchId = null;
let locationActive = false;

// 지도 초기화 (카카오맵 생성 + 마커 로드)
async function initMap() {
    workStatus = loadStatusLocal();
    const container = document.getElementById('map');

    // 마지막 지도 위치/줌 레벨 복원
    const saved = (() => { try { return JSON.parse(localStorage.getItem('ami_map_view')); } catch { return null; } })();
    const options = {
        center: new kakao.maps.LatLng(saved ? saved.lat : 37.525, saved ? saved.lng : 126.960),
        level: saved ? saved.level : 4
    };
    map = new kakao.maps.Map(container, options);

    // 지도 이동/줌 변경 시 현재 뷰 저장
    kakao.maps.event.addListener(map, 'idle', () => {
        const c = map.getCenter();
        localStorage.setItem('ami_map_view', JSON.stringify({ lat: c.getLat(), lng: c.getLng(), level: map.getLevel() }));
    });

    // 로컬 JSON에서 현장 데이터 로드
    try {
        const res = await fetch('./data/site-data.json');
        sampleData = await res.json();
    } catch (e) {
        console.error('[siteData] 로드 실패:', e);
        sampleData = [];
    }
    console.log('[siteData] 로드 완료:', sampleData.length, '개');

    populateJisaOptions();
    loadMarkers();
    await initFirebase();
    markers.forEach(m => updateMarkerColor(m.address));
}

// 지사 드롭다운 옵션 채우기 (데이터의 unique 지사 + localStorage 복원)
function populateJisaOptions() {
    const select = document.getElementById('jisa-select');
    if (!select) return;
    const jisaSet = new Set();
    sampleData.forEach(item => { if (item.지사) jisaSet.add(item.지사); });
    const sorted = [...jisaSet].sort((a, b) => a.localeCompare(b, 'ko'));
    sorted.forEach(j => {
        const opt = document.createElement('option');
        opt.value = j;
        opt.textContent = j;
        select.appendChild(opt);
    });
    const saved = localStorage.getItem('ami_selected_jisa') || '';
    if (saved && sorted.includes(saved)) select.value = saved;
}

// 지사 선택 변경 시 마커 재생성
function onJisaChange() {
    const select = document.getElementById('jisa-select');
    const value = select ? select.value : '';
    localStorage.setItem('ami_selected_jisa', value);
    markers.forEach(m => m.overlay.setMap(null));
    markers = [];
    loadMarkers();
    refreshAllMarkers();
}

// 전체 마커 생성 (주소 기준으로 계기 그룹핑) — 선택된 지사로 필터링
function loadMarkers() {
    const selectedJisa = localStorage.getItem('ami_selected_jisa') || '';
    const grouped = {};
    sampleData.forEach(item => {
        if (selectedJisa && item.지사 !== selectedJisa) return;
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

// 단일 마커 생성 및 지도에 추가
function createMarker(position, address, meters) {
    const status = workStatus[address] || { state: 'pending', checkedMeters: [], reason: '' };
    const meterCount = meters.length;

    const isApproximate = meters.some(m => m.좌표정확도 === 'approximate');
    let color = isApproximate ? 'yellow' : 'green';
    if (status.state === 'complete') color = 'gray';
    else if (status.state === 'hold') color = 'blue';
    else if (status.state === 'fail') color = 'red';
    const markerLabel = (isApproximate && status.state === 'pending') ? '?' : meterCount;

    const markerContent = `
        <div class="custom-marker ${color}">
            <svg viewBox="0 0 20 26" xmlns="http://www.w3.org/2000/svg">
                <path class="pin-body" d="M10 0C4.48 0 0 4.48 0 10c0 6.72 10 16 10 16s10-9.28 10-16C20 4.48 15.52 0 10 0z"/>
                <circle class="pin-circle" cx="10" cy="10" r="5.5" fill="white"/>
            </svg>
            <div class="marker-number">${markerLabel}</div>
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

// 마커 색상 갱신 (상태 변경 시 호출)
function updateMarkerColor(address) {
    const marker = markers.find(m => m.address === address);
    if (!marker) return;

    const status = workStatus[address] || { state: 'pending' };
    const isApproximate = marker.meters.some(m => m.좌표정확도 === 'approximate');

    let color = isApproximate ? 'yellow' : 'green';
    if (status.state === 'complete') color = 'gray';
    else if (status.state === 'hold') color = 'blue';
    else if (status.state === 'fail') color = 'red';

    const el = marker.element.querySelector('.custom-marker');
    if (el) el.className = `custom-marker ${color}`;

    const labelEl = marker.element.querySelector('.marker-number');
    if (labelEl) labelEl.textContent = (isApproximate && status.state === 'pending') ? '?' : marker.meters.length;
}

// 전체 마커 색상 일괄 갱신 (Firebase 동기화 후 호출)
function refreshAllMarkers() {
    markers.forEach(m => updateMarkerColor(m.address));
}

// 현재 위치 추적 토글
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
