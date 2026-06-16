// firebase.js — 상태 관리 (localStorage + Firebase Realtime Database 동기화)
// Firebase SDK: firebase-app-compat, firebase-database-compat (map.html에서 로드)

// 전역 상태 변수
let workStatus = {};

// Firebase DB 참조
let db = null;
let statusRef = null;
let settingsRef = null;   // 앱 설정 (admin이 변경, 모두에게 동기화)

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

// ── 빈 엔트리 생성 ────────────────────────────────────────────
function makeEmptyEntry() {
    return {
        meter_state:         'pending',
        meter_reason:        '',
        meter_updatedAt:     '',
        meter_updatedBy:     '',
        meter_updatedByName: '',
        comm_state:          'pending',
        comm_reason:         '',
        comm_updatedAt:      '',
        comm_updatedBy:      '',
        comm_updatedByName:  '',
        checkedMeters: [],
        meterChecks:   {},
        failedMeters:  {},
    };
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

    // 같은 대상(address+role)의 중복 이벤트는 ts 최신 것만 유지
    // 키: address+'||'+role  — 양 팀이 같은 주소에 동시에 완료해도 각자 보존
    const stateMap = {};
    const checkMap = {};   // address+'||'+meter → latest check event

    queue.forEach(ev => {
        if (ev.type === 'state' || ev.type === 'reset') {
            const key = ev.address + '||' + (ev.role || 'meter');
            if (!stateMap[key] || ev.ts > stateMap[key].ts)
                stateMap[key] = ev;
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
        const ts = new Date(ev.ts).toISOString();
        if (ev.role === 'both') {
            ['meter', 'comm'].forEach(prefix => {
                updates[`${p}/${prefix}_state`]         = ev.state;
                updates[`${p}/${prefix}_reason`]        = '';
                updates[`${p}/${prefix}_updatedAt`]     = ts;
                updates[`${p}/${prefix}_updatedBy`]     = ev.updatedBy || '';
                updates[`${p}/${prefix}_updatedByName`] = ev.updatedByName || '';
            });
            // 강제 완료 플래그 — complete 시 true, reset 시 false
            updates[`${p}/meter_forced_by_comm`] = (ev.state === 'complete');
        } else {
            const prefix = (ev.role === 'comm') ? 'comm' : 'meter';
            updates[`${p}/${prefix}_state`]         = ev.state;
            updates[`${p}/${prefix}_reason`]        = ev.reason || '';
            updates[`${p}/${prefix}_updatedAt`]     = ts;
            updates[`${p}/${prefix}_updatedBy`]     = ev.updatedBy || '';
            updates[`${p}/${prefix}_updatedByName`] = ev.updatedByName || '';
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
        settingsRef = db.ref('appSettings/jongno');
        console.log('[Firebase] 초기화 완료');
        return true;
    } catch (e) {
        console.warn('[Firebase] 초기화 실패:', e.message);
        return false;
    }
}

// ── 앱 설정 동기화 (admin이 markerMode 변경 → 모든 사용자 적용) ─────
function saveMarkerModeRemote(mode) {
    if (!settingsRef) return;
    settingsRef.child('markerMode').set(mode)
        .catch(e => console.warn('[Settings] markerMode 저장 실패:', e.message));
}

function subscribeMarkerMode(callback) {
    if (!settingsRef) return;
    settingsRef.child('markerMode').on('value', (snap) => {
        const val = snap.val();
        if (val) callback(val);
    });
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
// role: 'admin' | 'meter' | 'comm' | '' — prefix(meter_/comm_) 결정에 사용
// admin은 getEffectiveRole()로 이미 결정된 값으로 들어옴
function saveStateEvent(address, state, reason, updatedBy, updatedByName, role) {
    if (!workStatus[address]) workStatus[address] = makeEmptyEntry();
    const now = isoKst();
    const prefix = (role === 'comm') ? 'comm' : 'meter';
    workStatus[address][`${prefix}_state`]         = state;
    workStatus[address][`${prefix}_reason`]        = reason || '';
    workStatus[address][`${prefix}_updatedAt`]     = now;
    workStatus[address][`${prefix}_updatedBy`]     = updatedBy || '';
    workStatus[address][`${prefix}_updatedByName`] = updatedByName || '';
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
// meter_forced_by_comm=true 플래그를 박아서, 나중에 통신팀이 초기화할 때 원본 복구 가능하게
function saveBothCompleteEvent(address, updatedBy, updatedByName) {
    if (!workStatus[address]) workStatus[address] = makeEmptyEntry();
    const now = isoKst();
    workStatus[address].meter_state         = 'complete';
    workStatus[address].meter_reason        = '';
    workStatus[address].meter_updatedAt     = now;
    workStatus[address].meter_updatedBy     = updatedBy || '';
    workStatus[address].meter_updatedByName = updatedByName || '';
    workStatus[address].comm_state          = 'complete';
    workStatus[address].comm_reason         = '';
    workStatus[address].comm_updatedAt      = now;
    workStatus[address].comm_updatedBy      = updatedBy || '';
    workStatus[address].comm_updatedByName  = updatedByName || '';
    workStatus[address].meter_forced_by_comm = true;
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

// 통신팀이 강제 완료(saveBothCompleteEvent로 박힌 것)를 초기화 — 양쪽 다 pending + 플래그 제거
function saveResetBothEvent(address, updatedBy, updatedByName) {
    if (!workStatus[address]) workStatus[address] = makeEmptyEntry();
    const now = isoKst();
    workStatus[address].meter_state         = 'pending';
    workStatus[address].meter_reason        = '';
    workStatus[address].meter_updatedAt     = now;
    workStatus[address].meter_updatedBy     = updatedBy || '';
    workStatus[address].meter_updatedByName = updatedByName || '';
    workStatus[address].comm_state          = 'pending';
    workStatus[address].comm_reason         = '';
    workStatus[address].comm_updatedAt      = now;
    workStatus[address].comm_updatedBy      = updatedBy || '';
    workStatus[address].comm_updatedByName  = updatedByName || '';
    workStatus[address].meter_forced_by_comm = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));

    addEvent({
        address,
        type: 'reset',
        state: 'pending',
        reason: '',
        updatedBy,
        updatedByName,
        role: 'both',
        ts: Date.now(),
    });
}

// 체크 토글
function saveCheckEvent(address, meter, checked) {
    if (!workStatus[address]) workStatus[address] = makeEmptyEntry();
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

        // 구형 Firebase 데이터 폴백: meter_state/comm_state 없으면 state+meter_done/comm_done으로 추론
        const meterState = val.meter_state
            || (val.meter_done === true ? 'complete' : (val.state || 'pending'));
        const commState  = val.comm_state
            || (val.comm_done  === true ? 'complete' : 'pending');

        result[addr] = {
            meter_state:         meterState,
            meter_reason:        val.meter_reason        || (val.reason || ''),
            meter_updatedAt:     val.meter_updatedAt     || (val.updatedAt || ''),
            meter_updatedBy:     val.meter_updatedBy     || (val.updatedBy || ''),
            meter_updatedByName: val.meter_updatedByName || (val.updatedByName || ''),
            comm_state:          commState,
            comm_reason:         val.comm_reason         || '',
            comm_updatedAt:      val.comm_updatedAt      || '',
            comm_updatedBy:      val.comm_updatedBy      || '',
            comm_updatedByName:  val.comm_updatedByName  || '',
            checkedMeters,
            meterChecks,
            failedMeters:       val.failedMeters || {},
            meter_forced_by_comm: val.meter_forced_by_comm === true,
            // 계기 단위 작업 데이터 — 코덱스 #5 fix: 변환 결과에 포함되어야 sync됨
            replacement_list:    val.replacement_list    || {},
            added_meters:        val.added_meters        || {},
            comm_completed_list: val.comm_completed_list || {},
        };
    });
    return result;
}

// ── 단건 병합 헬퍼 — handleChildUpsert/mergeFirebaseData 공용 ────────
// fb: buildWorkStatusFromFirebase 결과의 단일 항목(addr 키 변환 완료)
// pendingWriteAddrs: 큐 미전송 주소 Set (주소 보호)
function mergeAddrInto(addr, fb, pendingWriteAddrs) {
    const local = workStatus[addr];
    if (!local) {
        workStatus[addr] = fb;
        return;
    }

    // 주소상태 = Firebase 권위 (timestamp 게이트 제거)
    // stale local(complete)이 fresh DB(pending)를 덮어 회색 잔존하던 근본 버그 차단.
    // 단, 큐 미전송 작업자 입력 주소는 로컬 상태 유지(전송 후 일치).
    if (!pendingWriteAddrs.has(addr)) {
        local.meter_state         = fb.meter_state;
        local.meter_reason        = fb.meter_reason;
        local.meter_updatedAt     = fb.meter_updatedAt;
        local.meter_updatedBy     = fb.meter_updatedBy;
        local.meter_updatedByName = fb.meter_updatedByName;
        local.comm_state          = fb.comm_state;
        local.comm_reason         = fb.comm_reason;
        local.comm_updatedAt      = fb.comm_updatedAt;
        local.comm_updatedBy      = fb.comm_updatedBy;
        local.comm_updatedByName  = fb.comm_updatedByName;
    }

    // checkedMeters/meterChecks — Firebase 쪽이 있으면 덮어쓰기 (체크는 공유)
    if (fb.checkedMeters.length > 0 || Object.keys(fb.meterChecks).length > 0) {
        local.checkedMeters = fb.checkedMeters;
        local.meterChecks   = fb.meterChecks;
    }

    // 계기 단위 데이터 — Firebase = source of truth
    local.replacement_list    = fb.replacement_list    || {};
    local.added_meters        = fb.added_meters        || {};
    local.comm_completed_list = fb.comm_completed_list || {};

    // failedMeters — 로컬 전용 필드 유지
    // meter_forced_by_comm 은 Firebase 권위 값을 사용하지 않음(mergeFirebaseData 기존 동작 유지)
    local.failedMeters = local.failedMeters || fb.failedMeters || {};
}

// Firebase 데이터와 로컬 데이터를 각 팀 prefix 별로 updatedAt 비교하여 병합
// meter_*/comm_* 각각 독립 비교: 둘 중 더 최신 쪽 유지
function mergeFirebaseData(firebaseData) {
    const converted = buildWorkStatusFromFirebase(firebaseData);
    // 작업자 입력이 아직 큐에 남아 Firebase 미전송인 주소 — DB 덮어쓰기 예외
    // (전송 완료되면 Firebase 에코로 자연히 일치. 그 전엔 로컬 입력 보호 — 깜빡임/revert 방지)
    const pendingWriteAddrs = new Set(loadEventQueue()
        .filter(e => e.type === 'state' || e.type === 'reset')
        .map(e => e.address));

    Object.keys(converted).forEach(addr => {
        mergeAddrInto(addr, converted[addr], pendingWriteAddrs);
    });

    // applyLocalChecked 제거 (코덱스 #2: Firebase가 source of truth, local check 덮어쓰기 금지)
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

    // === Firebase = source of truth, localStorage = 마지막 DB 미러(폴백·즉시표시) ===
    // 미러로 우선 채움 → on('value') 첫 콜백 전에도 빈 상태 아님.
    const mirror = loadStatusLocal();
    workStatus = (mirror && Object.keys(mirror).length > 0) ? mirror : {};

    if (!firebaseOk) {
        if (Object.keys(workStatus).length === 0) applyLocalChecked();
        console.log('[Mirror] Firebase 미연결 — 미러/로컬 기준 시작, 주소수:', Object.keys(workStatus).length);
        return;
    }

    await flushEventQueue();

    // ★ 초기 1회 다운로드 = on('value') 첫 콜백으로 통일.
    //   기존 get()+on() = 같은 노드 전체 2회 다운로드(3MB×2). on() 1회로 절감.
    //   mergeFirebaseData는 빈 workStatus엔 전체구성처럼, 미러 위엔 보호병합(pendingWrite/failedMeters)으로 동작 →
    //   별도 get()+build 없이도 동일 정합. 첫 콜백을 init-완료 신호로 await(빈 렌더 방지).
    let _initialDone = false;
    let _resolveInitial;
    const initialPromise = new Promise(r => { _resolveInitial = r; });

    // ── 단건 갱신: child 이벤트용 기존 키 추적 ──────────────────
    // child_added는 부착 시 기존 키 전체를 replay하므로 isAdd=true & 이미 본 키는 버린다.
    let _seenKeys = new Set();

    // localStorage 미러 디바운스 저장 (child마다 전체 JSON.stringify 방지)
    let _mirrorTimer = null;
    function scheduleMirrorSave() {
        if (_mirrorTimer) clearTimeout(_mirrorTimer);
        _mirrorTimer = setTimeout(() => {
            _mirrorTimer = null;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));
        }, 400);
    }

    // child_added / child_changed 공용 처리
    function handleChildUpsert(snap, isAdd) {
        const encKey = snap.key;
        // child_added replay 홍수 방지: 초기 스냅샷에 있던 키는 이미 build로 반영됨
        if (isAdd && _seenKeys.has(encKey)) return;
        _seenKeys.add(encKey);

        const val = snap.val();
        if (!val) return;
        const addr = decodeKey(encKey);

        const pendingWriteAddrs = new Set(loadEventQueue()
            .filter(e => e.type === 'state' || e.type === 'reset')
            .map(e => e.address));

        // buildWorkStatusFromFirebase 재사용 — 단건도 동일 변환 로직 적용
        const converted = buildWorkStatusFromFirebase({ [encKey]: val });
        const fb = converted[addr];
        if (!fb) return;

        mergeAddrInto(addr, fb, pendingWriteAddrs);
        scheduleMirrorSave();

        // map.js 단건 갱신 (화면에 있으면 즉시 색갱신, 없으면 renderViewport가 다음 pan/zoom에 반영)
        if (typeof updateMarkerColor === 'function') updateMarkerColor(addr);
        if (typeof updateTopbarInfoIncremental === 'function') updateTopbarInfoIncremental(addr);
        if (typeof updateMeterLatestAddressIncremental === 'function') updateMeterLatestAddressIncremental(addr);
    }

    // child_removed 처리
    function handleChildRemoved(snap) {
        const encKey = snap.key;
        const addr = decodeKey(encKey);
        delete workStatus[addr];
        _seenKeys.delete(encKey);
        scheduleMirrorSave();

        // 마커 제거 후 캐시 전체 재계산 (감소는 증분으로 못 처리)
        if (typeof removeMarker === 'function') removeMarker(addr);
        if (typeof updateTopbarInfo === 'function') updateTopbarInfo();
        if (typeof updateMeterLatestAddress === 'function') updateMeterLatestAddress();
    }

    // named value 핸들러 — 초기 1회 후 off()로 해제
    const valueHandler = (snapshot) => {
        const data = snapshot.val();
        if (!_initialDone) {
            _initialDone = true;
            // ★ 초기 1회 = build(전체 교체) — 원본 get()→build와 동일 정합:
            //   workStatus = 정확히 FB 주소집합. 미러에만 있고 FB에서 삭제된 stale 주소 제거(self-heal 유지).
            //   pendingWrite 손실 없음: flushEventQueue가 리스너 부착 전 await됨(미전송분은 스냅샷에 포함).
            if (data) {
                workStatus = buildWorkStatusFromFirebase(data);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));
                // _seenKeys: child_added replay 가드용 — 초기 snapshot 키 전부 기록
                _seenKeys = new Set(Object.keys(data));
            }
            console.log('[Firebase] 초기 로드 완료(on 첫 콜백), 주소수:', Object.keys(workStatus).length);

            // value 리스너 해제 → child 3개로 교체 (이후 전체 발화 제거)
            statusRef.off('value', valueHandler);
            statusRef.on('child_added',   s => handleChildUpsert(s, true));
            statusRef.on('child_changed', s => handleChildUpsert(s, false));
            statusRef.on('child_removed', s => handleChildRemoved(s));

            _resolveInitial();   // 첫 렌더는 initMap()이 await 후 renderViewport로 수행
        }
        // else 분기 제거: child 리스너가 이후 변경을 담당 (이 핸들러는 첫 콜백 후 off됨)
    };

    statusRef.on('value', valueHandler);

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

    // 첫 데이터(또는 8초 타임아웃) 대기 — initMap()의 await initFirebase()가 데이터 보장(빈 렌더 방지)
    await Promise.race([initialPromise, new Promise(r => setTimeout(r, 8000))]);
    if (!_initialDone && Object.keys(workStatus).length === 0) {
        // Firebase 첫 응답 지연 + 미러 없음 — 로컬 체크라도 반영 후 시작(리스너 붙으면 곧 채워짐)
        applyLocalChecked();
        console.log('[Firebase] 첫 응답 지연 — 로컬 폴백으로 시작');
    }
}
