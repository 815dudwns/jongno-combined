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

// 정산·집계용 5종 분류 (2026-05-21 영준님 확정)
// 신규 설치 계기는 AE / G단상 / G삼상 / Amigo단상 / Amigo삼상 5종이 전부
// E(17)은 신규 없음 → 5종 분류에서는 null 반환
function parseType5(meterNo) {
    if (!meterNo || String(meterNo).length < 4) return null;
    const code = String(meterNo).substring(2, 4);
    if (code === '19') return 'AE';
    if (['25','26','27'].includes(code)) return 'G_단상';
    if (['45','46','47'].includes(code)) return 'G_삼상';
    if (code === '53') return 'AMIGO_단상';
    if (code === '55') return 'AMIGO_삼상';
    return null;
}

// 5종 표시 라벨
const TYPE5_LABELS = ['AE', 'G_단상', 'G_삼상', 'AMIGO_단상', 'AMIGO_삼상'];
function type5Label(t) {
    return ({
        AE: 'AE',
        G_단상: 'G 단상',
        G_삼상: 'G 삼상',
        AMIGO_단상: 'AMIGO 단상',
        AMIGO_삼상: 'AMIGO 삼상',
    })[t] || '기타';
}

// 값을 클립보드에 복사하고 토스트 표시
let toastTimer = null;
function copyMeterNo(no) {
    const value = (no == null) ? '' : String(no);
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => {
        const t = document.getElementById('toast');
        if (!t) return;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
    });
}
