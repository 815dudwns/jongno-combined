// regions.js — 멀티지역 설정 레이어 (config.js·firebase.js·map.js보다 먼저 로드)
//
// 한 코드베이스로 여러 지역(종로/구로/…)을 운영하기 위한 단일 설정 출처.
// 지역에 종속된 값(지도중심·동그룹·검침일그룹·site-data 경로·캐시/노드 키)을 여기 모은다.
//
// ★ 무손상 원칙: region='jongno'일 때 모든 로컬 키가 기존 문자열과 byte 동일
//   (예: 'jongno_work_status', 'jongno-site-data'). → 기존 종로 사용자 마이그레이션 0.
// ★ auth/세션(jongno_auth)은 지역분리 하지 않는다(전역) — admin 자동로그인 보존.

const REGIONS = {
    jongno: {
        id: 'jongno',
        label: '종로',
        center: { lat: 37.578, lng: 126.983 },
        zoom: 15,
        siteData:    './data/jongno-site-data.json',
        siteVersion: './data/jongno-site-data.version.json',
        // 데이터의 '동그룹' 필드와 직접 매칭(map.js buildAddrCandidates) — 키만 의미 있음
        dongGroups: {
            '북촌·삼청':       ['가회동','삼청동','화동','안국동','소격동','팔판동','사간동','재동','계동','원서동','송현동'],
            '부암·평창':       ['부암동','신영동','홍지동','평창동','구기동'],
            '청운효자·사직':   ['청운동','효자동','창성동','통의동','적선동','통인동','누상동','누하동','옥인동','신교동','궁정동','사직동','도렴동','당주동','내수동','내자동','신문로1가','신문로2가','필운동','체부동','세종로'],
            '무악·교남':       ['무악동','교남동','교북동','행촌동','평동','송월동','홍파동'],
            '종로 도심':       ['종로1가','종로2가','종로3가','종로4가','종로5가','종로6가','청진동','견지동','서린동','수송동','중학동','관철동','관수동','익선동','돈의동','봉익동','묘동','권농동','와룡동','인사동','관훈동','경운동','낙원동','운니동','공평동','인의동','예지동','장사동','훈정동'],
            '혜화·이화':       ['혜화동','이화동','동숭동','연건동','충신동','원남동','효제동','연지동'],
            '창신':            ['창신동'],
            '숭인':            ['숭인동'],
            '명륜':            ['명륜1가','명륜2가','명륜3가','명륜4가'],
        },
        checkdayGroups: {
            'G1': '1주차 (D1~D5)',
            'G2': '2주차 (D8~D12)',
            'G3': '3주차 (D15~D19)',
            'G4': '4주차 (D22~D26)',
        },
    },

    guro: {
        id: 'guro',
        label: '구로',
        // guro-site-data 좌표 median
        center: { lat: 37.4772, lng: 126.8908 },
        zoom: 14,
        siteData:    './data/guro-site-data.json',
        siteVersion: './data/guro-site-data.version.json',
        // 구로금천지사 — 법정동 하나가 여러 행정동그룹으로 쪼개지므로 site-data '동그룹' 필드값을 키로 사용
        dongGroups: {
            '개봉1동':        [],
            '개봉남부·가리봉': [],
            '독산북부':        [],
            '독산남부':        [],
            '가산동':          [],
            '시흥동':          [],
        },
        // 종로와 동일(추후 30일 검침건 G5 추가 검토)
        checkdayGroups: {
            'G1': '1주차 (D1~D5)',
            'G2': '2주차 (D8~D12)',
            'G3': '3주차 (D15~D19)',
            'G4': '4주차 (D22~D26)',
        },
    },
};

// 현재 지역 — 전역 키(mcs_region). auth와 무관, 지역 토글로만 변경.
const REGION_ID = (() => {
    try {
        const r = localStorage.getItem('mcs_region');
        return (r && REGIONS[r]) ? r : 'jongno';
    } catch (e) { return 'jongno'; }
})();
const REGION = REGIONS[REGION_ID] || REGIONS.jongno;

// 지역 파생 키 — region='jongno'면 기존 문자열과 byte 동일
function regionKey(suffix) { return REGION.id + suffix; }     // regionKey('_work_status') → 'jongno_work_status'
function regionIdbKey()    { return REGION.id + '-site-data'; } // 'jongno-site-data'

// 지역 전환(관리자 메뉴 토글에서 호출) — 저장 후 reload
function switchRegion(regionId) {
    if (!REGIONS[regionId]) return;
    if (regionId === REGION_ID) return;
    try { localStorage.setItem('mcs_region', regionId); } catch (e) {}
    location.reload();
}

// 디버그/검증용 노출 (읽기 참조 — 무해). 콘솔에서 window.REGION 확인 가능.
try {
    window.REGION = REGION;
    window.REGION_ID = REGION_ID;
    window.REGIONS = REGIONS;
    window.regionKey = regionKey;
} catch (e) {}
