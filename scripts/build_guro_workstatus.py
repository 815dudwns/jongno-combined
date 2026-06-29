#!/usr/bin/env python3
"""
guro workStatus JSON 빌더
차수 엑셀(5/14/15/18차) → workStatus/guro 구조로 변환
종로 스키마 완전 복제 (kepco_import 레코드 기준)

실행: python3 scripts/build_guro_workstatus.py
출력: data/guro-workstatus-build.json
"""
import json, os, re
from datetime import datetime, timezone, timedelta
import openpyxl

# ------------------------------------------------------------------
# 설정
# ------------------------------------------------------------------
UPLOAD_DIR = "/Users/woodelight/.claude/uploads/46113083-8d23-4581-8d55-c7ab8cc2b64a/"
SITE_DATA_PATH = "/Users/woodelight/Projects/ami-work/data/guro-site-data.json"
OUTPUT_PATH = "/Users/woodelight/Projects/ami-work/data/guro-workstatus-build.json"

KST = timezone(timedelta(hours=9))

# 차수별 파일 정보 — 헤더명으로 컬럼 찾음 (고정 인덱스 아님)
EXCEL_FILES = [
    ("5차",  "4cb72579-__________5__.xlsx"),
    ("14차", "fa1283c0-___________14__.xlsx"),
    ("15차", "434215c3-__________15__.xlsx"),
    ("18차", "a8a59e8e-__________18__.xlsx"),
]

# ------------------------------------------------------------------
# 유틸
# ------------------------------------------------------------------
def normalize_meter(v):
    """
    계기번호 정규화.
    - 순수 숫자: float→int→str→zfill(11), 하이픈 제거
    - KH 접두사 계기(KH340126316 등): KH + 나머지 숫자 그대로 유지
      (site-data가 KH 포함 문자열로 저장되어 있음)
    """
    if v is None:
        return None
    s = str(v).strip().replace('-', '')

    # KH 접두사 특수 계기 — site-data와 동일 형식으로 유지
    if s.upper().startswith('KH'):
        digits = re.sub(r'\D', '', s[2:])
        return 'KH' + digits

    if '.' in s:
        try:
            s = str(int(float(s)))
        except Exception:
            pass
    s = re.sub(r'\D', '', s)  # 숫자만
    if not s:
        return None
    return s.zfill(11)


def parse_reading(v):
    """검침값 파싱: '074436.00' -> 74436, None -> None"""
    if v is None:
        return None
    s = str(v).strip()
    try:
        return int(float(s))
    except Exception:
        return None


def date_to_kst_ms(v):
    """
    부설일자/철거일자 → KST 자정 ms timestamp
    엑셀 date object, '2026-01-15' 문자열, datetime 모두 처리
    """
    if v is None:
        return None
    if isinstance(v, datetime):
        dt = v.replace(hour=0, minute=0, second=0, microsecond=0)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=KST)
        return int(dt.timestamp() * 1000)
    s = str(v).strip()
    # 'YYYY-MM-DD' 혹은 'YYYY-MM-DD HH:MM:SS' 형식
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            dt = datetime.strptime(s[:10], '%Y-%m-%d')
            dt = dt.replace(tzinfo=KST)
            return int(dt.timestamp() * 1000)
        except Exception:
            pass
    return None


def find_col(header, *names):
    """헤더 행에서 이름 중 하나 일치하는 인덱스 반환 (공백 무시, 없으면 None)"""
    normalized = [str(h or '').replace(' ', '').strip() for h in header]
    for name in names:
        n = name.replace(' ', '')
        if n in normalized:
            return normalized.index(n)
    return None


