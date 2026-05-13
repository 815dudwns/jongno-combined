#!/usr/bin/env python3
# upload_work_status.py
# Firebase Realtime DB의 workStatus/charger4eleccar에 작업자/날짜 정보를 일괄 업로드

import json
import sys
import os

# firebase-admin SDK
try:
    import firebase_admin
    from firebase_admin import credentials, db as firebase_db
except ImportError:
    print("firebase-admin이 설치되어 있지 않습니다. pip install firebase-admin 실행 필요")
    sys.exit(1)

# 경로 설정
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DATA_PATH = os.path.join(BASE_DIR, "data", "site-data.json")
SERVICE_ACCOUNT_KEY = os.path.join(BASE_DIR, "ami-work-1c49a-firebase-adminsdk-fbsvc-8ce17a057a.json")
DB_URL = "https://ami-work-1c49a-default-rtdb.asia-southeast1.firebasedatabase.app"

def load_addresses():
    """site-data.json에서 고유 주소 목록 추출"""
    with open(SITE_DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    # 고유 주소만 추출 (빈 문자열 제외)
    addresses = list(set(item["주소"] for item in data if item.get("주소", "").strip()))
    return addresses

def classify_address(address):
    """
    주소 분류:
    - 한남동 포함 → (날짜: 2026-03-25)
    - 이촌동 포함 → (날짜: 2026-03-26)
    - 종로구/중구 포함 → None (건드리지 않음)
    - 나머지 마포구/용산구 → (날짜: 2026-03-27)
    """
    if "종로구" in address or "중구" in address:
        return None  # 제외
    if "한남동" in address:
        return "2026-03-25"
    if "이촌동" in address:
        return "2026-03-26"
    return "2026-03-27"  # 나머지 마포구/용산구

def build_entry(updated_at):
    """Firebase에 저장할 항목 딕셔너리 생성"""
    return {
        "state": "complete",
        "updatedAt": updated_at,
        "updatedBy": "admin",
        "updatedByName": "우영준",
        "checkedMeters": [],
        "reason": "",
        "failedMeters": {},
    }

def main():
    # Firebase Admin SDK 초기화
    print(f"[Firebase] 서비스 계정 키: {SERVICE_ACCOUNT_KEY}")
    if not os.path.exists(SERVICE_ACCOUNT_KEY):
        print("[오류] 서비스 계정 키 파일이 존재하지 않습니다.")
        sys.exit(1)

    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
    firebase_admin.initialize_app(cred, {"databaseURL": DB_URL})
    print("[Firebase] 초기화 완료")

    # 주소 로드 및 분류
    addresses = load_addresses()
    print(f"[정보] 전체 고유 주소 수: {len(addresses)}개\n")

    hannamdong_list = []
    ichondong_list = []
    others_list = []
    skipped_list = []

    payload = {}  # Firebase에 업로드할 데이터

    for addr in sorted(addresses):
        updated_at = classify_address(addr)
        if updated_at is None:
            skipped_list.append(addr)
            continue
        entry = build_entry(updated_at)
        payload[addr] = entry

        if "한남동" in addr:
            hannamdong_list.append(addr)
        elif "이촌동" in addr:
            ichondong_list.append(addr)
        else:
            others_list.append(addr)

    print(f"한남동: {len(hannamdong_list)}개")
    print(f"이촌동: {len(ichondong_list)}개")
    print(f"나머지(마포구/용산구): {len(others_list)}개")
    print(f"제외(종로구/중구): {len(skipped_list)}개")
    print(f"업로드 대상 총 합계: {len(payload)}개\n")

    # Firebase에 업로드 (update: 기존 키 유지, 대상 키만 덮어씀)
    ref = firebase_db.reference("workStatus/charger4eleccar")
    print("[Firebase] 업로드 시작...")
    ref.update(payload)
    print("[Firebase] 업로드 완료!")

    # 결과 요약
    print("\n===== 결과 요약 =====")
    print(f"한남동 ({len(hannamdong_list)}개, updatedAt: 2026-03-25):")
    for a in hannamdong_list:
        print(f"  - {a}")
    print(f"\n이촌동 ({len(ichondong_list)}개, updatedAt: 2026-03-26):")
    for a in ichondong_list:
        print(f"  - {a}")
    print(f"\n나머지 ({len(others_list)}개, updatedAt: 2026-03-27):")
    for a in others_list:
        print(f"  - {a}")
    print(f"\n제외 ({len(skipped_list)}개, 종로구/중구 — 미수정):")
    for a in skipped_list:
        print(f"  - {a}")

if __name__ == "__main__":
    main()
