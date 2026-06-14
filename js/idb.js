// js/idb.js — 작은 IndexedDB key-value 래퍼 (siteData 캐시-우선 로더용)
//   목적: 11MB jongno-site-data.json을 폰 IndexedDB에 캐시 → 버전 같으면 재다운로드 0.
//   ★아이폰 사파리 PWA는 콜드스타트 시 HTTP 캐시(force-cache)를 잘 비워 매번 11MB 재다운로드됨.
//     IndexedDB는 PWA 재시작에도 생존 → 재진입 즉시 로드.
//   localStorage는 5~10MB 한도라 11MB 못 담음 → IndexedDB 사용.
//   모든 함수는 실패 시 reject — 호출측이 try/catch로 fetch 폴백해야 함(누락 금지).
(function () {
    const DB_NAME = 'jongno-cache';
    const STORE = 'kv';
    const DB_VER = 1;

    function openDB() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { reject(new Error('IndexedDB 미지원')); return; }
            const req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IDB open 실패'));
        });
    }

    async function idbGet(key) {
        const db = await openDB();
        try {
            return await new Promise((resolve, reject) => {
                const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('IDB get 실패'));
            });
        } finally { db.close(); }
    }

    async function idbSet(key, value) {
        const db = await openDB();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('IDB set 실패'));
                tx.onabort = () => reject(tx.error || new Error('IDB set abort(용량초과?)'));
            });
        } finally { db.close(); }
    }

    window.idbGet = idbGet;
    window.idbSet = idbSet;
})();
