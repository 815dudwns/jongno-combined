// detail.js — 상세 패널(오버레이) 로직

let currentAddress = '';
let currentMeters = [];

// 현재 정렬 모드: 'none' | 'dup' | 'maker'
let currentSortMode = 'none';

// 주소 클릭 시 상세 패널 표시
function showDetail(address, meters) {
    currentAddress = address;
    currentMeters = meters;

    // 어드민 사진등록 버튼에 현재 주소 전달
    const adminBtn = document.getElementById('admin-upload-btn');
    if (adminBtn) adminBtn.href = `admin.html?addr=${encodeURIComponent(address)}`;

    const status = workStatus[address] || { state: 'pending', checkedMeters: [], reason: '' };
    status.checkedMeters = status.checkedMeters || [];

    document.getElementById('detail-address').textContent = address;

    // 좌표정확도가 approximate인 계기가 하나라도 있으면 "주소 오류" 표시
    const hasApproximate = meters.some(m => m.좌표정확도 === 'approximate');
    const errorTag = hasApproximate
        ? ' <span style="color:#ef4444;font-size:12px;">(주소 오류)</span>'
        : '';
    document.getElementById('detail-road-address').innerHTML = '📍 ' + meters[0].도로명주소 + errorTag;

    // 상태 색상 바 업데이트 (기능 3)
    updateStatusBar(status.state);

    // 지도 앱 버튼 3개 — 도로명주소로 검색
    const roadAddr = meters[0].도로명주소;
    document.getElementById('tmap-btn').onclick = () => {
        window.location.href = `tmap://search?name=${encodeURIComponent(roadAddr)}`;
    };
    document.getElementById('naver-btn').onclick = () => {
        window.location.href = `nmap://search?query=${encodeURIComponent(roadAddr)}`;
    };
    document.getElementById('kakao-btn').onclick = () => {
        window.location.href = `kakaomap://search?q=${encodeURIComponent(roadAddr)}`;
    };

    const btnComplete = document.getElementById('btn-complete');
    const btnHold = document.getElementById('btn-hold');
    const btnFail = document.getElementById('btn-fail');

    // 완료 상태면 초기화 버튼으로 전환
    // comm: 본인(comm_done) 기준, meter: 본인(meter_done) 기준, admin/기타: state 기준
    const sessionForBtn = authGetSession();
    const roleForBtn = sessionForBtn ? sessionForBtn.role : '';
    const myDone = roleForBtn === 'comm'  ? status.comm_done === true
                 : roleForBtn === 'meter' ? status.meter_done === true
                 : status.state === 'complete';

    if (myDone) {
        btnComplete.textContent = '🔄 초기화';
        btnComplete.className = 'action-btn reset';
        btnComplete.onclick = () => resetStatus();
    } else {
        btnComplete.textContent = '✅ 완료';
        btnComplete.className = 'action-btn complete';
        btnComplete.onclick = () => { updateStatus('complete'); closeDetail(); };
    }

    btnHold.onclick = () => { updateStatus('hold'); closeDetail(); };
    btnFail.onclick = () => {
        const failInput = document.getElementById('fail-reason');
        const reason = failInput.value.trim();
        if (!reason) {
            failInput.style.borderColor = '#ef4444';
            return;
        }
        failInput.style.borderColor = '';
        updateStatus('fail');
        closeDetail();
    };

    // 현재 상태에 맞는 버튼 활성화
    [btnComplete, btnHold, btnFail].forEach(btn => btn.classList.remove('active'));
    if (status.state === 'complete') btnComplete.classList.add('active');
    if (status.state === 'hold') btnHold.classList.add('active');
    if (status.state === 'fail') btnFail.classList.add('active');

    const failInput = document.getElementById('fail-reason');
    failInput.value = status.reason || '';
    failInput.style.borderColor = '';
    failInput.oninput = (e) => {
        if (e.target.value.trim()) e.target.style.borderColor = '';
        // 입력 중: 로컬만 저장
        if (!workStatus[currentAddress]) {
            workStatus[currentAddress] = { state: 'pending', checkedMeters: [], reason: '' };
        }
        workStatus[currentAddress].reason = e.target.value;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workStatus));
    };
    // blur/Enter 시 이벤트 큐에 추가
    const flushFailReason = () => {
        const session = authGetSession();
        const state = workStatus[currentAddress]?.state || 'pending';
        if (state !== 'pending') {
            const role = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : (session ? session.role : '');
            saveStateEvent(
                currentAddress,
                state,
                failInput.value.trim(),
                session ? session.id   : '',
                session ? session.name : '',
                role
            );
        }
    };
    failInput.addEventListener('blur', flushFailReason);
    failInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { flushFailReason(); failInput.blur(); } });

    // 작업자 정보 표시 (기능 4)
    // 디버그: showDetail에서 읽어온 status 확인
    console.log('[showDetail] status:', {
        state:         status.state,
        updatedByName: status.updatedByName,
        updatedAt:     status.updatedAt,
    });
    updateWorkerInfo(status);

    // 변대주가 모두 같은 경우 공통 표시
    const allSamePole = meters.length > 0 && meters.every(m => m.변대주 === meters[0].변대주);
    const commonPoleEl = document.getElementById('common-pole');
    if (allSamePole && meters[0].변대주 && meters[0].변대주 !== '0') {
        const poleText = meters[0].변대주;
        const isDcuId = /[A-Za-z]/.test(poleText);
        const poleMain = isDcuId ? poleText.slice(0, -2) : poleText;
        const poleHtml = isDcuId
            ? `<span>${poleMain}</span><span class="seg-dup">${poleText.slice(-2)}</span>`
            : `<span>${poleText}</span>`;
        const poleCopyBtn = `<button class="copy-btn pole-copy-btn" data-copy="${poleMain}" title="변대주 복사" style="margin-left:6px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
        commonPoleEl.innerHTML = `변대주 ${poleHtml}${poleCopyBtn}`;
        commonPoleEl.style.display = 'block';
        // 공통 변대주 복사 버튼 이벤트 바인딩
        commonPoleEl.querySelector('.pole-copy-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            copyMeterNo(poleMain);
        });
    } else {
        commonPoleEl.style.display = 'none';
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

    const colorMap = {
        complete: '#10b981',
        hold:     '#3b82f6',
        fail:     '#ef4444',
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

    // updatedAt을 "M월 D일" 형식으로 변환
    let dateStr = '';
    try {
        const d = new Date(status.updatedAt);
        const month = d.getMonth() + 1;
        const day = d.getDate();
        dateStr = `${month}월 ${day}일`;
    } catch (e) {
        dateStr = status.updatedAt;
    }

    workerEl.textContent = `${status.updatedByName} / ${dateStr} 작업`;
    workerEl.style.display = 'block';
}

// ── 계기 목록 렌더링 ─────────────────────────────────────────

// 현재 정렬 모드에 따라 계기 목록을 정렬해서 반환
function getSortedMeters() {
    const meters = currentMeters;
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
    // 'none': 원래 순서
    return meters;
}

// 계기 개별 불가 토글
function toggleMeterFail(meterNumber) {
    if (!workStatus[currentAddress]) {
        workStatus[currentAddress] = { state: 'pending', checkedMeters: [], reason: '' };
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
    const meters = currentMeters;
    const sortedMeters = getSortedMeters();
    const status = workStatus[currentAddress] || { state: 'pending', checkedMeters: [], reason: '' };
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
        const detailParts = [];
        // 변대주가 있고 공통 표시 영역에 없는 경우만 개별 표시 (복사 버튼 포함)
        if (!allSamePole && meter.변대주 && meter.변대주 !== '0') {
            const pv = meter.변대주;
            const pvIsDcu = /[A-Za-z]/.test(pv);
            const pvMain = pvIsDcu ? pv.slice(0, -2) : pv;
            const pHtml = pvIsDcu
                ? `<span>${pvMain}</span><span class="seg-dup">${pv.slice(-2)}</span>`
                : `<span>${pv}</span>`;
            const pCopyBtn = `<button class="copy-btn pole-copy-btn" data-copy="${pvMain}" title="변대주 복사" style="margin-left:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
            detailParts.push(`변대주 ${pHtml}${pCopyBtn}`);
        }
        if (meter.상호 && meter.상호 !== '0') detailParts.push(`상호 ${meter.상호}`);
        const details = detailParts.join(', ');

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

        // 불가 처리된 계기는 취소선 클래스 추가
        const itemClass = isFailed
            ? `meter-item ${rowClass(s2)} meter-item-failed`
            : `meter-item ${rowClass(s2)}`;

        return `
            <div class="${itemClass}">
                <input type="checkbox" class="meter-checkbox"
                       data-meter="${meter.계기번호}" ${checked}>
                <div class="meter-info">
                    <span class="meter-type">${parsedType}</span>
                    ${noHtml}${copyBtn}
                    <button class="${failBtnClass}" data-meter="${meter.계기번호}">${failBtnLabel}</button>
                    ${details ? `<div class="meter-details">${details}</div>` : ''}
                    ${failInputHtml}
                </div>
            </div>
        `;
    }).join('');

    // 체크박스, 복사 버튼, 개별 불가 버튼/입력창 이벤트 바인딩
    setTimeout(() => {
        document.querySelectorAll('.meter-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                toggleMeterCheck(e.target.dataset.meter);
            });
        });
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                copyMeterNo(btn.dataset.copy);
            });
        });

        // 개별 불가 버튼 클릭
        document.querySelectorAll('.meter-fail-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMeterFail(btn.dataset.meter);
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
}

