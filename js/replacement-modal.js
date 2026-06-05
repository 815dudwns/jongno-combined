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
    dm_mt_day: {
      wrap:       'rpl-rv-field-dm-mt',
      input:      'rpl-rv-dm-mt',
      photo:      'rpl-rv-photo-dm-mt',
      photoInput: 'rpl-rv-photo-input-dm-mt',
    },
    var_day:   {
      wrap:       'rpl-rv-field-var',
      input:      'rpl-rv-var',
      photo:      'rpl-rv-photo-var',
      photoInput: 'rpl-rv-photo-input-var',
    },
  };
  const ALL_KNOWN_FIELDS = ['whme_day', 'whme_mngt', 'dm_mt_day', 'var_day'];

  function open(address, meter, prefillOldId, editData) {
    currentAddress = address;
    currentMeter = meter || null;
    editingData = editData || null;
    newPhotoBlob = null;
    keepNewPhotoUrl = null;
    removalPhotoBlobs = {};
    keepRemovalPhotoUrls = {};

    document.getElementById('rpl-modal').classList.add('active');
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

    // 지침 4칸 활성화 — currentMeter의 계약종별·계약전력으로 판별
    // 수정(edit) 모드면 기존 removal_values 키도 union — stats 등 meter에 계약종별 없는 경우 데이터 손실 방지
    let activeFields = [];
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

      for (const fid of ALL_KNOWN_FIELDS) {
        const els = RV_FIELDS[fid];
        const wrapEl = document.getElementById(els.wrap);
        const inpEl  = document.getElementById(els.input);
        if (!wrapEl || !inpEl) continue;
        const isActive = activeFields.includes(fid);
        wrapEl.style.display = isActive ? '' : 'none';
        inpEl.value = '';
        // 비활성 칸 사진 슬롯 초기화
        if (!isActive) {
          resetPhoto(els.photo);
        }
      }
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
  function showPhotoUrl(slotId, url) {
    const slot = document.getElementById(slotId);
    if (!slot) return;
    slot.classList.add('has-photo');
    slot.querySelector('.rpl-photo-preview').src = url;
  }

  function close() {
    document.getElementById('rpl-modal').classList.remove('active');
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
    } else if (slotId === 'rpl-new-photo') {
      newPhotoBlob = blob;
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

  async function onPhotoSelect(slotId, file) {
    if (!file) return;
    try {
      const compressed = await PhotoUploader.compress(file);
      setPhoto(slotId, compressed);
    } catch (e) {
      console.warn('압축 실패, 원본 사용', e);
      setPhoto(slotId, file);
    }
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
    photoBtn.textContent = '📷';
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

  async function onSave(isDraft) {
    const isAddMode = !currentMeter;
    const oldMeterId = isAddMode
      ? document.getElementById('rpl-old-meter-id').value.trim().toUpperCase()
      : (currentMeter.계기번호 || currentMeter.meter_id || '');

    if (!oldMeterId || String(oldMeterId).length !== 11) return toast('기존 계기번호 11자리 확인');

    const saveBtn = isDraft ? document.getElementById('rpl-draft') : document.getElementById('rpl-save');
    saveBtn.disabled = true;
    saveBtn.textContent = isDraft ? '임시 저장 중...' : '저장 중...';

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
          toast(`🧪 [DRY RUN] 추가 모의: ${oldMeterId}`);
        } else {
          const node = statusRef.child(addrKey).child('added_meters').child(String(oldMeterId));
          await node.set(added);
          // 로컬 반영 (실저장 시에만)
          if (!workStatus[currentAddress]) workStatus[currentAddress] = makeEmptyEntry();
          if (!workStatus[currentAddress].added_meters) workStatus[currentAddress].added_meters = {};
          workStatus[currentAddress].added_meters[oldMeterId] = added;
          toast(`✅ 계기 추가됨: ${oldMeterId}`);
        }

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
      const activeFields = ALL_KNOWN_FIELDS.filter(f => baseFields.includes(f) || prevSavedKeys.includes(f));
      const firstActive = activeFields[0] || 'whme_day';

      const removalValues = {};
      for (const fid of activeFields) {
        const el = document.getElementById(RV_FIELDS[fid].input);
        const v = el ? el.value.trim() : '';
        removalValues[fid] = v === '' ? null : Number(v);
      }
      // 하위호환: whme_day 값을 removal_value(단일)에도 저장
      const removalValue = removalValues['whme_day'] != null ? String(removalValues['whme_day']) : '';

      // 사진 검증
      const hasNewPhoto = newPhotoBlob || keepNewPhotoUrl;
      const hasFirstActivePhoto = removalPhotoBlobs[firstActive] || keepRemovalPhotoUrls[firstActive];

      // 임시 저장 모드는 검증 스킵 — 부분 데이터만으로도 저장
      if (!isDraft) {
        if (!hasFirstActivePhoto) return toast('주간(첫 활성칸) 계기판 사진 필요');
        if (!hasNewPhoto) return toast('새 계기 사진 필요');
        if (!newMeterId || newMeterId.length !== 11) return toast('새 계기번호 11자리 필요');
        if (!y || !m) return toast('제조년월 필요');
        // 지침값 빈칸 확인
        const emptyCount = activeFields.filter(fid => removalValues[fid] == null).length;
        if (emptyCount > 0) {
          const go = confirm(`빈칸 ${emptyCount}개 있습니다. 그래도 완료할까요?`);
          if (!go) return;
        }
        // 첫 활성칸 외 나머지 활성칸 사진 없는 칸 확인
        const missingPhotoCnt = activeFields.slice(1).filter(fid => !removalPhotoBlobs[fid] && !keepRemovalPhotoUrls[fid]).length;
        if (missingPhotoCnt > 0) {
          const go = confirm(`사진 없는 칸 ${missingPhotoCnt}개 있습니다. 그래도 완료할까요?`);
          if (!go) return;
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
      for (let i = 0; i < uploadTasks.length; i++) {
        urlMap[uploadTasks[i].tag] = results[i].url || '';
      }

      // removal_photos 구성 (활성칸만)
      const removal_photos = {};
      for (const fid of activeFields) {
        const url = urlMap[`rv_${fid}`];
        if (url) removal_photos[fid] = url;
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
      if (editingData) {
        replacement.last_edited_at = ts;
        replacement.last_edited_by = me;
      }

      if (dryRun) {
        console.log('[DRY RUN] replacement_list', addrKey, oldMeterId, replacement);
        saveLastMfgYm(y, m);
        toast(editingData ? '🧪 [DRY RUN] 수정 모의' : `🧪 [DRY RUN] 저장 모의 (오늘 ${dailySeq}번째)`);
        setTimeout(close, 800);
        return;
      }

      const node = statusRef.child(addrKey).child('replacement_list').child(String(oldMeterId));
      await node.set(replacement);

      // 로컬 반영
      if (!workStatus[currentAddress]) workStatus[currentAddress] = makeEmptyEntry();
      if (!workStatus[currentAddress].replacement_list) workStatus[currentAddress].replacement_list = {};
      workStatus[currentAddress].replacement_list[oldMeterId] = replacement;

      if (y && m) saveLastMfgYm(y, m);
      if (isDraft) {
        toast('📝 임시 저장됨 — 나중에 이어서 작업하세요');
      } else {
        toast(editingData ? '✏️ 수정 완료' : `✅ 저장 완료 (오늘 ${dailySeq}번째)`);
      }
      setTimeout(close, 800);

      if (typeof updateMarkerColor === 'function') updateMarkerColor(currentAddress);
      if (typeof renderMetersList === 'function') renderMetersList();
      if (typeof window.statsAfterModalChange === 'function') window.statsAfterModalChange();
    } catch (e) {
      console.error(e);
      toast(`저장 실패: ${e.message || e}`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = isDraft ? '임시 저장' : (editingData ? '수정 저장' : '저장');
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

      toast('🗑 삭제 완료');
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
      delBtn.textContent = '🗑 삭제';
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

    // 신계기 사진 바인딩
    document.getElementById('rpl-new-photo').onclick = () =>
      document.getElementById('rpl-new-photo-input').click();
    document.getElementById('rpl-new-photo-input').onchange = (e) =>
      onPhotoSelect('rpl-new-photo', e.target.files[0]);

    // 지침칸 사진 바인딩 — RV_FIELDS 기반
    for (const fid of ALL_KNOWN_FIELDS) {
      const els = RV_FIELDS[fid];
      const photoSlot  = document.getElementById(els.photo);
      const photoInput = document.getElementById(els.photoInput);
      if (photoSlot && photoInput) {
        photoSlot.onclick  = () => photoInput.click();
        photoInput.onchange = (e) => onPhotoSelect(els.photo, e.target.files[0]);
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
          if (inp) inp.click();
        }
      });
      extraRows_container.addEventListener('change', async (e) => {
        if (!e.target.classList.contains('ex-photo-input')) return;
        const file = e.target.files[0];
        if (!file) return;
        const row = e.target.closest('.rpl-extra-row');
        if (!row) return;
        try {
          const compressed = await PhotoUploader.compress(file);
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
