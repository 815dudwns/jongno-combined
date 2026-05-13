"""
카카오 API로 지번 주소를 도로명 주소로 변환

사용 방법:
1. 이 파일과 전기차_마용.xlsx를 같은 폴더에 넣기
2. Python 실행: python 주소변환.py
3. 완료되면 전기차_마용_도로명.xlsx 생성됨
"""

import pandas as pd
import requests
import time

# ========== 설정 ==========
API_KEY = 'e46ada1811d067b4acf77d992a13b52e'  # 영준님 API 키
EXCEL_FILE = '전기차_마용.xlsx'  # 입력 파일
OUTPUT_FILE = '전기차_마용_도로명.xlsx'  # 출력 파일
# ==========================

def get_road_address(jibun_address):
    """지번 주소를 도로명 주소로 변환"""
    url = 'https://dapi.kakao.com/v2/local/search/address.json'
    headers = {'Authorization': f'KakaoAK {API_KEY}'}
    params = {'query': jibun_address}
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            
            if result.get('documents'):
                doc = result['documents'][0]
                
                # 1순위: 도로명 주소
                if doc.get('road_address') and doc['road_address'].get('address_name'):
                    return doc['road_address']['address_name']
                
                # 2순위: 지번 주소 (정제된 버전)
                if doc.get('address') and doc['address'].get('address_name'):
                    return doc['address']['address_name']
        
        # 변환 실패 시 원본 반환
        return jibun_address
        
    except Exception as e:
        print(f"    ⚠️ 오류: {e}")
        return jibun_address

def main():
    print("=" * 60)
    print("📍 지번 → 도로명 주소 변환기")
    print("=" * 60)
    print()
    
    # 엑셀 파일 읽기
    try:
        df = pd.read_excel(EXCEL_FILE, sheet_name='시트1')
        print(f"✅ 파일 로드 완료: {len(df)}개 주소")
    except FileNotFoundError:
        print(f"❌ 오류: '{EXCEL_FILE}' 파일을 찾을 수 없습니다.")
        print(f"   이 파일과 엑셀 파일을 같은 폴더에 넣어주세요.")
        return
    
    # 계기번호 0 채우기
    if '계기번호' in df.columns:
        df['계기번호'] = df['계기번호'].astype(str).str.zfill(11)
    
    # 도로명주소 컬럼 추가
    df['도로명주소'] = ''
    
    print(f"\n🔄 변환 시작...\n")
    
    success_count = 0
    fail_count = 0
    
    # 전체 변환
    for idx, row in df.iterrows():
        jibun = row['고객주소']
        
        print(f"[{idx+1}/{len(df)}] 변환 중...")
        print(f"  지번: {jibun}")
        
        road = get_road_address(jibun)
        df.at[idx, '도로명주소'] = road
        
        # 변환 성공 여부 체크
        if road != jibun and '도' in road:  # 도로명에는 보통 '로', '길' 포함
            print(f"  ✅ 도로명: {road}")
            success_count += 1
        else:
            print(f"  ⚠️ 도로명: {road} (변환 실패 또는 도로명 없음)")
            fail_count += 1
        
        print()
        
        # API 제한 방지 (0.1초 대기)
        time.sleep(0.1)
    
    # 결과 저장
    df.to_excel(OUTPUT_FILE, index=False, sheet_name='시트1')
    
    print("=" * 60)
    print("✅ 변환 완료!")
    print("=" * 60)
    print(f"총 {len(df)}개 주소")
    print(f"  성공: {success_count}개")
    print(f"  실패: {fail_count}개")
    print(f"\n📁 저장 파일: {OUTPUT_FILE}")
    print()
    
    # 샘플 출력
    print("📋 변환 샘플 (처음 5개):")
    print("-" * 60)
    sample = df[['고객주소', '도로명주소']].head()
    for idx, row in sample.iterrows():
        print(f"{idx+1}. {row['고객주소']}")
        print(f"   → {row['도로명주소']}")
        print()

if __name__ == '__main__':
    main()
    input("\n완료! 엔터 키를 누르면 종료됩니다...")