// 주소의 작업 상태 업데이트 후 마커 색상 갱신
function updateStatus(state) {
    const session = authGetSession();
    // admin이 시각 토글로 다른 역할 선택한 경우 그 역할로 동작 (getEffectiveRole는 map.js에 정의)
    const role = (typeof getEffectiveRole === 'function') ? getEffectiveRole() : (session ? session.role : '');
    const reason = (document.getElementById('fail-reason')?.value || '').trim();

    // 통신팀이 완료를 누르는데 계기팀 미완료인 경우 → 확인 다이얼로그
    if (role === 'comm' && state === 'complete') {
        const cur = workStatus[currentAddress];
        if (!cur || cur.meter_done !== true) {
            const ok = confirm('계기팀 작업이 완료된 것 확인되었나요?\n확인하면 계기팀·통신팀 둘 다 완료 처리됩니다.');
            if (!ok) return;
            saveBothCompleteEvent(
                currentAddress,
                session ? session.id   : '',
                session ? session.name : ''
            );
            // commLastAddress 갱신을 포함한 전체 마커 갱신
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

    // state만 pending으로 (체크박스/불가 유지), 역할 플래그도 함께 초기화
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
        workStatus[currentAddress] = { state: 'pending', checkedMeters: [], reason: '' };
    }
    const checkedMeters = workStatus[currentAddress].checkedMeters || [];
    const isChecked = checkedMeters.includes(meterNumber);
    saveCheckEvent(currentAddress, meterNumber, !isChecked);
}
