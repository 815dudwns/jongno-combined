// config.js — Firebase 설정값 및 상수

// TODO: 새 Firebase 프로젝트 config 입력
// 기존 ami-work-1c49a 참고:
//   apiKey: "AIzaSyAqVaYGYLjT4qa8nQToYlSqnqtlgoFauWU"
//   authDomain: "ami-work-1c49a.firebaseapp.com"
//   databaseURL: "https://ami-work-1c49a-default-rtdb.asia-southeast1.firebasedatabase.app"
//   projectId: "ami-work-1c49a"
//   storageBucket: "ami-work-1c49a.firebasestorage.app"
//   messagingSenderId: "734048538037"
//   appId: "1:734048538037:web:5514cb0a78ea03a4571dfc"
const firebaseConfig = {
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
};

const STORAGE_KEY = 'jongno_work_status';
const CHECKED_KEY = 'jongno_checked_meters';
const PENDING_KEY = 'ami_pending_sync';   // 하위호환용, 미사용
const EVENTS_KEY  = 'jongno_event_queue';
