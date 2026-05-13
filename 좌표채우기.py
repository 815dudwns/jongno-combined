"""
site-data.json에서 lat/lng가 null인 항목에 카카오 geocoding API로 좌표 채우기

사용 방법:
    python3 좌표채우기.py
"""

import json
import requests
import time

# ========== 설정 ==========
API_KEY   = 'e46ada1811d067b4acf77d992a13b52e'
DATA_FILE = '/Users/woodelight/Library/Mobile Documents/iCloud~md~obsidian/Documents/working/ami-work/data/site-data.json'
# ==========================


def search_address(query):
    """카카오 주소 검색 API → (도로명주소, lat, lng) 또는 None"""
    url = 'https://dapi.kakao.com/v2/local/search/address.json'
    headers = {'Authorization': f'KakaoAK {API_KEY}'}
    try:
        r = requests.get(url, headers=headers, params={'query': query}, timeout=10)
        if r.status_code == 200:
            docs = r.json().get('documents', [])
            if docs:
                doc = docs[0]
                lat = float(doc['y'])
                lng = float(doc['x'])
                road = (doc.get('road_address') or {}).get('address_name', '')
                jibun = (doc.get('address') or {}).get('address_name', '')
                road_name = road or jibun or query
                return road_name, lat, lng
    except Exception as e:
        print(f"  API 오류: {e}")
    return None


def main():
    print("=" * 60)
    print("좌표 채우기 시작 (카카오 geocoding API)")
    print("=" * 60)

    # JSON 읽기
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 좌표 없는 항목 추출
    null_items_idx = [
        i for i, item in enumerate(data)
        if item.get('lat') is None or item.get('lng') is None
    ]
    total = len(null_items_idx)
    print(f"전체 항목: {len(data)}개")
    print(f"좌표 없는 항목: {total}개\n")

    exact_cnt = 0
    approx_cnt = 0
    fail_cnt = 0
    fail_list = []

    for seq, idx in enumerate(null_items_idx, 1):
        item = data[idx]
        addr = str(item.get('주소') or '').strip()
        road_addr = str(item.get('도로명주소') or '').strip()

        found = None
        accuracy = None

        # 1차: 주소(지번) 검색
        if addr:
            found = search_address(addr)
            if found:
                accuracy = 'exact'

        # 2차: 도로명주소로 재시도
        if not found and road_addr:
            found = search_address(road_addr)
            if found:
                accuracy = 'exact'

        # 3차: 동 단위로 폴백
        if not found and addr:
            # 예: "서울특별시 종로구 구기동 160-3" → "서울특별시 종로구 구기동"
            parts = addr.split()
            # 동/읍/면으로 끝나는 부분까지 잘라냄
            dong_query = None
            for j, part in enumerate(parts):
                if part.endswith(('동', '읍', '면')):
                    dong_query = ' '.join(parts[:j+1])
                    break
            if dong_query:
                found = search_address(dong_query)
                if found:
                    accuracy = 'approximate'

        if found:
            resolved_road, lat, lng = found
            data[idx]['lat'] = lat
            data[idx]['lng'] = lng
            data[idx]['도로명주소'] = resolved_road if resolved_road else data[idx].get('도로명주소', '')
            data[idx]['좌표정확도'] = accuracy

            flag = 'O' if accuracy == 'exact' else '~'
            print(f"[{seq}/{total}] {flag} {addr} → {lat:.6f}, {lng:.6f}")

            if accuracy == 'exact':
                exact_cnt += 1
            else:
                approx_cnt += 1
        else:
            print(f"[{seq}/{total}] X 실패: {addr}")
            fail_cnt += 1
            fail_list.append(addr)

        # API 호출 간격 (rate limit 방지)
        time.sleep(0.15)

    # 결과 저장
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 60)
    print("완료!")
    print(f"  정확 (exact)      : {exact_cnt}개")
    print(f"  근사 (approximate): {approx_cnt}개")
    print(f"  실패              : {fail_cnt}개")
    print(f"저장: {DATA_FILE}")

    if fail_list:
        print("\n실패한 주소 목록:")
        for addr in fail_list:
            print(f"  - {addr}")

    print("=" * 60)


if __name__ == '__main__':
    main()
