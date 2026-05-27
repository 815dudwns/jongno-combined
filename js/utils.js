// utils.js — 유틸리티 함수

// ── KST 시간 헬퍼 ─────────────────────────────────────────────
// Asia/Seoul 기준 ISO 문자열 반환 (예: "2026-05-27T14:30:00+09:00")
function isoKst(d) {
    if (!d) d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}+09:00`;
}

// Asia/Seoul 기준 YYYY-MM-DD 반환
function kstYmd(d) {
    if (!d) d = new Date();
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
}

// Asia/Seoul 기준 HH:MM 반환 (표시용)
function kstHm(d) {
    if (!d) d = new Date();
    return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
}

// KST 자정~23:59:59.999 범위 반환 (일자 범위 필터용)
// yyyymmdd: "YYYY-MM-DD" 형식
function kstDayRange(yyyymmdd) {
    const [y, m, d] = yyyymmdd.split('-').map(Number);
    const start = Date.UTC(y, m - 1, d, -9, 0, 0, 0);      // KST 00:00 = UTC -9h
    const end   = Date.UTC(y, m - 1, d, 14, 59, 59, 999);  // KST 23:59:59.999 = UTC 14:59:59
    return { start, end };
}

// KST 오늘 자정 ms (todayStartMs 공통 구현)
function kstTodayStartMs() {
    const ymd = kstYmd(new Date());
    const [y, m, d] = ymd.split('-').map(Number);
    return Date.UTC(y, m - 1, d, -9, 0, 0, 0);
}


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
