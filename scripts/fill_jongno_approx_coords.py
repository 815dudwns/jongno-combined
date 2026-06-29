"""
종로 site-data approximate/none 좌표 보강 스크립트
- 카카오 주소검색(a) → 지번주소(b) → 키워드검색(c) 순서로 시도
- 카카오 실패 → 네이버 NCP Geocoding API
- 성공 시 lat/lng 갱신 + 좌표정확도 = 'exact'
- exact 건(15251개)은 절대 변경하지 않음
- 대상: 좌표정확도 == 'approximate'(68건) + 'none'(2건) = 70건
"""

import json
import os
import requests
import time

KAKAO_API_KEY = 'e46ada1811d067b4acf77d992a13b52e'

# ~/.env 에서 네이버 키 로드
def load_env(path=os.path.expanduser('~/.env')):
    result = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    result[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return result

env = load_env()
NAVER_ID     = env.get('NAVER_GEOCODE_ID', '')
NAVER_SECRET = env.get('NAVER_GEOCODE_SECRET', '')

TARGET_FILE = '/Users/woodelight/Projects/jongno-combined/data/jongno-site-data.json'

KAKAO_HEADERS = {'Authorization': f'KakaoAK {KAKAO_API_KEY}'}
NAVER_HEADERS = {
    'x-ncp-apigw-api-key-id': NAVER_ID,
    'x-ncp-apigw-api-key':    NAVER_SECRET,
}


def kakao_address(query):
    """카카오 주소검색 API → (lat, lng) 또는 None"""
    url = 'https://dapi.kakao.com/v2/local/search/address.json'
    try:
        r = requests.get(url, headers=KAKAO_HEADERS, params={'query': query}, timeout=10)
        if r.status_code == 200:
            docs = r.json().get('documents', [])
            if docs:
                return float(docs[0]['y']), float(docs[0]['x'])
    except Exception as e:
        print(f'    [kakao_address 오류] {e}')
    return None


def kakao_keyword(query):
    """카카오 키워드검색 API → (lat, lng) 또는 None"""
    url = 'https://dapi.kakao.com/v2/local/search/keyword.json'
    try:
        r = requests.get(url, headers=KAKAO_HEADERS, params={'query': query}, timeout=10)
        if r.status_code == 200:
            docs = r.json().get('documents', [])
            if docs:
                return float(docs[0]['y']), float(docs[0]['x'])
    except Exception as e:
        print(f'    [kakao_keyword 오류] {e}')
    return None


def naver_geocode(query):
    """네이버 NCP Geocoding API → (lat, lng) 또는 None"""
    url = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode'
    try:
        r = requests.get(url, headers=NAVER_HEADERS, params={'query': query}, timeout=10)
        if r.status_code == 200:
            addresses = r.json().get('addresses', [])
            if addresses:
                return float(addresses[0]['y']), float(addresses[0]['x'])
    except Exception as e:
        print(f'    [naver_geocode 오류] {e}')
    return None


def geocode(rec):
    """레코드에서 주소 추출 후 카카오 다단계 → 네이버 순으로 지오코딩
    반환: (lat, lng, method) 또는 None
    """
    road   = (rec.get('도로명주소') or '').strip()
    dong   = (rec.get('법정동') or '').strip()
    beonji = (rec.get('번지') or '').strip()
    addr   = (rec.get('주소') or '').strip()

    # 번지에서 "번지" 접미사 제거 (151번지 → 151)
    beonji_clean = beonji.replace('번지', '').strip()
    # 번지에서 하이픈 이후 제거 (123-45 → 123)
    beonji_parent = beonji_clean.split('-')[0] if '-' in beonji_clean else ''

    def try_jibun():
        """종로구 지번 주소로 다단계 시도"""
        gu = '종로구'
        if dong and beonji_clean:
            q = f'서울특별시 {gu} {dong} {beonji_clean}'
            result = kakao_address(q)
            if result:
                return result[0], result[1], 'kakao_jibun'
            time.sleep(0.12)
        if dong and beonji_parent:
            q2 = f'서울특별시 {gu} {dong} {beonji_parent}'
            result = kakao_address(q2)
            if result:
                return result[0], result[1], 'kakao_jibun_parent'
            time.sleep(0.12)
        if dong and beonji_clean:
            kw = f'{gu} {dong} {beonji_clean}'
            result = kakao_keyword(kw)
            if result:
                return result[0], result[1], 'kakao_keyword'
            time.sleep(0.12)
        if dong and beonji_parent:
            kw2 = f'{gu} {dong} {beonji_parent}'
            result = kakao_keyword(kw2)
            if result:
                return result[0], result[1], 'kakao_keyword_parent'
            time.sleep(0.12)
        return None

    # (a) 도로명주소로 주소검색
    if road:
        result = kakao_address(road)
        if result:
            return result[0], result[1], 'kakao_road'
        time.sleep(0.12)

    # (b) 주소 필드 전체로 주소검색
    if addr:
        result = kakao_address(addr)
        if result:
            return result[0], result[1], 'kakao_addr_field'
        time.sleep(0.12)

    # (c) 지번 다단계 시도
    r = try_jibun()
    if r:
        return r

    # (d) 네이버 NCP Geocoding — 도로명주소 우선, 그 다음 지번주소
    if road:
        result = naver_geocode(road)
        if result:
            return result[0], result[1], 'naver_road'
        time.sleep(0.12)
    if addr:
        result = naver_geocode(addr)
        if result:
            return result[0], result[1], 'naver_addr'
        time.sleep(0.12)
    if dong and beonji_clean:
        q = f'서울특별시 종로구 {dong} {beonji_clean}'
        result = naver_geocode(q)
        if result:
            return result[0], result[1], 'naver_jibun'
        time.sleep(0.12)

    return None


def run():
    with open(TARGET_FILE, encoding='utf-8') as f:
        data = json.load(f)

    total_before_exact = sum(1 for r in data if r.get('좌표정확도') == 'exact')
    target_indices = [i for i, r in enumerate(data)
                      if r.get('좌표정확도') in ('approximate', 'none')]
    print(f'전체 레코드: {len(data)}')
    print(f'exact (변경 금지): {total_before_exact}')
    print(f'보강 대상: {len(target_indices)}건 (approximate+none)')

    fixed        = 0
    failed       = []
    method_count = {}

    for idx in target_indices:
        rec = data[idx]
        addr_display = (rec.get('주소') or
                        rec.get('도로명주소') or
                        f'{rec.get("법정동")} {rec.get("번지")}')
        prev_acc = rec.get('좌표정확도')
        result = geocode(rec)
        if result:
            lat, lng, method = result
            data[idx]['lat'] = lat
            data[idx]['lng'] = lng
            data[idx]['좌표정확도'] = 'exact'
            fixed += 1
            method_count[method] = method_count.get(method, 0) + 1
            print(f'  [OK:{method}] ({prev_acc}) {addr_display} → {lat:.6f}, {lng:.6f}')
        else:
            failed.append((prev_acc, addr_display))
            print(f'  [FAIL] ({prev_acc}) {addr_display}')
        time.sleep(0.12)

    # 검증: exact 건수가 줄지 않았는지 확인
    total_after_exact = sum(1 for r in data if r.get('좌표정확도') == 'exact')
    expected_exact = total_before_exact + fixed
    assert total_after_exact == expected_exact, \
        f'exact 건수 불일치! before={total_before_exact}, fixed={fixed}, after={total_after_exact}'

    print(f'\n=== 결과 ===')
    print(f'보강 성공: {fixed} / 실패: {len(failed)}')
    print(f'exact 건수: {total_before_exact} → {total_after_exact}')
    for m, c in sorted(method_count.items()):
        print(f'  {m}: {c}건')
    if failed:
        print(f'\n실패 목록:')
        for acc, a in failed:
            print(f'  [{acc}] {a}')

    with open(TARGET_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f'\n저장 완료: {TARGET_FILE}')

    return fixed, len(failed), failed


if __name__ == '__main__':
    run()
