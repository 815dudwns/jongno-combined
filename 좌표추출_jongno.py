"""
종로 합동시공 site-data JSON 생성
종로 실효리스트.xlsx → jongno-site-data.json

좌표추출_v2.py의 search_address, search_keyword, resolve, fix_meter_no,
trim_addr, extract_dong 함수를 직접 import해서 활용.
"""

import sys
import os
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import openpyxl

# 좌표추출_v2.py import 경로 추가
sys.path.insert(0, '/Users/woodelight/Projects/jongno-combined')

from 좌표추출_v2 import (
    search_address, search_keyword, fix_meter_no, trim_addr, extract_dong
)

# ───── 설정 ─────────────────────────────────────────────────────────────────
EXCEL_FILE   = '/Users/woodelight/Library/Mobile Documents/com~apple~CloudDocs/종로 실효리스트.xlsx'
OVERLAP_JSON = '/Users/woodelight/Projects/ami-work/research/jongno_overlap.json'
OUTPUT_JSON  = '/Users/woodelight/Projects/jongno-combined/data/jongno-site-data.json'
WORKERS      = 10
LOG_INTERVAL = 200

# ───── 동그룹 매핑 ────────────────────────────────────────────────────────────
DONG_GROUP = {
    '북촌·삼청':     ['가회동','삼청동','화동','안국동','소격동','팔판동','사간동','재동','계동','원서동','송현동'],
    '부암·평창':     ['부암동','신영동','홍지동','평창동','구기동'],
    '청운효자·사직': ['청운동','효자동','창성동','통의동','적선동','통인동','누상동','누하동','옥인동','신교동','궁정동','사직동','도렴동','당주동','내수동','내자동','신문로1가','신문로2가','필운동','체부동','세종로'],
    '무악·교남':     ['무악동','교남동','교북동','행촌동','평동','송월동','홍파동'],
    '종로 도심':     ['종로1가','종로2가','종로3가','종로4가','종로5가','종로6가','청진동','견지동','서린동','수송동','중학동','관철동','관수동','익선동','돈의동','봉익동','묘동','권농동','와룡동','인사동','관훈동','경운동','낙원동','운니동','공평동','인의동','예지동','장사동','훈정동'],
    '혜화·이화':     ['혜화동','이화동','동숭동','연건동','충신동','원남동','효제동','연지동'],
    '창신':          ['창신동'],
    '숭인':          ['숭인동'],
}
_DONG_TO_GROUP = {d: g for g, ds in DONG_GROUP.items() for d in ds}


# ───── 검침일 그룹 ─────────────────────────────────────────────────────────────
def day_group(day):
    try:
        d = int(str(day).strip())
    except (ValueError, TypeError):
        return None
    if d in [1, 2, 3, 4, 5]:        return 'G1'   # 1주차
    if d in [8, 9, 10, 11, 12]:     return 'G2'   # 2주차
    if d in [15, 16, 17, 18, 19]:   return 'G3'   # 3주차
    if d in [22, 23, 24, 25, 26]:   return 'G4'   # 4주차
    return None


# ───── 계기타입 파싱 ───────────────────────────────────────────────────────────
def parse_type(meter_no):
    try:
        code = str(int(float(str(meter_no)))).zfill(11)[2:4]
    except (ValueError, TypeError):
        return '알수없음'
    if code == '17':                    return 'E'
    if code == '19':                    return 'EA'
    if code in ('25', '26', '27', '45', '46', '47'): return 'G'
    if code in ('53', '55'):            return 'Amigo'
    return '알수없음'


# ───── 단상/삼상 ───────────────────────────────────────────────────────────────
_DANGSANG_CODES = {'17', '19', '25', '26', '27', '53'}
_SAMSANG_CODES  = {'45', '46', '47', '55'}

def phase_from_meter(meter_no):
    """계기번호 3~4자리(index 2:4)로 단상/삼상 결정. 매핑 외는 공급방식 폴백."""
    try:
        code = str(int(float(str(meter_no)))).zfill(11)[2:4]
    except (ValueError, TypeError):
        return None
    if code in _DANGSANG_CODES: return '단상'
    if code in _SAMSANG_CODES:  return '삼상'
    return None  # 매핑 외 코드는 None

def phase_from_supply(supply_code):
    """공급방식 코드로 단상/삼상 폴백 결정."""
    try:
        c = int(str(supply_code).strip())
    except (ValueError, TypeError):
        return None
    if c == 322: return '단상'
    if c == 738: return '삼상'
    return None


# ───── 지번주소1에서 번지 추출 ─────────────────────────────────────────────────
def extract_beonji_from_jibun1(jibun1_str):
    """'가회동 31-11 ...' 형태에서 번지 추출 — 동명 다음 번지(숫자-숫자 or 숫자) 파싱"""
    s = str(jibun1_str or '').strip()
    m = re.search(r'[동읍면로]\s+(\d+(?:-\d+)?)', s)
    if m:
        return m.group(1)
    # 동명 없을 때: 첫 번째 숫자 패턴
    m2 = re.search(r'\b(\d+(?:-\d+)?)\b', s)
    if m2:
        return m2.group(1)
    return ''


