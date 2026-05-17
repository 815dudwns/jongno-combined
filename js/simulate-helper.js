// simulate-helper.js — 시뮬레이션 헬퍼 (Firebase 직접 저장 + 일괄 정리)
// 영준님 명세: 일반 워크플로와 동일. _simulated 플래그로 구분, clearSimulation으로 일괄 제거.
// 콘솔 사용:
//   simulateAddresses(5, 1, ['무악','교남'])   -- 5개 주소 완전 완료
//   simulatePartial(3, 1, 1, ['무악','교남'])  -- 3개 주소 각 1개씩 (부분 완료)
//   simulateWeek(1, 5, ['무악','교남'])        -- 1주차 무악교남 첫 5개 계기
//   clearSimulation()                          -- Firebase에서 _simulated 모두 제거

(function () {
  // 1x1 투명 PNG (Base64) — 가상 사진
  const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  function getMe() {
    const session = (typeof authGetSession === 'function') ? authGetSession() : null;
    return session?.id || session?.username || session?.name || 'sim_user';
  }
  function todayStartMs() {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }
  function randMeterId() {
    return '9' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  }
  function makeReplacement(meter, seq, me, startMs) {
    return {
      old_meter_id: String(meter.계기번호),
      new_meter_id: randMeterId(),
      removal_value: Math.floor(Math.random() * 100000),
      new_meter_mfg_ym: '2024-11',
      old_meter_photo: PNG_1X1,
      new_meter_photo: PNG_1X1,
      worker: me,
      replaced_at: startMs + seq * 60000,
      daily_seq: seq,
      _simulated: true,
    };
  }

  async function loadSiteData() {
    const res = await fetch('./data/jongno-site-data.json');
    const sd = await res.json();
    return Array.isArray(sd) ? sd : Object.values(sd);
  }

  function filterByWeek(arr, weekNum) {
    if (!weekNum || weekNum < 1) return arr;
    const startD = (weekNum - 1) * 5 + 1, endD = weekNum * 5;
    return arr.filter(m => {
      const d = parseInt(String(m.검침일 || '').replace(/\D/g, ''), 10);
      return !isNaN(d) && d >= startD && d <= endD;
    });
  }
  function filterByKeywords(arr, keywords) {
    if (!keywords || keywords.length === 0) return arr;
    return arr.filter(m =>
      keywords.some(k =>
        (m.도로명주소 || '').includes(k) || (m.주소 || '').includes(k)
      )
    );
  }
  function groupByAddr(arr) {
    const byAddr = {};
    arr.forEach(m => {
      const k = m.주소 || m.도로명주소;
      if (!k) return;
      if (!byAddr[k]) byAddr[k] = [];
      byAddr[k].push(m);
    });
    return byAddr;
  }

  // Firebase + 메모리 동시 반영
  async function saveReplacements(addr, replacements) {
    const addrKey = (typeof encodeKey === 'function') ? encodeKey(addr) : addr;
    // 메모리 반영
    if (!workStatus[addr]) workStatus[addr] = makeEmptyEntry();
    if (!workStatus[addr].replacement_list) workStatus[addr].replacement_list = {};
    replacements.forEach(r => {
      workStatus[addr].replacement_list[r.old_meter_id] = r;
    });
    // Firebase 업데이트 (한 번에 multi-path)
    if (statusRef) {
      const updates = {};
      replacements.forEach(r => {
        updates[`${addrKey}/replacement_list/${r.old_meter_id}`] = r;
      });
      await statusRef.update(updates);
    }
  }

  // 1. 주소 N개 완전 완료
  window.simulateAddresses = async function (addrCount = 5, weekNum = 0, keywords = []) {
    const arr = await loadSiteData();
    let filtered = filterByKeywords(arr, keywords);
    filtered = filterByWeek(filtered, weekNum);
    if (filtered.length === 0) { alert('매칭 없음'); return; }

    const byAddr = groupByAddr(filtered);
    const addrKeys = Object.keys(byAddr).slice(0, addrCount);
    const me = getMe();
    const startMs = todayStartMs();

    let seq = 1, total = 0;
    for (const addr of addrKeys) {
      const allInAddr = arr.filter(m => (m.주소 || m.도로명주소) === addr);
      const reps = allInAddr.map(m => makeReplacement(m, seq++, me, startMs));
      total += reps.length;
      await saveReplacements(addr, reps);
      if (typeof updateMarkerColor === 'function') updateMarkerColor(addr);
    }
    console.log(`%c✅ 시뮬레이션 — ${addrKeys.length}개 주소, 총 ${total}개 계기 (Firebase 저장됨)`,
      'color:#10b981;font-weight:bold;font-size:14px');
    console.log('주소들:', addrKeys);
    return { addresses: addrKeys.length, meters: total };
  };

  // 2. 주소 N개 부분 완료 (각 주소 첫 M개만)
  window.simulatePartial = async function (addrCount = 3, perAddrComplete = 1, weekNum = 0, keywords = []) {
    const arr = await loadSiteData();
    let filtered = filterByKeywords(arr, keywords);
    filtered = filterByWeek(filtered, weekNum);
    if (filtered.length === 0) { alert('매칭 없음'); return; }

    const byAddr = groupByAddr(filtered);
    const addrKeys = Object.keys(byAddr).slice(0, addrCount);
    const me = getMe();
    const startMs = todayStartMs();

    let seq = 1, total = 0;
    for (const addr of addrKeys) {
      const allInAddr = arr.filter(m => (m.주소 || m.도로명주소) === addr);
      const targets = allInAddr.slice(0, perAddrComplete);
      const reps = targets.map(m => makeReplacement(m, seq++, me, startMs));
      total += reps.length;
      await saveReplacements(addr, reps);
      if (typeof updateMarkerColor === 'function') updateMarkerColor(addr);
    }
    console.log(`%c✅ 부분 완료 — ${addrKeys.length}개 주소, 각 ${perAddrComplete}개씩 (총 ${total})`,
      'color:#3b82f6;font-weight:bold;font-size:14px');
    console.log('주소들:', addrKeys);
    return { addresses: addrKeys.length, meters: total };
  };

  // 3. 계기 단위 N개 (한 주소 또는 여러 주소 분산)
  window.simulateWeek = async function (weekNum, count = 5, keywords = []) {
    const arr = await loadSiteData();
    let filtered = filterByKeywords(arr, keywords);
    filtered = filterByWeek(filtered, weekNum);
    if (filtered.length === 0) { alert('매칭 없음'); return; }

    const targets = filtered.slice(0, count);
    const me = getMe();
    const startMs = todayStartMs();

    // 주소별 묶어서 저장
    const byAddr = {};
    let seq = 1;
    targets.forEach(m => {
      const addr = m.주소 || m.도로명주소;
      if (!addr) return;
      if (!byAddr[addr]) byAddr[addr] = [];
      byAddr[addr].push(makeReplacement(m, seq++, me, startMs));
    });
    for (const [addr, reps] of Object.entries(byAddr)) {
      await saveReplacements(addr, reps);
      if (typeof updateMarkerColor === 'function') updateMarkerColor(addr);
    }
    console.log(`%c✅ ${weekNum}주차 ${count}개 계기 시뮬레이션 (${Object.keys(byAddr).length}개 주소)`,
      'color:#10b981;font-weight:bold;font-size:14px');
    return { meters: targets.length, addresses: Object.keys(byAddr).length };
  };

  // Firebase에서 _simulated:true 표시된 replacement만 모두 제거
  window.clearSimulation = async function () {
    if (!statusRef) { alert('Firebase 미초기화'); return; }
    const snap = await statusRef.once('value');
    const data = snap.val() || {};
    const removeKeys = [];  // multi-path 삭제용
    Object.entries(data).forEach(([addrKey, val]) => {
      const rl = val?.replacement_list || {};
      Object.entries(rl).forEach(([meterId, r]) => {
        if (r?._simulated) removeKeys.push(`${addrKey}/replacement_list/${meterId}`);
      });
    });
    if (removeKeys.length === 0) {
      console.log('정리할 시뮬레이션 데이터 없음');
      return;
    }
    const updates = {};
    removeKeys.forEach(p => { updates[p] = null; });
    await statusRef.update(updates);
    // 메모리 반영
    Object.values(workStatus).forEach(v => {
      if (v?.replacement_list) {
        Object.keys(v.replacement_list).forEach(k => {
          if (v.replacement_list[k]?._simulated) delete v.replacement_list[k];
        });
      }
    });
    if (typeof refreshAllMarkers === 'function') refreshAllMarkers();
    console.log(`%c🧹 시뮬레이션 ${removeKeys.length}건 Firebase 제거 완료`,
      'color:#dc2626;font-weight:bold');
  };

  console.log(
    '%c[simulate-helper] 사용 가능 (Firebase 직접 저장):\n' +
    "  simulateAddresses(addrCnt, weekNum, keywords)\n" +
    "  simulatePartial(addrCnt, perAddr, weekNum, keywords)\n" +
    '  simulateWeek(weekNum, count, keywords)\n' +
    '  clearSimulation()  — _simulated 표시된 것만 일괄 제거',
    'color:#7c3aed;font-weight:bold'
  );
})();
