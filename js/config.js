// config.js — Firebase 설정값 및 상수

// ami-jongno (종로 합동시공 전용 Firebase 프로젝트)
const firebaseConfig = {
    apiKey: "AIzaSyAQae8iqfvkYgFxoSZNaLuCca3ldA4koUU",
    authDomain: "ami-jongno.firebaseapp.com",
    databaseURL: "https://ami-jongno-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ami-jongno",
    storageBucket: "ami-jongno.firebasestorage.app",
    messagingSenderId: "393038393348",
    appId: "1:393038393348:web:1e0bfa92164554c3d24551"
};

// 지역 파생 키 (regions.js의 REGION). region='jongno'면 기존 문자열과 byte 동일 → 종로 무손상.
const STORAGE_KEY = regionKey('_work_status');     // 'jongno_work_status' | 'guro_work_status'
const CHECKED_KEY = regionKey('_checked_meters');
const PENDING_KEY = 'ami_pending_sync';   // 하위호환용, 미사용
const EVENTS_KEY  = regionKey('_event_queue');


// 네이버 지도 Web Dynamic Map NCP Key ID
// 네이버 클라우드 콘솔에서 발급받은 Key ID를 입력하세요.
const NAVER_MAPS_NCP_KEY_ID = "dxuz48sk06";


// 네이버 지도 Style Editor 연동용 My Style ID
// 다크 지도 타일을 쓰려면 네이버 클라우드 Maps > Style Editor에서 다크 스타일을 발행한 뒤
// NAVER_MAPS_DARK_STYLE_ID에 My Style ID를 입력하세요. 비워두면 기본 지도 타일을 사용합니다.
const NAVER_MAPS_LIGHT_STYLE_ID = "";
const NAVER_MAPS_DARK_STYLE_ID = "68fdddd5-dbb4-420a-9e4f-45bc0b0cf5eb";
