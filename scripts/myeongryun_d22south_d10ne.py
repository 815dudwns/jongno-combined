#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""명륜동 종로/중구 매핑 — 두 조정만 적용, 나머지 보존.

기준: 현 myeongryun-team-assign.json (959/1617)을 그대로 두고
두 계기집합의 팀만 변경한다.

조정1: 비명3 ∩ D22(검침일22) 종로몫을 남쪽(lat 작은)으로 응집.
  - 주소그룹(호) 단위로 lat 오름차순(남쪽부터) 정렬해 종로 채움.
  - 종로 계기수 = 현재와 동일하게 유지(~56). 나머지=중구.
  - awms는 중구. (이 구역 awms 0건 확인)

조정2: D10(검침일10) 중구 호 중 기준점 성균관로17길47(37.5912,126.997, 동북)
  가까운 큰집을 종로 추가(~36계기). 18/9/9 정확히 없으면 근사(17/9/9).
  - 호 통째, awms163 주소 제외.

보존: D10·비명3D22 외 모든 계기는 현 팀·현 순서 유지.
"""
import json, re, math, os, sys
from collections import defaultdict

BASE = '/Users/woodelight/Projects/jongno-combined/data'
ASSIGN = f'{BASE}/myeongryun-team-assign.json'
CONV = f'{BASE}/myeongryun-converted.json'
AWMS = '/Users/woodelight/Projects/ami-work/data/cha10-jongno-20260623-171628.json'

with open(ASSIGN, encoding='utf-8') as f:
    assign_raw = f.read()
assign = json.loads(assign_raw)
TRAILING_NL = assign_raw.endswith('\n')

d = json.load(open(CONV, encoding='utf-8'))
aw = json.load(open(AWMS))

def norm(x):
    return re.sub(r'\D', '', str(x)).zfill(11)

awset = set(norm(a['WHM_NO']) for a in aw)
by_no = {r['계기번호']: r for r in d}

def m3(r):
    return r['법정동'] == '명륜3가'

def is_awms(no):
    return norm(no) in awset

def day_of(no):
    r = by_no.get(no)
    return r.get('검침일') if r else None

def addr_of(no):
    r = by_no.get(no)
    return r['주소'] if r else None

def lat_of(no):
    r = by_no.get(no)
    return r['lat'] if r else None

def phase(r):
    ss = r.get('단상삼상')
    if ss in ('단상', '삼상'):
        return ss
    digs = re.sub(r'\D', '', r['계기번호']); code = digs[2:4]
    return '삼상' if code in ('45', '46', '47', '55') else '단상'

# ---- current team map ----
old_team = {}
for t in ('종로', '중구'):
    for no in assign[t]:
        old_team[no] = t

new_team = dict(old_team)  # start from current; mutate only target sets

# ============ 조정1: 비명3 ∩ D22 남쪽 응집 ============
b22_addrs = defaultdict(list)
for r in d:
    if (not m3(r)) and r['검침일'] == 22:
        b22_addrs[r['주소']].append(r)

# 현재 비명3D22 종로 계기수 (유지 목표)
cur_b22_jongno = sum(1 for a, recs in b22_addrs.items()
                     for r in recs if old_team[r['계기번호']] == '종로')

# 주소그룹 lat 오름차순(남쪽 먼저). awms 주소는 강제 중구(맨 뒤로).
def ag_lat(recs):
    return sum(r['lat'] for r in recs) / len(recs)

ags = []
for a, recs in b22_addrs.items():
    hasaw = any(is_awms(r['계기번호']) for r in recs)
    ags.append((ag_lat(recs), hasaw, a, recs))
# 정렬: awms 먼저 중구로 빼기 위해 (hasaw, lat) — non-awms를 lat순으로 종로 채움
ags_sorted = sorted([x for x in ags if not x[1]], key=lambda x: x[0])

acc = 0
for lat, hasaw, a, recs in ags_sorted:
    if acc < cur_b22_jongno:
        for r in recs:
            new_team[r['계기번호']] = '종로'
        acc += len(recs)
    else:
        for r in recs:
            new_team[r['계기번호']] = '중구'
# awms 주소는 중구
for lat, hasaw, a, recs in ags:
    if hasaw:
        for r in recs:
            new_team[r['계기번호']] = '중구'

# ============ 조정2: D10 동북 큰집 종로 추가 ============
RLAT, RLNG = 37.5912, 126.997

def hav(a, b, c, e):
    R = 6371000.0
    p1, p2 = math.radians(a), math.radians(c)
    dphi = math.radians(c - a); dl = math.radians(e - b)
    x = math.sin(dphi/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

# D10 후보 호 = 그 주소의 전체 계기가 모두 검침일10(pure-D10)이고 현재 중구인 호.
# pure-D10이라야 호 통째 이동해도 D1 등 다른 검침일 계기를 건드리지 않음(=새 split 0).
# (2-12는 18계기지만 17 D10+1 D1 혼합 → split 유발하므로 제외, big 슬롯은 pure 16-호 5-34)
full_groups = defaultdict(list)
for r in d:
    full_groups[r['주소']].append(r)

cand = []
for a, recs in full_groups.items():
    days = set(r['검침일'] for r in recs)
    if days != {10}:
        continue  # pure-D10만
    if any(old_team[r['계기번호']] != '중구' for r in recs):
        continue  # 현재 통째 중구인 호만
    if any(is_awms(r['계기번호']) for r in recs):
        continue
    lat = sum(r['lat'] for r in recs) / len(recs)
    lng = sum(r['lng'] for r in recs) / len(recs)
    dist = hav(RLAT, RLNG, lat, lng)
    cand.append({'addr': a, 'n': len(recs), 'dist': dist, 'recs': recs})

# 목표 형태: 큰집1(18근사) + 중집2(9). 가장 가까운 9-호 2개 + 가장 가까운 최대-호 1개.
by_dist = sorted(cand, key=lambda c: c['dist'])
nine = [c for c in by_dist if c['n'] == 9]
big = [c for c in by_dist if c['n'] >= 16]  # 18 pure 없음 → 가장 가까운 16-호(5-34) 근사
picked = []
if big:
    picked.append(big[0])
picked += nine[:2]
# 중복 주소 제거(혹시 같은게 잡히면)
seen = set(); picked = [c for c in picked if not (c['addr'] in seen or seen.add(c['addr']))]

d10_added = []
for c in picked:
    for r in c['recs']:
        new_team[r['계기번호']] = '종로'
        d10_added.append(r['계기번호'])

# ============ 결과 빌드 (현 순서 보존) ============
# 전체 계기 순서 = 현 종로 + 현 중구 순서를 보존하되 팀 재배치.
# 보존 원칙: 각 계기는 자신의 new_team 리스트에, '현재 그 팀에서의 등장 순서'로 들어감.
# 변경된 계기는 상대 리스트 끝으로 자연 이동 — non-target 보존을 위해
# new_j/new_c를 (현 종로 순회 → 현 중구 순회) 순으로 쌓되 new_team으로 분기.
new_j, new_c = [], []
for no in assign['종로']:
    (new_j if new_team[no] == '종로' else new_c).append(no)
for no in assign['중구']:
    (new_j if new_team[no] == '종로' else new_c).append(no)

result = {'종로': new_j, '중구': new_c}

# ============ 검증 ============
errors = []
all_no = set(old_team)
# 1) 멀티셋 보존
if sorted(new_j + new_c) != sorted(assign['종로'] + assign['중구']):
    errors.append('전체 계기 멀티셋 깨짐')
# 2) 중복/교집합
if len(set(new_j)) != len(new_j): errors.append('종로 중복')
if len(set(new_c)) != len(new_c): errors.append('중구 중복')
if set(new_j) & set(new_c): errors.append('교집합')
# 3) 변경된 계기 ⊆ (비명3D22 ∪ D10추가35)  ← 핵심 불변 검증
changed = {no for no in all_no if old_team[no] != new_team[no]}
b22_set = {r['계기번호'] for recs in b22_addrs.values() for r in recs}
allowed = b22_set | set(d10_added)
stray = changed - allowed
if stray:
    errors.append('보존구역 침범 %d건: %r' % (len(stray), list(stray)[:5]))
# 4) non-target zone별 불변(검침일 단위)
for label, filt in [
    ('D1', lambda r: r['검침일'] == 1),
    ('D4', lambda r: r['검침일'] == 4),
    ('D16', lambda r: r['검침일'] == 16),
    ('D24', lambda r: r['검침일'] == 24),
    ('명3D22', lambda r: m3(r) and r['검침일'] == 22),
    ('명3D10', lambda r: m3(r) and r['검침일'] == 10),
]:
    for r in d:
        if filt(r):
            no = r['계기번호']
            if old_team[no] != new_team[no]:
                errors.append('%s 침범: %s' % (label, no)); break
# 5) awms163 전부 중구
aw_in_j = [r['계기번호'] for r in d if is_awms(r['계기번호']) and new_team[r['계기번호']] == '종로']
if aw_in_j:
    errors.append('awms 종로유입 %d건' % len(aw_in_j))
# 6) 같은주소 split — 새 split 0 (기존 split 2건은 다른 검침일 혼재 호로 base부터 존재, 보존)
def splits_of(team_map):
    at = defaultdict(set)
    for r in d:
        at[r['주소']].add(team_map[r['계기번호']])
    return {a for a, ts in at.items() if len(ts) > 1}

old_splits = splits_of(old_team)
split = sorted(splits_of(new_team))
new_splits = splits_of(new_team) - old_splits
if new_splits:
    errors.append('새 같은주소 split %d: %r' % (len(new_splits), sorted(new_splits)))

# ============ 출력 ============
def team_no(no): return new_team[no]

# 비명3D22
b22_j = [r for recs in b22_addrs.values() for r in recs if team_no(r['계기번호']) == '종로']
b22_c = [r for recs in b22_addrs.values() for r in recs if team_no(r['계기번호']) == '중구']
b22_jlat = sum(r['lat'] for r in b22_j) / len(b22_j)
b22_clat = sum(r['lat'] for r in b22_c) / len(b22_c)
b22_sj = sum(phase(r) == '삼상' for r in b22_j)
b22_sc = sum(phase(r) == '삼상' for r in b22_c)

print('=== 조정1: 비명3∩D22 남쪽 응집 ===')
print('종로 %d / 중구 %d (현재 종로수 유지목표 %d)' % (len(b22_j), len(b22_c), cur_b22_jongno))
print('종로 lat평균 %.5f  중구 lat평균 %.5f  (종로<중구=남쪽: %s)'
      % (b22_jlat, b22_clat, b22_jlat < b22_clat))
print('종로 lat범위 %.5f~%.5f' % (min(r['lat'] for r in b22_j), max(r['lat'] for r in b22_j)))
print('삼상 종로 %d / 중구 %d' % (b22_sj, b22_sc))

print()
print('=== 조정2: D10 동북 큰집 추가 ===')
for c in picked:
    print('  호 %s  계기 %d  거리 %.0fm' % (c['addr'], c['n'], c['dist']))
print('추가 계기 합: %d (목표 ~36)' % len(d10_added))
d10_j = sum(1 for r in d if r['검침일'] == 10 and team_no(r['계기번호']) == '종로')
d10_c = sum(1 for r in d if r['검침일'] == 10 and team_no(r['계기번호']) == '중구')
print('D10 종로 %d / 중구 %d' % (d10_j, d10_c))

print()
print('=== 총계 ===')
print('종로 %d (현 %d) / 중구 %d (현 %d) / 합 %d'
      % (len(new_j), len(assign['종로']), len(new_c), len(assign['중구']), len(new_j) + len(new_c)))
sj = sum(phase(by_no[no]) == '삼상' for no in new_j)
sc = sum(phase(by_no[no]) == '삼상' for no in new_c)
print('삼상 종로 %d / 중구 %d' % (sj, sc))

print()
print('=== 검침일 x 팀 ===')
for dd in sorted(set(r['검침일'] for r in d)):
    rs = [r for r in d if r['검침일'] == dd]
    j = sum(team_no(r['계기번호']) == '종로' for r in rs)
    print('  D%-3d 종로%5d 중구%5d' % (dd, j, len(rs) - j))

print()
print('=== 불변/제약 검증 ===')
print('변경된 계기 수: %d (전부 비명3D22∪D10추가 내: %s)' % (len(changed), not stray))
print('awms163 종로유입: %d (목표 0)' % len(aw_in_j))
print('같은주소 split: 전체 %d (기존 %d 보존, 새 %d / 목표 0)'
      % (len(split), len(old_splits), len(new_splits)))
print('ERRORS:', errors if errors else 'NONE')

if errors:
    print('검증 실패 — 파일 미수정', file=sys.stderr); sys.exit(1)

if '--write' in sys.argv:
    out = json.dumps(result, ensure_ascii=False, indent=1)
    if TRAILING_NL: out += '\n'
    with open(ASSIGN, 'w', encoding='utf-8') as f:
        f.write(out)
    print('\nWROTE', ASSIGN)
else:
    print('\n(dry-run; --write 로 저장)')
