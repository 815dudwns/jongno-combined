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

const STORAGE_KEY = 'jongno_work_status';
const CHECKED_KEY = 'jongno_checked_meters';
const PENDING_KEY = 'ami_pending_sync';   // 하위호환용, 미사용
const EVENTS_KEY  = 'jongno_event_queue';
