// config.js — Firebase 설정값 및 상수

const firebaseConfig = {
    apiKey: "AIzaSyAqVaYGYLjT4qa8nQToYlSqnqtlgoFauWU",
    authDomain: "ami-work-1c49a.firebaseapp.com",
    databaseURL: "https://ami-work-1c49a-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ami-work-1c49a",
    storageBucket: "ami-work-1c49a.firebasestorage.app",
    messagingSenderId: "734048538037",
    appId: "1:734048538037:web:5514cb0a78ea03a4571dfc"
};

const STORAGE_KEY = 'ami_work_status';
const CHECKED_KEY = 'ami_checked_meters';
const PENDING_KEY = 'ami_pending_sync';   // 하위호환용, 미사용
const EVENTS_KEY  = 'ami_event_queue';