# ------------------------------------------------------------------
# 엑셀 파싱
# ------------------------------------------------------------------
def parse_excel(cha, fname):
    """차수 엑셀 파싱 → 레코드 리스트 반환"""
    fpath = os.path.join(UPLOAD_DIR, fname)
    wb = openpyxl.load_workbook(fpath, read_only=True, data_only=True)
    ws = wb['계획공사 일일입력 결과조회']
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    # 2행이 헤더
    header = rows[1]

    # 컬럼 인덱스 (헤더명으로 찾기)
    col = {
        'new_meter':     find_col(header, '부설전력량계번호'),
        'old_meter':     find_col(header, '철거전력량계번호'),
        'mfg_ym':        find_col(header, '제작년월'),
        'seal1':         find_col(header, '봉인번호1'),
        'seal2':         find_col(header, '봉인번호2'),
        'install_date':  find_col(header, '부설일자'),
        'remove_date':   find_col(header, '철거일자'),
        'install_read':  find_col(header, '부설지침'),
        'remove_read':   find_col(header, '철거지침'),
        'cntr_clas':     find_col(header, '계약종별'),
        'supply_type':   find_col(header, '공급방식'),
        'cust_no':       find_col(header, '계약번호'),
        'capacity':      find_col(header, '전력량계용량'),
    }

    records = []
    for row in rows[2:]:
        if row[0] is None:  # 순번 없으면 데이터 끝
            continue

        old_id = normalize_meter(row[col['old_meter']]) if col['old_meter'] is not None else None
        new_id = normalize_meter(row[col['new_meter']]) if col['new_meter'] is not None else None
        if not old_id or not new_id:
            continue

        # 봉인번호: 봉인번호1 우선, 없으면 봉인번호2
        seal = None
        if col['seal1'] is not None:
            seal = row[col['seal1']]
        if not seal and col['seal2'] is not None:
            seal = row[col['seal2']]
        seal = str(seal).strip() if seal else None

        # 부설일자 (replaced_at 기준)
        install_date = row[col['install_date']] if col['install_date'] is not None else None
        replaced_at = date_to_kst_ms(install_date)

        # 철거지침 (removal_values)
        remove_read = parse_reading(row[col['remove_read']]) if col['remove_read'] is not None else None

        # 제작년월
        mfg_ym = str(row[col['mfg_ym']]).strip() if col['mfg_ym'] is not None and row[col['mfg_ym']] else None

        # 계약종별 (엑셀에 있으면 우선)
        cntr_clas_excel = str(row[col['cntr_clas']]).strip() if col['cntr_clas'] is not None and row[col['cntr_clas']] else None

        records.append({
            'cha': cha,
            'old_meter_id': old_id,
            'new_meter_id': new_id,
            'seal_no': seal,
            'replaced_at': replaced_at,
            'removal_read': remove_read,
            'new_meter_mfg_ym': mfg_ym,
            'cntr_clas_excel': cntr_clas_excel,
        })

    print(f"  {cha}: {len(records)}건 파싱")
    return records


