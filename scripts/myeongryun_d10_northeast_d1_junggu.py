#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
명륜동 종로/중구 매핑 수정 (베이스: myeongryun-team-assign.json).
변경만 적용 후 덮어쓰기. D4/D16/D22 배정 완전 보존.

변경1: D10(검침일10) 명3 종로몫을 동북(lng·lat 큰)으로 재응집.
  - 성균관로5길(94, 종로) 유지.
  - 4/16/22 메터 포함 그룹(hazard)은 현 팀 고정(보존).
  - 나머지 D10명3 그룹(pool)에서 현재 종로계기수(109)만큼을 동북코너 우선(lng+lat 큰 순)으로 종로, 나머지 중구.
변경2: D1(검침일1) + 물음표(미상/미분류) 전부 중구.
  - 단, 4/16/22 메터를 함께 가진 주소그룹은 보존 위해 현 팀 고정(D1/물음표 stranded).
  - 같은주소=같은팀(그룹 단위 이동).

검증: D4/16/22 메터집합 베이스와 바이트동일 assert.
"""
import json
from collections import defaultdict, Counter

BASE = "/Users/woodelight/Projects/jongno-combined/data"
CONV = BASE + "/myeongryun-converted.json"
ASSIGN = BASE + "/myeongryun-team-assign.json"
AWMS = "/Users/woodelight/Projects/ami-work/data/cha10-jongno-20260623-171628.json"

QM = {"TH141895787", "KH141508652"}  # 물음표: 검침일미상/계기타입·단상삼상 미분류


def parse_phase(rec):
    p = rec.get("단상삼상", "")
    if p in ("단상", "삼상"):
        return p
    no = rec["계기번호"]
    digits = no[2:4] if no[:2].isdigit() else ""
    return "삼상" if digits in ("45", "46", "47", "55") else "단상"


def main():
    conv = json.load(open(CONV, encoding="utf-8"))
    base = json.load(open(ASSIGN, encoding="utf-8"))
    base_jongno = set(base["종로"])
    base_junggu = set(base["중구"])
    # 메터->팀 (베이스)
    m2t = {m: "종로" for m in base_jongno}
    m2t.update({m: "중구" for m in base_junggu})

    by_meter = {r["계기번호"]: r for r in conv}
    groups = defaultdict(list)
    for r in conv:
        groups[r["주소"]].append(r)

    # awms163: 전부 중구 고정 (베이스 규칙)
    awms = json.load(open(AWMS, encoding="utf-8"))
    awms_whm = set(a["WHM_NO"] for a in awms)

    def has_awms(items):
        return any(i["계기번호"] in awms_whm for i in items)

    def modal(items):
        return Counter(i["검침일"] for i in items).most_common(1)[0][0]

    def has_preserve(items):  # 4/16/22 메터 포함 = 보존 잠금
        return any(i["검침일"] in (4, 16, 22) for i in items)

    def is_sgg5(items):
        return any("성균관로5길" in (i.get("도로명주소") or "") for i in items)

    def is3ga(items):
        return any(i["법정동"] == "명륜3가" for i in items)

    # 그룹 현재 팀 (베이스, 주소그룹 원자단위라 메터 전부 동일팀)
    def gteam(items):
        return m2t[items[0]["계기번호"]]

    # 새 그룹->팀 매핑 (베이스 복사)
    new_team = {addr: gteam(items) for addr, items in groups.items()}

    # ---- 변경1: D10명3 동북 재배치 ----
    pool = []
    for addr, items in groups.items():
        if modal(items) != 10:
            continue
        if not is3ga(items):
            continue
        if is_sgg5(items):
            continue          # 성균관5길 종로 유지
        if has_preserve(items):
            continue          # hazard: 현 팀 고정
        if has_awms(items):
            new_team[addr] = "중구"  # awms163 전부 중구 고정
            continue
        pool.append((addr, items))

    # pool 내 현재 종로 계기수만큼을 동북우선으로 종로
    target_jn = sum(len(items) for a, items in pool if gteam(items) == "종로")

    def coord(items):
        n = len(items)
        return (sum(i["lat"] for i in items) / n, sum(i["lng"] for i in items) / n)

    # 동북코너 우선: lng+lat 큰 순 (정규화 합)
    lats = [coord(items)[0] for a, items in pool]
    lngs = [coord(items)[1] for a, items in pool]
    lat_min, lat_max = min(lats), max(lats)
    lng_min, lng_max = min(lngs), max(lngs)

    def ne_score(items):
        la, ln = coord(items)
        nlat = (la - lat_min) / (lat_max - lat_min) if lat_max > lat_min else 0
        nlng = (ln - lng_min) / (lng_max - lng_min) if lng_max > lng_min else 0
        return nlat + nlng  # 동북=큰

    pool_sorted = sorted(pool, key=lambda x: -ne_score(x[1]))  # 동북 먼저
    acc = 0
    for addr, items in pool_sorted:
        if acc < target_jn:
            new_team[addr] = "종로"
            acc += len(items)
        else:
            new_team[addr] = "중구"

    # ---- 변경2: D1 + 물음표 그룹 -> 중구 (보존잠금 그룹 제외) ----
    move_addrs = set()
    for r in conv:
        if r["검침일"] == 1 or r["계기번호"] in QM:
            move_addrs.add(r["주소"])
    stranded = []
    moved_groups = []
    for addr in move_addrs:
        items = groups[addr]
        if has_preserve(items):
            stranded.append(addr)   # 4/16/22 보존 위해 고정
            continue
        if new_team[addr] != "중구":
            moved_groups.append((addr, new_team[addr]))
        new_team[addr] = "중구"

    # ---- 출력 ----
    out = {"종로": [], "중구": []}
    for addr, items in groups.items():
        t = new_team[addr]
        for it in items:
            out[t].append(it["계기번호"])
    json.dump(out, open(ASSIGN, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ---- 백스톱 assert: D4/16/22 메터집합 불변 ----
    def day_set(team, day):
        return set(m for m in (base_jongno if team == "종로" else base_junggu)
                   if by_meter.get(m, {}).get("검침일") == day)
    new_j = set(out["종로"]); new_g = set(out["중구"])
    for day in (4, 16, 22):
        ok_j = day_set("종로", day) == set(m for m in new_j if by_meter[m]["검침일"] == day)
        ok_g = day_set("중구", day) == set(m for m in new_g if by_meter[m]["검침일"] == day)
        assert ok_j and ok_g, f"D{day} 배정 변동! 보존 실패"
    print("ASSERT OK: D4/D16/D22 메터집합 베이스와 동일\n")

    report(conv, by_meter, base_jongno, base_junggu, new_j, new_g,
           pool, target_jn, acc, stranded, moved_groups)


def report(conv, by_meter, bj, bg, nj, ng, pool, target_jn, acc, stranded, moved):
    def t_of(m, J): return "종로" if m in J else "중구"
    print(f"전체: 종로 {len(nj):,} / 중구 {len(ng):,} / 합 {len(nj)+len(ng):,}")
    print(f"  (베이스: 종로 {len(bj):,} / 중구 {len(bg):,})\n")

    # D10명3 검증
    d10m3 = [r for r in conv if r["검침일"] == 10 and r["법정동"] == "명륜3가"]
    jn = [r for r in d10m3 if r["계기번호"] in nj]
    jg = [r for r in d10m3 if r["계기번호"] in ng]
    def avg(its, k): return sum(i[k] for i in its)/len(its) if its else 0
    print("=== 변경1: D10 명3 동북 재배치 ===")
    print(f"D10명3 종로 {len(jn)} / 중구 {len(jg)} (비율 {len(jn)/len(d10m3)*100:.1f}:{len(jg)/len(d10m3)*100:.1f})")
    print(f"  종로 lng평균 {avg(jn,'lng'):.6f} > 중구 {avg(jg,'lng'):.6f} (종로 동)? {avg(jn,'lng')>avg(jg,'lng')}")
    print(f"  종로 lat평균 {avg(jn,'lat'):.6f} > 중구 {avg(jg,'lat'):.6f} (종로 북)? {avg(jn,'lat')>avg(jg,'lat')}")
    sgg = [r for r in d10m3 if "성균관로5길" in (r.get("도로명주소") or "")]
    sgg_jn = sum(1 for r in sgg if r["계기번호"] in nj)
    print(f"  성균관로5길 {len(sgg)} 중 종로 {sgg_jn} (전부 종로 유지)")
    print(f"  pool 재배치: 그룹 {len(pool)}, 종로목표 {target_jn} → 실제 {acc}")

    # 변경2
    print("\n=== 변경2: D1 + 물음표 -> 중구 ===")
    d1 = [r for r in conv if r["검침일"] == 1]
    d1_jn = [r for r in d1 if r["계기번호"] in nj]
    print(f"D1 17건 중 종로 잔존 {len(d1_jn)} (보존잠금 stranded)")
    for r in d1_jn:
        print(f"  stranded 종로: {r['계기번호']} | {r['주소']} | grp {sorted(set(i['검침일'] for i in by_meter.values() if i['주소']==r['주소']))}")
    print(f"물음표 2건 식별: TH141895787(D24 수도 미분류), KH141508652(검침16 수도 미분류)")
    for m in ("TH141895787", "KH141508652"):
        print(f"  {m} -> {t_of(m, nj)}")
    print(f"중구로 이동한 그룹 수: {len(moved)} (D10/비4·16·22 메터 끌려간 그룹 포함)")

    # 삼상 / awms / 같은주소
    def phase(r): return parse_phase(r)
    for team, S in (("종로", nj), ("중구", ng)):
        its = [by_meter[m] for m in S]
        sam = sum(1 for i in its if parse_phase(i) == "삼상")
        print(f"\n{team}: 총 {len(its):,} | 단상 {len(its)-sam:,} 삼상 {sam}")

    # 같은주소 분할 0 확인
    groups = defaultdict(list)
    for r in conv: groups[r["주소"]].append(r)
    split = sum(1 for a, items in groups.items()
                if len(set(t_of(i["계기번호"], nj) for i in items)) > 1)
    print(f"\n같은주소 분할 그룹: {split} (0이어야)")

    # awms163 중구
    AWMS = "/Users/woodelight/Projects/ami-work/data/cha10-jongno-20260623-171628.json"
    try:
        awms = json.load(open(AWMS, encoding="utf-8"))
        whm = set(a["WHM_NO"] for a in awms) & set(by_meter)
        teams = set(t_of(w, nj) for w in whm)
        print(f"awms163 ({len(whm)}건) 전부 중구? {teams == {'중구'}} ({teams})")
    except Exception as e:
        print(f"awms163 확인 스킵: {e}")


if __name__ == "__main__":
    main()
