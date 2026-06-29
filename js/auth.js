// auth.js — 인증 관련 로직 (하드코딩 계정)

// 계정 목록.
// region: 작업자 계정은 지역 고정(구로 아이디=구로). admin/admin2는 region 없음 = 지역토글(모드) 따라감.
// (regions.js resolveRegionId: 세션 region 있으면 그 지역, 없으면 mcs_region 토글)
const ACCOUNTS = [
    { id: 'admin',  pw: '1201', name: '우영준', role: 'admin' },                    // 무적 — 지역토글
    { id: 'admin2', pw: '1234', name: '김창숙', role: 'admin' },                    // 구로 사장님 — 지역토글
    { id: 'meter1', pw: '1111', name: '계기팀', role: 'meter', region: 'jongno' },  // 종로 작업자
    { id: 'comm1',  pw: '1111', name: '통신팀', role: 'comm',  region: 'jongno' },  // 종로 작업자
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
    const account = ACCOUNTS.find(a => a.id === id && a.pw === pw);
    if (!account) {
        return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
    }
    const session = { id: account.id, name: account.name, role: account.role };
    if (account.region) session.region = account.region;   // 작업자 지역 고정(어드민은 없음=토글)
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
