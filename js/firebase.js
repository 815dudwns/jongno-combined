// firebase.js — 상태 관리 (localStorage + Firebase Realtime Database 동기화)
// Firebase SDK: firebase-app-compat, firebase-database-compat (map.html에서 로드)

// 전역 상태 변수
let workStatus = {};

// Firebase DB 참조
let db = null;
let statusRef = null;

// ── 키 인코딩/디코딩 ─────────────────────────────────────────
// Firebase 키 금지 문자: . # $ [ ] /
function encodeKey(str) {
    return str
        .replace(/\./g,  '_dot_')
        .replace(/#/g,   '_hash_')
        .replace(/\$/g,  '_dollar_')
        .replace(/\[/g,  '_lb_')
        .replace(/\]/g,  '_rb_')
        .replace(/\//g,  '_sl_');
}

function decodeKey(str) {
    return str
        .replace(/_dot_/g,    '.')
        .replace(/_hash_/g,   '#')
        .replace(/_dollar_/g, '$')
        .replace(/_lb_/g,     '[')
        .replace(/_rb_/g,     ']')
        .replace(/_sl_/g,     '/');
}

// ── 이벤트 큐 ─────────────────────────────────────────────────
function loadEventQueue() {
    const saved = localStorage.getItem(EVENTS_KEY);
    return saved ? JSON.parse(saved) : [];
}

function saveEventQueue(queue) {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(queue));
}

function addEvent(ev) {
    const queue = loadEventQueue();
    queue.push({ ...ev, id: Date.now().toString(36) + Math.random().toString(36).slice(2) });
    saveEventQueue(queue);
}

// 큐를 Firebase에 전송 (이벤트별 update, set 안 씀)
async function flushEventQueue() {
    if (!statusRef) return;
    const queue = loadEventQueue();
    if (!queue.length) return;

    // 같은 대상의 중복 이벤트는 ts 최신 것만 유지
    const stateMap = {};   // address → latest state event
    const checkMap = {};   // address+'||'+meter → latest check event

    queue.forEach(ev => {
        if (ev.type === 'state' || ev.type === 'reset') {
            if (!stateMap[ev.address] || ev.ts > stateMap[ev.address].ts)
                stateMap[ev.address] = ev;
        } else if (ev.type === 'check' || ev.type === 'uncheck') {
            const key = ev.address + '||' + ev.meter;
            if (!checkMap[key] || ev.ts > checkMap[key].ts)
                checkMap[key] = ev;
        }
    });

    // Firebase multi-path update 객체 생성
    const updates = {};

    Object.values(stateMap).forEach(ev => {
        const p = encodeKey(ev.address);
        updates[`${p}/state`]         = ev.state;
        updates[`${p}/reason`]        = ev.reason || '';
        updates[`${p}/updatedAt`]     = new Date(ev.ts).toISOString();
        updates[`${p}/updatedBy`]     = ev.updatedBy || '';
        updates[`${p}/updatedByName`] = ev.updatedByName || '';
        // 역할별 완료 플래그 Firebase 업데이트
        if (ev.role === 'meter') {
            updates[`${p}/meter_done`] = (ev.state === 'complete');
        } else if (ev.role === 'comm') {
            updates[`${p}/comm_done`] = (ev.state === 'complete');
        } else if (ev.role === 'both') {
            updates[`${p}/meter_done`] = true;
            updates[`${p}/comm_done`]  = true;
        }
    });

    Object.values(checkMap).forEach(ev => {
        const p = encodeKey(ev.address);
        const m = encodeKey(ev.meter);
        updates[`${p}/meterChecks/${m}`] = { checked: ev.type === 'check', ts: ev.ts };
    });

    try {
        await statusRef.update(updates);
        saveEventQueue([]);
        console.log('[Queue] 이벤트 전송 완료, 건수:', queue.length);
    } catch (e) {
        console.warn('[Queue] 이벤트 전송 실패, 큐 유지:', e.message);
    }
}

// ── Firebase 초기화 및 DB 연결 ─────────────────────────────────
function initFirebaseApp() {
    try {
        const app = firebase.apps.length
            ? firebase.app()
            : firebase.initializeApp(firebaseConfig);
        db = firebase.database(app);
        statusRef = db.ref('workStatus/jongno');
        console.log('[Firebase] 초기화 완료');
        return true;
    } catch (e) {
        console.warn('[Firebase] 초기화 실패:', e.message);
        return false;
    }
}

// ── localStorage 접근 ─────────────────────────────────────────
function loadStatusLocal() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
}

