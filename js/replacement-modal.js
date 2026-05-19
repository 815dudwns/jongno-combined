// replacement-modal.js — 계기 교체 입력 모달

const RplModal = (() => {
  let currentAddress = '';
  let currentMeter = null;     // 선택한 계기 객체
  let oldPhotoBlob = null;
  let newPhotoBlob = null;
  let editingData = null;      // 수정 모드 = 기존 replacement 객체 (prefill용)
  let keepOldPhotoUrl = null;  // 수정 모드에서 사진 재선택 안 했을 때 기존 URL 유지
  let keepNewPhotoUrl = null;

  // DRY-RUN 제거됨 — 항상 Firebase 직접 저장 (영준님 결정 2026-05-17)
  function isDryRun() { return false; }

  function open(address, meter, prefillOldId, editData) {
    currentAddress = address;
    currentMeter = meter || null;
    editingData = editData || null;
    oldPhotoBlob = null;
    newPhotoBlob = null;
    keepOldPhotoUrl = null;
    keepNewPhotoUrl = null;

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

    // 기본 채움 / 수정 모드면 기존 데이터로 prefill
    resetPhoto('rpl-old-photo');
    resetPhoto('rpl-new-photo');
    if (isEditMode) {
      document.getElementById('rpl-removal-value').value = editData.removal_value ?? '';
      document.getElementById('rpl-new-meter-id').value = editData.new_meter_id || '';
      // 사진은 URL preview만 (재선택 안 하면 URL 유지)
      if (editData.old_meter_photo) {
        showPhotoUrl('rpl-old-photo', editData.old_meter_photo);
        keepOldPhotoUrl = editData.old_meter_photo;
      }
      if (editData.new_meter_photo) {
        showPhotoUrl('rpl-new-photo', editData.new_meter_photo);
        keepNewPhotoUrl = editData.new_meter_photo;
      }
    } else {
      document.getElementById('rpl-removal-value').value = '';
      document.getElementById('rpl-new-meter-id').value = '';
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
    slot.classList.add('has-photo');
    slot.querySelector('.rpl-photo-preview').src = url;
  }

  function close() {
    document.getElementById('rpl-modal').classList.remove('active');
  }

  function resetPhoto(slotId) {
    const slot = document.getElementById(slotId);
    slot.classList.remove('has-photo');
    slot.querySelector('.rpl-photo-preview').src = '';
  }

  function setPhoto(slotId, blob) {
    const slot = document.getElementById(slotId);
    slot.classList.add('has-photo');
    const url = URL.createObjectURL(blob);
    slot.querySelector('.rpl-photo-preview').src = url;
    if (slotId === 'rpl-old-photo') oldPhotoBlob = blob;
    else newPhotoBlob = blob;
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

  // 오늘 자정 (KST 로컬)
  function todayStartMs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
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
          if (r.worker !== me) continue;
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
    QrScanner.show((text, photoBlob) => {
      const raw = String(text || '');

      // 신형 QR 포맷: "PID : 127825 YYMM : 24.11 MID : 07530057365"
      //   - MID = 새 계기번호
      //   - YYMM = 제조년월 (24.11 → 2024년 11월)
      const midMatch  = raw.match(/MID\s*[:：]?\s*([A-Za-z0-9]+)/i);
      const ymMatch   = raw.match(/YYMM\s*[:：]?\s*(\d{2})\.(\d{2})/i);

      let meterId = '';
      if (midMatch) {
        meterId = String(midMatch[1]).toUpperCase();
        if (meterId.length > 11) meterId = meterId.slice(0, 11);
      } else {
        // 구형 폴백: 영숫자만 추출 + 첫 11자리
        const cleaned = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        meterId = cleaned.length >= 11 ? cleaned.slice(0, 11) : cleaned;
      }
      document.getElementById('rpl-new-meter-id').value = meterId;

      // 제조년월 자동 입력
      let ymToast = '';
      if (ymMatch) {
        const yy = ymMatch[1];
        const mm = ymMatch[2];
        const fullY = '20' + yy;
        const ySel = document.getElementById('rpl-mfg-y');
        const mSel = document.getElementById('rpl-mfg-m');
        // 옵션 없으면 추가 (보통 5년 전까지만 채워져 있으니 오래된 QR 대비)
        if (ySel && ![...ySel.options].some(o => o.value === fullY)) {
          const opt = document.createElement('option');
          opt.value = fullY; opt.textContent = `${fullY}년`;
          ySel.appendChild(opt);
        }
        if (ySel) ySel.value = fullY;
        if (mSel) mSel.value = mm;
        ymToast = ` / 제조 ${fullY}-${mm}`;
      }

      // 캡처된 사진을 "새 계기 사진" 슬롯에 자동 첨부
      if (photoBlob) setPhoto('rpl-new-photo', photoBlob);
      toast(`QR 인식: ${meterId}${ymToast}`);
    });
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
      const removalValue = document.getElementById('rpl-removal-value').value.trim();
      const newMeterId = document.getElementById('rpl-new-meter-id').value.trim();
      const y = document.getElementById('rpl-mfg-y').value;
      const m = document.getElementById('rpl-mfg-m').value;

      // 사진 검증 — 수정 모드면 기존 URL 있으면 OK
      const hasOldPhoto = oldPhotoBlob || keepOldPhotoUrl;
      const hasNewPhoto = newPhotoBlob || keepNewPhotoUrl;

      // 임시 저장 모드는 검증 스킵 — 부분 데이터만으로도 저장
      if (!isDraft) {
        if (!hasOldPhoto) return toast('기존 계기 사진 필요');
        if (!hasNewPhoto) return toast('새 계기 사진 필요');
        if (!removalValue) return toast('철거 제번 필요');
        if (!newMeterId || newMeterId.length !== 11) return toast('새 계기번호 11자리 필요');
        if (!y || !m) return toast('제조년월 필요');
      }

      saveBtn.textContent = isDraft ? '임시 저장 중...' : (dryRun ? '확인 중...' : '업로드 중...');

      // 사진 업로드 — 새로 선택한 것만, 안 한 것은 기존 URL 유지
      // 임시 저장이면 사진 없을 수 있음 — 있는 것만 업로드
      const baseDir = `replacements/${addrKey}/${oldMeterId}_${ts}`;
      const [oldRes, newRes] = await Promise.all([
        dryRun
          ? Promise.resolve({ url: keepOldPhotoUrl || `[DRY_RUN_OLD_${ts}]` })
          : (oldPhotoBlob
              ? PhotoUploader.compressAndUpload(oldPhotoBlob, `${baseDir}/old.jpg`)
              : Promise.resolve({ url: keepOldPhotoUrl || '' })),
        dryRun
          ? Promise.resolve({ url: keepNewPhotoUrl || `[DRY_RUN_NEW_${ts}]` })
          : (newPhotoBlob
              ? PhotoUploader.compressAndUpload(newPhotoBlob, `${baseDir}/new.jpg`)
              : Promise.resolve({ url: keepNewPhotoUrl || '' })),
      ]);

      // daily_seq · 시각 · 작업자
      // - 시각/작업자: 수정 모드면 원본 유지, 신규면 새로
      // - daily_seq: 항상 현재 UI 표시값 (사용자가 조절 가능)
      const dailySeq = getDailySeq();
      const replacedAt = editingData ? editingData.replaced_at : ts;
      const worker     = editingData ? editingData.worker     : me;

      const replacement = {
        old_meter_id: String(oldMeterId),
        new_meter_id: String(newMeterId || ''),
        removal_value: removalValue === '' ? null : Number(removalValue),
        new_meter_mfg_ym: (y && m) ? `${y}-${m}` : '',
        old_meter_photo: oldRes.url || '',
        new_meter_photo: newRes.url || '',
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
    document.getElementById('rpl-old-photo').onclick = () =>
      document.getElementById('rpl-old-photo-input').click();
    document.getElementById('rpl-new-photo').onclick = () =>
      document.getElementById('rpl-new-photo-input').click();
    document.getElementById('rpl-old-photo-input').onchange = (e) =>
      onPhotoSelect('rpl-old-photo', e.target.files[0]);
    document.getElementById('rpl-new-photo-input').onchange = (e) =>
      onPhotoSelect('rpl-new-photo', e.target.files[0]);
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
  }

  return { open, close, init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', RplModal.init);
} else {
  RplModal.init();
}
