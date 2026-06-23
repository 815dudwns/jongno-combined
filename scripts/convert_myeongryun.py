"""
명륜동 엑셀 → 종로 site-data 형식 변환 + 카카오 좌표추출
출력: data/myeongryun-converted.json  (합치기·업로드 안 함)
"""
import openpyxl, json, re, requests, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed

API_KEY = 'e46ada1811d067b4acf77d992a13b52e'
EXCEL = '/Users/woodelight/Downloads/명륜동.xlsx'
OUT = '/Users/woodelight/Projects/jongno-combined/data/myeongryun-converted.json'
WORKERS = 10
DONG_CENTER = (37.5859, 126.9986)  # 명륜동(성균관대 일대) 대략 중심 폴백

# 컬럼 인덱스 (헤더 row=2 기준, 새 2576 파일 기준)
# 새 파일은 idx6에 "지번/도로명" 병합열이 추가되어 기존 대비 1칸씩 당겨짐
# idx: 0순번 1순위 2고객번호 3고객명 4지번주소 5도로명주소 6지번/도로명병합 7공동주택명
#      8상호 9공동주택명/상호 10검침일 11전화번호 12휴대폰번호 13전화번호/휴대폰병합
#      14계약종별 15계약전력 16공급방식(숫자) 17공급방식(텍스트) 18계기번호
#      24계기위치 29변대주전산화번호 30변대주번호 31인입주전산화번호 32인입주번호
#      33인입선상태 34검침방법 36검침원 37검침원연락처
C_RANK=1; C_CUST=2; C_NAME=3; C_JIBUN=4; C_APT=7; C_SANGHO=8
C_DAY=10; C_PHONE=13; C_GYEYAK=14; C_POWER=15; C_SUPPLY=16
C_METER=18; C_LOC=24; C_BDJ_NUM=29; C_BDJ_LBL=30; C_INIB_NUM=31
C_INIB_LBL=32; C_INSEON=33; C_GMETHOD=34; C_GWON=36; C_GWON_TEL=37

def parse_type(meter_no):
    code = str(meter_no)[2:4]
    if code == '17': return 'E'
    if code == '19': return 'EA'
    if code in ('25','26','27','45','46','47'): return 'G'
    if code in ('53','55'): return 'Amigo'
    return ''

def phase(meter_no, mtype):
    code = str(meter_no)[2:4]
    if mtype in ('E','EA'): return '단상'
    if code in ('25','26','27'): return '단상'
    if code in ('45','46','47'): return '삼상'
    if code == '53': return '단상'
    if code == '55': return '삼상'
    return ''

def fix_meter(val):
    if val is None: return ''.zfill(11)
    s = re.sub(r'[가-힣\s]','',str(val))
    try: return str(int(float(s))).zfill(11)
    except (ValueError,TypeError): return s.zfill(11)

def clean_jibun(addr):
    if not addr: return ''
    a = re.sub(r'\s+',' ',str(addr)).strip()
    a = re.sub(r'(\d+)번지','\\1',a)  # "2번지"->"2"
    return a

def beonji(jibun):
    # 마지막 "동/가 " 뒤 번지 부분
    m = re.search(r'(\d+(?:-\d+)?)\s*$', jibun)
    return m.group(1) if m else ''

def beopjeong(jibun):
    m = re.search(r'(명륜\d가)', jibun)
    return m.group(1) if m else ''

def day_group(day):
    if day in (1,2,3,4,5): return 'G1'
    if day in (8,9,10,11,12): return 'G2'
    if day in (15,16,17,18,19): return 'G3'
    if day in (22,23,24,25,26): return 'G4'
    return ''

def zero_blank(v):
    s = str(v).strip() if v is not None else ''
    return '' if s in ('0','') else s

_session = requests.Session()
_session.headers.update({'Authorization': f'KakaoAK {API_KEY}'})

def search_address(query):
    if not query: return None
    for attempt in range(4):
        try:
            r = _session.get('https://dapi.kakao.com/v2/local/search/address.json',
                             params={'query': query}, timeout=15)
            if r.status_code == 429:
                time.sleep(0.5*(attempt+1)); continue
            if r.status_code == 200:
                docs = r.json().get('documents', [])
                if docs:
                    d = docs[0]
                    road = (d.get('road_address') or {}).get('address_name','')
                    return (road or query, float(d['y']), float(d['x']))
                return None
            time.sleep(0.3)
        except Exception:
            time.sleep(0.3)
    return None

def search_keyword(query):
    if not query: return None
    try:
        r = _session.get('https://dapi.kakao.com/v2/local/search/keyword.json',
                         params={'query': query,'size':1}, timeout=15)
        if r.status_code == 200:
            docs = r.json().get('documents', [])
            if docs:
                d = docs[0]
                return (d.get('road_address_name') or d.get('address_name') or query,
                        float(d['y']), float(d['x']))
    except Exception:
        pass
    return None

