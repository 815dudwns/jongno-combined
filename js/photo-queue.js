// js/photo-queue.js — 사진 유실 방지용 IndexedDB 대기 큐
//
// 목적: onPhotoSelect 압축 완료 직후 blob을 영속화 → 저장(node.set) 성공 후에만 삭제.
//   WebView 백그라운드 freeze / OS 킬 / 새로고침 / 이탈 로 인한 촬영본 전량 소실을 방어.
//
// 설계:
//   - 독립 DB 'jongno-photo-queue' (기존 'jongno-cache'·idb.js 와 격리)
//   - 키: "${addrKey}::${mid}::${field}" — 같은 계기·칸 재촬영 시 자동 덮어쓰기(ts는 값에)
//   - 필드 'new'는 신계기 사진 전용
//   - 모든 연산 best-effort(throw 금지) — 실패해도 메인 사진 경로에 영향 없음
//   - iOS Safari 호환(IndexedDB만, Background Sync 미사용)
//
// 사용:
//   PhotoQueue.put(addrKey, mid, field, blob)        // 큐 삽입(압축 완료 직후)
//   PhotoQueue.delete(addrKey, mid, field)           // 큐 삭제(node.set 성공 후)
//   PhotoQueue.deleteForMeter(addrKey, mid, fields)  // 저장된 계기 전 칸 한꺼번에 삭제
//   PhotoQueue.getAll()                              // 전체 조회(드레인용)
//   PhotoQueue.deleteBatch(keys)                     // 키 배열 일괄 삭제

const PhotoQueue = (() => {
  const DB_NAME  = 'jongno-photo-queue';
  const STORE    = 'pending';
  const DB_VER   = 1;

  // DB 열기 (싱글톤 캐시)
  let _dbPromise = null;
  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB 미지원')); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE); // keyPath 없이 out-of-line key 사용
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror  = () => reject(req.error || new Error('IDB open 실패'));
    });
    return _dbPromise;
  }

  // 키 생성
  function makeKey(addrKey, mid, field) {
    return `${addrKey}::${mid}::${field}`;
  }

  // blob + 메타 저장 (압축 완료 직후 호출)
  // Blob 대신 ArrayBuffer + type 저장: iOS WebKit에서 IDB 저장 Blob이 다음 세션에
  // null/읽기불가로 돌아오는 경우가 있음(구조적 직렬화 한계). ArrayBuffer는 안전.
  async function put(addrKey, mid, field, blob) {
    try {
      const buf = await blob.arrayBuffer();
      const db = await openDB();
      const entry = { buf, type: blob.type || 'image/jpeg', addrKey, mid, field, createdAt: Date.now(), uploaded: false };
      await new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(entry, makeKey(addrKey, mid, field));
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
        tx.onabort    = () => reject(tx.error || new Error('IDB put abort'));
      });
    } catch (e) {
      console.warn('[PhotoQueue] put 실패(무시):', e);
    }
  }

  // ArrayBuffer → Blob 재조립 (드레인·복구 시)
  function entryToBlob(entry) {
    if (!entry || !entry.buf) return null;
    try {
      return new Blob([entry.buf], { type: entry.type || 'image/jpeg' });
    } catch (e) {
      console.warn('[PhotoQueue] entryToBlob 실패:', e);
      return null;
    }
  }

  // 단일 키 삭제
  async function deleteEntry(addrKey, mid, field) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(makeKey(addrKey, mid, field));
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[PhotoQueue] delete 실패(무시):', e);
    }
  }

  // 계기 전 칸 한꺼번에 삭제 (node.set 성공 후 — fields: [...'whme_day', 'new'] 등)
  async function deleteForMeter(addrKey, mid, fields) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readwrite');
        const st  = tx.objectStore(STORE);
        for (const f of (fields || [])) {
          st.delete(makeKey(addrKey, mid, f));
        }
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
        tx.onabort    = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[PhotoQueue] deleteForMeter 실패(무시):', e);
    }
  }

  // 키 배열 일괄 삭제 (드레인 후 overkill 정리용)
  async function deleteBatch(keys) {
    if (!keys || !keys.length) return;
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        for (const k of keys) st.delete(k);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
        tx.onabort    = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[PhotoQueue] deleteBatch 실패(무시):', e);
    }
  }

  // 전체 조회 — [{key, ...entry}, ...] 반환 (드레인용)
  // getAllKeys + getAll 두 요청을 같은 트랜잭션에서 병렬로 날려 key-value를 묶음
  async function getAll() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const st = tx.objectStore(STORE);
        let keys = null, vals = null;
        const tryResolve = () => {
          if (keys === null || vals === null) return;
          const entries = [];
          for (let i = 0; i < keys.length; i++) {
            entries.push({ key: keys[i], ...vals[i] });
          }
          resolve(entries);
        };
        const ka = st.getAllKeys();
        ka.onsuccess = () => { keys = ka.result; tryResolve(); };
        ka.onerror   = () => reject(ka.error || new Error('IDB getAllKeys 실패'));
        const va = st.getAll();
        va.onsuccess = () => { vals = va.result; tryResolve(); };
        va.onerror   = () => reject(va.error || new Error('IDB getAll 실패'));
      });
    } catch (e) {
      console.warn('[PhotoQueue] getAll 실패(무시):', e);
      return [];
    }
  }

  return { put, delete: deleteEntry, deleteForMeter, deleteBatch, getAll, _entryToBlob: entryToBlob };
})();
