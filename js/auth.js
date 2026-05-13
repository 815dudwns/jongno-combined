// auth.js — 인증 관련 로직 (하드코딩 계정)

// 계정 목록 (종로 합동시공 전용: 관리자 1 + 계기팀 + 통신팀)
const ACCOUNTS = [
    { id: 'admin',  pw: '8414', name: '우영준', role: 'admin' },
    { id: 'meter1', pw: '1111', name: '계기팀', role: 'meter' },
    { id: 'comm1',  pw: '1111', name: '통신팀', role: 'comm'  },
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
