// detail.js — 상세 패널(오버레이) 로직

let currentAddress = '';
let currentMeters = [];
// 통신팀 임시 선택 (코덱스 #3: 계기팀 checkedMeters와 분리)
// detail 패널 열려있는 동안만 유효. 페이지 새로고침 시 휘발.
const commTempChecked = new Set();

// 현재 정렬 모드: 'none' | 'dup' | 'maker'
let currentSortMode = 'none';

// 주소 클릭 시 상세 패널 표시
// admin viewToggle(계기팀/통신팀 보기) 전환 시 열린 디테일을 현재 역할로 재렌더
function rerenderDetailIfOpen() {
    const ov = document.getElementById('fullpage-overlay');
    if (ov && ov.classList.contains('active') && currentAddress && Array.isArray(currentMeters)) {
        showDetail(currentAddress, currentMeters);
    }
}
window.rerenderDetailIfOpen = rerenderDetailIfOpen;

function showDetail(address, meters) {
    currentAddress = address;
    currentMeters = meters;
    // 새 주소 진입 시 통신팀 임시 선택 초기화
    commTempChecked.clear();

    // 어드민 사진등록 버튼 — 통신팀 시각일 때만 표시 (admin이라도 계기팀 시각이면 숨김)
    const adminBtn = document.getElementById('admin-upload-btn');
    if (adminBtn) adminBtn.href = `admin.html?addr=${encodeURIComponent(address)}`;

    const session = authGetSession();
    const role = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : (session?.role || 'meter');
    const myPrefix = (role === 'comm') ? 'comm' : 'meter';

    // 계기팀에 중복정렬 버튼 숨김 (통신팀에서만 사용)
    const dupSortBtn = document.getElementById('sort-btn-dup');
    if (dupSortBtn) dupSortBtn.style.display = (role === 'comm') ? '' : 'none';

    // 계기팀 액션 = "불가 + 계기추가"만. 완료/보류 버튼 숨김.
    // (주소 상태는 계기 단위 작업으로 자동 계산됨)
    const isMeter = (role === 'meter');
    document.getElementById('btn-complete').style.display = isMeter ? 'none' : '';
    document.getElementById('btn-hold').style.display = isMeter ? 'none' : '';

    // 사진등록 버튼 — 통신팀 시각일 때만 (admin도 계기팀 시각이면 숨김)
    if (adminBtn) {
        const sessionAll = authGetSession();
        const isAdmin = sessionAll?.role === 'admin';
        const showUpload = isAdmin && (role === 'comm');
        adminBtn.style.display = showUpload ? '' : 'none';
    }

    // "+ 계기 추가" 버튼 — 계기팀/admin만 노출
    const addMeterBtn = document.getElementById('btn-add-meter');
    if (addMeterBtn) {
      const showAdd = (role === 'meter') || (role === 'admin');
      addMeterBtn.style.display = showAdd ? '' : 'none';
      addMeterBtn.onclick = () => (typeof RplModal !== 'undefined') && RplModal.open(address, null);
    }

    const status = workStatus[address] || makeEmptyEntry();
    status.checkedMeters = status.checkedMeters || [];

    const myState         = status[`${myPrefix}_state`]         || 'pending';
    const myReason        = status[`${myPrefix}_reason`]        || '';
    const myUpdatedByName = status[`${myPrefix}_updatedByName`] || '';
    const myUpdatedAt     = status[`${myPrefix}_updatedAt`]     || '';

    // 작은 SVG 복사 아이콘 (기존 meter copy-btn과 동일 스타일)
    const COPY_ICON_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const copyIconHtml = (id, title) =>
        `<button class="copy-btn" id="${id}" title="${title}" style="margin-left:6px;vertical-align:middle;">${COPY_ICON_SVG}</button>`;

    // 사용 가능한 값인지 — 더러운 패턴 차단:
    //   undefined / null / "undefined" / "null" / "undefined undefined" / "null undefined" 등
    const DIRTY_RE = /^\s*(undefined|null)(\s+(undefined|null))*\s*$/i;
    const isUsable = (s) => {
        if (s == null) return false;
        const t = String(s).trim();
        if (!t) return false;
        if (DIRTY_RE.test(t)) return false;
        return true;
    };
    const pick = (...vals) => vals.find(isUsable) || '';
    const jibunAddr = pick(meters[0] && meters[0].주소, address);
    const roadAddr  = pick(meters[0] && meters[0].도로명주소);

    // 헤더 = 도로명(있으면) 우선, 없으면 지번.
    // 화면에 보이는 텍스트를 data-copy에 그대로 넣어 — 계기번호 복사와 동일한 패턴
    const headerAddr = roadAddr || jibunAddr;
    const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    document.getElementById('detail-address').innerHTML =
        `<span>${esc(headerAddr)}</span>` +
        `<button class="copy-btn" data-copy="${esc(headerAddr)}" title="주소 복사" style="margin-left:6px;vertical-align:middle;">${COPY_ICON_SVG}</button>`;

    // 좌표정확도가 approximate인 계기가 하나라도 있으면 "주소 오류" 표시
    const hasApproximate = meters.some(m => m.좌표정확도 === 'approximate');
    const errorTag = hasApproximate
        ? ' <span style="color:var(--rose);font-size:12px;">(주소 오류)</span>'
        : '';

    // 도로명/지번 라인 — 헤더와 다를 때만 노출 (중복 표시 방지)
    let roadLine = '';
    if (roadAddr && roadAddr !== headerAddr) {
        roadLine = `<span>${esc(roadAddr)}</span>` +
            `<button class="copy-btn" data-copy="${esc(roadAddr)}" title="도로명 복사" style="margin-left:6px;vertical-align:middle;">${COPY_ICON_SVG}</button>` +
            errorTag;
    } else if (hasApproximate && roadAddr === headerAddr) {
        roadLine = errorTag;
    }
    let jibunLine = '';
    if (jibunAddr && jibunAddr !== headerAddr) {
        const br = roadLine ? '<br>' : '';
        jibunLine = `${br}<span style="color:var(--ink-3);">${esc(jibunAddr)}</span>` +
            `<button class="copy-btn" data-copy="${esc(jibunAddr)}" title="지번 복사" style="margin-left:6px;vertical-align:middle;">${COPY_ICON_SVG}</button>`;
    }
    document.getElementById('detail-road-address').innerHTML = roadLine + jibunLine;

    // 상태 색상 바 업데이트 (기능 3)
    updateStatusBar(myState);

    // 지도 앱 버튼 3개 — 도로명주소로 검색
    document.getElementById('tmap-btn').onclick = () => {
        window.location.href = `tmap://search?name=${encodeURIComponent(roadAddr)}`;
    };
    document.getElementById('naver-btn').onclick = () => {
        window.location.href = `nmap://search?query=${encodeURIComponent(roadAddr)}`;
    };
    document.getElementById('kakao-btn').onclick = () => {
        window.location.href = `kakaomap://search?q=${encodeURIComponent(roadAddr)}`;
    };

    // 주소 복사 핸들러 — copy-btn 클래스 + data-copy 속성으로 통일 (계기번호와 동일 패턴)
    document.querySelectorAll('#detail-address .copy-btn, #detail-road-address .copy-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const v = btn.dataset.copy;
            if (v) copyMeterNo(v);
        };
    });

    const btnComplete = document.getElementById('btn-complete');
    const btnHold = document.getElementById('btn-hold');
    const btnFail = document.getElementById('btn-fail');

    // 완료 상태면 초기화 버튼으로 전환 — myState(자기 팀 state) 기준
    // 통신팀 시각 = 체크된 활성 계기 일괄 완료 (comm_completed_list에 저장)
    const isCommRole = (role === 'comm');
    if (myState === 'complete') {
        btnComplete.textContent = '초기화';
        btnComplete.className = 'action-btn reset';
        btnComplete.onclick = () => resetStatus();
    } else if (isCommRole) {
        btnComplete.textContent = '완료';
        btnComplete.className = 'action-btn complete';
        btnComplete.onclick = () => bulkCommComplete(address);
    } else {
        btnComplete.textContent = '완료';
        btnComplete.className = 'action-btn complete';
        btnComplete.onclick = () => { updateStatus('complete'); closeDetail(); };
    }

    // 보류 상태면 초기화 버튼으로 전환
    if (myState === 'hold') {
        btnHold.textContent = '초기화';
        btnHold.className = 'action-btn reset';
        btnHold.onclick = () => resetStatus();
    } else {
        btnHold.textContent = '보류';
        btnHold.className = 'action-btn hold';
        btnHold.onclick = () => { updateStatus('hold'); closeDetail(); };
    }

    // 불가 상태면 초기화 버튼으로 전환
    if (myState === 'fail') {
        btnFail.textContent = '초기화';
        btnFail.className = 'action-btn reset';
        btnFail.onclick = () => resetStatus();
    } else {
        btnFail.textContent = '불가';
        btnFail.className = 'action-btn fail';
        btnFail.onclick = () => {
            const failInput = document.getElementById('fail-reason');
            const reason = failInput.value.trim();
            if (!reason) {
                failInput.style.boxShadow = 'var(--clay-inset), 0 0 0 2px var(--rose)';
                return;
            }
            failInput.style.boxShadow = '';
            updateStatus('fail');
            closeDetail();
        };
    }

    // 현재 상태에 맞는 버튼 활성화 — myState 기준
    [btnComplete, btnHold, btnFail].forEach(btn => btn.classList.remove('active'));
    if (myState === 'complete') btnComplete.classList.add('active');
    if (myState === 'hold')     btnHold.classList.add('active');
    if (myState === 'fail')     btnFail.classList.add('active');

    const failInput = document.getElementById('fail-reason');
    failInput.value = myReason;
    failInput.style.borderColor = '';
    failInput.oninput = (e) => {
        if (e.target.value.trim()) e.target.style.borderColor = '';
        // 입력 중: 로컬만 저장 (자기 팀 reason 필드)
        if (!workStatus[currentAddress]) {
            workStatus[currentAddress] = makeEmptyEntry();
        }
        const _session = authGetSession();
        const _role = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : (_session?.role || 'meter');
        const _prefix = (_role === 'comm') ? 'comm' : 'meter';
        workStatus[currentAddress][`${_prefix}_reason`] = e.target.value;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));
    };
    // blur/Enter 시 이벤트 큐에 추가
    const flushFailReason = () => {
        const _session = authGetSession();
        const _role = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : (_session?.role || 'meter');
        const _prefix = (_role === 'comm') ? 'comm' : 'meter';
        const curState = workStatus[currentAddress]?.[`${_prefix}_state`] || 'pending';
        if (curState !== 'pending') {
            saveStateEvent(
                currentAddress,
                curState,
                failInput.value.trim(),
                _session ? _session.id   : '',
                _session ? _session.name : '',
                _role
            );
        }
    };
    failInput.addEventListener('blur', flushFailReason);
    failInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { flushFailReason(); failInput.blur(); } });

    // 작업자 정보 표시 (기능 4) — 자기 팀 updatedByName/updatedAt
    console.log('[showDetail] myState:', myState, 'myUpdatedByName:', myUpdatedByName, 'myUpdatedAt:', myUpdatedAt);
    updateWorkerInfo({ state: myState, updatedByName: myUpdatedByName, updatedAt: myUpdatedAt });

    // 상단 강조 영역(#common-pole) — role 따라 다른 정보 강조 표시
    //   통신팀: 변대주 (계기 전체 같은 경우)
    //   계기팀: 순위·검침일 (첫 계기 기준)
    const allSamePole = meters.length > 0 && meters.every(m => m.변대주 === meters[0].변대주);
    const commonPoleEl = document.getElementById('common-pole');
    commonPoleEl.innerHTML = '';
    commonPoleEl.style.display = 'none';

    if (role === 'comm') {
        // 통신팀 — 변대주 강조 (모든 계기 같은 변대주일 때만)
        if (allSamePole && meters[0].변대주 && meters[0].변대주 !== '0') {
            const poleText = meters[0].변대주;
            const isDcuId = !!meters[0].DCUID;
            const poleMain = isDcuId ? poleText.slice(0, -2) : poleText;
            const poleHtml = isDcuId
                ? `<span>${poleMain}</span><span class="seg-dup">${poleText.slice(-2)}</span>`
                : `<span>${poleText}</span>`;
            const labelHtml = meters[0].변대주라벨 ? ` <span style="opacity:0.7;font-weight:normal;">(${meters[0].변대주라벨})</span>` : '';
            const poleCopyBtn = `<button class="copy-btn pole-copy-btn" data-copy="${poleMain}" title="변대주 복사" style="margin-left:6px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
            commonPoleEl.innerHTML = `변대주 ${poleHtml}${labelHtml}${poleCopyBtn}`;
            commonPoleEl.style.display = 'block';
            commonPoleEl.querySelector('.pole-copy-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                copyMeterNo(poleMain);
            });
        }
    } else {
        // 계기팀 / admin-meter — 순위 + 검침일 강조 (계기마다 다를 수 있으니 모두 같은 값일 때만 공통 표시)
        const allSamePri = meters.every(m => m.순위 === meters[0].순위);
        const allSameDay = meters.every(m => m.검침일 === meters[0].검침일);
        const parts = [];
        if (allSamePri && meters[0].순위) parts.push(meters[0].순위);
        if (allSameDay && meters[0].검침일) {
            const phaseCount = { 단상: 0, 삼상: 0 };
            for (const m of meters) {
                const ph = phaseOf(m.계기번호);
                if (ph) phaseCount[ph]++;
            }
            const phaseLabel = [];
            if (phaseCount.단상 > 0) phaseLabel.push(`단상 ${phaseCount.단상}`);
            if (phaseCount.삼상 > 0) phaseLabel.push(`삼상 ${phaseCount.삼상}`);
            const phaseSuffix = phaseLabel.length ? ' · ' + phaseLabel.join(' · ') : '';
            parts.push(`검침일 ${meters[0].검침일}${phaseSuffix}`);
        }
        if (parts.length) {
            commonPoleEl.textContent = parts.join(' · ');
            commonPoleEl.style.display = 'block';
        }
    }

    // 패널 열릴 때 검색창 초기화
    const searchEl = document.getElementById('meter-search');
    if (searchEl) { searchEl.value = ''; }

    // 패널 열릴 때 정렬 상태 초기화 + 버튼 UI 동기화
    currentSortMode = 'none';
    updateSortBtnUI();

    // 계기 목록 렌더링
    renderMetersList();

    document.getElementById('fullpage-overlay').classList.add('active');
}

// 상태 색상 바 업데이트 (기능 3)
function updateStatusBar(state) {
    const bar = document.getElementById('status-bar');
    if (!bar) return;

    // 상태 띠 색 — 클레이 상태 토큰 사용 (액션 버튼 색과 일치). 완료=민트 진한톤, 보류=블루, 불가=로즈
    const colorMap = {
        complete: 'var(--mint-ink)',
        hold:     'var(--blue)',
        fail:     'var(--rose)',
    };

    if (state === 'pending' || !colorMap[state]) {
        bar.style.background = 'transparent';
    } else {
        bar.style.background = colorMap[state];
    }
}

// 작업자 정보 표시 업데이트 (기능 4)
function updateWorkerInfo(status) {
    const workerEl = document.getElementById('worker-info');
    if (!workerEl) return;

    // pending이거나 작업자 정보 없으면 숨김
    if (
        status.state === 'pending' ||
        !status.updatedByName ||
        !status.updatedAt
    ) {
        workerEl.style.display = 'none';
        workerEl.textContent = '';
        return;
    }

    // updatedAt을 "M월 D일" 형식으로 변환 (KST 기준)
    let dateStr = '';
    try {
        const d = new Date(status.updatedAt);
        const parts = new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul',
            month: 'numeric', day: 'numeric'
        }).formatToParts(d);
        const g = t => (parts.find(x => x.type === t) || {}).value || '';
        dateStr = `${g('month')}월 ${g('day')}일`;
    } catch (e) {
        dateStr = status.updatedAt;
    }

    workerEl.textContent = `${status.updatedByName} / ${dateStr} 작업`;
    workerEl.style.display = 'block';
}

// ── 계기 목록 렌더링 ─────────────────────────────────────────

// 현재 정렬 모드에 따라 계기 목록을 정렬해서 반환
function getSortedMeters(metersOverride) {
    const meters = metersOverride || currentMeters;
    if (currentSortMode === 'dup') {
        // 뒤 2자리 기준 그룹 정렬 (같은 뒤2자리끼리 인접)
        return [...meters].sort((a, b) => {
            const sa = a.계기번호.slice(-2);
            const sb = b.계기번호.slice(-2);
            if (sa !== sb) return sa.localeCompare(sb);
            return meters.indexOf(a) - meters.indexOf(b); // 그룹 내 원래 순서 유지
        });
    }
    if (currentSortMode === 'maker') {
        // 앞 2자리 기준 그룹 정렬 (같은 메이커 코드끼리 인접)
        return [...meters].sort((a, b) => {
            const pa = a.계기번호.slice(0, 2);
            const pb = b.계기번호.slice(0, 2);
            if (pa !== pb) return pa.localeCompare(pb);
            return meters.indexOf(a) - meters.indexOf(b); // 그룹 내 원래 순서 유지
        });
    }
    // 'none': 상태순(미작업 → 이어서(임시저장) → 완료) + 그 안 daily_seq 오름차순
    const st = (typeof workStatus !== 'undefined' && workStatus[currentAddress]) || {};
    const rl = st.replacement_list || {};
    const rank = m => {
        const r = rl[m.계기번호];
        if (!r) return 0;            // 미작업(nothing)
        return r.draft ? 1 : 2;      // 이어서(임시저장) / 완료
    };
    const seq = m => {
        const r = rl[m.계기번호];
        return (r && typeof r.daily_seq === 'number') ? r.daily_seq : Number.MAX_SAFE_INTEGER;
    };
    return [...meters].sort((a, b) =>
        rank(a) - rank(b) || seq(a) - seq(b) || meters.indexOf(a) - meters.indexOf(b));
}

// 계기 개별 불가 토글
function toggleMeterFail(meterNumber) {
    if (!workStatus[currentAddress]) {
        workStatus[currentAddress] = makeEmptyEntry();
    }
    const status = workStatus[currentAddress];
    if (!status.failedMeters) status.failedMeters = {};

    if (status.failedMeters[meterNumber] !== undefined) {
        // 이미 불가 → 해제
        delete status.failedMeters[meterNumber];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));
        renderMetersList();
    } else {
        // 불가 처리 → 일단 빈 사유로 등록하고 입력창 표시 (renderMetersList에서 처리)
        status.failedMeters[meterNumber] = '';
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));
        renderMetersList();
        // 렌더링 후 해당 입력창에 포커스
        setTimeout(() => {
            const input = document.querySelector(`.meter-fail-input[data-meter="${meterNumber}"]`);
            if (input) input.focus();
        }, 50);
    }
}

// 계기 불가 사유 저장
function saveMeterFailReason(meterNumber, reason) {
    if (!workStatus[currentAddress]) return;
    const status = workStatus[currentAddress];
    if (!status.failedMeters) status.failedMeters = {};
    status.failedMeters[meterNumber] = reason;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));
}

// 계기 목록 HTML 생성 및 렌더링
function renderMetersList() {
    const status = workStatus[currentAddress] || makeEmptyEntry();

    // 작업자가 "+계기 추가"로 등록한 계기 → 가상 meter 객체로 합치기
    // (site-data에 없으므로 변대주·검침일·타입 등은 빈 값)
    const addedMeters = status.added_meters || {};
    const addedAsMeters = Object.keys(addedMeters).map(id => ({
        계기번호: String(id),
        계기타입: '',
        상호: '',
        변대주: '',
        _isAdded: true,
    }));

    // currentMeters는 site-data 원본. 합쳐서 표시
    const meters = [...currentMeters, ...addedAsMeters];
    const sortedMeters = getSortedMeters(meters);
    const allSamePole = meters.length > 0 && meters.every(m => m.변대주 === meters[0].변대주);
    const failedMeters = status.failedMeters || {};

    // 뒤 2자리 중복 그룹 계산 (중복 계기번호 색상 구분용)
    const suffix2Map = {};
    meters.forEach(m => {
        const s = m.계기번호.slice(-2);
        if (!suffix2Map[s]) suffix2Map[s] = [];
        suffix2Map[s].push(m.계기번호);
    });
    // suffix → 그룹 인덱스 (0-based)
    const dupGroupIndex = {};
    let gIdx = 0;
    Object.entries(suffix2Map).forEach(([s, nos]) => {
        if (nos.length > 1) dupGroupIndex[s] = gIdx++;
    });
    // 그룹 인덱스 → CSS 클래스 방식 (인라인 스타일 대신 dup-row-N 클래스 사용)
    function rowClass(s2) {
        if (dupGroupIndex[s2] === undefined) return '';
        return `dup-row-${dupGroupIndex[s2] % 10}`;
    }

    // 검색 필터
    const searchVal = (document.getElementById('meter-search')?.value || '').replace(/\D/g, '');
    const filtered = (searchVal.length >= 2)
        ? sortedMeters.filter(m => m.계기번호.includes(searchVal))
        : sortedMeters;

    const metersList = document.getElementById('meters-list');
    metersList.innerHTML = filtered.map(meter => {
        const checked = (status.checkedMeters || []).includes(meter.계기번호) ? 'checked' : '';
        const parsedType = parseType(meter.계기번호) || meter.계기타입;
        // 상호 + 공동주택명 (둘 다 있으면 같이, 같은 값이면 중복 제거)
        const sangho = (meter.상호 && meter.상호 !== '0') ? meter.상호 : '';
        const apt    = (meter.공동주택명 && meter.공동주택명 !== '0') ? meter.공동주택명 : '';
        const detailParts = [];
        if (sangho) detailParts.push(`상호 ${sangho}`);
        if (apt && apt !== sangho) detailParts.push(`공동주택 ${apt}`);
        const details = detailParts.join(' / ');

        // 계기번호 4구간 색상 분리
        const no = meter.계기번호;
        const s2 = no.slice(-2);
        const isDup = dupGroupIndex[s2] !== undefined;
        const noHtml = `<span class="meter-no-seg">` +
            `<span class="seg-maker">${no.slice(0, 2)}</span>` +
            `<span class="seg-type">${no.slice(2, 4)}</span>` +
            `<span class="seg-mid">${no.slice(4, -2)}</span>` +
            `<span class="${isDup ? 'seg-dup' : 'seg-last'}">${s2}</span>` +
            `</span>`;

        const copyBtn = `<button class="copy-btn" data-copy="${meter.계기번호}" title="계기번호 복사"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;

        // 미연계 오타 판명 라벨 — 통신팀/admin 시각만 (계기팀 시각에선 미연계 숨김과 일관)
        const _otaRole = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : ((authGetSession() || {}).role || 'meter');
        const _commEntry = (status.comm_completed_list || {})[meter.계기번호];
        const otaHtml = (_otaRole !== 'meter' && _commEntry && _commEntry.otype)
            ? ` <span class="ota-badge ${_commEntry.otype === '통신오타' ? 'comm-typo' : 'missing'}" title="${_commEntry.comm_meter_id ? '통신팀 입력: ' + _commEntry.comm_meter_id : ''}">(${_commEntry.otype})</span>`
            : '';

        // 개별 불가 처리 상태
        const isFailed = failedMeters[meter.계기번호] !== undefined;
        const failReason = failedMeters[meter.계기번호] || '';
        const failBtnClass = isFailed ? 'meter-fail-btn active' : 'meter-fail-btn';
        const failBtnLabel = isFailed ? '불가해제' : '불가';
        const failInputHtml = isFailed
            ? `<div class="meter-fail-input-wrap">
                 <input type="text" class="meter-fail-input"
                        data-meter="${meter.계기번호}"
                        placeholder="불가 사유 입력 후 엔터"
                        value="${failReason.replace(/"/g, '&quot;')}">
               </div>`
            : '';

        // 역할 판별 (extraParts 분기에 사용 — 아래 showRpl 계산과 동일 방식)
        // getEffectiveRole()은 admin을 adminViewRole('meter'|'comm')으로 콜랩스함.
        // admin 원본 role을 별도 보관해 "전체 표시" 분기에 사용.
        const _role = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : ((authGetSession() || {}).role || 'meter');
        const _isAdmin = (typeof authGetSession === 'function') && ((authGetSession() || {}).role === 'admin');

        // 불가 버튼 옆에 작은 글씨로 표시할 보조 정보 (계기 별 메타) — role별 분기
        const extraParts = [];
        if (meter.순위) extraParts.push(meter.순위);
        if (meter.계약전력) extraParts.push(`${meter.계약전력}kW`);
        const cust = [meter.고객번호, meter.고객명, meter.휴대폰].filter(Boolean);
        if (cust.length) extraParts.push(`고객(${cust.join(', ')})`);
        if (meter.검침일) extraParts.push(`검침일 ${meter.검침일}`);
        if (meter.계기위치) extraParts.push(meter.계기위치);
        if (meter.검침방법) extraParts.push(meter.검침방법);
        // 검침원연락처 — 계기팀은 숨김, 통신팀·admin은 표시
        if (_role !== 'meter') {
            if (meter.검침원 || meter.검침원연락처) {
                const nm = (meter.검침원 || '').split(/\s+/)[0];
                const cp = [nm, meter.검침원연락처].filter(Boolean);
                if (cp.length) extraParts.push(`검침원(${cp.join(', ')})`);
            }
        }
        // 인입주 — 계기팀은 숨김, 통신팀·admin은 표시
        if (_role !== 'meter') {
            const ip = [meter.인입주번호, meter.인입주전산화].filter(Boolean);
            if (ip.length) extraParts.push(`인입주(${ip.join(', ')})`);
        }
        // 변대주 — 계기팀은 숨김, 통신팀·admin은 표시
        if (_role !== 'meter') {
            if (meter.변대주) {
                const pv = meter.변대주;
                const isDcu = !!meter.DCUID;
                const pvMain = isDcu ? pv.slice(0, -2) : pv;
                const pvHtml = isDcu
                    ? `${pvMain}<span class="seg-dup">${pv.slice(-2)}</span>`
                    : pv;
                const labelStr = meter.변대주라벨 ? `${meter.변대주라벨}, ` : '';
                const cpyBtn = `<button class="copy-btn pole-copy-btn" data-copy="${pvMain}" title="변대주 복사" style="margin-left:3px;vertical-align:middle;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
                extraParts.push(`변대주(${labelStr}${pvHtml})${cpyBtn}`);
            }
        }
        // 계약종별 — 계기팀·admin에게 표시 (통신팀 불필요)
        if (_role !== 'comm') {
            if (meter.계약종별) extraParts.push(`계약(${meter.계약종별})`);
        }
        // 인입선상태 — 통신팀·admin에게 표시 (계기팀 불필요)
        if (_role !== 'meter') {
            if (meter.인입선상태) extraParts.push(`인입선(${meter.인입선상태})`);
        }
        const meterMetaHtml = extraParts.length
            ? `<div class="meter-meta">${extraParts.join(' · ')}</div>`
            : '';

        // 계기팀/admin에게만 "교체/수정" 버튼 노출 (_role 이미 위에서 계산됨)
        const showRpl = (_role === 'meter') || (_role === 'admin');
        const replInfo = (status.replacement_list || {})[meter.계기번호];
        const isReplaced = !!replInfo;
        const isDraft = isReplaced && replInfo.draft === true;
        const isReplacedDone = isReplaced && !isDraft;  // 완전 저장된 상태

        // 교체 작성 정보 — Daily No. + 교체계기번호/철거지침 복사 + 사진 2장 다운로드 (awms 앱작성 입력용)
        let replInfoHtml = '';
        try {
        if (isReplaced) {
            const e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            const cpBtn = (v, t) => `<button class="copy-btn" data-copy="${e(v)}" title="${t}" style="margin-left:3px;vertical-align:middle;">${ICON}</button>`;
            // 철거값(검침지침) 수집 — 다칸(removal_values) 우선, 단일(removal_value) 폴백
            const rvItems = [];
            if (replInfo.removal_values && typeof replInfo.removal_values === 'object') {
                const activeFields = (typeof readingFieldsFor === 'function')
                    ? readingFieldsFor(meter.계약종별, meter.계약전력)
                    : ['whme_day'];
                const fieldLabels = (typeof FIELD_META !== 'undefined') ? FIELD_META : {};
                for (const fid of activeFields) {
                    const fval = replInfo.removal_values[fid];
                    if (fval != null && String(fval) !== '') {
                        const flabel = (fieldLabels[fid] && fieldLabels[fid].label) ? fieldLabels[fid].label : fid;
                        rvItems.push(`<span class="sw-rv-item">${flabel} <b>${e(fval)}</b>${cpBtn(fval, `${flabel} 복사`)}</span>`);
                    }
                }
            } else if (replInfo.removal_value != null && String(replInfo.removal_value) !== '') {
                rvItems.push(`<span class="sw-rv-item">철거지침 <b>${e(replInfo.removal_value)}</b>${cpBtn(replInfo.removal_value, '철거지침 복사')}</span>`);
            }
            // 박스 없이 심플하게: → 새계기번호[복사] / 철거지침[복사] / 사진받기
            const _newNo = replInfo.new_meter_id;
            let _h = '<div class="m-repl">';
            _h += `<div class="m-repl-new"><span class="m-repl-arrow">→</span><b>${_newNo ? e(_newNo) : '입력 대기'}</b>${_newNo ? cpBtn(_newNo, '교체계기번호 복사') : ''}</div>`;
            if (rvItems.length) _h += `<div class="m-repl-rv">${rvItems.join('')}</div>`;
            // 추가데이터(extra_data) — 1종2종/20kW↑ 등 site-data로 미리 알 수 없어 작업자가 자유입력한 검침값
            if (Array.isArray(replInfo.extra_data) && replInfo.extra_data.length) {
                const exItems = replInfo.extra_data
                    .filter(x => x && x.value != null && String(x.value) !== '')
                    .map((x, i) => {
                        const lbl = (x.label && String(x.label).trim()) ? e(x.label) : `추가${i + 1}`;
                        const photo = x.photo_url
                            ? `<a class="sw-extra-photo" href="${e(x.photo_url)}" target="_blank" rel="noopener" title="추가데이터 사진">사진</a>`
                            : '';
                        return `<span class="sw-rv-item">${lbl} <b>${e(x.value)}</b>${cpBtn(x.value, `${lbl} 복사`)}${photo}</span>`;
                    });
                if (exItems.length) _h += `<div class="m-repl-rv m-repl-extra"><span class="sw-extra-tag">추가</span>${exItems.join('')}</div>`;
            }
            if (replInfo.old_meter_photo || replInfo.new_meter_photo) {
                _h += `<a class="repl-dl-all" data-old="${e(replInfo.old_meter_photo || '')}" data-new="${e(replInfo.new_meter_photo || '')}" data-base="${e(meter.계기번호)}">사진 받기 ↓</a>`;
            }
            _h += '</div>';
            replInfoHtml = _h;
        }
        } catch (err) { replInfoHtml = ''; console.error('replInfo 생성 오류:', err); }

        // 불가 처리된 계기는 취소선, 교체 완료는 하늘색 배경
        let itemClass = `meter-item ${rowClass(s2)}`;
        if (isFailed) itemClass += ' meter-item-failed';
        if (isReplacedDone) itemClass += ' meter-item-replaced';
        if (isDraft) itemClass += ' meter-item-draft';

        const rplBtnHtml = showRpl
            ? (isDraft
                ? `<button class="meter-rpl-btn draft" data-meter="${meter.계기번호}" data-mode="edit">이어서</button>`
                : (isReplaced
                    ? `<button class="meter-rpl-btn done" data-meter="${meter.계기번호}" data-mode="edit">수정</button>`
                    : `<button class="meter-rpl-btn new" data-meter="${meter.계기번호}">교체</button>`))
            : '';

        // 통신팀 시각: 계기팀 완료한 계기만 활성. 활성 계기 = "기존 → 신" 표시
        const isCommView = (_role === 'comm');
        const commDone = isCommView && !!((status.comm_completed_list || {})[meter.계기번호]);
        const arrowHtml = isCommView && isReplaced
            ? ` <span class="new-meter-arrow">→ ${replInfo.new_meter_id}</span>`
            : '';
        // 통신팀 시각에서 비활성(계기팀 미작업) 계기는 옅게
        const inactiveCommStyle = isCommView && !isReplaced
            ? ' style="opacity:0.4;"'
            : '';
        // 통신팀 완료 = 회색 + 취소선
        const commDoneStyle = commDone
            ? ' style="opacity:0.5;text-decoration:line-through;"'
            : '';
        // "추가" 배지 — 작업자가 수동 추가한 계기 (site-data에 없는)
        const addedBadge = meter._isAdded
            ? `<span class="added-meter-badge">추가</span>`
            : '';
        // 추가 계기는 삭제 버튼 (잘못 추가한 경우 제거)
        const removeAddedBtnHtml = meter._isAdded
            ? `<button class="meter-remove-added-btn" data-meter="${meter.계기번호}" title="추가 취소">삭제</button>`
            : '';

        // 통신팀 시각: 비활성 계기 = disabled. 통신팀 완료 = 체크 자동 + disabled.
        // 통신팀 체크 = 별도 임시 선택(commTempChecked) — 계기팀 checkedMeters와 분리 (코덱스 #3)
        const checkboxDisabled = (isCommView && (!isReplaced || commDone)) ? 'disabled' : '';
        let checkboxChecked;
        if (isCommView) {
            checkboxChecked = commDone || commTempChecked.has(meter.계기번호) ? 'checked' : '';
        } else {
            checkboxChecked = checked;
        }
        if (isCommView && !isReplaced) itemClass += ' meter-item-comm-inactive';
        if (commDone) itemClass += ' meter-item-comm-done';

        return `
            <div class="${itemClass}">
                <div class="meter-side">
                    <input type="checkbox" class="meter-checkbox"
                           data-meter="${meter.계기번호}" ${checkboxChecked} ${checkboxDisabled}>
                    ${(isReplaced && replInfo.daily_seq != null) ? `<span class="meter-seq">No.<b>${replInfo.daily_seq}</b></span>` : ''}
                </div>
                <div class="meter-info"${commDoneStyle}>
                    <span class="meter-type">${parsedType}</span>
                    ${noHtml}${otaHtml}${copyBtn}${addedBadge}${arrowHtml}
                    <button class="${failBtnClass}" data-meter="${meter.계기번호}">${failBtnLabel}</button>
                    ${rplBtnHtml}${removeAddedBtnHtml}
                    ${replInfoHtml}
                    ${details ? `<div class="meter-details">${details}</div>` : ''}
                    ${meterMetaHtml}
                    ${failInputHtml}
                </div>
            </div>
        `;
    }).join('');

    // 체크박스, 복사 버튼, 개별 불가 버튼/입력창 이벤트 바인딩
    setTimeout(() => {
        const _viewRole = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : ((authGetSession() || {}).role || 'meter');
        const _isCommView = (_viewRole === 'comm');
        document.querySelectorAll('.meter-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const m = e.target.dataset.meter;
                if (_isCommView) {
                    // 통신팀 = 임시 선택 (Firebase 안 박음)
                    if (e.target.checked) commTempChecked.add(m);
                    else commTempChecked.delete(m);
                } else {
                    toggleMeterCheck(m);
                }
            });
        });
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                copyMeterNo(btn.dataset.copy);
            });
        });

        // 교체 사진 받기 — Web Share(사진첩 저장, ami-board 방식) 우선, 폴백=강제 다운로드
        document.querySelectorAll('.repl-dl-all').forEach(a => {
            a.addEventListener('click', async (e) => {
                e.preventDefault(); e.stopPropagation();
                const base = a.getAttribute('data-base') || 'photo';
                const items = [[a.getAttribute('data-old'), '철거전'], [a.getAttribute('data-new'), '교체후']];
                // 1) 사진들을 File 객체로 수집
                const files = [];
                for (const [url, tag] of items) {
                    if (!url) continue;
                    try {
                        const r = await fetch(url);
                        const b = await r.blob();
                        files.push(new File([b], `${base}_${tag}.jpg`, { type: 'image/jpeg' }));
                    } catch (err) { /* 한 장 실패해도 나머지 진행 */ }
                }
                if (!files.length) { alert('사진을 불러오지 못했습니다.'); return; }
                // 2) iOS만 Web Share(공유시트 → 사진첩 저장). 안드로이드는 공유시트 건너뛰고 바로 다운로드.
                const _isAndroid = /Android/i.test(navigator.userAgent);
                if (!_isAndroid && navigator.canShare && navigator.canShare({ files })) {
                    try { await navigator.share({ files, title: '교체 사진' }); return; }
                    catch (err) { if (err && err.name === 'AbortError') return; /* 그 외엔 폴백 */ }
                }
                // 3) 폴백: 강제 다운로드 (Web Share 미지원 환경)
                for (const f of files) {
                    const u = URL.createObjectURL(f);
                    const x = document.createElement('a');
                    x.href = u; x.download = f.name;
                    document.body.appendChild(x); x.click(); x.remove();
                    setTimeout(() => URL.revokeObjectURL(u), 2000);
                    await new Promise(res => setTimeout(res, 500));
                }
            });
        });

        // 개별 불가 버튼 클릭
        document.querySelectorAll('.meter-fail-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMeterFail(btn.dataset.meter);
            });
        });

        // 추가 계기 삭제 버튼 — added_meters에서 제거
        document.querySelectorAll('.meter-remove-added-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const meterNo = String(btn.dataset.meter);
                if (!confirm(`추가된 계기 ${meterNo} 삭제?`)) return;
                try {
                    const addrKey = (typeof encodeKey === 'function') ? encodeKey(currentAddress) : currentAddress;
                    if (statusRef) {
                        await statusRef.child(addrKey).child('added_meters').child(meterNo).remove();
                    }
                    if (workStatus[currentAddress]?.added_meters) {
                        delete workStatus[currentAddress].added_meters[meterNo];
                    }
                    renderMetersList();
                } catch (err) {
                    alert('삭제 실패: ' + (err.message || err));
                }
            });
        });

        // 계기별 "교체/수정" 버튼 → 모달 열기 (계기 객체 함께 전달)
        document.querySelectorAll('.meter-rpl-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof RplModal === 'undefined') return;
                const meterNo = String(btn.dataset.meter);
                const mode = btn.dataset.mode === 'edit' ? 'edit' : 'new';
                // site-data 원본에서 먼저 찾고, 없으면 추가된 계기에서
                let meter = currentMeters.find(m => String(m.계기번호) === meterNo);
                if (!meter) {
                    const addedMap = (workStatus[currentAddress] || {}).added_meters || {};
                    if (addedMap[meterNo]) {
                        meter = { 계기번호: meterNo, 계기타입: '', 상호: '', 변대주: '', _isAdded: true };
                    }
                }
                // 수정 모드면 기존 replacement 데이터 prefill
                if (mode === 'edit') {
                    const existing = (workStatus[currentAddress] || {}).replacement_list?.[meterNo];
                    RplModal.open(currentAddress, meter, null, existing);
                } else {
                    RplModal.open(currentAddress, meter);
                }
            });
        });

        // 불가 사유 입력창 — 엔터 또는 포커스아웃 시 저장
        document.querySelectorAll('.meter-fail-input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    saveMeterFailReason(input.dataset.meter, input.value.trim());
                    input.blur();
                }
            });
            input.addEventListener('blur', (e) => {
                saveMeterFailReason(input.dataset.meter, input.value.trim());
            });
        });

        // 계기 검색 — 입력 시 목록으로 자동 스크롤
        const searchInput = document.getElementById('meter-search');
        if (searchInput) {
            searchInput.oninput = () => {
                renderMetersList();
                setTimeout(() => {
                    const actionsEl = document.querySelector('.overlay-actions');
                    if (actionsEl) actionsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 150);
            };
        }
    }, 100);
}

// 통신팀 — commTempChecked(임시 선택) 중 활성 계기(계기팀 완료)를 일괄 완료
// comm_completed_list/{meter_id}: { done_at, worker }
async function bulkCommComplete(address) {
    const session = authGetSession();
    const me = session?.id || 'unknown';
    const status = workStatus[address] || makeEmptyEntry();
    const replList = status.replacement_list || {};

    // commTempChecked 중 활성 계기만 (코덱스 #3)
    const targets = [...commTempChecked].filter(m => replList[m]);

    // 활성 계기 없으면 → 주소 단위 강제 완료
    // (계기팀이 데이터 안 넣는 경우 대비 — 통신팀이 지도상으로만 완료 처리)
    if (targets.length === 0) {
        const ok = confirm('체크된 활성 계기가 없습니다.\n\n주소 단위로 통신팀 완료 처리할까요?\n(지도에서 완료로 표시되지만 계기별 기록은 남지 않습니다)');
        if (!ok) return;
        saveStateEvent(address, 'complete', '', session?.id || '', session?.name || '', 'comm');
        renderMetersList();
        if (typeof updateMarkerColor === 'function') updateMarkerColor(address);
        closeDetail();
        return;
    }

    const now = Date.now();
    const addrKey = (typeof encodeKey === 'function') ? encodeKey(address) : address;

    try {
        if (statusRef) {
            const updates = {};
            targets.forEach(m => {
                updates[`${addrKey}/comm_completed_list/${m}`] = { done_at: now, worker: me };
                // 코덱스 #4: 혹시 남아있을 옛 meterChecks 정리 (stale 방지)
                updates[`${addrKey}/meterChecks/${m}`] = null;
            });
            await statusRef.update(updates);
        }
        // 로컬 반영
        if (!status.comm_completed_list) status.comm_completed_list = {};
        targets.forEach(m => {
            status.comm_completed_list[m] = { done_at: now, worker: me };
            commTempChecked.delete(m);
            // 로컬 meterChecks/checkedMeters에서도 제거
            if (status.meterChecks && status.meterChecks[m]) delete status.meterChecks[m];
            if (Array.isArray(status.checkedMeters)) {
                status.checkedMeters = status.checkedMeters.filter(x => x !== m);
            }
        });
        workStatus[address] = status;

        alert(`통신팀 완료: ${targets.length}건`);
        renderMetersList();
        if (typeof updateMarkerColor === 'function') updateMarkerColor(address);
    } catch (e) {
        console.error(e);
        alert('저장 실패: ' + (e.message || e));
    }
}

// 정렬 버튼 토글 — 같은 버튼을 다시 누르면 원래 순서(none)로 복귀
function toggleSort(mode) {
    currentSortMode = (currentSortMode === mode) ? 'none' : mode;
    updateSortBtnUI();
    renderMetersList();
}

// 정렬 버튼 활성화 UI 업데이트
function updateSortBtnUI() {
    const dupBtn = document.getElementById('sort-btn-dup');
    const makerBtn = document.getElementById('sort-btn-maker');
    if (!dupBtn || !makerBtn) return;
    dupBtn.classList.toggle('active', currentSortMode === 'dup');
    makerBtn.classList.toggle('active', currentSortMode === 'maker');
}

// 상세 패널 닫기
function closeDetail() {
    document.getElementById('fullpage-overlay').classList.remove('active');
    // 검색/딥링크로 연 모달이면, 닫는 순간 해당 위치 빨간 펄스 10초 표시
    if (window._searchPulseLatlng) {
        if (typeof showSearchPulse === 'function') showSearchPulse(window._searchPulseLatlng);
        window._searchPulseLatlng = null;
    }
}

// 주소의 작업 상태 업데이트 후 마커 색상 갱신
function updateStatus(state) {
    const session = authGetSession();
    // admin이 시각 토글로 다른 역할 선택한 경우 그 역할로 동작 (getEffectiveRole는 map.js에 정의)
    const role = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : (session ? session.role : '');
    const reason = (document.getElementById('fail-reason')?.value || '').trim();

    // 통신팀이 완료 누르면 계기팀 상태 무관하게 자동 양쪽 complete
    // (계기팀이 아직 앱 사용 안 함 → 통신팀 완료 = 사실상 진짜 완료)
    // 추후 계기팀이 앱 사용·새 계기 등록 프로세스 시작하면 별도 흐름 추가
    if (role === 'comm' && state === 'complete') {
        const cur = workStatus[currentAddress];
        if (!cur || cur.meter_state !== 'complete') {
            saveBothCompleteEvent(
                currentAddress,
                session ? session.id   : '',
                session ? session.name : ''
            );
            if (typeof refreshAllMarkers === 'function') refreshAllMarkers();
            else updateMarkerColor(currentAddress);
            return;
        }
    }

    saveStateEvent(
        currentAddress,
        state,
        state === 'fail' ? reason : '',
        session ? session.id   : '',
        session ? session.name : '',
        role
    );
    // commLastAddress 갱신을 포함한 전체 마커 갱신 (찐초록 즉시 반영)
    if (typeof refreshAllMarkers === 'function') refreshAllMarkers();
    else updateMarkerColor(currentAddress);
}

// 주소의 작업 상태 초기화 (pending으로 되돌리기) — 체크박스는 유지
function resetStatus() {
    if (!workStatus[currentAddress]) return;
    const session = authGetSession();
    const role = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : (session ? session.role : '');
    const cur = workStatus[currentAddress];

    // 계기팀 초기화 시 — 통신팀이 이미 완료한 곳은 차단
    if (role === 'meter') {
        if (cur.comm_state === 'complete') {
            alert('통신팀이 이미 작업했습니다.\n관리자에 문의하세요.');
            return;
        }
    }

    // 통신팀 초기화 시 — meter_forced_by_comm(통신팀이 강제 양쪽 완료한 케이스)이면 양쪽 다 pending
    if (role === 'comm' && cur.meter_forced_by_comm === true) {
        saveResetBothEvent(
            currentAddress,
            session ? session.id   : '',
            session ? session.name : ''
        );
        if (typeof refreshAllMarkers === 'function') refreshAllMarkers();
        else updateMarkerColor(currentAddress);
        showDetail(currentAddress, currentMeters);
        return;
    }

    // 일반 케이스 — 자기 팀 state만 pending으로 (체크박스/불가 유지)
    saveStateEvent(
        currentAddress, 'pending', '',
        session ? session.id   : '',
        session ? session.name : '',
        role
    );

    if (typeof refreshAllMarkers === 'function') refreshAllMarkers();
    else updateMarkerColor(currentAddress);
    showDetail(currentAddress, currentMeters);
}

// 계기 체크 토글
function toggleMeterCheck(meterNumber) {
    if (!workStatus[currentAddress]) {
        workStatus[currentAddress] = makeEmptyEntry();
    }
    const checkedMeters = workStatus[currentAddress].checkedMeters || [];
    const isChecked = checkedMeters.includes(meterNumber);
    saveCheckEvent(currentAddress, meterNumber, !isChecked);
}
