#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""명륜동 2576건 종로/중구 배분 재계산.
규칙(영준님 최신):
 1. 삼상 종로:중구 = 64:101 (매출형평) 최대한 정확히
 2. 명륜4가 삼상55: 통째 금지, 종로/중구 균등 지향 + 4가내 좌표응집(섬없게)
 3. awms 인근(반경 R) 종로 제외 -> 중구
 4. D10 종로몫 = 북쪽(lat 큰)
 5. D16 3가 종로=남(lat작), D22 3가 종로=북(lat큰); 비3가 삼상 균등
 6. D4 종로 통째
 7. D16/D22 종로:중구 비율 완화
 8. 종로 총 ~1000(+-100)
하드: 같은 주소=같은 팀, awms163 전부 중구.
방법: 주소단위 그룹핑 + 대표좌표, 축정렬 half-plane 컷.
"""
import json,math
from collections import defaultdict,Counter

CONV='/Users/woodelight/Projects/jongno-combined/data/myeongryun-converted.json'
AWMS='/Users/woodelight/Projects/ami-work/data/cha10-jongno-20260623-171628.json'
OUT='/Users/woodelight/Projects/jongno-combined/data/myeongryun-team-assign.json'

d=json.load(open(CONV))
awms_whm=set(str(a['WHM_NO']) for a in json.load(open(AWMS)))

def ph(r): return '삼상' if r.get('단상삼상')=='삼상' else '단상'

# ---- 주소단위 그룹 ----
groups=defaultdict(list)
for r in d: groups[r['주소']].append(r)

def haversine(la1,lo1,la2,lo2):
    R=6371000
    p1,p2=math.radians(la1),math.radians(la2)
    dp=math.radians(la2-la1); dl=math.radians(lo2-lo1)
    a=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

# awms coords
awms_coords=[(r['lat'],r['lng']) for r in d if r['계기번호'] in awms_whm]

G=[]  # group records
for a,rs in groups.items():
    lat=sum(r['lat'] for r in rs)/len(rs)
    lng=sum(r['lng'] for r in rs)/len(rs)
    md=Counter(r['검침일'] for r in rs).most_common(1)[0][0]   # 대표 검침일=다수결
    dong=rs[0]['법정동']
    n_sam=sum(1 for r in rs if ph(r)=='삼상')
    has_awms=any(r['계기번호'] in awms_whm for r in rs)
    G.append(dict(addr=a,lat=lat,lng=lng,md=md,dong=dong,rs=rs,
                  n=len(rs),n_sam=n_sam,has_awms=has_awms,team=None))

# ---- radius lock (R 튜닝) ----
def apply_radius(R):
    for g in G:
        if g['team']: continue
        for (la,lo) in awms_coords:
            if haversine(g['lat'],g['lng'],la,lo)<=R:
                g['team']='중구'; g['locked_radius']=True
                break

# ---- 평가 함수 ----
def evaluate():
    sam_t=Counter(); tot=Counter()
    for g in G:
        for r in g['rs']:
            tot[g['team']]+=1
            if ph(r)=='삼상': sam_t[g['team']]+=1
    return sam_t,tot

def reset():
    for g in G:
        g['team']=None; g.pop('locked_radius',None)

# ============ 메인 배정 (파라미터화) ============
def assign(R, p):
    """p = dict of half-plane thresholds."""
    reset()
    # (a) awms163 전부 중구 (그룹에 awms 포함이면 그룹 전체 중구)
    for g in G:
        if g['has_awms']: g['team']='중구'
    # (b) radius lock
    apply_radius(R)
    # (c) per-검침일 half-plane on remaining
    for g in G:
        if g['team']: continue
        md=g['md']; dong=g['dong']; lat=g['lat']; lng=g['lng']
        if md==4:
            g['team']='종로'  # D4 통째
        elif md==1:
            # D1: nearest-rule -> 북쪽 종로 (D10 north와 일관), lat threshold
            g['team']='종로' if lat>=p['d1_lat'] else '중구'
        elif md==24:
            g['team']='종로'  # 단건, 3가 북쪽
        elif md==10:
            # 종로=북(lat 큰)
            g['team']='종로' if lat>=p['d10_lat'] else '중구'
        elif md==16:
            if dong=='명륜3가':
                # 종로=남(lat작)
                g['team']='종로' if lat<=p['d16_3_lat'] else '중구'
            else:  # 비3가(2가) 삼상균등: lng median 컷
                g['team']='종로' if lng<=p['d16_other_lng'] else '중구'
        elif md==22:
            if dong=='명륜3가':
                g['team']='종로' if lat>=p['d22_3_lat'] else '중구'
            elif dong=='명륜4가':
                # 4가: lng 컷으로 종로/중구 응집 분리(삼상 균등 지향)
                g['team']='종로' if lng<=p['d22_4_lng'] else '중구'
            else:  # 2가 등 비3가 삼상균등
                g['team']='종로' if lng<=p['d22_other_lng'] else '중구'
        else:
            g['team']='중구'
    return evaluate()

if __name__=='__main__':
    import itertools
    # 초기 추정 임계값
    base=dict(
        d1_lat=37.588,
        d10_lat=37.589,      # 북쪽 종로
        d16_3_lat=37.590,    # 남쪽 종로
        d16_other_lng=126.999,
        d22_3_lat=37.589,    # 북쪽 종로
        d22_4_lng=126.9995,  # 4가 분리
        d22_other_lng=126.998,
    )
    sam_t,tot=assign(100,base)
    print('init sam',dict(sam_t),'tot',dict(tot))
