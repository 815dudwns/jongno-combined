"""
Firebase 백업 데이터 복원 스크립트
경로: workStatus/charger4eleccar
작업자: 우영준 (admin)
"""

import firebase_admin
from firebase_admin import credentials, db
import json
import os

# 경로 설정 (스크립트 위치 기준 상위 디렉토리)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ACCOUNT_PATH = os.path.join(BASE_DIR, 'ami-work-1c49a-firebase-adminsdk-fbsvc-8ce17a057a.json')
BACKUP_DATA_PATH = os.path.join(BASE_DIR, 'data', 'work-status.json')


def get_updated_at(address):
    """
    주소에 따라 updatedAt 날짜 결정
    - 한남동 포함 -> 2026-03-25T09:00:00
    - 이촌동 포함 -> 2026-03-26T09:00:00
    - 나머지      -> 2026-03-27T09:00:00
    """
    if '한남동' in address:
        return '2026-03-25T09:00:00'
    elif '이촌동' in address:
        return '2026-03-26T09:00:00'
    else:
        return '2026-03-27T09:00:00'


def restore_data():
    print('=== Firebase 데이터 복원 시작 ===')

    # 백업 데이터 읽기
    with open(BACKUP_DATA_PATH, 'r', encoding='utf-8') as f:
        backup_data = json.load(f)

    addresses = list(backup_data.keys())
    print(f'총 {len(addresses)}개 항목 발견')

    # Firebase 초기화
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred, {
        'databaseURL': 'https://ami-work-1c49a-default-rtdb.asia-southeast1.firebasedatabase.app'
    })

    # 업로드할 데이터 구성
    upload_data = {}
    stats = {'한남동': 0, '이촌동': 0, '나머지': 0}

    for address in addresses:
        original = backup_data[address]

        entry = {
            # 백업 데이터 그대로 유지
            'state': original.get('state', 'pending'),
            'checkedMeters': original.get('checkedMeters', []),
            'reason': original.get('reason', ''),
            # failedMeters 없으면 빈 딕셔너리 추가
            'failedMeters': original.get('failedMeters', {}),
            # 작업자 정보 추가
            'updatedBy': 'admin',
            'updatedByName': '우영준',
            # 주소 기반 날짜 설정
            'updatedAt': get_updated_at(address),
        }

        upload_data[address] = entry

        # 통계
        if '한남동' in address:
            stats['한남동'] += 1
        elif '이촌동' in address:
            stats['이촌동'] += 1
        else:
            stats['나머지'] += 1

    print(f"날짜 분류: 한남동(03-25) {stats['한남동']}개, 이촌동(03-26) {stats['이촌동']}개, 나머지(03-27) {stats['나머지']}개")

    # Firebase에 업로드
    ref = db.reference('workStatus/charger4eleccar')
    print('Firebase 업로드 중...')
    ref.update(upload_data)

    print(f'\n=== 복원 완료: 총 {len(addresses)}개 항목 업로드됨 ===')


if __name__ == '__main__':
    restore_data()
