// auth.js — 인증 관련 로직 (하드코딩 계정)

// 계정 목록
const ACCOUNTS = [
    { id: 'admin',  pw: '8414', name: '우영준', role: 'admin' },
    { id: 'user01', pw: '1111', name: '김민성', role: 'user' },
    { id: 'user02', pw: '1111', name: '이영길', role: 'user' },
    { id: 'user03', pw: '1111', name: '김상권', role: 'user' },
    { id: 'user04', pw: '1111', name: '김지호', role: 'user' },
    { id: 'user05', pw: '1111', name: '장성훈', role: 'user' },
    { id: 'user06', pw: '1111', name: '조은규', role: 'user' },
    { id: 'user07', pw: '1111', name: '장진교', role: 'user' },
    { id: 'user08', pw: '1111', name: '이규재', role: 'user' },
    { id: 'user09', pw: '1111', name: '윤용운', role: 'user' },
    { id: 'user10', pw: '1111', name: '이종우', role: 'user' },
    { id: 'user11', pw: '1111', name: '최창호', role: 'user' },
    { id: 'user12', pw: '1111', name: '우희근', role: 'user' },
];

const AUTH_KEY = 'ami_auth';

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