def resolve(jibun):
    """반환: (도로명, lat, lng, 정확도)"""
    found = search_address(jibun)
    if found: return found[0], found[1], found[2], 'exact'
    found = search_keyword(jibun)
    if found: return found[0], found[1], found[2], 'exact'
    # 동 폴백
    dong = beopjeong(jibun) or '명륜동'
    found = search_address('서울특별시 종로구 '+dong) or search_keyword('서울 종로구 '+dong)
    if found: return found[0], found[1], found[2], 'approximate'
    # 최후: 하드코딩 동 중심
    return '', DONG_CENTER[0], DONG_CENTER[1], 'approximate'

def main():
    wb = openpyxl.load_workbook(EXCEL, read_only=True, data_only=True)
    ws = wb['저압']
    rows = [r for r in ws.iter_rows(min_row=3, values_only=True) if r[C_CUST] is not None]
    print(f'유효행: {len(rows)}', flush=True)

    # 지번 정리해서 그룹핑(좌표 캐시)
    cleaned = [clean_jibun(r[C_JIBUN]) for r in rows]
    uniq = sorted(set(cleaned))
    print(f'고유 지번: {len(uniq)}', flush=True)

    coord = {}
    cnt = {'done':0,'exact':0,'approx':0}
    lock = threading.Lock()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(resolve, j): j for j in uniq}
        for fut in as_completed(futs):
            j = futs[fut]
            road, lat, lng, acc = fut.result()
            coord[j] = (road, lat, lng, acc)
            with lock:
                cnt['done']+=1
                if acc=='exact': cnt['exact']+=1
                else: cnt['approx']+=1
                if cnt['done']%100==0 or cnt['done']==len(uniq):
                    print(f"[{cnt['done']}/{len(uniq)}] exact={cnt['exact']} approx={cnt['approx']}", flush=True)

    out = []
    for r, jb in zip(rows, cleaned):
        meter = fix_meter(r[C_METER])
        mtype = parse_type(meter)
        road, lat, lng, acc = coord[jb]
        day = r[C_DAY]
        try: day_i = int(day)
        except (ValueError,TypeError): day_i = day
        rank = r[C_RANK] if r[C_RANK] else ''
        try: power = int(r[C_POWER]) if r[C_POWER] is not None else 0
        except (ValueError,TypeError): power = 0
        try: supply = int(r[C_SUPPLY]) if r[C_SUPPLY] is not None else 0
        except (ValueError,TypeError): supply = 0
        out.append({
            '주소': jb,
            '도로명주소': road,
            '계기번호': meter,
            '계기타입': mtype,
            '변대주': zero_blank(r[C_BDJ_NUM]),
            '변대주라벨': zero_blank(r[C_BDJ_LBL]),
            '상호': zero_blank(r[C_SANGHO]),
            'lat': lat,
            'lng': lng,
            '좌표정확도': acc,
            '고객번호': str(r[C_CUST]).strip(),
            'DCUID': '',
            '법정동': beopjeong(jb),
            '번지': beonji(jb),
            '동그룹': '명륜',
            '검침일': day_i,
            '검침일그룹': day_group(day_i if isinstance(day_i,int) else -1),
            '순위': rank,
            '단상삼상': phase(meter, mtype),
            '공급방식': supply,
            '계약전력': power,
            '공동주택명': zero_blank(r[C_APT]),
            'new_meter_no': None,
            '자동완료': False,
            '고객명': str(r[C_NAME] or '').strip(),
            '휴대폰': str(r[C_PHONE] or '').strip(),
            '계기위치': str(r[C_LOC] or '').strip(),
            '인입주전산화': zero_blank(r[C_INIB_NUM]),
            '인입주번호': zero_blank(r[C_INIB_LBL]),
            '검침방법': str(r[C_GMETHOD] or '').strip(),
            '검침원': str(r[C_GWON] or '').strip(),
            '검침원연락처': str(r[C_GWON_TEL] or '').strip(),
            '계약종별': str(r[C_GYEYAK] or '').strip(),
            '인입선상태': str(r[C_INSEON] or '').strip(),
        })

    with open(OUT,'w',encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # 보고용 통계
    from collections import Counter
    tdist = Counter(o['계기타입'] for o in out)
    adist = Counter(o['좌표정확도'] for o in out)
    failhc = sum(1 for o in out if o['lat']==DONG_CENTER[0] and o['lng']==DONG_CENTER[1])
    custs = [o['고객번호'] for o in out]
    dup = [k for k,v in Counter(custs).items() if v>1]
    print('=== 완료 ===', flush=True)
    print('총:', len(out), flush=True)
    print('계기타입:', dict(tdist), flush=True)
    print('좌표정확도:', dict(adist), flush=True)
    print('하드코딩폴백(완전실패):', failhc, flush=True)
    print('고객번호 중복:', len(dup), dup[:10], flush=True)

if __name__ == '__main__':
    main()
