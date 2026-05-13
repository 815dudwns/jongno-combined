/**
 * Firebase 백업 데이터 복원 스크립트
 * 경로: workStatus/charger4eleccar
 * 작업자: 우영준 (admin)
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// 서비스 계정 키 경로
const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  '../ami-work-1c49a-firebase-adminsdk-fbsvc-8ce17a057a.json'
);

// 백업 데이터 경로
const BACKUP_DATA_PATH = path.join(__dirname, '../data/work-status.json');

// Firebase 초기화
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://ami-work-1c49a-default-rtdb.asia-southeast1.firebasedatabase.app',
});

const db = admin.database();

/**
 * 주소에 따라 updatedAt 날짜 결정
 * - 한남동 포함 → 2026-03-25T09:00:00
 * - 이촌동 포함 → 2026-03-26T09:00:00
 * - 나머지     → 2026-03-27T09:00:00
 */
function getUpdatedAt(address) {
  if (address.includes('한남동')) {
    return '2026-03-25T09:00:00';
  } else if (address.includes('이촌동')) {
    return '2026-03-26T09:00:00';
  } else {
    return '2026-03-27T09:00:00';
  }
}

async function restoreData() {
  console.log('=== Firebase 데이터 복원 시작 ===');

  // 백업 데이터 읽기
  const rawData = fs.readFileSync(BACKUP_DATA_PATH, 'utf8');
  const backupData = JSON.parse(rawData);
  const addresses = Object.keys(backupData);

  console.log(`총 ${addresses.length}개 항목 발견`);

  // 업로드할 데이터 구성
  const uploadData = {};

  for (const address of addresses) {
    const original = backupData[address];

    // Firebase key에서 슬래시(/) 등 특수문자를 사용할 수 없으므로
    // 주소를 그대로 key로 사용 (Firebase는 . # $ [ ] / 불가)
    // 주소에 공백 포함되어 있으므로 인코딩 필요 없음 (실제 key는 별도 처리)
    const entry = {
      // 백업 데이터 그대로 유지
      state: original.state,
      checkedMeters: original.checkedMeters || [],
      reason: original.reason || '',
      // failedMeters 없으면 빈 객체 추가
      failedMeters: original.failedMeters || {},
      // 작업자 정보 추가
      updatedBy: 'admin',
      updatedByName: '우영준',
      // 주소 기반 날짜 설정
      updatedAt: getUpdatedAt(address),
    };

    uploadData[address] = entry;
  }

  // 날짜별 통계 출력
  const stats = { 한남동: 0, 이촌동: 0, 나머지: 0 };
  for (const address of addresses) {
    if (address.includes('한남동')) stats.한남동++;
    else if (address.includes('이촌동')) stats.이촌동++;
    else stats.나머지++;
  }
  console.log(`날짜 분류: 한남동(03-25) ${stats.한남동}개, 이촌동(03-26) ${stats.이촌동}개, 나머지(03-27) ${stats.나머지}개`);

  // Firebase에 업로드
  const ref = db.ref('workStatus/charger4eleccar');

  console.log('Firebase 업로드 중...');
  await ref.update(uploadData);

  console.log(`\n=== 복원 완료: 총 ${addresses.length}개 항목 업로드됨 ===`);

  // 연결 종료
  await admin.app().delete();
  process.exit(0);
}

restoreData().catch((err) => {
  console.error('복원 중 오류 발생:', err);
  process.exit(1);
});
