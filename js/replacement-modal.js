// replacement-modal.js — 계기 교체 입력 모달

const RplModal = (() => {
  let currentAddress = '';
  let currentMeter = null;     // 선택한 계기 객체
  let newPhotoBlob = null;
  let editingData = null;      // 수정 모드 = 기존 replacement 객체 (prefill용)
  let keepNewPhotoUrl = null;

  // 칸별 사진 blob / 수정모드 유지 URL
  let removalPhotoBlobs = {};    // { whme_day: Blob|null, ... }
  let keepRemovalPhotoUrls = {}; // { whme_day: 'https://...', ... }
  // 칸별 "원본"(압축 전) file 보관 — 저장 시 LCD 크롭본(고화질) 생성용. 검침값 검증/학습 데이터.
  let removalPhotoOriginals = {}; // { whme_day: File|Blob|null, ... }
  // 칸별 LCD 영역 (작업자 지정). 정규화(0~1), 원본 이미지 기준.
  let removalPhotoRegions = {};   // { whme_day: {x0,y0,x1,y1}, ... }

  // 추가 데이터 행 (DOM 요소 배열 — save 시 collectExtraRows로 수집)
  let extraRows = [];

  // DRY-RUN 제거됨 — 항상 Firebase 직접 저장 (영준님 결정 2026-05-17)
  function isDryRun() { return false; }

  // ── RV_FIELDS: 칸 → {wrap, input, photo, photoInput} id 매핑 (단일 소스) ──
  // photo/photoInput id의 접미어는 HTML의 data-field, input wrap id와 통일
  const RV_FIELDS = {
    whme_day:  {
      wrap:       'rpl-rv-field-whme-day',
      input:      'rpl-rv-whme-day',
      photo:      'rpl-rv-photo-whme-day',
      photoInput: 'rpl-rv-photo-input-whme-day',
    },
    whme_mngt: {
      wrap:       'rpl-rv-field-whme-mngt',
      input:      'rpl-rv-whme-mngt',
      photo:      'rpl-rv-photo-whme-mngt',
      photoInput: 'rpl-rv-photo-input-whme-mngt',
    },
    var_day:   {
      wrap:       'rpl-rv-field-var',
      input:      'rpl-rv-var',
      photo:      'rpl-rv-photo-var',
      photoInput: 'rpl-rv-photo-input-var',
    },
    dm_mt_day: {
      wrap:       'rpl-rv-field-dm-mt',
      input:      'rpl-rv-dm-mt',
      photo:      'rpl-rv-photo-dm-mt',
      photoInput: 'rpl-rv-photo-input-dm-mt',
    },
  };
  // 순서: 주간·야간·무효전력·최대전력 (영준님 2026-06-15: 무효↔최대 순서 교환)
  const ALL_KNOWN_FIELDS = ['whme_day', 'whme_mngt', 'var_day', 'dm_mt_day'];
  let activeFields = [];      // 현재 활성 검침칸 (open에서 계약정보로 자동 계산)
  let _rvMode = 'auto';       // 수동 토글 순환: auto → day(주간) → night(야간) → all(4개) → day...

  // 현재 모드의 실제 검침칸 목록 (auto면 자동계산값 그대로)
  function _rvFieldsFor(autoFields) {
    if (_rvMode === 'day')   return ['whme_day'];
    if (_rvMode === 'night') return ['whme_mngt'];
    if (_rvMode === 'all')   return ALL_KNOWN_FIELDS.slice();
    return autoFields || [];
  }

  // 검침칸 표시 갱신
  function _applyRvVisibility() {
    const eff = _rvFieldsFor(activeFields);
    for (const fid of ALL_KNOWN_FIELDS) {
      const els = RV_FIELDS[fid];
      const w = els && document.getElementById(els.wrap);
      if (w) w.style.display = eff.includes(fid) ? '' : 'none';
    }
    const rf = document.getElementById('rpl-removal-fields');
    if (rf) rf.classList.toggle('single', eff.length <= 1);
    const btn = document.getElementById('rpl-rv-toggle');
    if (btn) {
      const lbl = { auto: '검침: 자동', day: '검침: 주간', night: '검침: 야간', all: '검침: 4칸' };
      btn.textContent = lbl[_rvMode] || '검침칸 수동';
      btn.classList.toggle('on', _rvMode !== 'auto');
    }
  }

  // 버튼 누를 때마다 주간 → 야간 → 4개 순환 (auto에서 첫 클릭 시 주간)
  function _cycleRvMode() {
    _rvMode = (_rvMode === 'auto') ? 'day' : (_rvMode === 'day') ? 'night' : (_rvMode === 'night') ? 'all' : 'auto';
    _applyRvVisibility();
  }

  function open(address, meter, prefillOldId, editData) {
    // 모달 열리는 즉시 YOLO 모델 워밍업 — 사진 선택 전에 미리 로드해 첫 검출도 빠르게
    if (typeof LcdYolo !== 'undefined') LcdYolo.preload();
    currentAddress = address;
    currentMeter = meter || null;
    _rvMode = 'auto';   // 모달 열 때마다 수동토글 초기화(자동판별)
    editingData = editData || null;
    newPhotoBlob = null;
    keepNewPhotoUrl = null;
    removalPhotoBlobs = {};
    keepRemovalPhotoUrls = {};
    removalPhotoOriginals = {};
    removalPhotoRegions = {};
    _tempPrefilled = { new: false, rv: null };  // 보조앱 temp 불러옴 추적 초기화(재오픈 누수 방지)
    _tempPrefilledData = { readingId: null, meterId: false, mfg: false, regionFid: null };
    _pendingTempPath = null;
    _tempDecisions = {};

    document.getElementById('rpl-modal').classList.add('active');
    _setFormDisabled(false);  // 직전 제출로 잠긴 입력 해제 (재오픈)
    _installBackGuard();   // 안드로이드 뒤로가기 가드 (QR/모달 단계적 닫기)
    document.getElementById('rpl-title-addr').textContent = address;

    // 모달 제목 — 추가 모드는 "계기 추가", 그 외는 "계기 교체 등록"
    const headerH3 = document.querySelector('#rpl-modal h3');
    if (headerH3) {
      headerH3.textContent = !meter ? '계기 추가' : (editData ? '계기 교체 수정' : '계기 교체 등록');
    }

    const isAddMode = !meter;
    const isEditMode = !!editData;

    // 모드별 영역 토글
    document.querySelectorAll('.rpl-add-only').forEach(el => {
      el.style.display = isAddMode ? '' : 'none';
    });
    document.querySelectorAll('.rpl-replace-only').forEach(el => {
      el.style.display = isAddMode ? 'none' : '';
    });

    document.getElementById('rpl-seq').style.display = isAddMode ? 'none' : '';

    // 삭제 버튼 — 수정모드일 때만 노출
    const delBtn = document.getElementById('rpl-delete');
    if (delBtn) delBtn.style.display = isEditMode ? '' : 'none';

    const oldIdInput = document.getElementById('rpl-old-meter-id');
    if (isAddMode) {
      oldIdInput.value = String(prefillOldId || '');
    } else {
      oldIdInput.value = meter.계기번호 || meter.meter_id || '';
    }
    const currentMeterCard = document.getElementById('rpl-current-meter');
    const currentMeterText = document.getElementById('rpl-current-meter-id');
    if (currentMeterCard) currentMeterCard.style.display = isAddMode ? 'none' : '';
    if (currentMeterText) currentMeterText.textContent = isAddMode ? '-' : (oldIdInput.value || '-');

    // 저장 버튼 라벨
    const saveBtn = document.getElementById('rpl-save');
    saveBtn.textContent = isEditMode ? '수정 저장' : '저장';
    saveBtn.disabled = false;

    // 임시 저장 버튼 — 추가 모드에서는 숨김(추가는 11자리만 필요), 교체 모드에서만 노출
    const draftBtn = document.getElementById('rpl-draft');
    if (draftBtn) {
      draftBtn.style.display = isAddMode ? 'none' : '';
      draftBtn.disabled = false;
      draftBtn.textContent = '임시 저장';
    }

    // 완료(저장)된 건만 '임시저장으로 되돌리기' 노출 — 이미 draft(임시저장)면 의미없음
    const revertBtn = document.getElementById('rpl-revert');
    if (revertBtn) {
      revertBtn.style.display = (isEditMode && editingData && !editingData.draft) ? '' : 'none';
      revertBtn.disabled = false;
      revertBtn.textContent = '임시저장으로';
    }

    // 지침 4칸 활성화 — currentMeter의 계약종별·계약전력으로 판별
    // 수정(edit) 모드면 기존 removal_values 키도 union — stats 등 meter에 계약종별 없는 경우 데이터 손실 방지
    activeFields = [];
    if (!isAddMode) {
      const clas = (meter && meter.계약종별) || (meter && meter.CNTR_CLAS_CD) || '';
      const pwr = (meter && meter.계약전력) || 0;
      const baseFields = (typeof readingFieldsFor === 'function')
          ? readingFieldsFor(clas, pwr)
          : ['whme_day'];
      // 기존 저장 데이터에 있는 키도 활성화 (편집 시 손실 방지)
      const savedKeys = (editData && editData.removal_values && typeof editData.removal_values === 'object')
          ? Object.keys(editData.removal_values).filter(k => editData.removal_values[k] != null)
          : [];
      activeFields = ALL_KNOWN_FIELDS.filter(f => baseFields.includes(f) || savedKeys.includes(f));

      // 검침값 자릿수: 단상만 5자리, 나머지(삼상·코드미상)는 6자리
      // (영준님 2026-06-15: '삼상 필터→6'을 뒤집어 '단상 필터→5, 그 외 6'. 알 수 없음 계기도 6으로 빠지게.)
      // 단상 = E(17)/EA(19)/G단상(25·26·27)/Amigo(53). 삼상(45/46/47/55)·코드미상은 6.
      const _mno = String((meter && (meter.계기번호 || meter.meter_id)) || '').replace(/-/g, '').padStart(11, '0');
      const _rvDigits = ['17', '19', '25', '26', '27', '53'].includes(_mno.slice(2, 4)) ? 5 : 6;

      for (const fid of ALL_KNOWN_FIELDS) {
        const els = RV_FIELDS[fid];
        const wrapEl = document.getElementById(els.wrap);
        const inpEl  = document.getElementById(els.input);
        if (!wrapEl || !inpEl) continue;
        const isActive = _rvFieldsFor(activeFields).includes(fid);
        wrapEl.style.display = isActive ? '' : 'none';
        inpEl.value = '';
        inpEl.maxLength = (fid === 'dm_mt_day') ? 7 : _rvDigits;   // 최대전력은 소수점(.) 포함 7자리 (영준님 2026-06-15)
        // 비활성 칸 사진 슬롯 초기화
        if (!isActive) {
          resetPhoto(els.photo);
        }
      }

      // 활성 지침이 1개(단상=주간만 등)면 grid 한 줄을 전체로 사용 (반쪽 방지)
      const _rfWrap = document.getElementById('rpl-removal-fields');
      if (_rfWrap) _rfWrap.classList.toggle('single', activeFields.length <= 1);
    }

    // 신계기 사진 초기화
    resetPhoto('rpl-new-photo');

    if (isEditMode) {
      // removal_values(다칸) 있으면 항목별 채움, 없으면 removal_value(단일→whme_day) 하위호환
      const rvs = editData.removal_values;
      if (rvs && typeof rvs === 'object') {
        for (const fid of ALL_KNOWN_FIELDS) {
          const el = document.getElementById(RV_FIELDS[fid].input);
          if (el) el.value = rvs[fid] != null ? String(rvs[fid]) : '';
        }
      } else {
        // 하위호환: removal_value(단일) → whme_day 칸
        const el = document.getElementById(RV_FIELDS.whme_day.input);
        if (el) el.value = editData.removal_value != null ? String(editData.removal_value) : '';
      }
      document.getElementById('rpl-new-meter-id').value = editData.new_meter_id || '';
      { const _rm = document.getElementById('rpl-remark'); if (_rm) _rm.value = editData.remark || ''; }

      // 신계기 사진 prefill
      if (editData.new_meter_photo) {
        showPhotoUrl('rpl-new-photo', editData.new_meter_photo);
        keepNewPhotoUrl = editData.new_meter_photo;
      }

      // 칸별 사진 prefill — removal_photos 있으면 칸별, 없으면 old_meter_photo → whme_day 하위호환
      const remPhotos = editData.removal_photos;
      for (const fid of activeFields) {
        const els = RV_FIELDS[fid];
        let photoUrl = (remPhotos && remPhotos[fid]) || '';
        // 하위호환: removal_photos 없고 old_meter_photo 있으면 whme_day 슬롯에
        if (!photoUrl && fid === 'whme_day' && editData.old_meter_photo) {
          photoUrl = editData.old_meter_photo;
        }
        if (photoUrl) {
          showPhotoUrl(els.photo, photoUrl);
          keepRemovalPhotoUrls[fid] = photoUrl;
        } else {
          resetPhoto(els.photo);
        }
      }

      // 추가 데이터 복원
      _clearExtraRows();
      if (Array.isArray(editData.extra_data)) {
        for (const row of editData.extra_data) {
          addExtraRow(row);
        }
      }
    } else {
      for (const fid of ALL_KNOWN_FIELDS) {
        const el = document.getElementById(RV_FIELDS[fid].input);
        if (el) el.value = '';
        resetPhoto(RV_FIELDS[fid].photo);
      }
      document.getElementById('rpl-new-meter-id').value = '';
      { const _rm = document.getElementById('rpl-remark'); if (_rm) _rm.value = ''; }
      _clearExtraRows();
    }

    if (!isAddMode) {
      populateMfgSelects();
      if (isEditMode && editData.new_meter_mfg_ym) {
        const [y, m] = String(editData.new_meter_mfg_ym).split('-');
        if (y) document.getElementById('rpl-mfg-y').value = y;
        if (m) document.getElementById('rpl-mfg-m').value = m;
      } else {
        loadLastMfgYm();
      }
      if (isEditMode && editData.daily_seq) {
        // 수정 모드 = 원본 daily_seq 표시 (조절 가능)
        setDailySeq(editData.daily_seq);
      } else {
        loadDailySeq();
      }
    }
  }

  // URL 사진을 슬롯에 미리보기 (수정 모드 prefill용)
  // 사진 선택 — 카메라/앨범 선택 시트 (일부 안드로이드는 accept만으론 카메라 안 띄움 → 명시 선택)
  function triggerPhotoPick(inputEl) {
    if (!inputEl) return;
    // iOS Safari는 OS가 '사진 보관함/사진 찍기' 선택을 자동 제공 → 우리 시트 생략, 바로 OS 선택
    // (동적 시트 버튼의 input.click()이 iOS에서 사용자 제스처 밖으로 간주돼 막히는 문제도 회피)
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      inputEl.removeAttribute('capture');
      inputEl.click();
      return;
    }
    const sheet = document.createElement('div');
    sheet.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;justify-content:center;';
    sheet.innerHTML = '<div style="width:100%;max-width:420px;margin:10px;display:flex;flex-direction:column;gap:10px;">'
      + '<button data-act="cam" style="padding:15px;border:none;border-radius:var(--radius-pill,999px);background:var(--surface,#f6f4ef);color:var(--ink,#2c2a27);font-size:16px;font-weight:800;font-family:var(--font);box-shadow:var(--clay-sm);">카메라로 촬영</button>'
      + '<button data-act="alb" style="padding:15px;border:none;border-radius:var(--radius-pill,999px);background:linear-gradient(145deg,#bbe8d0,#93d2af);color:var(--mint-deep,#2c5e44);font-size:16px;font-weight:800;font-family:var(--font);box-shadow:var(--clay-mint);">앨범에서 선택</button>'
      + '<button data-act="cancel" style="padding:15px;border:none;border-radius:var(--radius-pill,999px);background:var(--bg-deep,#ddd9d0);color:var(--ink-2,#6f6b62);font-size:16px;font-weight:800;font-family:var(--font);box-shadow:var(--clay-inset-sm);">취소</button></div>';
    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    sheet.addEventListener('click', (e) => {
      const act = (e.target && e.target.dataset) ? e.target.dataset.act : null;
      if (act === 'cam') { inputEl.setAttribute('capture', 'environment'); inputEl.dataset.square = '1'; inputEl.click(); close(); }
      else if (act === 'alb') { inputEl.removeAttribute('capture'); delete inputEl.dataset.square; inputEl.click(); close(); }
      else if (act === 'cancel' || e.target === sheet) { close(); }
    });
  }

  function showPhotoUrl(slotId, url) {
    const slot = document.getElementById(slotId);
    if (!slot) return;
    slot.classList.add('has-photo');
    slot.querySelector('.rpl-photo-preview').src = url;
  }

  function close() {
    _teardownBackGuard(true);
    document.getElementById('rpl-modal').classList.remove('active');
  }

  // ── 안드로이드 뒤로가기 가드 (모달/QR 단계적 닫기) — 2026-06-09 ──
  // 모달 열 때 history 한 칸 push → 뒤로가기(popstate)를 가로채:
  //   QR 떠있으면 QR만 닫고 모달 유지(다시 push) / 아니면 모달 닫기.
  // 미설치 시 안드로이드 뒤로가기가 교체 모달을 통째로 닫아 입력 전부 소실되던 버그 수정.
  let _backGuarded = false;
  function _qrIsOpen() {
    const o = document.getElementById('qr-scan-overlay');
    return !!o && getComputedStyle(o).display !== 'none';
  }
  function _onModalPop() {
    if (_qrIsOpen()) {
      try { QrScanner.stop(); } catch (e) {}
      const o = document.getElementById('qr-scan-overlay'); if (o) o.style.display = 'none';
      history.pushState({ rplModal: 1 }, '');   // 모달 레벨 history 복구 (모달·입력 유지)
      return;
    }
    // QR 없음 → 모달 닫기 (우리 state는 이미 pop됨)
    _backGuarded = false;
    window.removeEventListener('popstate', _onModalPop);
    document.getElementById('rpl-modal').classList.remove('active');
  }
  function _installBackGuard() {
    if (_backGuarded) return;
    _backGuarded = true;
    history.pushState({ rplModal: 1 }, '');
    window.addEventListener('popstate', _onModalPop);
  }
  function _teardownBackGuard(popSelf) {
    if (!_backGuarded) return;
    _backGuarded = false;
    window.removeEventListener('popstate', _onModalPop);
    if (popSelf && history.state && history.state.rplModal) history.back();
  }

  function resetPhoto(slotId) {
    const slot = document.getElementById(slotId);
    if (!slot) return;
    slot.classList.remove('has-photo');
    slot.querySelector('.rpl-photo-preview').src = '';
  }

  function setPhoto(slotId, blob) {
    const slot = document.getElementById(slotId);
    if (!slot) return;
    slot.classList.add('has-photo');
    const url = URL.createObjectURL(blob);
    slot.querySelector('.rpl-photo-preview').src = url;
    const field = slot.dataset && slot.dataset.field;
    if (field && RV_FIELDS[field]) {
      // 지침칸 사진 — 칸별 blob 저장
      removalPhotoBlobs[field] = blob;
      if (_tempPrefilled && _tempPrefilled.rv === field) _tempPrefilled.rv = null;  // 사용자 직접 촬영 → temp 추적 해제(보존)
    } else if (slotId === 'rpl-new-photo') {
      newPhotoBlob = blob;
      if (_tempPrefilled) _tempPrefilled.new = false;
    }
  }

  function populateMfgSelects() {
    const ySel = document.getElementById('rpl-mfg-y');
    const mSel = document.getElementById('rpl-mfg-m');
    if (ySel.options.length === 0) {
      const now = new Date().getFullYear();
      for (let y = now; y >= now - 5; y--) {
        const opt = document.createElement('option');
        opt.value = String(y); opt.textContent = `${y}년`;
        ySel.appendChild(opt);
      }
    }
    if (mSel.options.length === 0) {
      for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = String(m).padStart(2, '0'); opt.textContent = `${m}월`;
        mSel.appendChild(opt);
      }
    }
  }

  function loadLastMfgYm() {
    const last = localStorage.getItem('rpl_last_mfg_ym') || '';
    const [y, m] = last.split('-');
    if (y) document.getElementById('rpl-mfg-y').value = y;
    if (m) document.getElementById('rpl-mfg-m').value = m;
  }

  function saveLastMfgYm(y, m) {
    localStorage.setItem('rpl_last_mfg_ym', `${y}-${m}`);
  }

  // 오늘 자정 (KST 강제)
  function todayStartMs() {
    return kstTodayStartMs();
  }

  // 같은 작업자 그날 이미 쓰인 daily_seq Set (자기 원본은 제외 — 수정모드면 자기 자리 유지)
  function usedSeqsToday() {
    const session = (typeof authGetSession === 'function') ? authGetSession() : null;
    const me = (editingData && editingData.worker)
      || (session ? (session.id || session.username || session.name) : '');
    const selfId = editingData && editingData.old_meter_id;
    const used = new Set();
    try {
      const start = todayStartMs();
      const ws = (typeof workStatus !== 'undefined') ? workStatus : {};
      for (const addr in ws) {
        const rl = ws[addr] && ws[addr].replacement_list;
        if (!rl) continue;
        for (const k in rl) {
          const r = rl[k];
          if (!r) continue;
          // [통합 daily_seq] worker 무관 — 계기팀2+통신팀2 한 팀이라 그날 전체 통합 번호 (영준님 2026-06-03)
          if (typeof r.replaced_at !== 'number' || r.replaced_at < start) continue;
          // 자기 자신은 used에서 제외 (수정모드)
          if (selfId && String(r.old_meter_id) === String(selfId)) continue;
          if (typeof r.daily_seq === 'number') used.add(r.daily_seq);
        }
      }
    } catch (e) {}
    return used;
  }

  // 현재 표시 중인 daily_seq (사용자 조절 가능)
  function getDailySeq() {
    const el = document.getElementById('rpl-seq-num');
    return Math.max(1, parseInt(el && el.textContent, 10) || 1);
  }
  function setDailySeq(n) {
    const el  = document.getElementById('rpl-seq-num');
    const dec = document.getElementById('rpl-seq-dec');
    const inc = document.getElementById('rpl-seq-inc');
    const val = Math.max(1, n | 0);
    if (el) el.textContent = String(val);
    // 버튼 활성/비활성 — 다음 미할당 자리가 있는지 미리 보고 결정
    const used = usedSeqsToday();
    let canDec = false;
    for (let i = val - 1; i >= 1; i--) {
      if (!used.has(i)) { canDec = true; break; }
    }
    if (dec) dec.disabled = !canDec;
    if (inc) inc.disabled = false; // 위로는 항상 가능 (상한 없음)
    prefillTempForSeq(val);  // 보조앱(snap) temp 사진이 이 작업번호에 있으면 물어보고 불러옴
  }

  // 보조앱(snap)이 미할당으로 올린 temp 사진을 작업번호별로 처리.
  //  - temp가 있고 빈 칸이 있으면 confirm으로 "이 계기로 불러올까요?" 물어봄(이게 할당 확정).
  //    temp 작업번호 = 보조앱 입력번호라 다른 계기일 수 있어 자동 흡수 대신 사람이 확정해야 함(영준님 지시).
  //  - 예 → 빈 칸만 채우고(showPhotoUrl+keep) 저장 성공 시 temp 노드 삭제 예약.
  //  - 작업번호별 결정(_tempDecisions)을 기억해 +/- 왕복 시 재질문 안 함.
  // _tempPrefilled = 이번 불러옴으로 채운 슬롯 추적(작업번호 바뀌면 비움). 사용자가 직접 찍으면 setPhoto가 추적 해제.
  let _tempPrefillToken = 0;
  let _tempPrefilled = { new: false, rv: null };
  let _tempPrefilledData = { readingId: null, meterId: false, mfg: false, regionFid: null };  // 불러온 데이터칸 추적
  let _pendingTempPath = null;   // 수락된 temp 경로 — 저장 성공 시 삭제
  let _tempDecisions = {};       // { seq: 'yes'|'no' } 이번 모달의 작업번호별 결정
  function _clearTempPrefilled() {
    if (_tempPrefilled.new) { keepNewPhotoUrl = null; resetPhoto('rpl-new-photo'); _tempPrefilled.new = false; }
    if (_tempPrefilled.rv) { delete keepRemovalPhotoUrls[_tempPrefilled.rv]; resetPhoto(RV_FIELDS[_tempPrefilled.rv].photo); _tempPrefilled.rv = null; }
    // 불러온 데이터칸 비우기 (사용자가 직접 입력한 칸은 애초에 안 채웠으니 안전)
    if (_tempPrefilledData.readingId) { const el = document.getElementById(_tempPrefilledData.readingId); if (el) el.value = ''; _tempPrefilledData.readingId = null; }
    if (_tempPrefilledData.meterId) { const el = document.getElementById('rpl-new-meter-id'); if (el) el.value = ''; _tempPrefilledData.meterId = false; }
    if (_tempPrefilledData.mfg) { if (typeof loadLastMfgYm === 'function') loadLastMfgYm(); _tempPrefilledData.mfg = false; }
    if (_tempPrefilledData.regionFid) { delete removalPhotoRegions[_tempPrefilledData.regionFid]; _tempPrefilledData.regionFid = null; }
    _pendingTempPath = null;
  }
  async function prefillTempForSeq(seq) {
    const myToken = ++_tempPrefillToken;
    _clearTempPrefilled();  // 직전 작업번호의 불러온 값 제거(사용자 직접 입력분은 setPhoto/빈칸가드로 보존)
    try {
      if (typeof db === 'undefined' || !db) return;
      if (_tempDecisions[seq] === 'no') return;  // 이미 '아니오' → 더 안 물음
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const tmp = (await db.ref(`tempPhotos/jongno/${day}/${seq}`).once('value')).val();
      if (myToken !== _tempPrefillToken) return;  // 그 사이 작업번호 또 바뀜 → 무시
      if (!tmp) return;

      // firstActive(대표 철거칸) — 계약종별 기준, 기본 whme_day
      const clas = currentMeter ? (currentMeter.계약종별 || currentMeter.CNTR_CLAS_CD || '') : '';
      const pwr = currentMeter ? (currentMeter.계약전력 || 0) : 0;
      const bf = (typeof readingFieldsFor === 'function') ? readingFieldsFor(clas, pwr) : ['whme_day'];
      const firstActive = (ALL_KNOWN_FIELDS.filter(f => bf.includes(f))[0]) || 'whme_day';
      const readingId = RV_FIELDS[firstActive] ? RV_FIELDS[firstActive].input : 'rpl-rv-whme-day';
      const meterIdEl = document.getElementById('rpl-new-meter-id');

      // 검침값 — snap 멀티필드(removal_values{fid}) 우선, 없으면 구스키마 단일(removal_value→firstActive) 하위호환
      const tmpRV = (tmp.removal_values && typeof tmp.removal_values === 'object') ? tmp.removal_values : null;
      const tmpRVfields = tmpRV ? ALL_KNOWN_FIELDS.filter(f => tmpRV[f] != null)
                                : (tmp.removal_value != null ? [firstActive] : []);
      const tmpRVval = (fid) => (tmpRV ? tmpRV[fid] : tmp.removal_value);
      // 채울 수 있는 빈 항목 판별 (이미 채워진 칸·사용자 입력칸은 안 건드림)
      const canNewPhoto = !!(tmp.new_meter_photo && !newPhotoBlob && !keepNewPhotoUrl);
      const canRvPhoto  = !!(tmp.removal_photo && !removalPhotoBlobs[firstActive] && !keepRemovalPhotoUrls[firstActive]);
      const rdEl = document.getElementById(readingId);
      const canReading  = tmpRVfields.some(fid => { const el = document.getElementById(RV_FIELDS[fid].input); return el && !String(el.value || '').trim(); });
      const canMeterId  = !!(tmp.new_meter_id && meterIdEl && !String(meterIdEl.value || '').trim());
      const canMfg      = !!(tmp.new_meter_mfg_ym);
      const canRegion   = !!(tmp.removal_lcd_region && !removalPhotoRegions[firstActive]);
      if (!canNewPhoto && !canRvPhoto && !canReading && !canMeterId && !canRegion) return;  // 채울 것 없음

      // 결정 받기 — 이번 모달서 이 작업번호 처음이면 confirm(오/예스)
      let decision = _tempDecisions[seq];
      if (!decision) {
        const parts = [];
        if (canRvPhoto) parts.push('철거사진');
        if (canNewPhoto) parts.push('새계기사진');
        if (canReading) parts.push('검침값');
        if (canMeterId) parts.push('계기번호');
        decision = confirm(
          `보조앱에 작업번호 ${seq}번으로 올린 ${parts.join('·')}이(가) 있어요.\n\n` +
          `이 계기 교체 건으로 불러올까요?\n` +
          `(아니오 = 안 쓰고 직접 입력)`
        ) ? 'yes' : 'no';
        _tempDecisions[seq] = decision;
      }
      if (decision !== 'yes') return;

      // 수락 → 빈 칸만 채우기 + 저장 시 삭제 예약
      if (canNewPhoto) { showPhotoUrl('rpl-new-photo', tmp.new_meter_photo); keepNewPhotoUrl = tmp.new_meter_photo; _tempPrefilled.new = true; }
      if (canRvPhoto)  { showPhotoUrl(RV_FIELDS[firstActive].photo, tmp.removal_photo); keepRemovalPhotoUrls[firstActive] = tmp.removal_photo; _tempPrefilled.rv = firstActive; }
      // 흡수값을 사용자가 직접 고치면 추적 해제 → 작업번호 변경 시 _clearTempPrefilled가 안 지움(수정 보존).
      //   메인앱 입력칸은 readonly 아님 → 종로앱에서 자유롭게 수정 가능(영준님 지시).
      if (canReading)  {
        // 멀티필드(또는 비주간 단일)면 4칸 모드로 펼쳐 모두 채움 — snap이 넣은 야간/무효/최대 소멸 방지
        if (tmpRVfields.length > 1 || (tmpRVfields[0] && tmpRVfields[0] !== 'whme_day')) { _rvMode = 'all'; _applyRvVisibility(); }
        for (const fid of tmpRVfields) {
          const el = document.getElementById(RV_FIELDS[fid].input);
          if (!el || String(el.value || '').trim()) continue;
          el.value = String(tmpRVval(fid));
        }
        _tempPrefilledData.readingId = readingId;
        if (rdEl && !rdEl._absorbGuard) { rdEl._absorbGuard = true; rdEl.addEventListener('input', () => { if (_tempPrefilledData.readingId === readingId) _tempPrefilledData.readingId = null; }); } }
      if (canMeterId)  { meterIdEl.value = String(tmp.new_meter_id); _tempPrefilledData.meterId = true;
        if (!meterIdEl._absorbGuard) { meterIdEl._absorbGuard = true; meterIdEl.addEventListener('input', () => { _tempPrefilledData.meterId = false; }); } }
      if (canMfg) {
        const [yy, mm] = String(tmp.new_meter_mfg_ym).split('-');
        const ysel = document.getElementById('rpl-mfg-y'), msel = document.getElementById('rpl-mfg-m');
        if (ysel && msel && yy && mm) { ysel.value = yy; msel.value = mm; _tempPrefilledData.mfg = true; }
      }
      if (canRegion)   { removalPhotoRegions[firstActive] = tmp.removal_lcd_region; _tempPrefilledData.regionFid = firstActive; }
      _pendingTempPath = `tempPhotos/jongno/${day}/${seq}`;
      toast(`보조앱 입력을 불러왔어요 (작업번호 ${seq}번)`);
    } catch (e) { console.warn('[보조앱 temp] 실패(무시)', e); }
  }

  // 이전/다음 빈 자리(미할당)를 찾아 이동 — used 자리는 스킵
  function stepDailySeq(dir) {
    const used = usedSeqsToday();
    let cur = getDailySeq();
    if (dir < 0) {
      for (let i = cur - 1; i >= 1; i--) {
        if (!used.has(i)) { setDailySeq(i); return; }
      }
    } else {
      for (let i = cur + 1; i <= cur + 10000; i++) {
        if (!used.has(i)) { setDailySeq(i); return; }
      }
    }
  }

  // Firebase workStatus 순회 → 빈 자리 중 가장 낮은 번호 (없으면 max+1)
  function loadDailySeq() {
    const used = usedSeqsToday();
    let maxUsed = 0;
    used.forEach(n => { if (n > maxUsed) maxUsed = n; });
    // 1..maxUsed 사이에 빈자리 있으면 거기, 없으면 maxUsed+1
    let pick = maxUsed + 1;
    for (let i = 1; i <= maxUsed; i++) {
      if (!used.has(i)) { pick = i; break; }
    }
    setDailySeq(pick);
  }

  function toast(msg) {
    const t = document.getElementById('rpl-toast');
    t.textContent = msg;
    t.classList.add('active');
    setTimeout(() => t.classList.remove('active'), 2000);
  }

  // 카메라 촬영 판별 — 촬영본만 1:1 강제(앨범 업로드는 원본 비율 유지)
  // Android: 선택 시트에서 '카메라' 누르면 input.dataset.square='1' (확실)
  // iOS: capture 못 쓰는 구조(시트→click 제스처 차단) → 방금 촬영(15초 이내) 휴리스틱
  function isCameraShot(inputEl, file) {
    if (inputEl && inputEl.dataset && inputEl.dataset.square === '1') return true;
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) && file && file.lastModified
        && (Date.now() - file.lastModified) < 15000) return true;
    return false;
  }

  async function onPhotoSelect(slotId, file, square = false) {
    if (!file) return;
    // 삼성 파일피커의 content:// 파일은 동시/다중 createImageBitmap 시 디코드 실패.
    // 메모리 Blob으로 1회 materialize → compress/detect/편집기/크롭 모두 안전 재사용.
    let mem = file;
    try {
      const buf = await file.arrayBuffer();
      mem = new Blob([buf], { type: file.type || 'image/jpeg' });
    } catch (e) { console.warn('파일 메모리화 실패, 원본 사용', e); }

    const slotEl = document.getElementById(slotId);
    const field = slotEl && slotEl.dataset && slotEl.dataset.field;
    if (field && RV_FIELDS[field]) {
      removalPhotoOriginals[field] = mem;  // 고화질 LCD 크롭본 생성용 (메모리본)
    }
    try {
      const compressed = await PhotoUploader.compress(mem, { square });
      setPhoto(slotId, compressed);
    } catch (e) {
      console.warn('압축 실패, 원본 사용', e);
      setPhoto(slotId, mem);
    }
    // 지침칸이면 LCD 영역 편집기 — 즉시 열고, YOLO 검출은 백그라운드로 (기다리지 않음)
    if (field && RV_FIELDS[field]) {
      // 검출 프로미스 — 편집기 열기를 막지 않음. 끝나면 박스 자동 스냅(유저 미조작 시)
      const detectPromise = (typeof LcdYolo !== 'undefined')
        ? LcdYolo.detect(mem).catch(err => { console.warn('[LcdYolo] 검출 실패', err); return null; })
        : Promise.resolve(null);
      try {
        await openLcdEditor(field, mem, detectPromise);
      } catch (e) { console.warn('LCD편집기', e); }
    }
  }

  // ── LCD 영역 편집기 — 전체화면 오버레이 ──────────────────────────────
  async function openLcdEditor(field, origFile, detectPromise = null) {
    const bmp = await createImageBitmap(origFile);
    const iw = bmp.width;
    const ih = bmp.height;

    // 오버레이 DOM 생성
    const overlay = document.createElement('div');
    overlay.className = 'lcd-editor-overlay';

    const guide = document.createElement('div');
    guide.className = 'lcd-editor-guide';
    guide.textContent = '검침값 화면(LCD)을 드래그하거나, 두 모서리를 탭해서 감싸주세요. 모서리로 미세조정.';

    const canvas = document.createElement('canvas');
    canvas.className = 'lcd-editor-canvas';
    canvas.style.touchAction = 'none';

    const footer = document.createElement('div');
    footer.className = 'lcd-editor-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'lcd-editor-btn lcd-editor-btn-cancel';
    cancelBtn.textContent = '취소';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'lcd-editor-btn lcd-editor-btn-confirm';
    confirmBtn.textContent = '확인';
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    overlay.appendChild(guide);
    overlay.appendChild(canvas);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);

    // canvas CSS 크기 = 화면 가용 영역
    const HEADER_H = 56; // 안내문
    const FOOTER_H = 72; // 버튼 영역
    const cssW = window.innerWidth;
    const cssH = window.innerHeight - HEADER_H - FOOTER_H;
    canvas.width  = cssW;
    canvas.height = cssH;

    const ctx = canvas.getContext('2d');

    // letterbox 변환 계산 (이미지→canvas, 비율 유지)
    function calcLetterbox() {
      const scale = Math.min(cssW / iw, cssH / ih);
      const drawW = iw * scale;
      const drawH = ih * scale;
      const offX = (cssW - drawW) / 2;
      const offY = (cssH - drawH) / 2;
      return { scale, offX, offY, drawW, drawH };
    }
    const lb = calcLetterbox();

    // 정규화 ↔ canvas 픽셀 변환
    function normToCanvas(norm) {
      return {
        x: norm.x0 * lb.drawW + lb.offX,
        y: norm.y0 * lb.drawH + lb.offY,
        x1: norm.x1 * lb.drawW + lb.offX,
        y1: norm.y1 * lb.drawH + lb.offY,
      };
    }
    function canvasToNorm(cx0, cy0, cx1, cy1) {
      const x0 = Math.max(0, Math.min(1, (cx0 - lb.offX) / lb.drawW));
      const y0 = Math.max(0, Math.min(1, (cy0 - lb.offY) / lb.drawH));
      const x1 = Math.max(0, Math.min(1, (cx1 - lb.offX) / lb.drawW));
      const y1 = Math.max(0, Math.min(1, (cy1 - lb.offY) / lb.drawH));
      return { x0, y0, x1, y1 };
    }

    // 현재 박스 (정규화)
    const DEF = (typeof LcdCrop !== 'undefined') ? LcdCrop.REGION : { x0: 0.15, x1: 0.85, y0: 0.35, y1: 0.55 };
    let box = removalPhotoRegions[field]
      ? Object.assign({}, removalPhotoRegions[field])
      : Object.assign({}, DEF);

    const HANDLE_PX = 24;   // 핸들 터치 여유(px)
    const MIN_NORM  = 0.05; // 최소 박스 크기 (정규화)

    let userTouched = false; // 유저가 손대면 YOLO 스냅 중단 (수동 우선)

    // YOLO 검출이 백그라운드에서 끝나면 박스 자동 스냅 (유저 미조작 시에만)
    if (detectPromise) {
      detectPromise.then(bbox => {
        if (bbox && !userTouched) {
          box = clampBox({ x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 });
          redraw();
        }
      }).catch(() => {});
    }

    // 핸들 판별 — canvas 좌표 기준
    // 반환: 'nw'|'ne'|'sw'|'se'|'move'|'new'|null
    function hitTest(cx, cy) {
      const c = normToCanvas(box);
      // 네 모서리
      const corners = [
        { name: 'nw', px: c.x,  py: c.y  },
        { name: 'ne', px: c.x1, py: c.y  },
        { name: 'sw', px: c.x,  py: c.y1 },
        { name: 'se', px: c.x1, py: c.y1 },
      ];
      for (const co of corners) {
        if (Math.abs(cx - co.px) < HANDLE_PX && Math.abs(cy - co.py) < HANDLE_PX) return co.name;
      }
      // 모서리 외에는 어디든 드래그 = 새 박스 그리기 (폰에서 가장 쉬움)
      return 'new';
    }

    // 박스 이미지 경계 clamp + 최소 크기 보장
    function clampBox(b) {
      let { x0, y0, x1, y1 } = b;
      x0 = Math.max(0, x0); y0 = Math.max(0, y0);
      x1 = Math.min(1, x1); y1 = Math.min(1, y1);
      if (x1 - x0 < MIN_NORM) x1 = Math.min(1, x0 + MIN_NORM);
      if (y1 - y0 < MIN_NORM) y1 = Math.min(1, y0 + MIN_NORM);
      return { x0, y0, x1, y1 };
    }

    function redraw() {
      ctx.clearRect(0, 0, cssW, cssH);
      // 이미지 (letterbox)
      ctx.drawImage(bmp, lb.offX, lb.offY, lb.drawW, lb.drawH);
      // 다크 오버레이 — 박스 밖 4개 사각형으로 분할 (cutout 방식 회피)
      const c = normToCanvas(box);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, cssW, c.y);                         // 위
      ctx.fillRect(0, c.y1, cssW, cssH - c.y1);              // 아래
      ctx.fillRect(0, c.y, c.x, c.y1 - c.y);                // 왼쪽
      ctx.fillRect(c.x1, c.y, cssW - c.x1, c.y1 - c.y);     // 오른쪽
      // 박스 테두리
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x, c.y, c.x1 - c.x, c.y1 - c.y);
      // 네 모서리 핸들
      const hw = 10;
      ctx.fillStyle = '#34d399';
      const handles = [
        [c.x,  c.y  ],
        [c.x1, c.y  ],
        [c.x,  c.y1 ],
        [c.x1, c.y1 ],
      ];
      for (const [hx, hy] of handles) {
        ctx.fillRect(hx - hw / 2, hy - hw / 2, hw, hw);
      }
      // 투클릭 첫 점 표시 (주황 원)
      if (pendingClick) {
        const px = pendingClick.x * lb.drawW + lb.offX;
        const py = pendingClick.y * lb.drawH + lb.offY;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Pointer 이벤트 상태
    let drag = null; // { type, startNorm, startBox, startCx, startCy, moved }
    let pendingClick = null; // 투클릭: 첫 탭 점 (정규화 {x,y})

    function getCanvasXY(e) {
      const rect = canvas.getBoundingClientRect();
      return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      userTouched = true; // 유저 조작 시작 → YOLO 스냅 무시
      canvas.setPointerCapture(e.pointerId);
      const { cx, cy } = getCanvasXY(e);
      const hit = hitTest(cx, cy);
      drag = {
        type: hit,
        startCx: cx, startCy: cy,
        startBox: Object.assign({}, box),
        moved: false,
      };
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      e.preventDefault();
      const { cx, cy } = getCanvasXY(e);
      // 미세 떨림은 탭으로 유지 — 6px 넘게 움직여야 드래그
      if (!drag.moved && (Math.abs(cx - drag.startCx) + Math.abs(cy - drag.startCy)) < 6) return;
      drag.moved = true;
      const dx = (cx - drag.startCx) / lb.drawW;
      const dy = (cy - drag.startCy) / lb.drawH;
      const sb = drag.startBox;

      if (drag.type === 'move') {
        const w = sb.x1 - sb.x0;
        const h = sb.y1 - sb.y0;
        let nx0 = sb.x0 + dx;
        let ny0 = sb.y0 + dy;
        nx0 = Math.max(0, Math.min(1 - w, nx0));
        ny0 = Math.max(0, Math.min(1 - h, ny0));
        box = { x0: nx0, y0: ny0, x1: nx0 + w, y1: ny0 + h };
      } else if (drag.type === 'new') {
        const norm0 = canvasToNorm(drag.startCx, drag.startCy, drag.startCx, drag.startCy);
        const ax0 = norm0.x0, ay0 = norm0.y0;
        const ax1 = Math.max(0, Math.min(1, ax0 + (cx - drag.startCx) / lb.drawW));
        const ay1 = Math.max(0, Math.min(1, ay0 + (cy - drag.startCy) / lb.drawH));
        box = clampBox({
          x0: Math.min(ax0, ax1), y0: Math.min(ay0, ay1),
          x1: Math.max(ax0, ax1), y1: Math.max(ay0, ay1),
        });
      } else {
        // 리사이즈 — 모서리 이동
        let nx0 = sb.x0, ny0 = sb.y0, nx1 = sb.x1, ny1 = sb.y1;
        if (drag.type === 'nw' || drag.type === 'sw') nx0 = sb.x0 + dx;
        if (drag.type === 'ne' || drag.type === 'se') nx1 = sb.x1 + dx;
        if (drag.type === 'nw' || drag.type === 'ne') ny0 = sb.y0 + dy;
        if (drag.type === 'sw' || drag.type === 'se') ny1 = sb.y1 + dy;
        box = clampBox({
          x0: Math.min(nx0, nx1), y0: Math.min(ny0, ny1),
          x1: Math.max(nx0, nx1), y1: Math.max(ny0, ny1),
        });
      }
      redraw();
    });

    canvas.addEventListener('pointerup', (e) => {
      e.preventDefault();
      if (drag && !drag.moved && drag.type === 'new') {
        // 탭(안 움직임, 모서리 아님) = 투클릭 영역 지정
        const p = canvasToNorm(drag.startCx, drag.startCy, drag.startCx, drag.startCy);
        if (pendingClick) {
          box = clampBox({
            x0: Math.min(pendingClick.x, p.x0), y0: Math.min(pendingClick.y, p.y0),
            x1: Math.max(pendingClick.x, p.x0), y1: Math.max(pendingClick.y, p.y0),
          });
          pendingClick = null;
        } else {
          pendingClick = { x: p.x0, y: p.y0 };
        }
        redraw();
      }
      drag = null;
    });

    redraw();

    // 확인/취소 Promise
    return new Promise((resolve) => {
      function done(confirmed) {
        bmp.close && bmp.close();
        overlay.remove();
        if (confirmed) {
          const r = {
            x0: Math.min(box.x0, box.x1),
            y0: Math.min(box.y0, box.y1),
            x1: Math.max(box.x0, box.x1),
            y1: Math.max(box.y0, box.y1),
          };
          removalPhotoRegions[field] = r;
          // 슬롯에 영역 지정 시각 표시
          const slotEl = document.getElementById(RV_FIELDS[field].photo);
          if (slotEl) slotEl.classList.add('lcd-region-set');
        }
        resolve();
      }
      confirmBtn.onclick = () => done(true);
      cancelBtn.onclick  = () => done(false);
    });
  }

  async function onQrScanClick() {
    if (typeof QrScanner === 'undefined') {
      return toast('QR 스캐너 미로드');
    }
    // 향후 모뎀 MAC 스캔도 동일 스캐너+parseValue 재사용 가능 (별도 분기 불필요)
    QrScanner.show((text, photoBlob) => {
      const raw = String(text || '').replace(/\*/g, '');

      // awms 검증 parseValue로 다양한 제조사 QR/바코드 포맷 처리
      // value = 계기번호/모뎀번호, value2 = 제조년월 "YYYYMM" 6자리 (없으면 빈 문자열)
      const parsed = (typeof parseValue === 'function') ? parseValue(raw) : { value: raw, value2: '' };

      let meterId = String(parsed.value || raw).toUpperCase();
      if (meterId.length > 11) meterId = meterId.slice(0, 11);
      // [QR 강화 2026-06-15] 계기번호 타입코드(3~4자리) 검증 — 계기번호 아닌 다른 바코드(예 51379112262, 코드37) 스캔 차단.
      //   유효 타입: E(17)/EA(19)/G(25·26·27·45·46·47)/Amigo(53·55). 그 외 = 잘못 스캔 → 안 채우고 재스캔 유도.
      const VALID_TYPE = ['17', '19', '25', '26', '27', '45', '46', '47', '53', '55'];
      // 형식: 11자리 + 타입코드(3~4자리) + 앞 2자리 제외 나머지 9자리 숫자(앞 2자리는 영문 등 허용 — A형 계기 수용).
      // 그래도 벗어나면 거부 대신 확인 — 작업자가 [확인]하면 넣는다(정상계기 차단 방지).
      const _validFmt = /^.{2}\d{9}$/.test(meterId) && VALID_TYPE.includes(meterId.slice(2, 4));
      if (!_validFmt) {
        if (!confirm(`계기번호 형식과 달라요: ${meterId}\n\n계기번호가 맞으면 [확인], 잘못 스캔이면 [취소].`)) {
          return;  // 취소 시에만 안 채움
        }
      }
      document.getElementById('rpl-new-meter-id').value = meterId;

      // 제조년월 자동 입력 — value2 = "YYYYMM" (예: "202411")
      let ymToast = '';
      const v2 = String(parsed.value2 || '');
      if (/^\d{6}$/.test(v2)) {
        const fullY = v2.slice(0, 4);
        const mm = v2.slice(4, 6);
        const ySel = document.getElementById('rpl-mfg-y');
        const mSel = document.getElementById('rpl-mfg-m');
        // 옵션 없으면 추가 (오래된 QR 대비)
        if (ySel && ![...ySel.options].some(o => o.value === fullY)) {
          const opt = document.createElement('option');
          opt.value = fullY; opt.textContent = `${fullY}년`;
          ySel.appendChild(opt);
        }
        if (ySel) ySel.value = fullY;
        if (mSel) mSel.value = mm;
        ymToast = ` / 제조 ${fullY}-${mm}`;
      }

      // 사진은 자동 첨부 X — 사용자가 직접 후사진 촬영 (영준님 지시 2026-05-21)
      toast(`QR 인식: ${meterId}${ymToast}`);
    });
  }

  // ── 추가 데이터 행 관리 ────────────────────────────────────────

  function _clearExtraRows() {
    const container = document.getElementById('rpl-extra-rows');
    if (container) container.innerHTML = '';
    extraRows = [];
  }

  function addExtraRow(prefill) {
    const container = document.getElementById('rpl-extra-rows');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'rpl-extra-row';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'ex-label';
    labelInput.placeholder = '항목명';
    if (prefill && prefill.label) labelInput.value = prefill.label;

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'ex-value';
    valueInput.placeholder = '값';
    if (prefill && prefill.value) valueInput.value = prefill.value;

    const photoBtn = document.createElement('button');
    photoBtn.type = 'button';
    photoBtn.className = 'ex-photo-btn';
    photoBtn.textContent = '사진';
    if (prefill && prefill.photo_url) {
      photoBtn.classList.add('has');
      photoBtn.title = prefill.photo_url;
      // blob은 없으나 기존 URL 보존 — 저장 시 keepUrl로 사용
      photoBtn.dataset.keepUrl = prefill.photo_url;
    }

    const photoInput = document.createElement('input');
    photoInput.type = 'file';
    photoInput.accept = 'image/*';
    photoInput.style.display = 'none';
    photoInput.className = 'ex-photo-input';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ex-del';
    delBtn.textContent = '×';

    row.appendChild(labelInput);
    row.appendChild(valueInput);
    row.appendChild(photoBtn);
    row.appendChild(photoInput);
    row.appendChild(delBtn);

    container.appendChild(row);
    extraRows.push(row);
  }

  // 추가 데이터 수집 (save 시 호출) — label/value/photo_url 중 하나라도 있는 행만
  async function collectExtraRows(baseDir, dryRun) {
    const results = [];
    for (let i = 0; i < extraRows.length; i++) {
      const row = extraRows[i];
      if (!row.parentNode) continue; // 삭제된 행
      const label = (row.querySelector('.ex-label') || {}).value || '';
      const value = (row.querySelector('.ex-value') || {}).value || '';
      const photoBtn = row.querySelector('.ex-photo-btn');
      const photoInput = row.querySelector('.ex-photo-input');
      const blob = photoInput && photoInput._blob;
      const keepUrl = (photoBtn && photoBtn.dataset.keepUrl) || '';

      let photo_url = keepUrl;
      if (blob && !dryRun) {
        try {
          const res = await PhotoUploader.compressAndUpload(blob, `${baseDir}/extra_${i}.jpg`);
          photo_url = res.url || '';
        } catch (e) {
          console.warn('추가데이터 사진 업로드 실패', e);
        }
      }

      if (label || value || photo_url) {
        results.push({ label, value, photo_url });
      }
    }
    return results;
  }

  // 제출(저장/임시저장) 시 모달 입력 잠금 — 처리 중·완료 후 값 수정/재제출 방지
  function _setFormDisabled(disabled) {
    const modal = document.getElementById('rpl-modal');
    if (!modal) return;
    modal.querySelectorAll('input, select, .rpl-alpha-btn, .rpl-alpha-btn-new, .rpl-qr-btn, .rpl-photo, #rpl-seq-dec, #rpl-seq-inc, #rpl-extra-add')
      .forEach(el => { try { el.disabled = disabled; } catch (e) {} el.style.pointerEvents = disabled ? 'none' : ''; });
  }

  async function onSave(isDraft) {
    const isAddMode = !currentMeter;
    const oldMeterId = isAddMode
      ? document.getElementById('rpl-old-meter-id').value.trim().toUpperCase()
      : (currentMeter.계기번호 || currentMeter.meter_id || '');

    if (!oldMeterId || String(oldMeterId).length !== 11) return toast('기존 계기번호 11자리 확인');

    const saveBtn = isDraft ? document.getElementById('rpl-draft') : document.getElementById('rpl-save');
    saveBtn.disabled = true;
    saveBtn.textContent = isDraft ? '임시 저장 중...' : '저장 중...';
    _setFormDisabled(true);   // 제출 시작 — 입력 잠금
    let _committed = false;    // 성공 시 true → 자동 close 전까지 잠금 유지(재제출 차단)

    try {
      const session = (typeof authGetSession === 'function') ? authGetSession() : null;
      const me = session ? (session.id || session.username || session.name || 'unknown') : 'unknown';
      const ts = Date.now();
      const addrKey = (typeof encodeKey === 'function') ? encodeKey(currentAddress) : currentAddress;

      const dryRun = isDryRun();
      if (!dryRun && (!db || !statusRef)) throw new Error('Firebase 미초기화');

      if (isAddMode) {
        // 추가 모드: 계기번호만 기록 (사진/검침 등 없음)
        const added = {
          meter_id: String(oldMeterId),
          added_by: me,
          added_at: ts,
        };

        if (dryRun) {
          console.log('[DRY RUN] added_meters', addrKey, oldMeterId, added);
          toast(`[DRY RUN] 추가 모의: ${oldMeterId}`);
        } else {
          const node = statusRef.child(addrKey).child('added_meters').child(String(oldMeterId));
          await node.set(added);
          // 로컬 반영 (실저장 시에만)
          if (!workStatus[currentAddress]) workStatus[currentAddress] = makeEmptyEntry();
          if (!workStatus[currentAddress].added_meters) workStatus[currentAddress].added_meters = {};
          workStatus[currentAddress].added_meters[oldMeterId] = added;
          toast(`계기 추가됨: ${oldMeterId}`);
        }

        _committed = true;  // 추가 완료 — 잠금 유지
        setTimeout(close, 700);
        if (!dryRun && typeof renderMetersList === 'function') renderMetersList();
        return;
      }

      // 교체 모드: 풀 데이터 검증 + 업로드
      const newMeterId = document.getElementById('rpl-new-meter-id').value.trim();
      const y = document.getElementById('rpl-mfg-y').value;
      const m = document.getElementById('rpl-mfg-m').value;

      // 활성 지침 칸 값 수집
      // open()과 동일하게: 계약종별 기반 + 기존 removal_values 키 union (편집 시 손실 방지)
      const clas = currentMeter ? (currentMeter.계약종별 || currentMeter.CNTR_CLAS_CD || '') : '';
      const pwr = currentMeter ? (currentMeter.계약전력 || 0) : 0;
      const baseFields = (typeof readingFieldsFor === 'function')
          ? readingFieldsFor(clas, pwr)
          : ['whme_day'];
      const prevSavedKeys = (editingData && editingData.removal_values && typeof editingData.removal_values === 'object')
          ? Object.keys(editingData.removal_values).filter(k => editingData.removal_values[k] != null)
          : [];
      // 수동토글(_rvMode) 반영 — auto면 자동계산, 아니면 모드별 칸
      const _autoFields = ALL_KNOWN_FIELDS.filter(f => baseFields.includes(f) || prevSavedKeys.includes(f));
      const activeFields = _rvFieldsFor(_autoFields);
      const firstActive = activeFields[0] || 'whme_day';

      const removalValues = {};
      for (const fid of activeFields) {
        const el = document.getElementById(RV_FIELDS[fid].input);
        const v = el ? el.value.trim() : '';
        removalValues[fid] = v === '' ? null : Number(v);
      }
      // 최대전력 형식 검증 — 정상 = 4자리.2자리(≤9999.99). 5자리 이상이면 무효전력과 뒤바뀐 입력 의심 → 경고
      // (영준님 2026-06-15: 종로 작업자 최대↔무효 칸 혼동 다수 발생, 입력 단계에서 차단)
      if (removalValues['dm_mt_day'] != null) {
        const _dmv = Number(removalValues['dm_mt_day']);
        if (!isNaN(_dmv) && _dmv >= 10000) {
          if (!confirm('최대전력 값(' + removalValues['dm_mt_day'] + ')이 형식(최대 9999.99)을 벗어납니다.\n\n무효전력 칸과 바뀌어 입력되지 않았는지 확인하세요.\n(최대전력=kW 소수값 / 무효전력=큰 정수)\n\n그래도 이대로 저장하시겠습니까?')) {
            return;   // 작업자가 수정하도록 저장 중단
          }
        }
      }
      // 하위호환: whme_day 값을 removal_value(단일)에도 저장
      const removalValue = removalValues['whme_day'] != null ? String(removalValues['whme_day']) : '';

      // 보조앱(snap) temp 사진은 prefillTempForSeq에서 confirm 받아 이미 keep*에 채워둠(확정 시).
      //   채워진 분은 아래 검증·업로드를 그대로 타고, 저장 성공 후 _pendingTempPath의 temp 노드를 삭제.

      // 사진 검증
      const hasNewPhoto = newPhotoBlob || keepNewPhotoUrl;
      const hasFirstActivePhoto = removalPhotoBlobs[firstActive] || keepRemovalPhotoUrls[firstActive];

      // 임시 저장 모드는 검증 스킵 — 부분 데이터만으로도 저장
      // [폴백] 완료(저장)인데 필수값이 하나라도 빠지면 → 완료 막고 '이어서'(draft)로 저장.
      //   (영준님 2026-06-09: 전부 폴백. 입력 유실 0 — 부분작업도 draft로 영속화.)
      if (!isDraft) {
        const missing = [];
        // 이번 세션에 새 원본이 들어온 활성칸(원본 있음)만 region 필수
        const needRegion = activeFields.filter(fid => removalPhotoOriginals[fid] && !removalPhotoRegions[fid]);
        if (needRegion.length) missing.push(`LCD영역 ${needRegion.length}칸`);
        if (!hasFirstActivePhoto) missing.push('주간 계기판 사진');
        if (!hasNewPhoto) missing.push('새 계기 사진');
        if (!newMeterId || newMeterId.length !== 11) missing.push('새 계기번호 11자리');
        // [QR 강화 백스톱] 새 계기번호 타입코드(3~4자리) 검증 — 잘못 스캔/입력된 비계기번호 차단
        else if (!['17', '19', '25', '26', '27', '45', '46', '47', '53', '55'].includes(newMeterId.slice(2, 4))) missing.push(`새 계기번호 형식이상(${newMeterId})`);
        if (!y || !m) missing.push('제조년월');
        // 값을 입력한 칸은 사진 필수. 값 없는 칸은 사진 불필요(부분완료 허용 — 검침값 1개만 완료 가능)
        const valNoPhoto = activeFields.slice(1).filter(fid => removalValues[fid] != null && !removalPhotoBlobs[fid] && !keepRemovalPhotoUrls[fid]);
        if (valNoPhoto.length) missing.push(`칸사진 ${valNoPhoto.length}`);
        if (missing.length) {
          isDraft = true;   // 사진/계기번호/제조 등 필수 누락 → 이어서(draft) 폴백
          toast(`값 누락(${missing.join(', ')}) — 완료 대신 '이어서'로 저장합니다`);
        } else {
          // 다지침(2종·20kW 등) 계기인데 검침값 일부만 입력 → 경고 후 완료 허용 (영준님 2026-06-10)
          const emptyCount = activeFields.filter(fid => removalValues[fid] == null).length;
          if (emptyCount > 0 && activeFields.length > 1) {
            const filledN = activeFields.length - emptyCount;
            const ok = confirm(
              `이 계기는 ${activeFields.length}지침(2종·20kW 등) 대상입니다.\n` +
              `검침값을 ${filledN}칸만 입력했습니다 (${emptyCount}칸 비어 있음).\n\n` +
              `나머지 칸 없이 이대로 완료할까요?`
            );
            if (!ok) {
              // 아니오 → 완료 중단. 작업자가 추가 입력하도록 폼 잠금 해제
              saveBtn.disabled = false;
              saveBtn.textContent = '저장';
              _setFormDisabled(false);
              return;
            }
            // 예 → 빈 칸은 그대로 두고(null) 완료 진행
          }
        }
      }

      saveBtn.textContent = isDraft ? '임시 저장 중...' : (dryRun ? '확인 중...' : '업로드 중...');

      const baseDir = `replacements/${addrKey}/${oldMeterId}_${ts}`;

      // 사진 업로드 — 태그 기반으로 Promise 배열 구성 (인덱스 의존 없음)
      const uploadTasks = [];

      // 활성 칸 사진 — 칸별 태그
      for (const fid of activeFields) {
        const blob = removalPhotoBlobs[fid];
        const keepUrl = keepRemovalPhotoUrls[fid] || '';
        if (dryRun) {
          uploadTasks.push({ tag: `rv_${fid}`, promise: Promise.resolve({ url: keepUrl || `[DRY_RUN_${fid}_${ts}]` }) });
        } else {
          uploadTasks.push({
            tag: `rv_${fid}`,
            promise: blob
              ? PhotoUploader.compressAndUpload(blob, `${baseDir}/${fid}.jpg`)
              : Promise.resolve({ url: keepUrl }),
          });
        }

        // 검침값 LCD 고화질 크롭본 (검증/학습용) — 원본 있을 때만, 실패해도 본 흐름 영향 없음
        const orig = removalPhotoOriginals[fid];
        if (!dryRun && orig && typeof LcdCrop !== 'undefined') {
          uploadTasks.push({
            tag: `lcd_${fid}`,
            promise: (async () => {
              try {
                const c = await LcdCrop.cropLcd(orig, 0.95, removalPhotoRegions[fid] || null); // { blob, ok, reason, roi }
                if (!c || !c.blob) return { url: '', ok: false };
                const url = await PhotoUploader.upload(c.blob, `${baseDir}/${fid}_lcd.jpg`);
                // ok=false면 LCD가 고정영역에 없는 "문제 사진" — URL은 올리되 플래그 전달
                return { url, ok: c.ok, reason: c.reason };
              } catch (e) {
                console.warn(`[LcdCrop] ${fid} 크롭본 업로드 실패(무시)`, e);
                return { url: '', ok: false };
              }
            })(),
          });
        }
      }

      // 신계기 사진
      if (dryRun) {
        uploadTasks.push({ tag: 'new', promise: Promise.resolve({ url: keepNewPhotoUrl || `[DRY_RUN_NEW_${ts}]` }) });
      } else {
        uploadTasks.push({
          tag: 'new',
          promise: newPhotoBlob
            ? PhotoUploader.compressAndUpload(newPhotoBlob, `${baseDir}/new.jpg`)
            : Promise.resolve({ url: keepNewPhotoUrl || '' }),
        });
      }

      const results = await Promise.all(uploadTasks.map(t => t.promise));

      // 태그 기반 결과 매핑
      const urlMap = {};
      const resMap = {};
      for (let i = 0; i < uploadTasks.length; i++) {
        urlMap[uploadTasks[i].tag] = results[i].url || '';
        resMap[uploadTasks[i].tag] = results[i];
      }

      // removal_photos 구성 (활성칸만)
      const removal_photos = {};
      for (const fid of activeFields) {
        const url = urlMap[`rv_${fid}`];
        if (url) removal_photos[fid] = url;
      }

      // 검침값 LCD 고화질 크롭본 URL (검증/학습용, 있을 때만)
      // + LCD가 고정영역에 안 잡힌 "문제 사진" 칸 플래그 (검증단계에서 사람이 우선 확인)
      const removal_lcd_photos = {};
      const removal_lcd_flags = {};
      for (const fid of activeFields) {
        const url = urlMap[`lcd_${fid}`];
        if (url) removal_lcd_photos[fid] = url;
        const r = resMap[`lcd_${fid}`];
        if (r && url && r.ok === false) removal_lcd_flags[fid] = r.reason || 'lcd_not_found';
      }

      // 작업자 지정 LCD 영역 좌표 수집 (YOLO 학습 라벨용)
      const removal_lcd_regions = {};
      for (const fid of activeFields) {
        if (removalPhotoRegions[fid]) removal_lcd_regions[fid] = removalPhotoRegions[fid];
      }

      // old_meter_photo = firstActive 칸 사진 (기존 소비자 호환, 절대 비우지 않음)
      const oldMeterPhoto = removal_photos[firstActive] || keepRemovalPhotoUrls[firstActive] || '';

      // 추가 데이터 수집
      const extra_data = await collectExtraRows(baseDir, dryRun);

      // daily_seq · 시각 · 작업자
      // - 시각/작업자: 수정 모드면 원본 유지, 신규면 새로
      // - daily_seq: 항상 현재 UI 표시값 (사용자가 조절 가능)
      const dailySeq = getDailySeq();
      const replacedAt = editingData ? editingData.replaced_at : ts;
      const worker     = editingData ? editingData.worker     : me;

      const replacement = {
        old_meter_id: String(oldMeterId),
        new_meter_id: String(newMeterId || ''),
        // 계약정보 저장 — snap(보조앱) 검침칸 자동판별 재료 (영준님 2026-06-17)
        계약종별: (currentMeter && (currentMeter.계약종별 || currentMeter.CNTR_CLAS_CD)) || (editingData && editingData.계약종별) || null,
        계약전력: (currentMeter && currentMeter.계약전력) || (editingData && editingData.계약전력) || null,
        remark: (function () { const e = document.getElementById('rpl-remark'); const v = e ? String(e.value || '').trim() : ''; return v || null; })(),
        removal_values: removalValues,
        removal_value: removalValue === '' ? null : Number(removalValue),
        new_meter_mfg_ym: (y && m) ? `${y}-${m}` : '',
        old_meter_photo: oldMeterPhoto,
        new_meter_photo: urlMap['new'] || '',
        removal_photos,
        extra_data,
        worker,
        replaced_at: replacedAt,
        daily_seq: dailySeq,
        draft: !!isDraft,
      };
      // 검침값 LCD 고화질 크롭본 URL (있을 때만 — 검증/학습용)
      if (Object.keys(removal_lcd_photos).length) {
        replacement.removal_lcd_photos = removal_lcd_photos;
      }
      // LCD가 고정영역에 안 잡힌 문제 사진 플래그 (있을 때만)
      if (Object.keys(removal_lcd_flags).length) {
        replacement.removal_lcd_flags = removal_lcd_flags;
      }
      // 작업자 지정 LCD 영역 좌표 (YOLO 학습 라벨용, 있을 때만)
      if (Object.keys(removal_lcd_regions).length) {
        replacement.removal_lcd_regions = removal_lcd_regions;
      }
      if (editingData) {
        replacement.last_edited_at = ts;
        replacement.last_edited_by = me;
      }

      if (dryRun) {
        console.log('[DRY RUN] replacement_list', addrKey, oldMeterId, replacement);
        saveLastMfgYm(y, m);
        toast(editingData ? '[DRY RUN] 수정 모의' : `[DRY RUN] 저장 모의 (오늘 ${dailySeq}번째)`);
        _committed = true;
        setTimeout(close, 800);
        return;
      }

      const node = statusRef.child(addrKey).child('replacement_list').child(String(oldMeterId));
      await node.set(replacement);

      // 불러온(확정된) 보조앱 temp 노드 정리 (저장 성공 후에만 — 사진 URL은 이미 record에 복사됨)
      if (_pendingTempPath) { db.ref(_pendingTempPath).remove().catch(() => {}); }

      // 로컬 반영
      if (!workStatus[currentAddress]) workStatus[currentAddress] = makeEmptyEntry();
      if (!workStatus[currentAddress].replacement_list) workStatus[currentAddress].replacement_list = {};
      workStatus[currentAddress].replacement_list[oldMeterId] = replacement;

      if (y && m) saveLastMfgYm(y, m);
      if (isDraft) {
        toast('임시 저장됨 — 나중에 이어서 작업하세요');
      } else {
        toast(editingData ? '수정 완료' : `저장 완료 (오늘 ${dailySeq}번째)`);
      }
      _committed = true;  // 저장 완료 — 잠금 유지
      setTimeout(close, 800);

      if (typeof updateMarkerColor === 'function') updateMarkerColor(currentAddress);
      if (typeof renderMetersList === 'function') renderMetersList();
      if (typeof window.statsAfterModalChange === 'function') window.statsAfterModalChange();
    } catch (e) {
      console.error(e);
      toast(`저장 실패: ${e.message || e}`);
    } finally {
      // 성공(_committed) 시엔 잠금 유지(자동 close 전까지 값수정/재제출 차단), 실패 시에만 복구
      if (!_committed) {
        saveBtn.disabled = false;
        saveBtn.textContent = isDraft ? '임시 저장' : (editingData ? '수정 저장' : '저장');
        _setFormDisabled(false);
      }
    }
  }

  async function onDelete() {
    if (!editingData) return;
    const oldId = editingData.old_meter_id || (currentMeter && (currentMeter.계기번호 || currentMeter.meter_id));
    if (!oldId) return toast('대상 계기번호 없음');

    const ok = confirm(`이 교체 기록을 삭제할까요?\n\n계기 ${oldId}\n주소 ${currentAddress}\n\n삭제 후 되돌릴 수 없습니다.`);
    if (!ok) return;

    const delBtn = document.getElementById('rpl-delete');
    delBtn.disabled = true;
    delBtn.textContent = '삭제 중...';

    try {
      const dryRun = isDryRun();
      if (!dryRun && (!db || !statusRef)) throw new Error('Firebase 미초기화');
      const addrKey = (typeof encodeKey === 'function') ? encodeKey(currentAddress) : currentAddress;

      if (dryRun) {
        console.log('[DRY RUN] delete replacement', addrKey, oldId);
      } else {
        await statusRef.child(addrKey).child('replacement_list').child(String(oldId)).remove();
        const am = workStatus[currentAddress] && workStatus[currentAddress].added_meters;
        if (am && am[oldId]) {
          await statusRef.child(addrKey).child('added_meters').child(String(oldId)).remove();
          delete workStatus[currentAddress].added_meters[oldId];
        }
      }

      const rl = workStatus[currentAddress] && workStatus[currentAddress].replacement_list;
      if (rl) delete rl[oldId];

      toast('삭제 완료');
      setTimeout(close, 600);

      if (typeof updateMarkerColor === 'function') updateMarkerColor(currentAddress);
      if (typeof renderMetersList === 'function') renderMetersList();
      // 통계 페이지에서 호출됐을 때 갱신 훅
      if (typeof window.statsAfterModalChange === 'function') window.statsAfterModalChange();
    } catch (e) {
      console.error(e);
      toast(`삭제 실패: ${e.message || e}`);
    } finally {
      delBtn.disabled = false;
      delBtn.textContent = '삭제';
    }
  }

  // 완료(저장) → 임시저장(draft) 되돌리기. 검침값·사진은 유지, draft 플래그만 true로.
  async function onRevertToDraft() {
    if (!editingData) return;
    const oldId = editingData.old_meter_id || (currentMeter && (currentMeter.계기번호 || currentMeter.meter_id));
    if (!oldId) return toast('대상 계기번호 없음');

    const ok = confirm(`완료 상태를 임시저장으로 되돌릴까요?\n\n계기 ${oldId}\n주소 ${currentAddress}\n\n검침값·사진은 그대로 유지되고 작업중(임시저장) 상태로 바뀝니다.`);
    if (!ok) return;

    const rvBtn = document.getElementById('rpl-revert');
    if (rvBtn) { rvBtn.disabled = true; rvBtn.textContent = '되돌리는 중...'; }

    try {
      const dryRun = isDryRun();
      if (!dryRun && (!db || !statusRef)) throw new Error('Firebase 미초기화');
      const addrKey = (typeof encodeKey === 'function') ? encodeKey(currentAddress) : currentAddress;
      const patch = { draft: true, last_edited_at: Date.now() };

      if (dryRun) {
        console.log('[DRY RUN] revert to draft', addrKey, oldId, patch);
      } else {
        await statusRef.child(addrKey).child('replacement_list').child(String(oldId)).update(patch);
      }

      // 로컬 미러 반영
      const rl = workStatus[currentAddress] && workStatus[currentAddress].replacement_list;
      if (rl && rl[oldId]) { rl[oldId].draft = true; rl[oldId].last_edited_at = patch.last_edited_at; }

      toast('임시저장으로 되돌렸습니다');
      setTimeout(close, 600);

      if (typeof updateMarkerColor === 'function') updateMarkerColor(currentAddress);
      if (typeof renderMetersList === 'function') renderMetersList();
      if (typeof window.statsAfterModalChange === 'function') window.statsAfterModalChange();
    } catch (e) {
      console.error(e);
      toast(`되돌리기 실패: ${e.message || e}`);
    } finally {
      if (rvBtn) { rvBtn.disabled = false; rvBtn.textContent = '임시저장으로'; }
    }
  }

  function init() {
    document.getElementById('rpl-close').onclick = close;
    document.getElementById('rpl-cancel').onclick = close;
    document.getElementById('rpl-save').onclick = () => onSave(false);
    const draftBtn = document.getElementById('rpl-draft');
    if (draftBtn) draftBtn.onclick = () => onSave(true);
    const delBtn = document.getElementById('rpl-delete');
    if (delBtn) delBtn.onclick = onDelete;
    const revertBtn = document.getElementById('rpl-revert');
    if (revertBtn) revertBtn.onclick = onRevertToDraft;
    const rvToggleBtn = document.getElementById('rpl-rv-toggle');
    if (rvToggleBtn) rvToggleBtn.onclick = _cycleRvMode;

    // 신계기 사진 바인딩
    document.getElementById('rpl-new-photo').onclick = () =>
      triggerPhotoPick(document.getElementById('rpl-new-photo-input'));
    document.getElementById('rpl-new-photo-input').onchange = (e) =>
      onPhotoSelect('rpl-new-photo', e.target.files[0], isCameraShot(e.target, e.target.files[0]));

    // 지침칸 사진 바인딩 — RV_FIELDS 기반
    for (const fid of ALL_KNOWN_FIELDS) {
      const els = RV_FIELDS[fid];
      const photoSlot  = document.getElementById(els.photo);
      const photoInput = document.getElementById(els.photoInput);
      if (photoSlot && photoInput) {
        photoSlot.onclick  = () => triggerPhotoPick(photoInput);
        photoInput.onchange = (e) => onPhotoSelect(els.photo, e.target.files[0], isCameraShot(e.target, e.target.files[0]));
      }
    }

    document.getElementById('rpl-qr-btn').onclick = onQrScanClick;

    // daily_seq ± 조절 (이미 쓰인 번호는 건너뜀, 빈 자리만 이동)
    const decBtn = document.getElementById('rpl-seq-dec');
    const incBtn = document.getElementById('rpl-seq-inc');
    if (decBtn) decBtn.onclick = () => stepDailySeq(-1);
    if (incBtn) incBtn.onclick = () => stepDailySeq(+1);

    // 알파벳 입력 보조 버튼 (AMIGO 영문 prefix용) — 기존 계기번호 input에 append
    document.querySelectorAll('.rpl-alpha-btn').forEach(btn => {
      btn.onclick = () => {
        const inp = document.getElementById('rpl-old-meter-id');
        const ch = btn.dataset.ch;
        if (ch === 'BS') {
          inp.value = inp.value.slice(0, -1);
        } else if (inp.value.length < 11) {
          inp.value = inp.value + ch;
        }
        inp.focus();
      };
    });

    // 알파벳 입력 보조 버튼 (계기교체 모달의 새 계기번호 칸 — AMIGO 영문 prefix용)
    document.querySelectorAll('.rpl-alpha-btn-new').forEach(btn => {
      btn.onclick = () => {
        const inp = document.getElementById('rpl-new-meter-id');
        const ch = btn.dataset.ch;
        if (ch === 'BS') {
          inp.value = inp.value.slice(0, -1);
        } else if (inp.value.length < 11) {
          inp.value = inp.value + ch;
        }
        inp.focus();
      };
    });

    // 추가 데이터 버튼
    const extraAddBtn = document.getElementById('rpl-extra-add');
    if (extraAddBtn) extraAddBtn.onclick = () => addExtraRow(null);

    // 추가 데이터 행 이벤트 위임 (삭제 / 사진열기 / 사진 선택)
    const extraRows_container = document.getElementById('rpl-extra-rows');
    if (extraRows_container) {
      extraRows_container.addEventListener('click', (e) => {
        const row = e.target.closest('.rpl-extra-row');
        if (!row) return;
        if (e.target.classList.contains('ex-del')) {
          row.remove();
          extraRows = extraRows.filter(r => r !== row);
        } else if (e.target.classList.contains('ex-photo-btn')) {
          const inp = row.querySelector('.ex-photo-input');
          if (inp) triggerPhotoPick(inp);
        }
      });
      extraRows_container.addEventListener('change', async (e) => {
        if (!e.target.classList.contains('ex-photo-input')) return;
        const file = e.target.files[0];
        if (!file) return;
        const row = e.target.closest('.rpl-extra-row');
        if (!row) return;
        try {
          const compressed = await PhotoUploader.compress(file, { square: isCameraShot(e.target, file) });
          e.target._blob = compressed;
        } catch (err) {
          e.target._blob = file;
        }
        const btn = row.querySelector('.ex-photo-btn');
        if (btn) {
          btn.classList.add('has');
          btn.dataset.keepUrl = '';  // 새 blob 선택 시 기존 URL 무효화
        }
      });
    }
  }

  return { open, close, init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', RplModal.init);
} else {
  RplModal.init();
}