# ───── resolve 함수 (jibun/road 키 방식으로 재정의) ──────────────────────────
import requests as _requests
import time as _time

_API_KEY = 'e46ada1811d067b4acf77d992a13b52e'
_session = _requests.Session()
_session.headers.update({'Authorization': f'KakaoAK {_API_KEY}'})

def resolve_jongno(key, jibun_str, road_str):
    """
    jibun_str: 지번주소 (e.g. '서울 종로구 가회동 31-11')
    road_str:  도로명주소 (e.g. '서울 종로구 북촌로11가길 8-2')
    """
    jibun_t = trim_addr(jibun_str)
    road_t  = trim_addr(road_str)

    found    = None
    accuracy = None

    # 1) 도로명 정확
    if road_t:
        found = search_address(road_t)
        if found: accuracy = 'exact'
    # 2) 지번 정확
    if not found and jibun_t:
        found = search_address(jibun_t)
        if found: accuracy = 'exact'
    # 3) 키워드(장소) — 도로명
    if not found and road_t:
        found = search_keyword(road_t)
        if found: accuracy = 'exact'
    # 4) 키워드 — 지번
    if not found and jibun_t:
        found = search_keyword(jibun_t)
        if found: accuracy = 'exact'
    # 5) 동 폴백
    if not found:
        dong = extract_dong(jibun_t) or extract_dong(road_t)
        if dong:
            found = search_address(dong) or search_keyword(dong)
            if found: accuracy = 'approximate'

    if found:
        return key, accuracy, found[0], found[1], found[2]
    return key, 'fail', road_t or jibun_t, None, None


