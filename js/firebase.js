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

// localStorage.setItem 안전 래퍼 — iOS 5MB quota 초과 시 throw를 삼켜 흐름이 안 끊기게.
//   (실패해도 Firebase가 권위라 무해. 상태변경 이벤트는 addEvent가 직접전송으로 보강.)
//   버그(영준님 2026-07-05): workStatus 미러(~5.9MB)가 iOS 한도 초과 → setItem throw로
//   불가(개별/전체)가 renderMetersList/addEvent/closeDetail 앞에서 죽던 문제 핫픽스.
function safeSetItem(key, val) {
    try { localStorage.setItem(key, val); return true; }
    catch (e) { console.warn('[quota] localStorage.setItem 실패:', key, e && e.name); return false; }
}

function saveEventQueue(queue) {
    return safeSetItem(EVENTS_KEY, JSON.stringify(queue));
}

function addEvent(ev) {
    const withId = { ...ev, id: Date.now().toString(36) + Math.random().toString(36).slice(2) };
    const queue = loadEventQueue();
    queue.push(withId);
    // 큐 저장 실패(quota) = 이벤트를 로컬에 못 담음 → Firebase로 직접 전송(큐 우회).
    //   Firebase가 권위라 이게 실제 저장. try/catch만으론 큐 쓰기가 같이 터져 전송이 유실됨.
    if (!saveEventQueue(queue)) {
        sendEventsDirect([withId]);
    }
}

// 이벤트 배열 → Firebase multi-path update 객체 (flushEventQueue·sendEventsDirect 공용 빌더)
function buildEventUpdates(events) {
    const stateMap = {};   // address||role → latest state/reset event
    const checkMap = {};   // address||meter → latest check event
    events.forEach(ev => {
        if (ev.type === 'state' || ev.type === 'reset') {
            const key = ev.address + '||' + (ev.role || 'meter');
            if (!stateMap[key] || ev.ts > stateMap[key].ts) stateMap[key] = ev;
        } else if (ev.type === 'check' || ev.type === 'uncheck') {
            const key = ev.address + '||' + ev.meter;
            if (!checkMap[key] || ev.ts > checkMap[key].ts) checkMap[key] = ev;
        }
    });
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
    return updates;
}

// 큐 우회 직접전송 — localStorage quota로 큐 저장이 실패했을 때만 호출. Firebase가 권위라 안전.
function sendEventsDirect(events) {
    if (!statusRef) { console.warn('[Queue] 직접전송 스킵 — statusRef 없음'); return; }
    try {
        const updates = buildEventUpdates(events);
        statusRef.update(updates)
            .then(() => console.log('[Queue] quota 우회 직접전송 완료:', events.length))
            .catch(e => console.warn('[Queue] 직접전송 실패:', e && e.message));
    } catch (e) {
        console.warn('[Queue] 직접전송 빌드 실패:', e && e.message);
    }
}

// 큐를 Firebase에 전송 (이벤트별 update, set 안 씀)
async function flushEventQueue() {
    if (!statusRef) return;
    const queue = loadEventQueue();
    if (!queue.length) return;

    // 같은 대상(address+role/meter)의 중복 이벤트는 ts 최신만 유지 → multi-path update 빌드(공용)
    const updates = buildEventUpdates(queue);

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
        statusRef = db.ref('workStatus/' + REGION.id);      // workStatus/jongno | workStatus/guro
        settingsRef = db.ref('appSettings/' + REGION.id);
        console.log('[Firebase] 초기화 완료 — 지역:', REGION.id);
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

// ── workStatus 미러 (IndexedDB) ───────────────────────────────
//   전환(영준님 2026-07-06): 미러를 localStorage(5MB 한도) → IndexedDB(수십MB 여유)로 이동.
//   이유: 종로 workStatus 전체(~5.9MB)가 iOS localStorage 한도를 넘겨 setItem이 throw →
//         불가(개별/전체)가 죽던 근본원인. IDB는 한도 사실상 없음(1년치 성장도 OK, persist() 요청됨).
//   Firebase가 권위 · 미러는 오프라인/즉시표시용 · 데이터·통계·서버 무변경(클라 저장위치만 변경).
const MIRROR_IDB_KEY = 'workStatus-mirror';

// 부팅 미러 로드 — IDB에서 읽고, 옛 localStorage 미러(quota로 반쯤 쓰다 만 쓰레기)는 제거해 5MB 회수.
async function loadStatusMirror() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 무시 */ }
    try {
        if (typeof idbGet === 'function') {
            const v = await idbGet(MIRROR_IDB_KEY);
            if (v && typeof v === 'object') return v;
        }
    } catch (e) { console.warn('[Mirror] IDB 로드 실패:', e && e.message); }
    return {};
}

// 미러 저장 — IDB fire-and-forget(UI 안 막음). 실패해도 Firebase 권위라 무해.
function saveStatusMirror() {
    try {
        if (typeof idbSet === 'function') {
            idbSet(MIRROR_IDB_KEY, workStatus)
                .catch(e => console.warn('[Mirror] IDB 저장 실패:', e && e.message));
        }
    } catch (e) { console.warn('[Mirror] IDB 저장 예외:', e && e.message); }
}

