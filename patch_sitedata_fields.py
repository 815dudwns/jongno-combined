"""
patch_sitedata_fields.py — jongno-site-data.json에 계약종별·인입선상태 머지패치

엑셀: data/original/종로 실효리스트.xlsx '저압' 시트
매칭키: 계기번호 (fix_meter_no 정규화, 좌표추출_v2.py와 동일 로직)
추가 필드:
  - 계약종별: 셀 값 그대로 (예 "100 주택용", "211 일반용(갑)저압")
  - 인입선상태: 셀 값 그대로 (예 "O 가공")

- 백업: data/jongno-site-data.json.bak (덮어쓰기)
- firebase 업로드 없음, 로컬 in-place 갱신
"""

import json
import re
import shutil
from pathlib import Path

import openpyxl

# ── 경로 ─────────────────────────────────────────────────────────────────────
BASE = Path(__file__).parent
XLSX = BASE / "data/original/종로 실효리스트.xlsx"
SITE_DATA = BASE / "data/jongno-site-data.json"
BAK = BASE / "data/jongno-site-data.json.bak"


# ── fix_meter_no (좌표추출_v2.py와 동일 로직) ────────────────────────────────
def fix_meter_no(val):
    if val is None:
        return "".zfill(11)
    s = re.sub(r"[가-힣\s]", "", str(val))  # 한글 prefix("상계" 등) 제거
    try:
        return str(int(float(s))).zfill(11)
    except (ValueError, TypeError):
        return s.zfill(11)


def main():
    # 1. 백업 (항상 덮어씀)
    shutil.copy2(SITE_DATA, BAK)
    print(f"백업 완료: {BAK}")

    # 2. 엑셀 읽기 — 헤더 행에서 컬럼 위치 검색 (인덱스 하드코딩 금지)
    wb = openpyxl.load_workbook(str(XLSX), read_only=True, data_only=True)
    ws = wb["저압"]

    rows_iter = ws.iter_rows(values_only=True)
    header_row = next(rows_iter)
    headers = list(header_row)

    def col_idx(name):
        for i, h in enumerate(headers):
            if h and str(h).strip() == name:
                return i
        raise KeyError(f"헤더에 '{name}' 없음. 전체 헤더: {headers}")

    idx_meter = col_idx("계기번호")
    idx_clas  = col_idx("계약종별")
    idx_inlet = col_idx("인입선상태")
    print(f"컬럼 인덱스 — 계기번호:{idx_meter}, 계약종별:{idx_clas}, 인입선상태:{idx_inlet}")

    # 3. 엑셀 → {정규화계기번호: {계약종별, 인입선상태}} 딕셔너리
    xlsx_map = {}
    for row in rows_iter:
        raw_no = row[idx_meter]
        if raw_no is None:
            continue
        norm = fix_meter_no(raw_no)
        clas_val  = row[idx_clas]
        inlet_val = row[idx_inlet]
        xlsx_map[norm] = {
            "계약종별":  str(clas_val).strip()  if clas_val  not in (None, "") else "",
            "인입선상태": str(inlet_val).strip() if inlet_val not in (None, "") else "",
        }

    print(f"엑셀 행 수(계기번호 있는 것): {len(xlsx_map)}")

    # 4. site-data 읽기
    with open(SITE_DATA, encoding="utf-8") as f:
        site_data = json.load(f)
    print(f"site-data 총 항목: {len(site_data)}")

    # 5. 매칭 + 패치 (엑셀 값이 있는 경우에만 덮어씀)
    matched       = 0
    unmatched     = 0
    clas_filled   = 0
    inlet_filled  = 0

    for item in site_data:
        meter_no = fix_meter_no(item.get("계기번호"))
        if meter_no in xlsx_map:
            matched += 1
            extra = xlsx_map[meter_no]

            # 계약종별: 엑셀에 값이 있으면 덮어씀
            if extra["계약종별"]:
                item["계약종별"] = extra["계약종별"]
                clas_filled += 1
            elif "계약종별" not in item:
                item["계약종별"] = ""

            # 인입선상태: 엑셀에 값이 있으면 덮어씀
            if extra["인입선상태"]:
                item["인입선상태"] = extra["인입선상태"]
                inlet_filled += 1
            elif "인입선상태" not in item:
                item["인입선상태"] = ""
        else:
            unmatched += 1
            # 필드 키가 없으면 빈 문자열로 초기화
            if "계약종별" not in item:
                item["계약종별"] = ""
            if "인입선상태" not in item:
                item["인입선상태"] = ""

    # 6. 저장 (compact — 파일 크기 최소화)
    with open(SITE_DATA, "w", encoding="utf-8") as f:
        json.dump(site_data, f, ensure_ascii=False, separators=(',', ':'))

    # 7. 최종 상태 집계
    final_clas  = sum(1 for d in site_data if d.get("계약종별") and str(d["계약종별"]).strip())
    final_inlet = sum(1 for d in site_data if d.get("인입선상태") and str(d["인입선상태"]).strip())
    empty_inlet = sum(1 for d in site_data if not d.get("인입선상태") or not str(d["인입선상태"]).strip())

    # 8. 리포트
    print()
    print("=== 패치 결과 ===")
    print(f"site-data 총 항목        : {len(site_data)}")
    print(f"매칭 성공                : {matched}")
    print(f"매칭 실패(엑셀에 없음)    : {unmatched}")
    print(f"계약종별 채워진 항목      : {clas_filled}")
    print(f"인입선상태 채워진 항목    : {inlet_filled}")
    print(f"최종 계약종별 있는 항목   : {final_clas}")
    print(f"최종 인입선상태 있는 항목 : {final_inlet}")
    print(f"최종 인입선상태 빈 항목   : {empty_inlet}  (엑셀 원본에도 값 없음)")


if __name__ == "__main__":
    main()