# ───── 메인 ─────────────────────────────────────────────────────────────────
def main():
    print(f"시작 (워커 {WORKERS}개)", flush=True)

    # 1) 자동완료 키 세트 로드
    with open(OVERLAP_JSON, encoding='utf-8') as f:
        overlap = json.load(f)
    auto_keys = {x['key'] for x in overlap.get('green', []) + overlap.get('yellow', [])}
    print(f"자동완료 키: {len(auto_keys):,}개", flush=True)

    # 2) 엑셀 로드
    print(f"엑셀 로드 중...", flush=True)
    wb = openpyxl.load_workbook(EXCEL_FILE, read_only=True, data_only=True)
    ws = wb['저압']

    rows_raw = []
    skip_empty = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        meter = row[25]   # 컬럼 26
        if not meter:
            skip_empty += 1
            continue
        rows_raw.append(row)

    print(f"계기번호 없는 행 건너뜀: {skip_empty:,}", flush=True)
    print(f"실 데이터: {len(rows_raw):,}행", flush=True)

    # 3) 데이터 파싱 + 그룹핑
    parsed = []
    for row in rows_raw:
        순위       = str(row[1]).strip() if row[1] else ''
        고객번호   = str(row[2]).strip() if row[2] else ''
        지번주소1  = str(row[4] or '').strip()
        법정동     = str(row[5] or '').strip()
        번지       = str(row[6] or '').strip()
        도로명주소 = str(row[12] or '').strip()
        공동주택명 = str(row[14] or '').strip()
        공동주택명 = '' if 공동주택명 == '0' else 공동주택명
        상호       = str(row[15] or '').strip()
        상호       = '' if 상호 == '0' else 상호
        검침일_raw = row[17]
        계약전력   = row[22]
        공급방식   = row[23]
        계기번호_raw = row[25]

        # 계기번호 정규화
        계기번호 = fix_meter_no(계기번호_raw)

        # 번지: 컬럼7 없으면 지번주소1에서 추출
        if not 번지:
            번지 = extract_beonji_from_jibun1(지번주소1)

        # 검침일: 정수 변환
        try:
            검침일 = int(str(검침일_raw).strip())
        except (ValueError, TypeError):
            검침일 = None

        # 동그룹
        동그룹 = _DONG_TO_GROUP.get(법정동, None)

        # 검침일그룹
        검침일그룹 = day_group(검침일)

        # 계기타입
        계기타입 = parse_type(계기번호)

        # 단상/삼상: 계기번호 우선, 폴백은 공급방식
        단상삼상 = phase_from_meter(계기번호)
        if 단상삼상 is None:
            단상삼상 = phase_from_supply(공급방식)

        # 공급방식 정수 변환
        try:
            공급방식_int = int(str(공급방식).strip())
        except (ValueError, TypeError):
            공급방식_int = None

        # 계약전력 정수 변환
        try:
            계약전력_int = int(str(계약전력).strip())
        except (ValueError, TypeError):
            계약전력_int = None

        # 자동완료 여부
        overlap_key = f"{법정동} {번지}"
        자동완료 = overlap_key in auto_keys

        # 지번 조합 주소 (좌표 검색용)
        jibun_full = f"서울 종로구 {법정동} {번지}".strip() if 법정동 else ''
        road_full  = f"서울 종로구 {도로명주소}".strip() if 도로명주소 else ''

        parsed.append({
            '법정동': 법정동,
            '번지': 번지,
            '도로명주소_원본': 도로명주소,
            'jibun_full': jibun_full,
            'road_full': road_full,
            '순위': 순위 if 순위 else None,
            '고객번호': 고객번호,
            '공동주택명': 공동주택명,
            '상호': 상호,
            '검침일': 검침일,
            '검침일그룹': 검침일그룹,
            '동그룹': 동그룹,
            '계기번호': 계기번호,
            '계기타입': 계기타입,
            '단상삼상': 단상삼상,
            '공급방식': 공급방식_int,
            '계약전력': 계약전력_int,
            '자동완료': 자동완료,
            'jibun_key': f"{jibun_full}|{road_full}",
        })

    # 4) 고유 (jibun_full, road_full) 키로 그룹핑 → 좌표 1번만 호출
    grouped = {}
    for d in parsed:
        k = d['jibun_key']
        grouped.setdefault(k, []).append(d)

    total_groups = len(grouped)
    print(f"고유 주소 그룹: {total_groups:,}", flush=True)

    # 5) 병렬 좌표 추출
    resolved = {}
    counter = {'done': 0, 'exact': 0, 'approx': 0, 'fail': 0}
    lock = threading.Lock()

    def worker_resolve(key, items):
        return resolve_jongno(key, items[0]['jibun_full'], items[0]['road_full'])

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {ex.submit(worker_resolve, k, v): k for k, v in grouped.items()}
        for fut in as_completed(futures):
            key, accuracy, road_result, lat, lng = fut.result()
            resolved[key] = (accuracy, road_result, lat, lng)
            with lock:
                counter['done'] += 1
                if accuracy == 'exact':       counter['exact'] += 1
                elif accuracy == 'approximate': counter['approx'] += 1
                else:                           counter['fail'] += 1
                if counter['done'] % LOG_INTERVAL == 0 or counter['done'] == total_groups:
                    print(
                        f"[{counter['done']:,}/{total_groups:,}] "
                        f"exact={counter['exact']:,} approx={counter['approx']:,} fail={counter['fail']:,}",
                        flush=True
                    )

    # 6) 최종 JSON 조립
    result = []
    for key, items in grouped.items():
        accuracy, road_resolved, lat, lng = resolved[key]
        for d in items:
            # 도로명주소: API 결과 우선, 없으면 원본
            final_road = road_resolved if road_resolved else d['도로명주소_원본']
            # 주소 (지번 형식)
            jibun_addr = f"서울특별시 종로구 {d['법정동']} {d['번지']}".strip() if d['법정동'] else ''

            record = {
                '주소': jibun_addr,
                '도로명주소': final_road,
                '계기번호': d['계기번호'],
                '계기타입': d['계기타입'],
                '변대주': '',
                '상호': d['상호'],
                'lat': lat,
                'lng': lng,
                '좌표정확도': accuracy,
                '고객번호': d['고객번호'],
                'DCUID': '',
                '법정동': d['법정동'],
                '번지': d['번지'],
                '동그룹': d['동그룹'],
                '검침일': d['검침일'],
                '검침일그룹': d['검침일그룹'],
                '순위': d['순위'],
                '단상삼상': d['단상삼상'],
                '공급방식': d['공급방식'],
                '계약전력': d['계약전력'],
                '공동주택명': d['공동주택명'],
                'new_meter_no': None,
                '자동완료': d['자동완료'],
            }
            result.append(record)

    # 7) 저장
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 8) 검증 통계 출력
    auto_count   = sum(1 for r in result if r['자동완료'])
    dong_dist    = {}
    for r in result:
        g = r['동그룹'] or '미분류'
        dong_dist[g] = dong_dist.get(g, 0) + 1
    day_dist = {}
    for r in result:
        g = r['검침일그룹'] or 'None'
        day_dist[g] = day_dist.get(g, 0) + 1
    acc_dist = {}
    for r in result:
        a = r['좌표정확도'] or 'fail'
        acc_dist[a] = acc_dist.get(a, 0) + 1

    print(f"\n=== 완료 ===", flush=True)
    print(f"입력 행: {len(rows_raw):,}", flush=True)
    print(f"출력 레코드: {len(result):,}", flush=True)
    print(f"자동완료: {auto_count:,}", flush=True)
    print(f"좌표 그룹: {total_groups:,} (exact={counter['exact']:,} approx={counter['approx']:,} fail={counter['fail']:,})", flush=True)
    print(f"\n동그룹 분포:", flush=True)
    for g, cnt in sorted(dong_dist.items(), key=lambda x: -x[1]):
        print(f"  {g}: {cnt:,}", flush=True)
    print(f"\n검침일그룹 분포:", flush=True)
    for g, cnt in sorted(day_dist.items()):
        print(f"  {g}: {cnt:,}", flush=True)
    print(f"\n좌표정확도 분포:", flush=True)
    for a, cnt in sorted(acc_dist.items(), key=lambda x: -x[1]):
        print(f"  {a}: {cnt:,}", flush=True)
    print(f"\n저장: {OUTPUT_JSON}", flush=True)


if __name__ == '__main__':
    main()
