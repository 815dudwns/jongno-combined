#!/usr/bin/env python3
# seed_work_status_jongno.py
# jongno-site-data.json의 자동완료=true 항목을 기반으로
# data/jongno-work-status.json (fallback용, raw 주소 키) 생성
#
# 사용법:
#   python3 scripts/seed_work_status_jongno.py
#
# 출력:
#   data/jongno-work-status.json — firebase.js initFirebase fallback에서 로드하는 파일

import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DATA_PATH = os.path.join(BASE_DIR, "data", "jongno-site-data.json")
OUTPUT_PATH    = os.path.join(BASE_DIR, "data", "jongno-work-status.json")

UPDATED_AT = "2026-05-13T00:00:00.000Z"

def main():
    with open(SITE_DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    auto_rows = [d for d in data if d.get("자동완료") is True]
    print(f"자동완료=true 행 수: {len(auto_rows)}")

    # 주소 기준 dedup — 같은 주소 여러 행이 있으면 한 엔트리로
    result = {}
    for row in auto_rows:
        addr = row.get("주소", "").strip()
        if not addr:
            continue
        if addr in result:
            continue  # 이미 처리된 주소
        result[addr] = {
            "state":         "complete",
            "reason":        "",
            "updatedAt":     UPDATED_AT,
            "updatedBy":     "AUTO_IMPORT",
            "updatedByName": "자동 임포트",
            "meter_done":    True,
            "comm_done":     True,
            "checkedMeters": [],
        }

    print(f"고유 주소 수(dedup): {len(result)}")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"저장 완료: {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
