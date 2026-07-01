// auth.js — 인증 관련 로직 (하드코딩 계정)

// 계정 목록.
// region: 작업자 계정은 지역 고정(구로 아이디=구로). admin/admin2는 region 없음 = 지역토글(모드) 따라감.
// (regions.js resolveRegionId: 세션 region 있으면 그 지역, 없으면 mcs_region 토글)
// lock: 명륜 팀 배분 잠금(2026-07-02). 종로/중구 팀을 계정 단위로 고정 — 남의 배분분 안 보임.
//   { team:'종로' }         → 명륜에서 종로 배분분만(다른 동그룹은 자유). 종로 작업자.
//   { dong:'명륜', team:'중구' } → 명륜 동그룹 + 중구 배분분만(다른 동 안 보임). 중구 작업자.
//   admin/구로는 lock 없음.
const ACCOUNTS = [
    { id: 'admin',  pw: '1201', name: '우영준', role: 'admin' },                    // 무적 — 지역토글
    { id: 'admin2', pw: '1234', name: '김창숙', role: 'admin' },                    // 구로 사장님 — 지역토글
    { id: 'meter1', pw: '1111', name: '계기팀', role: 'meter', region: 'jongno', lock: { team: '종로' } },  // 종로 계기팀 — 명륜 종로배분만
    { id: 'comm1',  pw: '1111', name: '통신팀', role: 'comm',  region: 'jongno', lock: { team: '종로' } },  // 종로 통신팀 — 명륜 종로배분만
    { id: 'Joong',     pw: '1111', name: '중구팀',   role: 'meter', region: 'jongno', lock: { dong: '명륜', team: '중구' } }, // 중구 계기팀 — 명륜 중구배분만
    { id: 'joongcomm', pw: '1111', name: '중구통신', role: 'comm',  region: 'jongno', lock: { dong: '명륜', team: '중구' } }, // 중구 통신팀 — 명륜 중구배분만
    { id: 'gurometer', pw: '1111', name: '구로 계기팀', role: 'meter', region: 'guro' }, // 구로 작업자(지역 고정)
    { id: 'gurocomm',  pw: '1111', name: '구로 통신팀', role: 'comm',  region: 'guro' }, // 구로 작업자(지역 고정)
];

const AUTH_KEY = 'jongno_auth';

/**
 * 로그인 시도
 * @param {string} id
 * @param {string} pw
 * @returns {{ ok: boolean, error?: string }}
 */
function authLogin(id, pw) {
    // 아이디는 대소문자 무시(폰 입력 마찰 방지 — 'Joong'/'joong' 둘 다 허용). 비번은 정확일치.
    const nid = String(id || '').trim().toLowerCase();
    const account = ACCOUNTS.find(a => a.id.toLowerCase() === nid && a.pw === pw);
    if (!account) {
        return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
    }
    const session = { id: account.id, name: account.name, role: account.role };
    if (account.region) session.region = account.region;   // 작업자 지역 고정(어드민은 없음=토글)
    if (account.lock) session.lock = account.lock;          // 명륜 팀 잠금(종로/중구 배분분 고정)
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return { ok: true };
}

/**
 * 현재 로그인 세션 반환. 없으면 null
 * @returns {{ id: string, name: string, role: string } | null}
 */
function authGetSession() {
    try {
        const raw = localStorage.getItem(AUTH_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * 로그아웃
 */
function authLogout() {
    localStorage.removeItem(AUTH_KEY);
    window.location.href = 'login.html';
}

/**
 * 로그인 여부 확인 — 미인증이면 login.html로 리다이렉트
 */
function authRequire() {
    if (!authGetSession()) {
        window.location.href = 'login.html';
    }
}