// ── localStorage 접근 (하위호환 유지 — 현재 미러는 IDB) ─────────
function loadStatusLocal() {
    // 옛 동기 로더. 남은 호출부 방어용 — 실제 미러는 loadStatusMirror(IDB)가 담당.
    try { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved) : {}; }
    catch (e) { return {}; }
}

// saveStatus — 미러 저장 진입점(이제 IDB). 주의: state/checkedMeters 변경은 saveStateEvent/saveCheckEvent 사용
function saveStatus(status) {
    saveStatusMirror();
}

function loadCheckedLocal() {
    const saved = localStorage.getItem(CHECKED_KEY);
    return saved ? JSON.parse(saved) : {};
}

function saveCheckedLocal(checkedMap) {
    safeSetItem(CHECKED_KEY, JSON.stringify(checkedMap));
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
    saveStatusMirror();

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
    saveStatusMirror();

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
    saveStatusMirror();

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
    saveStatusMirror();

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
    saveStatusMirror();
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
// 저장이력(saveLog) 자동정리 — 오늘·어제만 보관, 그제 이하(다다음날 기준) 날짜노드 삭제.
//   날짜키가 "YYYY-MM-DD" ISO라 사전식 비교 = 시간순. 멱등(여러 기기/앱이 동시에 돌려도 무해).
async function pruneSaveLog() {
    try {
        if (typeof db === 'undefined' || !db) return;
        const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        const yesterday = fmt(new Date(Date.now() - 86400000));  // 어제까지 보관, 그 이전 삭제
        const ref = db.ref('saveLog/jongno');
        const snap = await ref.once('value');
        snap.forEach(ch => {
            if (ch.key < yesterday) ref.child(ch.key).remove().catch(() => {});
        });
    } catch (e) { console.warn('[pruneSaveLog]', e); }
}

async function initFirebase() {
    console.log('[Firebase] initFirebase 시작');

    const firebaseOk = initFirebaseApp();

    // === Firebase = source of truth, IDB = 마지막 DB 미러(폴백·즉시표시) ===
    // map.js가 이미 loadStatusMirror(IDB)로 workStatus를 채우고 즉시렌더함 →
    // 비어있을 때만(다른 진입/방어) IDB에서 재로드. on('value') 첫 콜백이 곧 FB 권위로 교체.
    if (!workStatus || Object.keys(workStatus).length === 0) {
        workStatus = await loadStatusMirror();
    }

    if (!firebaseOk) {
        if (Object.keys(workStatus).length === 0) applyLocalChecked();
        console.log('[Mirror] Firebase 미연결 — 미러/로컬 기준 시작, 주소수:', Object.keys(workStatus).length);
        return;
    }

    await flushEventQueue();

    pruneSaveLog();  // 저장이력 자동정리(백그라운드, 비차단)

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
            saveStatusMirror();
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
                saveStatusMirror();
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

    // ── 복귀 동기화(catch-up) ──
    // 다른 앱 갔다 옴 / 슬립·잠금 후 복귀 시 child 리스너가 freeze됐을 수 있음 →
    // 미전송 쓰기 먼저 보내고(flush) Firebase 현재 상태를 한 번 당겨와(once) 머지.
    // child 리스너는 떼지 않고 유지(replay 홍수 방지) — once는 일회성 보강.
    let _catchUpInFlight = false;
    async function catchUpFromFirebase() {
        if (_catchUpInFlight || !_initialDone) return;   // 초기 로드 전이면 value 핸들러가 담당
        _catchUpInFlight = true;
        try {
            await flushEventQueue();                       // 1) 미전송 쓰기 먼저 (resume 시 덮어쓰기 방지)
            const snap = await statusRef.once('value');     // 2) 현재 상태 1회 조회
            const data = snap.val();
            if (!data) return;
            const converted = buildWorkStatusFromFirebase(data);
            const pendingWriteAddrs = new Set(loadEventQueue()
                .filter(e => e.type === 'state' || e.type === 'reset')
                .map(e => e.address));
            for (const addr in converted) {                 // 3) Firebase 권위 머지(pendingWrite 보호)
                mergeAddrInto(addr, converted[addr], pendingWriteAddrs);
            }
            scheduleMirrorSave();
            if (typeof refreshAllMarkers === 'function') refreshAllMarkers();  // 4) 머지만으론 재색칠 안 됨
            console.log('[Firebase] 복귀 동기화 완료, 주소수', Object.keys(converted).length);
        } catch (e) {
            console.warn('[Firebase] 복귀 동기화 실패:', e);
        } finally {
            _catchUpInFlight = false;
        }
    }

    // 화면 복귀(visible)/bfcache 복귀(pageshow)/다른앱→복귀(focus) — in-flight 플래그로 중복 차단
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') catchUpFromFirebase();
    });
    window.addEventListener('pageshow', () => catchUpFromFirebase());
    window.addEventListener('focus', () => catchUpFromFirebase());

    // 첫 데이터(또는 8초 타임아웃) 대기 — initMap()의 await initFirebase()가 데이터 보장(빈 렌더 방지)
    await Promise.race([initialPromise, new Promise(r => setTimeout(r, 8000))]);
    if (!_initialDone && Object.keys(workStatus).length === 0) {
        // Firebase 첫 응답 지연 + 미러 없음 — 로컬 체크라도 반영 후 시작(리스너 붙으면 곧 채워짐)
        applyLocalChecked();
        console.log('[Firebase] 첫 응답 지연 — 로컬 폴백으로 시작');
    }
}