# ------------------------------------------------------------------
# 메인 빌드
# ------------------------------------------------------------------
def build():
    # site-data 로드 (계기번호 → 레코드 매핑)
    print("site-data 로드 중...")
    with open(SITE_DATA_PATH, encoding='utf-8') as f:
        guro = json.load(f)

    meter_map = {}  # 계기번호 → site record
    for item in guro:
        mid = item.get('계기번호', '')
        if mid:
            meter_map[mid] = item
    print(f"  site-data 계기 수: {len(meter_map)}")

    # 주소 → 전체 계기 수 매핑 (meter_state 결정용)
    addr_all_meters = {}  # 주소 → [계기번호 list]
    for item in guro:
        addr = item.get('주소', '')
        mid = item.get('계기번호', '')
        if addr and mid:
            addr_all_meters.setdefault(addr, []).append(mid)

    # 모든 차수 엑셀 파싱
    all_records = []
    print("\n엑셀 파싱 중...")
    for cha, fname in EXCEL_FILES:
        recs = parse_excel(cha, fname)
        all_records.extend(recs)
    print(f"총 파싱 레코드: {len(all_records)}")

    # 중복 철거번호 처리 (같은 철거번호가 여러 차수에 있으면 마지막 차수 우선)
    deduped = {}
    for r in all_records:
        deduped[r['old_meter_id']] = r
    print(f"중복 제거 후: {len(deduped)}")

    # site-data 매칭 및 workStatus 빌드
    print("\nworkStatus 빌드 중...")
    result = {}
    unmatched = []

    for old_id, rec in deduped.items():
        site = meter_map.get(old_id)
        if not site:
            unmatched.append({
                'old_meter_id': old_id,
                'new_meter_id': rec['new_meter_id'],
                'cha': rec['cha'],
            })
            continue

        addr = site['주소']
        단상삼상 = site.get('단상삼상', '단상')

        # removal_values 구성
        # 엑셀에는 검침값 1개(철거지침)만 있음
        # 단상/삼상 무관하게 whme_day 하나만 기록
        # 이유: 엑셀에 삼상 4개 필드가 없고, Firebase는 null 필드를 저장하지 않으므로
        #       null padding 해도 업로드 시 {whme_day: X}로 축소됨 — 처음부터 일치하게 작성
        # 불확실성: 삼상(4필드) 검침값이 엑셀에 없어 실제 값 미기록 — PM 판단 필요
        remove_read = rec['removal_read']
        removal_values = {
            'whme_day': remove_read,
        }

        # 계약종별: 엑셀 값 우선, 없으면 site-data
        cntr_clas = rec.get('cntr_clas_excel') or site.get('계약종별', '')
        계약전력 = site.get('계약전력', '')

        # 계기 레코드 구성 (종로 kepco_import 스키마 복제)
        meter_record = {
            'old_meter_id': rec['old_meter_id'],
            'new_meter_id': rec['new_meter_id'],
            'new_meter_mfg_ym': rec['new_meter_mfg_ym'],
            'seal_no': rec['seal_no'],
            'removal_value': remove_read,       # 단일값 요약 (종로 호환)
            'removal_values': removal_values,
            'replaced_at': rec['replaced_at'],
            'draft': False,                     # 완료 (map.js: draft=false → doneCount)
            'source': 'kepco_guro',
            'worker': 'KEPCO_IMPORT',
            'worker_name': f"한전 준공리스트({rec['cha']})",
            'cha': rec['cha'],
            '계약종별': cntr_clas,
            '계약전력': str(계약전력) if 계약전력 else '',
        }

        # 주소 그룹에 추가
        if addr not in result:
            result[addr] = {
                'meter_state': None,  # 나중에 결정
                'meter_updatedAt': datetime.now(KST).isoformat(),
                'meter_updatedBy': 'KEPCO_IMPORT',
                'meter_updatedByName': '한전 준공리스트',
                'replacement_list': {},
            }

        result[addr]['replacement_list'][old_id] = meter_record

    # meter_state 결정: 주소 내 전체 계기 중 완료 비율
    print("\nmeter_state 결정 중...")
    complete_count = 0
    hold_count = 0

    for addr, ws_rec in result.items():
        all_mids = set(addr_all_meters.get(addr, []))
        done_mids = set(ws_rec['replacement_list'].keys())
        total = len(all_mids)
        done = len(done_mids)

        if total > 0 and done >= total:
            # 전부 완료
            ws_rec['meter_state'] = 'complete'
            complete_count += 1
        else:
            # 일부만 완료 → hold (종로 규칙: 일부완료=hold 파란색)
            ws_rec['meter_state'] = 'hold'
            hold_count += 1

    # 통계
    total_meters = sum(len(v['replacement_list']) for v in result.values())
    print(f"\n========== 빌드 결과 ==========")
    print(f"완료 주소: {len(result)}")
    print(f"  complete: {complete_count}, hold: {hold_count}")
    print(f"완료 계기 수: {total_meters}")
    print(f"미매칭: {len(unmatched)}")

    if unmatched:
        print("\n미매칭 목록:")
        for u in unmatched:
            print(f"  {u['cha']} 철거={u['old_meter_id']} 신설={u['new_meter_id']}")

    # 출력
    output = {
        '_meta': {
            'built_at': datetime.now(KST).isoformat(),
            'source': '한전 준공리스트 (5/14/15/18차)',
            'total_addresses': len(result),
            'total_meters': total_meters,
            'complete_addresses': complete_count,
            'hold_addresses': hold_count,
            'unmatched_count': len(unmatched),
            'unmatched': unmatched,
        },
        'workStatus': result,
    }

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n출력: {OUTPUT_PATH}")
    return output


if __name__ == '__main__':
    build()
