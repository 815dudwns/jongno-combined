// admin-data.js — 관리자 페이지 데이터 로더 & 추상화
// 미래 다른 구(중구 등) 추가 대비: loadByDistrict('jongno') 구조

const AdminData = (() => {
  // 지원하는 구역 목록 — 추가 시 여기와 firebase 경로 매핑만 확장
  const DISTRICTS = ['jongno'];

  // 단가 (정식 사업 전 데이터관리 대행 단가)
  const UNIT_PRICE = 1000;

  // ─── 상태 키 ──────────────────────────────
  // verification_state: 'unverified' | 'verified' | 'needs_fix' | 'rework_requested'
  // export_state: 'pending' | 'exported'

  // ─── 데모 모드 ──────────────────────────────
  const DEMO_KEY = 'admin_demo_mode';
  function isDemoMode() {
    try { return localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; }
  }
  function setDemoMode(on) {
    try { localStorage.setItem(DEMO_KEY, on ? '1' : '0'); } catch {}
  }

  // ─── 데이터 로드 ──────────────────────────
  /**
   * 구역 통합 workStatus + siteData 로드
   * 데모 모드면 가짜 데이터 반환
   * 실 데이터면 Firebase + site-data.json 병합
   */
  async function loadAll() {
    if (isDemoMode()) return generateDemoData();
    const all = [];
    for (const d of DISTRICTS) {
      all.push(await loadByDistrict(d));
    }
    return mergeBy(all);
  }

  async function loadByDistrict(district) {
    // jongno만 현재 지원 (firebase.js 의 statusRef 사용 가정)
    if (district !== 'jongno') return { district, siteData: [], workStatus: {} };
    const siteData = await fetchSiteData();
    const workStatus = await fetchWorkStatus();
    return { district, siteData, workStatus };
  }

  async function fetchSiteData() {
    try {
      const r = await fetch('data/jongno-site-data.json');
      if (!r.ok) return [];
      return await r.json();
    } catch (e) {
      console.warn('[admin] siteData fetch 실패', e);
      return [];
    }
  }

  async function fetchWorkStatus() {
    // firebase.js의 statusRef 우선, 없으면 정적 JSON 폴백
    try {
      if (typeof statusRef !== 'undefined' && statusRef) {
        const snap = await statusRef.once('value');
        return snap.val() || {};
      }
    } catch (e) {
      console.warn('[admin] firebase workStatus 실패', e);
    }
    try {
      const r = await fetch('data/jongno-work-status.json');
      if (!r.ok) return {};
      return await r.json();
    } catch (e) {
      return {};
    }
  }

  function mergeBy(list) {
    if (list.length === 1) return list[0];
    // 다구 통합 (미래)
    const merged = { district: 'ALL', siteData: [], workStatus: {} };
    list.forEach(d => {
      merged.siteData = merged.siteData.concat(d.siteData || []);
      Object.assign(merged.workStatus, d.workStatus || {});
    });
    return merged;
  }

  // ─── 검증 큐 추출 ──────────────────────────
  /**
   * replacement_list 중 draft=false + verification_state in (unverified, needs_fix)
   * 각 항목에 주소·계기 메타 붙여 평탄화
   */
  function extractVerificationQueue(data) {
    const queue = [];
    const ws = data.workStatus || {};
    const siteMap = buildSiteMap(data.siteData || []);
    Object.entries(ws).forEach(([addr, entry]) => {
      const rl = entry?.replacement_list || {};
      Object.entries(rl).forEach(([oldId, r]) => {
        if (r.draft) return;
        const vs = r.verification_state || 'unverified';
        if (vs !== 'unverified' && vs !== 'needs_fix') return;
        const meta = siteMap[oldId] || null;
        const customer_id = meta?.고객번호 || '';
        queue.push({
          address: addr,
          old_meter_id: oldId,
          new_meter_id: r.new_meter_id || '',
          new_meter_mfg_ym: r.new_meter_mfg_ym || '',
          removal_value: r.removal_value,
          old_photo: r.old_meter_photo || '',
          new_photo: r.new_meter_photo || '',
          worker: r.worker || '',
          replaced_at: r.replaced_at || 0,
          daily_seq: r.daily_seq || 0,
          verification_state: vs,
          verification_reason: r.verification_reason || '',
          new_type5: (typeof parseType5 === 'function') ? parseType5(r.new_meter_id) : null,
          customer_id,
          customer_matched: !!customer_id,
          site: meta,
        });
      });
    });
    queue.sort((a, b) => b.replaced_at - a.replaced_at);
    return queue;
  }

  /** 검증 완료·미전송 모음 (전송 준비 탭용) */
  function extractExportPending(data) {
    const out = [];
    const ws = data.workStatus || {};
    const siteMap = buildSiteMap(data.siteData || []);
    Object.entries(ws).forEach(([addr, entry]) => {
      const rl = entry?.replacement_list || {};
      Object.entries(rl).forEach(([oldId, r]) => {
        if (r.draft) return;
        if (r.verification_state !== 'verified') return;
        if (r.export_state === 'exported') return;
        const meta = siteMap[oldId] || null;
        const customer_id = meta?.고객번호 || '';
        out.push({
          address: addr,
          old_meter_id: oldId,
          new_meter_id: r.new_meter_id || '',
          new_meter_mfg_ym: r.new_meter_mfg_ym || '',
          removal_value: r.removal_value,
          old_photo: r.old_meter_photo || '',
          new_photo: r.new_meter_photo || '',
          worker: r.worker || '',
          replaced_at: r.replaced_at || 0,
          customer_id,
          customer_matched: !!customer_id,
          site: meta,
        });
      });
    });
    out.sort((a, b) => a.replaced_at - b.replaced_at);
    return out;
  }

  function buildSiteMap(siteData) {
    const m = {};
    siteData.forEach(r => {
      const id = r.계기번호;
      if (id) m[String(id)] = r;
    });
    return m;
  }

  // ─── 통계 집계 ──────────────────────────
  function summarize(data) {
    const ws = data.workStatus || {};
    const sd = data.siteData || [];

    const total = sd.length;
    const excluded = sd.filter(r => r.자동완료 === true).length;
    const target = total - excluded; // 우리 몫

    // replacement_list 통계
    let total_replacements = 0;
    let drafts = 0;
    let unverified = 0;
    let verified_pending = 0;
    let verified_exported = 0;
    let needs_fix = 0;
    let rework = 0;
    const byType5 = {};
    const byWorker = {};

    Object.values(ws).forEach(entry => {
      const rl = entry?.replacement_list || {};
      Object.values(rl).forEach(r => {
        total_replacements++;
        if (r.draft) { drafts++; return; }
        const vs = r.verification_state || 'unverified';
        if (vs === 'unverified') unverified++;
        else if (vs === 'needs_fix') needs_fix++;
        else if (vs === 'rework_requested') rework++;
        else if (vs === 'verified') {
          if (r.export_state === 'exported') verified_exported++;
          else verified_pending++;
        }
        const t = (typeof parseType5 === 'function') ? parseType5(r.new_meter_id) : null;
        if (t) byType5[t] = (byType5[t] || 0) + 1;
        const w = r.worker || '미상';
        byWorker[w] = (byWorker[w] || 0) + 1;
      });
    });

    const exported_count = verified_exported;
    const revenue = exported_count * UNIT_PRICE;

    return {
      total, excluded, target,
      total_replacements, drafts,
      unverified, needs_fix, rework,
      verified_pending, verified_exported,
      exported_count, revenue,
      byType5, byWorker,
    };
  }

  // ─── 데모 데이터 생성 ──────────────────────
  function generateDemoData() {
    const workers = [
      { id: 'meter1', name: '김계기' },
      { id: 'meter2', name: '이교체' },
      { id: 'meter3', name: '박설치' },
      { id: 'admin',  name: '우영준' },
    ];
    const addrs = [
      '서울특별시 종로구 가회동 31-11',
      '서울특별시 종로구 가회동 195번지',
      '서울특별시 종로구 부암동 100-1',
      '서울특별시 종로구 평창동 200-5',
      '서울특별시 종로구 효자동 50-3',
      '서울특별시 종로구 청운동 88-2',
      '서울특별시 종로구 창신동 436-79',
      '서울특별시 종로구 숭인동 56-1',
      '서울특별시 종로구 이화동 70-8',
      '서울특별시 종로구 혜화동 1-12',
    ];
    const oldCodes = ['17']; // 구형
    const newCodes = [
      ['19','AE'],
      ['25','G_단상'],['26','G_단상'],['27','G_단상'],
      ['45','G_삼상'],['46','G_삼상'],
      ['53','AMIGO_단상'],
      ['55','AMIGO_삼상'],
    ];
    function pad11(s) { return String(s).padStart(11, '0').slice(-11); }
    function mkOldId(i) { return pad11(`56${oldCodes[0]}${(1000000 + i)}`); }
    function mkNewId(i) {
      const [code] = newCodes[i % newCodes.length];
      return pad11(`07${code}${(2000000 + i)}`);
    }

    // ws 빌드
    const workStatus = {};
    const siteData = [];
    let seqId = 0;

    addrs.forEach((addr, ai) => {
      const meterCount = 3 + (ai % 4); // 3~6 계기
      const replacement_list = {};
      for (let m = 0; m < meterCount; m++) {
        const idx = seqId++;
        const oldId = mkOldId(idx);
        const newId = mkNewId(idx);
        // 다양한 verification_state
        const vsRoll = idx % 7;
        let vs = 'unverified', es = 'pending', draft = false;
        if (vsRoll === 0) { vs = 'verified'; es = 'exported'; }
        else if (vsRoll === 1) { vs = 'verified'; es = 'pending'; }
        else if (vsRoll === 2) vs = 'needs_fix';
        else if (vsRoll === 3) vs = 'rework_requested';
        else if (vsRoll === 4) { draft = true; }
        const worker = workers[idx % workers.length];
        const daysAgo = Math.floor(idx / 4);
        const ts = Date.now() - daysAgo * 86400 * 1000 - (idx % 8) * 3600 * 1000;
        replacement_list[oldId] = {
          old_meter_id: oldId,
          new_meter_id: newId,
          removal_value: 12000 + idx * 137,
          new_meter_mfg_ym: '2024-11',
          old_meter_photo: '',
          new_meter_photo: '',
          worker: worker.id,
          replaced_at: ts,
          daily_seq: (m + 1),
          draft,
          verification_state: vs,
          verification_reason: vs === 'needs_fix' ? '사진 흐림' : (vs === 'rework_requested' ? '계기번호 오타 의심' : ''),
          verified_at: vs === 'verified' ? ts + 3600000 : 0,
          verified_by: vs === 'verified' ? 'admin' : '',
          verified_by_name: vs === 'verified' ? '우영준' : '',
          export_state: es,
          exported_at: es === 'exported' ? ts + 86400000 : 0,
          exported_batch_id: es === 'exported' ? `EXP-DEMO-${String(Math.floor(ai/3)+1).padStart(3,'0')}` : '',
        };
        siteData.push({
          주소: addr,
          도로명주소: addr.replace('지번', '도로명'),
          계기번호: oldId,
          계기타입: 'E',
          고객번호: pad11(String(idx + 100000000)),
          법정동: addr.split(' ')[2] || '',
          동그룹: ['북촌·삼청','부암·평창','청운효자·사직','창신','숭인','혜화·이화','종로 도심'][ai % 7],
          검침일: (idx % 4) * 7 + 2,
          검침일그룹: ['G1','G2','G3','G4'][(idx % 4)],
          순위: ['1순위','2순위','3순위','4순위','과년도'][idx % 5],
          단상삼상: (idx % 3 === 0) ? '삼상' : '단상',
          자동완료: false,
          lat: 37.58 + (Math.random() - 0.5) * 0.01,
          lng: 126.98 + (Math.random() - 0.5) * 0.01,
          좌표정확도: 'exact',
        });
      }
      workStatus[addr] = {
        meter_state: 'complete',
        meter_updatedAt: new Date().toISOString(),
        meter_updatedBy: 'meter1',
        meter_updatedByName: '계기팀',
        comm_state: 'complete',
        replacement_list,
      };
    });

    // 시뮬용 추가 site-data (분모 부풀리기 — 미작업)
    for (let i = 0; i < 200; i++) {
      siteData.push({
        주소: `서울특별시 종로구 더미동 ${i}-${i}`,
        도로명주소: `서울 종로구 더미로 ${i}`,
        계기번호: pad11(`56${oldCodes[0]}${9000000 + i}`),
        계기타입: 'E',
        고객번호: pad11(String(i + 500000000)),
        법정동: '더미동',
        동그룹: ['북촌·삼청','부암·평창','청운효자·사직'][i % 3],
        검침일: (i % 4) * 7 + 2,
        검침일그룹: ['G1','G2','G3','G4'][i % 4],
        순위: ['1순위','2순위','3순위','4순위','과년도'][i % 5],
        단상삼상: (i % 3 === 0) ? '삼상' : '단상',
        자동완료: (i % 10 === 0),
        lat: 37.58, lng: 126.98, 좌표정확도: 'exact',
      });
    }

    return { district: 'jongno', siteData, workStatus };
  }

  // ─── Firebase 쓰기 (검증 상태 변경, 데모 모드면 차단) ──────────────────
  async function setVerification(addr, oldMeterId, patch) {
    if (isDemoMode()) {
      console.log('[demo] setVerification 무시', addr, oldMeterId, patch);
      return false;
    }
    if (typeof statusRef === 'undefined' || !statusRef) {
      throw new Error('Firebase 미초기화');
    }
    const key = (typeof encodeKey === 'function') ? encodeKey(addr) : addr;
    await statusRef.child(key).child('replacement_list').child(oldMeterId).update(patch);
    return true;
  }

  return {
    DISTRICTS, UNIT_PRICE,
    isDemoMode, setDemoMode,
    loadAll, loadByDistrict,
    extractVerificationQueue,
    extractExportPending,
    summarize,
    setVerification,
  };
})();
