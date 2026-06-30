#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""명륜동 2576건 종로/중구 배분 — 영준님 구역별 지시 기반 재계산.
명3=명륜3가, 비명3=명륜1·2·4가. KST 기준.
"""
import json, re, math
from collections import Counter, defaultdict

BASE = '/Users/woodelight/Projects/jongno-combined/data'
AWMS = '/Users/woodelight/Projects/ami-work/data/cha10-jongno-20260623-171628.json'

d = json.load(open(f'{BASE}/myeongryun-converted.json'))
aw = json.load(open(AWMS))

def norm(x): return re.sub(r'\D', '', str(x)).zfill(11)

def phase(r):
    ss = r.get('단상삼상')
    if ss in ('단상', '삼상'): return ss
    digs = re.sub(r'\D', '', r['계기번호']); code = digs[2:4]
    return '삼상' if code in ('45', '46', '47', '55') else '단상'

def m3(r): return r['법정동'] == '명륜3가'
def matgae(r): return float(r.get('계약전력') or 0)  # 계약전력 as 매출 proxy

# ---- awms anchors ----
by_mn = {norm(r['계기번호']): r for r in d}
awset = set(norm(a['WHM_NO']) for a in aw)
awrecs = [by_mn[m] for m in awset if m in by_mn]
awpts = [(r['lat'], r['lng']) for r in awrecs]
COSLAT = math.cos(math.radians(37.59))

def near_awms(lat, lng, m=100):
    for alat, alng in awpts:
        dlat = (lat - alat) * 111320
        dlng = (lng - alng) * 111320 * COSLAT
        if dlat * dlat + dlng * dlng <= m * m: return True
    return False

# ---- address-level grouping (same addr = same team) ----
addr_groups = defaultdict(list)
for r in d:
    addr_groups[r['주소']].append(r)

class AG:
    __slots__ = ('addr', 'recs', 'lat', 'lng', 'n', 'sam', 'mr', 'm3', 'sg5', 'awms', 'near')
    def __init__(self, addr, recs):
        self.addr = addr; self.recs = recs; self.n = len(recs)
        self.lat = sum(r['lat'] for r in recs) / self.n
        self.lng = sum(r['lng'] for r in recs) / self.n
        self.sam = sum(phase(r) == '삼상' for r in recs)
        self.mr = recs[0]['검침일']  # 검침일 per address (consistent)
        self.m3 = m3(recs[0])
        self.sg5 = any('성균관로5길' in (r.get('도로명주소') or '') for r in recs)
        self.awms = any(norm(r['계기번호']) in awset for r in recs)
        self.near = near_awms(self.lat, self.lng)

groups = [AG(a, recs) for a, recs in addr_groups.items()]
assign = {}  # addr -> '종로'/'중구'

def put(g, team): assign[g.addr] = team

def split_by(cands, axis_key, jongno_target, reverse=False):
    """주소그룹을 axis로 정렬, 누적 meter수로 jongno_target에 도달까지 종로, 나머지 중구.
    reverse=True면 큰 값부터(북=lat 큰)."""
    cands = sorted(cands, key=axis_key, reverse=reverse)
    acc = 0
    for g in cands:
        if acc < jongno_target:
            put(g, '종로'); acc += g.n
        else:
            put(g, '중구')
    return acc

# ============ 구역별 배분 ============
# 분류 헬퍼
def zone(g):
    cat = '명3' if g.m3 else '비명3'
    return (cat, g.mr)

buckets = defaultdict(list)
for g in groups:
    buckets[zone(g)].append(g)

report = {}

# Rule 4: 비명3 ∩ D16 → 전부 중구
for g in buckets[('비명3', 16)]: put(g, '중구')

# Rule 7: D4 → 종로 통째 (명3·비명3 모두)
for g in buckets[('명3', 4)] + buckets[('비명3', 4)]: put(g, '종로')

# D24 → 중구 (rule 9). D1(17) → 종로총량 조절: 일단 종로.
for g in buckets[('명3', 24)] + buckets[('비명3', 24)]: put(g, '중구')
for g in buckets[('명3', 1)] + buckets[('비명3', 1)]: put(g, '종로')

# Rule 1: 명3 ∩ D16 → 38.8:61.2, 종로몫 공간응집(좌표 한쪽=서쪽 lng 작은쪽, awms 북동 피함)
c = buckets[('명3', 16)]
tot = sum(g.n for g in c); jt = round(tot * 0.388)
# 종로몫은 lng 작은(서쪽) + awms-near 회피. near는 뒤로 밀기 위해 정렬키에 페널티.
report['명3∩D16'] = ('38.8:61.2', tot, jt)
split_by(c, axis_key=lambda g: (g.near, g.lng), jongno_target=jt)

# Rule 2+6: 명3 ∩ D10 → 38.8:61.2, 종로몫 = 성균관로5길(#6, D4위쪽) + 제일 북쪽(lat 최대).
# 두 영역 모두 zone규칙 최우선(awms-100m 소프트 선호보다 우선). awms-163 exact만 절대 중구.
c = buckets[('명3', 10)]
tot = sum(g.n for g in c); jt = round(tot * 0.388)
report['명3∩D10'] = ('38.8:61.2', tot, jt)
# 1순위 성균관5길, 2순위 북쪽(lat 큰). awms-163 exact 주소는 뒤로(=중구).
split_by(c, axis_key=lambda g: (g.awms, not g.sg5, -g.lat), jongno_target=jt)

# Rule 6 보강: 비명3 ∩ D10 → 성균관5길·최북 외 나머지는 중구
# 명3 D10에서 이미 성균관5길 처리. 비명3 D10의 성균관5길도 종로(D4 위쪽 성균관로5길 일대 응집).
c = buckets[('비명3', 10)]
# 성균관5길 종로, 나머지 중구
for g in c:
    put(g, '종로' if g.sg5 else '중구')

# Rule 3: 명3 ∩ D22 → 종로몫 위(북=lat 큰)에 공간응집, 비율 완화
c = buckets[('명3', 22)]
tot = sum(g.n for g in c)
jt = round(tot * 0.388)  # 완화지만 38.8 지향 출발
report['명3∩D22'] = ('완화~38.8', tot, jt)
split_by(c, axis_key=lambda g: g.lat, jongno_target=jt, reverse=True)  # 북쪽부터 종로

# Rule 5: 비명3 ∩ D22 (삼상 많음) → 삼상 종로/중구 균등 지향+응집(좌표 갈라)
c = buckets[('비명3', 22)]
tot = sum(g.n for g in c)
# 삼상 균등 지향: 좌표(lng)로 갈라 응집. 서쪽=종로, 동쪽=중구 (절반)
jt = round(tot * 0.5)
report['비명3∩D22'] = ('삼상균등(좌표분리)', tot, jt)
split_by(c, axis_key=lambda g: g.lng, jongno_target=jt)  # 서쪽(lng작은)부터 종로

# ---- 하드제약 재적용: awms-163 전부 중구 (절대) ----
# 같은주소 규칙상 awms 포함 주소는 통째 중구
forced_jung = 0
for g in groups:
    if g.awms and assign.get(g.addr) != '중구':
        put(g, '중구'); forced_jung += 1

# ============ 종로 총량 튜닝 → ≈1000 ============
def totals():
    jn = sum(g.n for g in groups if assign[g.addr] == '종로')
    return jn, len(d) - jn

jn, ju = totals()

# 튜닝: 종로가 부족/과다하면 명3∩D22(완화) 또는 비명3∩D22로 미세조정
# 우선 현재값 확인 후, 명3∩D22의 종로 경계를 lat순으로 늘리거나 줄임.
def retune_zone(zkey, axis_key, target_jn, reverse):
    """해당 zone의 비-awms·비-고정 그룹을 재정렬해 종로몫 늘/줄. 전체 종로가 target_jn 되도록."""
    pass

# 간단 튜닝: 종로 부족분/과다분을 명3∩D22 경계 이동으로 흡수
def adjust_for_total(goal=1000, tol=100):
    jn, _ = totals()
    diff = goal - jn  # +면 종로 더 필요
    # 조정 가능 zone: 명3∩D22 (완화). lat 큰순(북) 정렬.
    z = sorted([g for g in buckets[('명3', 22)] if not g.awms],
               key=lambda g: g.lat, reverse=True)
    # 현재 z의 종로/중구 경계 인덱스
    # 다시 깔되 종로몫을 diff만큼 가감
    cur_j = sum(g.n for g in z if assign[g.addr] == '종로')
    new_target = cur_j + diff
    new_target = max(0, min(sum(g.n for g in z), new_target))
    acc = 0
    for g in z:
        if acc < new_target:
            put(g, '종로'); acc += g.n
        else:
            put(g, '중구')
    return totals()

jn0, ju0 = totals()
jn, ju = adjust_for_total(1000)

# ============ 결과 빌드 ============
out = {'종로': [], '중구': []}
for g in groups:
    t = assign[g.addr]
    for r in g.recs:
        out[t].append(r['계기번호'])

json.dump(out, open(f'{BASE}/myeongryun-team-assign.json', 'w'),
          ensure_ascii=False, indent=1)

# ============ 검증 출력 ============
def fmt(n): return f'{n:,}'
print('=== 종로 총량 튜닝 ===')
print(f'튜닝전 종로 {fmt(jn0)} / 튜닝후 종로 {fmt(jn)} / 중구 {fmt(ju)} / awms강제중구 {forced_jung}')
print()
print('=== 구역별 검증 ===')
team_of = {}
for g in groups:
    for r in g.recs: team_of[r['계기번호']] = assign[g.addr]

def zstats(label, filt):
    rs = [r for r in d if filt(r)]
    j = sum(team_of[r['계기번호']] == '종로' for r in rs)
    u = len(rs) - j
    pct = 100 * j / len(rs) if rs else 0
    print(f'{label:18s} 총{fmt(len(rs)):>6} 종로{fmt(j):>5} 중구{fmt(u):>5} 종로%={pct:4.1f}')

zstats('명3∩D16', lambda r: m3(r) and r['검침일'] == 16)
zstats('명3∩D10', lambda r: m3(r) and r['검침일'] == 10)
zstats('명3∩D22', lambda r: m3(r) and r['검침일'] == 22)
zstats('명3∩D4', lambda r: m3(r) and r['검침일'] == 4)
zstats('비명3∩D16', lambda r: not m3(r) and r['검침일'] == 16)
zstats('비명3∩D10', lambda r: not m3(r) and r['검침일'] == 10)
zstats('비명3∩D22', lambda r: not m3(r) and r['검침일'] == 22)
zstats('비명3∩D4', lambda r: not m3(r) and r['검침일'] == 4)

print()
print('=== 비명3∩D22 삼상 분배 ===')
b22 = [r for r in d if not m3(r) and r['검침일'] == 22 and phase(r) == '삼상']
bj = [r for r in b22 if team_of[r['계기번호']] == '종로']
bu = [r for r in b22 if team_of[r['계기번호']] == '중구']
print(f'삼상 {len(b22)}: 종로{len(bj)} 중구{len(bu)}')
if bj: print(f'  종로 삼상 lng {min(r["lng"] for r in bj):.5f}~{max(r["lng"] for r in bj):.5f}')
if bu: print(f'  중구 삼상 lng {min(r["lng"] for r in bu):.5f}~{max(r["lng"] for r in bu):.5f}')

print()
print('=== 명3∩D22 종로 북쪽 확인 ===')
m22j = [r for r in d if m3(r) and r['검침일'] == 22 and team_of[r['계기번호']] == '종로']
m22u = [r for r in d if m3(r) and r['검침일'] == 22 and team_of[r['계기번호']] == '중구']
if m22j: print(f'  종로 lat {min(r["lat"] for r in m22j):.5f}~{max(r["lat"] for r in m22j):.5f}')
if m22u: print(f'  중구 lat {min(r["lat"] for r in m22u):.5f}~{max(r["lat"] for r in m22u):.5f}')

print()
print('=== D10 성균관로5길 종로 확인 ===')
sg5 = [r for r in d if r['검침일'] == 10 and '성균관로5길' in (r.get('도로명주소') or '')]
sg5j = sum(team_of[r['계기번호']] == '종로' for r in sg5)
print(f'  D10 성균관로5길 {len(sg5)}: 종로 {sg5j}')

print()
print('=== awms 검증 ===')
aw_j = sum(team_of[r['계기번호']] == '종로' for r in awrecs)
print(f'  awms 163 중 종로: {aw_j} (목표 0)')
near_j = sum(team_of[r['계기번호']] == '종로' for r in d if near_awms(r['lat'], r['lng']))
print(f'  awms 100m내 종로: {near_j}')

print()
print('=== 검침일 x 팀 ===')
print(f'{"검침일":>6} {"종로":>6} {"중구":>6}')
for dd in sorted(set(r['검침일'] for r in d)):
    rs = [r for r in d if r['검침일'] == dd]
    j = sum(team_of[r['계기번호']] == '종로' for r in rs)
    print(f'D{dd:<5} {fmt(j):>6} {fmt(len(rs)-j):>6}')

print()
print('=== 삼상 / 매출(계약전력합) ===')
for t in ['종로', '중구']:
    rs = [r for r in d if team_of[r['계기번호']] == t]
    sam = sum(phase(r) == '삼상' for r in rs)
    rev = sum(matgae(r) for r in rs)
    print(f'{t}: 총{fmt(len(rs))} 삼상{sam} 계약전력합{fmt(int(rev))}kW')
totrev = sum(matgae(r) for r in d)
jrev = sum(matgae(r) for r in d if team_of[r['계기번호']] == '종로')
print(f'종로 매출비중(계약전력): {100*jrev/totrev:.1f}%')
sam_all = [r for r in d if phase(r) == '삼상']
sj = sum(team_of[r['계기번호']] == '종로' for r in sam_all)
print(f'삼상 총{len(sam_all)}: 종로{sj} 중구{len(sam_all)-sj} (참고목표 64:101)')

print()
print('=== 같은주소 분할 체크 ===')
bad = 0
for a, recs in addr_groups.items():
    ts = set(team_of[r['계기번호']] for r in recs)
    if len(ts) > 1: bad += 1
print(f'  분할된 주소 수: {bad} (목표 0)')

print()
print('=== 가별 분포 ===')
for ga in ['명륜1가', '명륜2가', '명륜3가', '명륜4가']:
    rs = [r for r in d if r['법정동'] == ga]
    j = sum(team_of[r['계기번호']] == '종로' for r in rs)
    print(f'  {ga}: 총{fmt(len(rs))} 종로{j} 중구{len(rs)-j}')
print(f'총계: 종로 {fmt(jn)} / 중구 {fmt(ju)} / 합 {fmt(len(d))}')
