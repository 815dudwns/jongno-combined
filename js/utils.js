// utils.js — 유틸리티 함수

// 계기번호 앞 2~4자리 코드로 타입 판별
function parseType(meterNo) {
    const code = meterNo.substring(2, 4);
    if (code === '17') return 'E';
    if (code === '19') return 'EA';
    if (['25','26','27','45','46','47'].includes(code)) return 'G';
    if (code === '53' || code === '55') return 'Amigo';
    return null;
}

// 값을 클립보드에 복사하고 토스트로 무엇을 복사했는지 표시
let toastTimer = null;
function copyMeterNo(no) {
    const t = document.getElementById('toast');
    const original = t ? t.textContent : '';
    const value = (no == null) ? '' : String(no);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(() => showCopyToast(t, original, value))
            .catch(() => showCopyToast(t, original, value, true));
    } else {
        showCopyToast(t, original, value, true);
    }
}
function showCopyToast(t, original, value, failed) {
    if (!t) return;
    t.textContent = failed ? `복사 실패: ${value}` : `복사: ${value}`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        t.classList.remove('show');
        t.textContent = original || '복사했습니다';
    }, 2200);
}