// saveStatus — failedMeters 전용 로컬 저장 (Firebase 미전송)
// 주의: state/checkedMeters 변경은 saveStateEvent/saveCheckEvent 사용
function saveStatus(status) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
}

function loadCheckedLocal() {
    const saved = localStorage.getItem(CHECKED_KEY);
    return saved ? JSON.parse(saved) : {};
}

function saveCheckedLocal(checkedMap) {
    localStorage.setItem(CHECKED_KEY, JSON.stringify(checkedMap));
}

function applyLocalChecked() {
    const checked = loadCheckedLocal();
    Object.keys(checked).forEach(addr => {
        if (workStatus[addr]) {
            workStatus[addr].checkedMeters = checked[addr];
        }
    });
}

// ── 이벤트 기반 상태 변경 함수 ────────────────────────────────

// 상태 변경 (완료/보류/불가/초기화)
// role: 'admin' | 'meter' | 'comm' | '' — 역할별 완료 플래그(meter_done/comm_done) 갱신에 사용
function saveStateEvent(address, state, reason, updatedBy, updatedByName, role) {
    if (!workStatus[address]) {
        workStatus[address] = {
            state: 'pending', checkedMeters: [], reason: '',
            meter_done: false, comm_done: false
        };
    }
    workStatus[address].state         = state;
    workStatus[address].reason        = reason || '';
    workStatus[address].updatedAt     = new Date().toISOString();
    workStatus[address].updatedBy     = updatedBy || '';
    workStatus[address].updatedByName = updatedByName || '';
    // 역할별 완료 플래그 갱신
    if (role === 'meter') {
        workStatus[address].meter_done = (state === 'complete');
    } else if (role === 'comm') {
        workStatus[address].comm_done = (state === 'complete');
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));

    addEvent({
        address,
        type: state === 'pending' ? 'reset' : 'state',
        state,
        reason,
        updatedBy,
        updatedByName,
        role,
        ts: Date.now(),
    });
}

// 통신팀이 계기팀 미완료 상태에서 완료 누른 경우 — 양쪽 다 완료 처리
function saveBothCompleteEvent(address, updatedBy, updatedByName) {
    if (!workStatus[address]) {
        workStatus[address] = {
            state: 'pending', checkedMeters: [], reason: '',
            meter_done: false, comm_done: false
        };
    }
    workStatus[address].state         = 'complete';
    workStatus[address].reason        = '';
    workStatus[address].updatedAt     = new Date().toISOString();
    workStatus[address].updatedBy     = updatedBy || '';
    workStatus[address].updatedByName = updatedByName || '';
    workStatus[address].meter_done    = true;
    workStatus[address].comm_done     = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));

    addEvent({
        address,
        type: 'state',
        state: 'complete',
        reason: '',
        updatedBy,
        updatedByName,
        role: 'both',          // ← 양쪽 다 갱신 표시
        ts: Date.now(),
    });
}

// 체크 토글
function saveCheckEvent(address, meter, checked) {
    if (!workStatus[address]) {
        workStatus[address] = { state: 'pending', checkedMeters: [], reason: '' };
    }
    const cm = workStatus[address].checkedMeters || [];
    const idx = cm.indexOf(meter);
    if (checked && idx === -1) cm.push(meter);
    if (!checked && idx > -1) cm.splice(idx, 1);
    workStatus[address].checkedMeters = cm;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));

    addEvent({
        address,
        type: checked ? 'check' : 'uncheck',
        meter,
        ts: Date.now(),
    });

    // 체크 별도 localStorage 갱신
    const allChecked = {};
    Object.keys(workStatus).forEach(addr => {
        if (workStatus[addr]?.checkedMeters?.length) allChecked[addr] = workStatus[addr].checkedMeters;
    });
    saveCheckedLocal(allChecked);
}

