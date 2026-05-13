#!/usr/bin/env python3
# reset_work_status.py
# Firebase Realtime DB의 workStatus/charger4eleccar를 빈 상태({})로 초기화
# 용도: upload_work_status.py로 잘못 업로드한 107개 항목 전부 삭제

import sys
import os

try:
    import firebase_admin
    from firebase_admin import credentials, db as firebase_db
except ImportError:
    print("firebase-admin이 설치되어 있지 않습니다. pip install firebase-admin 실행 필요")
    sys.exit(1)

# 경로 설정
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ACCOUNT_KEY = os.path.join(BASE_DIR, "ami-work-1c49a-firebase-adminsdk-fbsvc-8ce17a057a.json")
DB_URL = "https://ami-work-1c49a-default-rtdb.asia-southeast1.firebasedatabase.app"

def main():
    print("=== workStatus/charger4eleccar 초기화 스크립트 ===\n")

    # 서비스 계정 키 확인
    if not os.path.exists(SERVICE_ACCOUNT_KEY):
        print(f"[오류] 서비스 계정 키 파일 없음: {SERVICE_ACCOUNT_KEY}")
        sys.exit(1)

    # Firebase 초기화
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
    firebase_admin.initialize_app(cred, {"databaseURL": DB_URL})
    print("[Firebase] 초기화 완료")

    ref = firebase_db.reference("workStatus/charger4eleccar")

    # 현재 데이터 읽기 (개수 확인용)
    print("[Firebase] 현재 데이터 읽는 중...")
    current_data = ref.get()

    if current_data is None:
        print("[정보] 이미 비어 있습니다. 작업 불필요.")
        return

    count = len(current_data)
    print(f"[정보] 현재 저장된 항목 수: {count}개")
    print("[정보] 항목 목록:")
    for key in sorted(current_data.keys()):
        state = current_data[key].get("state", "unknown")
        updated_at = current_data[key].get("updatedAt", "unknown")
        print(f"  - {key} (state: {state}, updatedAt: {updated_at})")

    # 초기화 실행 (delete()로 노드 자체를 삭제)
    print(f"\n[Firebase] workStatus/charger4eleccar 노드 삭제 중...")
    ref.delete()
    print("[Firebase] 삭제 완료!")

    # 결과 확인
    verify = ref.get()
    if verify is None:
        print("\n[성공] workStatus/charger4eleccar 가 완전히 비어있습니다.")
        print(f"[요약] {count}개 항목 삭제 완료")
    else:
        print(f"\n[경고] 삭제 후에도 데이터가 남아 있습니다: {verify}")

if __name__ == "__main__":
    main()
