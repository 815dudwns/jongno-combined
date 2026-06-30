#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
명륜동 종로/중구 매핑 수정 — D10(검침일10) 명3 종로몫만 재배치.
베이스: myeongryun-team-assign.json (현 매핑). 변경 적용 후 덮어쓰기.

요청(영준님): 종로팀 D10 구역 = "서울 종로구 성균관로17길 47" 인근.
  (앞서 '성균관로5길' 폐기 — 이걸로 대체)
  → D10∩명3 종로 ~204건을 기준점(성균관로17길 47)에서 가까운 주소 순으로 채워 응집.

보존(변동 0):
  - D1/D4/D16/D22/D24·물음표 배정 그대로.
  - 비명3∩D10(명륜1가) 현 상태 유지. 기준점이 비명3에 속하지만 끌어오지 않음
    (단지 클러스터 앵커로만 사용 — "그 인근 처리 반영").
  - 하드락: 4/16/22 메터 포함 그룹, awms163(중구 고정) 그룹은 베이스 팀 유지.
  - 같은주소=같은팀 (그룹 원자단위 이동).

검증: D10 외 검침일 배정 불변(메터-팀 매핑 동일) assert.
"""
import json
from collections import defaultdict, Counter

BASE = "/Users/woodelight/Projects/jongno-combined/data"
CONV = BASE + "/myeongryun-converted.json"
ASSIGN = BASE + "/myeongryun-team-assign.json"
AWMS = "/Users/woodelight/Projects/ami-work/data/cha10-jongno-20260623-171628.json"

# 기준점: 성균관로17길 47 좌표 (converted.json 도로명주소 매칭)
ANCHOR_LAT = 37.5911750940384
ANCHOR_LNG = 126.99684129417

QM = {"TH141895787", "KH141508652"}  # 물음표(미상/미분류) — 보존 대상


def parse_phase(rec):
    p = rec.get("단상삼상", "")
    if p in ("단상", "삼상"):
        return p
    no = rec["계기번호"]
    digits = no[2:4] if no[:2].isdigit() else ""
    return "삼상" if digits in ("45", "46", "47", "55") else "단상"


def haversine(lat1, lng1, lat2, lng2):
    from math import radians, sin, cos, asin, sqrt
    R = 6371000.0
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * R * asin(sqrt(a))


def main():
    conv = json.load(open(CONV, encoding="utf-8"))
    base = json.load(open(ASSIGN, encoding="utf-8"))
    base_jongno = set(base["종로"])
    base_junggu = set(base["중구"])
    m2t = {m: "종로" for m in base_jongno}
    m2t.update({m: "중구" for m in base_junggu})

    by_meter = {r["계기번호"]: r for r in conv}
    groups = defaultdict(list)
    for r in conv:
        groups[r["주소"]].append(r)

    awms = json.load(open(AWMS, encoding="utf-8"))
    awms_whm = set(a["WHM_NO"] for a in awms)

    # 기준점 좌표 확인(converted에 성균관로17길 47 있으면 그 좌표 사용)
    s47 = [r for r in conv if "성균관로17길 47" in (r.get("도로명주소") or "")]
    if s47:
        alat = s47[0]["lat"]
        alng = s47[0]["lng"]
    else:
        alat, alng = ANCHOR_LAT, ANCHOR_LNG
    print(f"기준점(성균관로17길 47): lat {alat} / lng {alng}  (converted 매칭 {len(s47)}건)")

    def modal(items):
        return Counter(i["검침일"] for i in items).most_common(1)[0][0]

    def has_preserve(items):  # 4/16/22 포함 = 보존 잠금
        return any(i["검침일"] in (4, 16, 22) for i in items)

    def has_awms(items):
        return any(i["계기번호"] in awms_whm for i in items)

    def is3ga(items):
        return any(i["법정동"] == "명륜3가" for i in items)

    def gteam(items):
        return m2t[items[0]["계기번호"]]

    # 새 그룹->팀 (베이스 복사)
    new_team = {addr: gteam(items) for addr, items in groups.items()}

    # ---- D10∩명3 재배치 (성균관로17길 47 인근 응집) ----
    pool = []
    for addr, items in groups.items():
        if modal(items) != 10:
            continue
        if not is3ga(items):
            continue          # 비명3(명륜1가) 보존 — 끌어오지 않음
        if has_preserve(items):
            continue          # hazard 보존 잠금
        if has_awms(items):
            new_team[addr] = "중구"  # awms163 중구 고정
            continue
        pool.append((addr, items))

    # pool 내 현재 종로 계기수 = 종로 목표(비율 유지)
    target_jn = sum(len(items) for a, items in pool if gteam(items) == "종로")

    def gcoord(items):
        n = len(items)
        return (sum(i["lat"] for i in items) / n, sum(i["lng"] for i in items) / n)

    def dist(items):
        la, ln = gcoord(items)
        return haversine(la, ln, alat, alng)

    # 기준점 가까운 주소 순으로 종로 채우기
    pool_sorted = sorted(pool, key=lambda x: dist(x[1]))
    acc = 0
    for addr, items in pool_sorted:
        if acc < target_jn:
            new_team[addr] = "종로"
            acc += len(items)
        else:
            new_team[addr] = "중구"

    # ---- 출력 (그룹 순서·메터 순서는 conv 순서 따름) ----
    out = {"종로": [], "중구": []}
    for addr, items in groups.items():
        t = new_team[addr]
        for it in items:
            out[t].append(it["계기번호"])
    json.dump(out, open(ASSIGN, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    new_j = set(out["종로"]); new_g = set(out["중구"])

    # ---- assert: D10 외 검침일 메터-팀 매핑 불변 ----
    new_m2t = {m: "종로" for m in new_j}
    new_m2t.update({m: "중구" for m in new_g})
    changed_non_d10 = [m for m in by_meter
                       if by_meter[m]["검침일"] != 10 and m2t[m] != new_m2t[m]]
    assert not changed_non_d10, f"D10 외 배정 변동! {changed_non_d10[:10]}"
    # D10 비명3(명륜1가)도 불변 확인
    changed_d10_n3 = [m for m in by_meter
                      if by_meter[m]["검침일"] == 10
                      and by_meter[m]["법정동"] != "명륜3가"
                      and m2t[m] != new_m2t[m]]
    assert not changed_d10_n3, f"D10 비명3 변동! {changed_d10_n3[:10]}"
    print("ASSERT OK: D10 외 + D10비명3 메터-팀 매핑 베이스와 동일\n")

    report(conv, by_meter, base_jongno, base_junggu, new_j, new_g,
           pool, target_jn, acc, awms_whm, alat, alng, m2t, new_m2t)


def report(conv, by_meter, bj, bg, nj, ng, pool, target_jn, acc,
           awms_whm, alat, alng, m2t, new_m2t):
    print(f"전체: 종로 {len(nj):,} / 중구 {len(ng):,} / 합 {len(nj)+len(ng):,}")
    print(f"  (베이스: 종로 {len(bj):,} / 중구 {len(bg):,})\n")

    d10m3 = [r for r in conv if r["검침일"] == 10 and r["법정동"] == "명륜3가"]
    jn = [r for r in d10m3 if r["계기번호"] in nj]
    jg = [r for r in d10m3 if r["계기번호"] in ng]

    def adist(its):
        if not its:
            return 0
        return sum(haversine(i["lat"], i["lng"], alat, alng) for i in its) / len(its)

    print("=== D10 명3 성균관로17길47 인근 응집 ===")
    print(f"D10명3 종로 {len(jn)} / 중구 {len(jg)} "
          f"(비율 {len(jn)/len(d10m3)*100:.1f}:{len(jg)/len(d10m3)*100:.1f})")
    print(f"  종로 평균거리 {adist(jn):.0f}m < 중구 {adist(jg):.0f}m  → 종로가 기준점 인근? {adist(jn) < adist(jg)}")
    print(f"  pool 그룹 {len(pool)}, 종로목표 {target_jn} → 실제 {acc}")

    # D10 외 불변(메터-팀)
    nond10_same = all(m2t[m] == new_m2t[m] for m in by_meter if by_meter[m]["검침일"] != 10)
    print(f"\nD10 외 배정 불변(메터-팀 동일): {nond10_same}")
    # 검침일별 종로/중구 변동표
    print("  검침일별 종로 건수 (베이스→신):")
    for day in sorted(set(r["검침일"] for r in conv), key=lambda x: (str(type(x)), str(x))):
        bset = sum(1 for m in bj if by_meter.get(m, {}).get("검침일") == day)
        nset = sum(1 for m in nj if by_meter.get(m, {}).get("검침일") == day)
        mark = "" if bset == nset else "  ← D10 변경"
        print(f"    D{day}: {bset} → {nset}{mark}")

    # 삼상
    for team, S in (("종로", nj), ("중구", ng)):
        its = [by_meter[m] for m in S]
        sam = sum(1 for i in its if parse_phase(i) == "삼상")
        print(f"\n{team}: 총 {len(its):,} | 단상 {len(its)-sam:,} 삼상 {sam}")

    # 같은주소 분할 0
    groups = defaultdict(list)
    for r in conv:
        groups[r["주소"]].append(r)

    def t_of(m):
        return "종로" if m in nj else "중구"
    split = sum(1 for a, its in groups.items()
                if len(set(t_of(i["계기번호"]) for i in its)) > 1)
    print(f"\n같은주소 분할 그룹: {split} (0이어야)")

    # awms163 중구
    whm = awms_whm & set(by_meter)
    teams = set(t_of(w) for w in whm)
    print(f"awms163 ({len(whm)}건) 전부 중구? {teams == {'중구'}} ({teams})")


if __name__ == "__main__":
    main()