// ── Firebase 데이터 → 내부 형식 변환 ─────────────────────────

function buildWorkStatusFromFirebase(data) {
    const result = {};
    Object.entries(data).forEach(([encodedAddr, val]) => {
        const addr = decodeKey(encodedAddr);
        const meterChecks = val.meterChecks || {};
        let checkedMeters;

        // 기존 배열 형태도 지원 (하위호환)
        if (Array.isArray(val.checkedMeters)) {
            checkedMeters = val.checkedMeters;
        } else {
            checkedMeters = Object.entries(meterChecks)
                .filter(([, v]) => v.checked)
                .map(([encodedMeter]) => decodeKey(encodedMeter));
        }

        result[addr] = {
            state:         val.state         || 'pending',
            reason:        val.reason        || '',
            updatedAt:     val.updatedAt     || '',
            updatedBy:     val.updatedBy     || '',
            updatedByName: val.updatedByName || '',
            checkedMeters,
            meterChecks,        // 원본 보관 (ts 비교용)
            meter_done:    val.meter_done === true,
            comm_done:     val.comm_done  === true,
        };
    });
    return result;
}

// Firebase 데이터와 로컬 데이터를 updatedAt 기준으로 병합 (더 최신 쪽 유지)
function mergeFirebaseData(firebaseData) {
    const converted = buildWorkStatusFromFirebase(firebaseData);

    Object.keys(converted).forEach(addr => {
        const fb    = converted[addr];
        const local = workStatus[addr];
        if (!local) {
            workStatus[addr] = fb;
            return;
        }
        const fbTime    = fb.updatedAt    ? new Date(fb.updatedAt).getTime()    : 0;
        const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
        if (fbTime > localTime) {
            // Firebase가 더 최신 — 단, 로컬 전용 필드(failedMeters)는 유지
            workStatus[addr] = { ...fb, failedMeters: local.failedMeters || {} };
        }
    });

    applyLocalChecked();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));
}

// Firebase에서 workStatus 읽기
async function syncFromFirebase() {
    if (!statusRef) return;
    try {
        const snapshot = await statusRef.get();
        if (snapshot.exists()) {
            const data = snapshot.val();
            mergeFirebaseData(data);
            console.log('[Firebase] syncFromFirebase 완료, 주소수:', Object.keys(workStatus).length);
        } else {
            console.log('[Firebase] 데이터 없음 — 로컬 상태 유지');
        }
    } catch (e) {
        console.warn('[Firebase] syncFromFirebase 실패:', e.message);
    }
}

// ── 초기 로드 + 주기 동기화 ───────────────────────────────────
async function initFirebase() {
    console.log('[Firebase] initFirebase 시작');

    const firebaseOk = initFirebaseApp();

    // 1순위: localStorage
    const local = loadStatusLocal();
    if (local && Object.keys(local).length > 0) {
        workStatus = local;
        console.log('[Local] localStorage에서 로드 완료, 주소수:', Object.keys(workStatus).length);
    } else {
        // 2순위: data/jongno-work-status.json
        try {
            const res = await fetch('./data/jongno-work-status.json');
            if (!res.ok) throw new Error('fetch 실패: ' + res.status);
            const data = await res.json();
            workStatus = data;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            console.log('[Local] data/work-status.json 로드 완료, 주소수:', Object.keys(workStatus).length);
        } catch (e) {
            console.warn('[Local] work-status.json 로드 실패:', e.message);
            workStatus = {};
        }
    }

    if (firebaseOk) {
        // 미전송 이벤트 큐 먼저 전송
        await flushEventQueue();

        await syncFromFirebase();
        applyLocalChecked();

        // 실시간 리스너 — Firebase 변경 즉시 반영 (30초 polling 대신)
        statusRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                mergeFirebaseData(data);
                if (typeof refreshAllMarkers === 'function') refreshAllMarkers();
            }
        });

        // 10초 간격 큐 재시도 (오프라인 → 온라인 복귀 시 미전송 이벤트 처리)
        setInterval(async () => {
            await flushEventQueue();
        }, 10000);

        // 창/탭이 다시 활성화될 때 미전송 큐 플러시
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible') {
                await flushEventQueue();
            }
        });
    }
}
