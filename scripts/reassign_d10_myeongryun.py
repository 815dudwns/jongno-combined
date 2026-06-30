#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""명륜동 D10(검침일10)만 새 규칙으로 종로/중구 재배정.
D10 외 검침일(D1/D4/D16/D22/D24/물음표)은 현 매핑 그대로 보존(바이트 동일 보장).

D10 종로 규칙(영준님):
  zone1: 도로명주소에 '성균관로5길' 포함
  zone2: '성균관로17길' 중 '성균관로17길 47' 기준점 반경 ~80m 이내 주소
  단, awms 계기(계기번호 시작 awms... 또는 TH/KH 등 비숫자)는 종로 규칙에서 awms는 중구 유지.
  awms = 계기번호가 'awms'로 시작하거나 영준님 정의상 awms 더미. 여기선 계기번호 패턴으로 awms를 판별 못하므로
  '도로명주소에 성균관로5길/17길'을 가진 awms 주소는 없음을 검증(awms 주소는 중구).
나머지 D10 전부 중구.
"""
import json, math, sys, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSIGN = os.path.join(BASE, 'data', 'myeongryun-team-assign.json')
CONV   = os.path.join(BASE, 'data', 'myeongryun-converted.json')

def dump_call(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1)

# ---- 0) pre-flight: round-trip byte identity of assign file ----
with open(ASSIGN, 'r', encoding='utf-8') as f:
    assign_raw = f.read()
assign = json.loads(assign_raw)
rt = dump_call(assign)
# the original file may or may not have a trailing newline
orig_no_nl = assign_raw[:-1] if assign_raw.endswith('\n') else assign_raw
if rt != assign_raw and rt != orig_no_nl:
    print('PREFLIGHT FAIL: round-trip not byte-identical', file=sys.stderr)
    print('orig len', len(assign_raw), 'rt len', len(rt), file=sys.stderr)
    # show first diff
    for i,(a,b) in enumerate(zip(assign_raw, rt)):
        if a != b:
            print('first diff at', i, repr(assign_raw[i:i+20]), repr(rt[i:i+20]), file=sys.stderr)
            break
    sys.exit(1)
TRAILING_NL = assign_raw.endswith('\n')
print('PREFLIGHT OK: round-trip byte-identical (trailing_nl=%s)' % TRAILING_NL)

# ---- 1) load converted, build 계기번호 -> meter ----
conv = json.load(open(CONV, 'r', encoding='utf-8'))
by_no = {}
for m in conv:
    by_no[str(m['계기번호'])] = m

def day_of(no):
    m = by_no.get(no)
    if m is None:
        return None  # 물음표 (converted에 없음)
    return m.get('검침일')

def addr_of(no):
    m = by_no.get(no)
    return (m.get('도로명주소') or '') if m else ''

# ---- 2) zone2 ref point: 성균관로17길 47 ----
ref = None
for m in conv:
    if m.get('검침일') == 10 and (m.get('도로명주소') or '').strip() == '서울 종로구 성균관로17길 47':
        ref = m; break
assert ref is not None, '성균관로17길 47 D10 기준점 없음'
RLAT, RLNG = ref['lat'], ref['lng']

def hav(a, b, c, e):
    R = 6371000.0
    p1, p2 = math.radians(a), math.radians(c)
    dphi = math.radians(c - a); dl = math.radians(e - b)
    x = math.sin(dphi/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

RADIUS = 80.0  # ~80m. 28번지(82.6m)는 제외 — near-47 클러스터 ≤78m, far 블록 ≥82.6m 사이 갭

def is_jongno_d10(no):
    """D10 계기가 종로 규칙에 해당하는지. (awms는 호출측에서 제외)"""
    a = addr_of(no)
    if '성균관로5길' in a:
        return True, 'zone1'
    if '성균관로17길' in a:
        m = by_no.get(no)
        if m and m.get('lat') is not None and m.get('lng') is not None:
            dd = hav(RLAT, RLNG, m['lat'], m['lng'])
            if dd <= RADIUS:
                return True, 'zone2(%.1fm)' % dd
        return False, 'zone2-far'
    return False, ''

def is_awms(no):
    # awms 더미/계기는 계기번호가 'awms'로 시작(영준님 awms163 등). 안전하게 소문자 awms 접두 판별.
    return str(no).lower().startswith('awms')

# ---- 3) 재배정: D10만, 나머지 보존 ----
old_j = assign['종로']
old_c = assign['중구']

# 전체 계기 = old_j + old_c (순서 보존). 각 계기 위치를 결정.
# 보존 원칙: D10이 아니면(검침일!=10 또는 물음표) 원래 리스트에 원래 순서로 남긴다.
# D10이면 새 규칙으로 재배치.

new_j = []
new_c = []
moved = {'j2c':0, 'c2j':0, 'stay_j':0, 'stay_c':0}
zone_counts = {'zone1':0, 'zone2':0}
zone2_addrs = set()
zone1_addrs = set()

# 결정 함수: 이 D10 계기는 종로인가?
def target_for_d10(no):
    if is_awms(no):
        return '중구', 'awms'
    j, tag = is_jongno_d10(no)
    return ('종로', tag) if j else ('중구', tag)

# 종로 리스트 순회
for no in old_j:
    d = day_of(no)
    if d != 10:
        new_j.append(no); continue
    tgt, tag = target_for_d10(no)
    if tgt == '종로':
        new_j.append(no); moved['stay_j']+=1
        if tag.startswith('zone1'): zone_counts['zone1']+=1; zone1_addrs.add(addr_of(no))
        elif tag.startswith('zone2'): zone_counts['zone2']+=1; zone2_addrs.add(addr_of(no))
    else:
        new_c.append(no); moved['j2c']+=1
# 중구 리스트 순회
for no in old_c:
    d = day_of(no)
    if d != 10:
        new_c.append(no); continue
    tgt, tag = target_for_d10(no)
    if tgt == '종로':
        new_j.append(no); moved['c2j']+=1
        if tag.startswith('zone1'): zone_counts['zone1']+=1; zone1_addrs.add(addr_of(no))
        elif tag.startswith('zone2'): zone_counts['zone2']+=1; zone2_addrs.add(addr_of(no))
    else:
        new_c.append(no); moved['stay_c']+=1

result = {'종로': new_j, '중구': new_c}

# ---- 4) 검증 ----
def filt_non_d10(lst):
    return [no for no in lst if day_of(no) != 10]

errors = []
# 4a. non-D10 보존(부분수열, 순서까지)
if filt_non_d10(new_j) != filt_non_d10(old_j):
    errors.append('non-D10 종로 보존 깨짐')
if filt_non_d10(new_c) != filt_non_d10(old_c):
    errors.append('non-D10 중구 보존 깨짐')
# 4b. D10 멀티셋 보존
old_d10 = sorted([no for no in old_j+old_c if day_of(no)==10])
new_d10 = sorted([no for no in new_j+new_c if day_of(no)==10])
if old_d10 != new_d10:
    errors.append('D10 멀티셋 깨짐(드롭/중복)')
# 4c. 전체 총수
if len(old_j)+len(old_c) != len(new_j)+len(new_c):
    errors.append('전체 총수 변동')
# 4d. 중복 없음
if len(set(new_j)) != len(new_j): errors.append('종로 중복')
if len(set(new_c)) != len(new_c): errors.append('중구 중복')
if set(new_j) & set(new_c): errors.append('종로∩중구 교집합')
# 4e. awms D10 전부 중구
awms_d10 = [no for no in old_j+old_c if day_of(no)==10 and is_awms(no)]
awms_in_j = [no for no in new_j if is_awms(no) and day_of(no)==10]
if awms_in_j:
    errors.append('awms D10 종로 유입: %r' % awms_in_j)
# 4f. 같은주소 split 0 (전체 결과)
addr_team = {}
split = set()
for team, lst in (('종로',new_j),('중구',new_c)):
    for no in lst:
        a = addr_of(no)
        if not a: continue
        if a in addr_team and addr_team[a]!=team:
            split.add(a)
        addr_team[a]=addr_team.get(a,team) if a not in addr_team else addr_team[a]
# 재계산 정확히
addr_team={}
for team,lst in (('종로',new_j),('중구',new_c)):
    for no in lst:
        a=addr_of(no)
        if not a: continue
        addr_team.setdefault(a,set()).add(team) if False else None
addr_team={}
for team,lst in (('종로',new_j),('중구',new_c)):
    for no in lst:
        a=addr_of(no)
        if not a: continue
        addr_team.setdefault(a,set()).add(team)
split=[a for a,ts in addr_team.items() if len(ts)>1]

# ---- 5) 출력 ----
d10_j = [no for no in new_j if day_of(no)==10]
d10_c = [no for no in new_c if day_of(no)==10]

def is_samsang(no):
    m=by_no.get(no); return (m.get('단상삼상')=='삼상') if m else False
samsang_j = sum(1 for no in new_j if is_samsang(no))
samsang_c = sum(1 for no in new_c if is_samsang(no))

print('--- D10 zone ---')
print('zone1 성균관로5길 종로:', zone_counts['zone1'], '| 주소수', len(zone1_addrs))
print('zone2 성균관로17길47 일대 종로:', zone_counts['zone2'], '| 주소수', len(zone2_addrs))
print('두구역 합:', zone_counts['zone1']+zone_counts['zone2'])
print('--- D10 team ---')
print('D10 종로:', len(d10_j), '중구:', len(d10_c), '합:', len(d10_j)+len(d10_c))
print('awms D10:', len(awms_d10), '(전부 중구 검증:', not awms_in_j, ')')
print('--- 전체 ---')
print('종로:', len(new_j), '(기존', len(old_j), ') 중구:', len(new_c), '(기존', len(old_c), ')')
print('삼상 종로:', samsang_j, '중구:', samsang_c)
print('같은주소 split:', len(split))
print('--- 검증 ---')
print('ERRORS:', errors if errors else 'NONE')

if '--zone2-addrs' in sys.argv:
    print('zone2 주소:', sorted(zone2_addrs))

if errors:
    print('검증 실패 — 파일 미수정', file=sys.stderr); sys.exit(1)

# ---- 6) 쓰기 (byte 형식 동일) ----
if '--write' in sys.argv:
    out = dump_call(result)
    if TRAILING_NL: out += '\n'
    with open(ASSIGN, 'w', encoding='utf-8') as f:
        f.write(out)
    print('WROTE', ASSIGN)
else:
    print('(dry-run; --write 로 저장)')
