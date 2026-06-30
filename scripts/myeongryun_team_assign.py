#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
명륜동 2576건 종로/중구 배분 (검침일 기준 재계산, 영준님 지정 규칙).

방향(지도): lat 큰=북 / lat 작은=남 / lng 큰=동 / lng 작은=서.

검침일별 규칙:
- D4 (342): 종로 통째(전부 종로).
- D10 (1266): 종로=서(lng 작은)부터, 종로 잔여(1000-고정)만큼. 나머지=중구.
- D16 (431): 종로:중구=38.8:61.2 → 종로 ~166. 종로=남(lat 작은) 응집. awms는 중구 고정.
- D22 (519): 종로:중구=38.8:61.2 → 종로 ~201. 3가/비3가 분리:
    * D22∩3가  : 종로=북(lat 큰) 응집
    * D22∩비3가: 삼상 종로/중구 균등(반반)
- D1 (17): 유연(종로총량 조절). D24 (1): 중구.

하드제약:
- 같은 주소=같은 팀 (주소 원자단위, 분할 금지). 그룹 대표 검침일=최빈.
- awms 163계기(주소 32) = 전부 중구 고정.
- 종로 총량 ≈1000 (±50).
"""
import json
from collections import defaultdict, Counter

BASE = "/Users/woodelight/Projects/jongno-combined/data"
AWMS = "/Users/woodelight/Projects/ami-work/data/cha10-jongno-20260623-171628.json"
OUT  = BASE + "/myeongryun-team-assign.json"
PRICE = {"단상": 13000, "삼상": 30000}


def parse_phase(rec):
    """단상삼상: 있으면 그대로. 없으면 계기번호 3~4자리 파싱.
    단상=E17/EA19/G25·26·27/Amigo53, 삼상=G45·46·47/Amigo55. 비숫자/그외=단상."""
    p = rec.get("단상삼상", "")
    if p in ("단상", "삼상"):
        return p
    no = rec["계기번호"]
    digits = no[2:4] if no[:2].isdigit() else ""
    if digits in ("45", "46", "47", "55"):
        return "삼상"
    return "단상"


def main():
    d = json.load(open(BASE + "/myeongryun-converted.json", encoding="utf-8"))
    awms = json.load(open(AWMS, encoding="utf-8"))
    awms_whm = set(a["WHM_NO"] for a in awms)

    for r in d:
        r["_phase"] = parse_phase(r)
        r["_awms"] = r["계기번호"] in awms_whm

    # ---- 주소 그룹핑 ----
    groups = defaultdict(list)
    for r in d:
        groups[r["주소"]].append(r)

    G = {}
    for addr, items in groups.items():
        day = Counter(i["검침일"] for i in items).most_common(1)[0][0]  # 대표=최빈
        G[addr] = {
            "addr": addr, "items": items, "n": len(items),
            "day": day,
            "lat": sum(i["lat"] for i in items) / len(items),
            "lng": sum(i["lng"] for i in items) / len(items),
            "is3ga": any(i["법정동"] == "명륜3가" for i in items),
            "awms": any(i["_awms"] for i in items),
            "n_sam": sum(1 for i in items if i["_phase"] == "삼상"),
        }

    assign = {}

    # ---- awms 그룹: 전부 중구 (최우선 고정) ----
    for addr, g in G.items():
        if g["awms"]:
            assign[addr] = "중구"

    def free(day=None, is3ga=None):
        out = []
        for addr, g in G.items():
            if addr in assign:
                continue
            if day is not None and g["day"] != day:
                continue
            if is3ga is not None and g["is3ga"] != is3ga:
                continue
            out.append(g)
        return out

    def n_of(gs):
        return sum(g["n"] for g in gs)

    def fill(groups_sorted, target):
        """정렬된 그룹을 target 건수까지 종로, 나머지 중구. 실제 채운 건수 반환."""
        acc = 0
        for g in groups_sorted:
            if acc < target:
                assign[g["addr"]] = "종로"; acc += g["n"]
            else:
                assign[g["addr"]] = "중구"
        return acc

    # ---- D4: 전부 종로 ----
    for g in free(day=4):
        assign[g["addr"]] = "종로"

    # ---- D16: 종로 ~38.8%, 남(lat 작은)부터 ----
    n16 = sum(g["n"] for g in G.values() if g["day"] == 16)
    t16 = round(n16 * 0.388)
    fill(sorted(free(day=16), key=lambda g: g["lat"]), t16)  # 남=lat 오름차순

    # ---- D22: 종로 ~38.8%. 3가/비3가 분리 ----
    n22 = sum(g["n"] for g in G.values() if g["day"] == 22)
    t22 = round(n22 * 0.388)
    d22_3  = free(day=22, is3ga=True)
    d22_n3 = free(day=22, is3ga=False)
    n22_3, n22_n3 = n_of(d22_3), n_of(d22_n3)

    # 비3가: 삼상 균등(반반). 종로몫=t22 비례배분. 삼상 큰 그룹부터, 종로삼상≤중구삼상이면 종로.
    t22_n3 = round(t22 * n22_n3 / max(1, n22_3 + n22_n3))
    jr_sam = jg_sam = jr_cnt = 0
    for g in sorted(d22_n3, key=lambda g: (-g["n_sam"], -g["n"])):
        if jr_cnt < t22_n3 and jr_sam <= jg_sam:
            assign[g["addr"]] = "종로"; jr_sam += g["n_sam"]; jr_cnt += g["n"]
        else:
            assign[g["addr"]] = "중구"; jg_sam += g["n_sam"]

    # 3가: 종로 나머지목표=t22 - 비3가종로. 북(lat 큰)부터.
    t22_3 = max(0, t22 - jr_cnt)
    fill(sorted(d22_3, key=lambda g: -g["lat"]), t22_3)  # 북=lat 내림차순

    # ---- 종로 잔여 → D10 서쪽 ----
    def jongno_n():
        return sum(g["n"] for a, g in G.items() if assign.get(a) == "종로")
    remain = 1000 - jongno_n()
    fill(sorted(free(day=10), key=lambda g: g["lng"]), remain)  # 서=lng 오름차순

    # ---- 잔여(D1 유연 / D24 중구) ----
    for addr, g in G.items():
        if addr in assign:
            continue
        if g["day"] == 24:
            assign[addr] = "중구"
        else:  # D1: 종로총량 1000 미만이면 종로, 아니면 중구
            assign[addr] = "종로" if jongno_n() < 1000 else "중구"

    # ---- 매핑 출력 ----
    out = {"종로": [], "중구": []}
    for addr, g in G.items():
        for it in g["items"]:
            out[assign[addr]].append(it["계기번호"])
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("매핑 저장:", OUT)
    print(f"종로 {len(out['종로']):,} / 중구 {len(out['중구']):,} / 합 {len(out['종로'])+len(out['중구']):,}\n")

    report(d, G, assign, awms_whm)


def fmt(n):
    return f"{int(round(n)):,}"


def report(d, G, assign, awms_whm):
    m2t = {it["계기번호"]: assign[a] for a, g in G.items() for it in g["items"]}
    all_items = [i for g in G.values() for i in g["items"]]

    def items_of(pred):
        return [i for a, g in G.items() for i in g["items"] if pred(i, a, g)]
    def latavg(its):
        return sum(i["lat"] for i in its) / len(its) if its else 0
    def lngavg(its):
        return sum(i["lng"] for i in its) / len(its) if its else 0

    # 검침일 × 팀 (실제 계기 검침일 기준)
    print("=== 검침일 × 팀 배분표 (실제 검침일) ===")
    print(f"{'검침일':>6} {'종로':>8} {'중구':>8} {'합계':>8}")
    days = sorted(set(i["검침일"] for i in all_items))
    TJ = TZ = 0
    for day in days:
        jr = sum(1 for i in all_items if i["검침일"] == day and m2t[i["계기번호"]] == "종로")
        jg = sum(1 for i in all_items if i["검침일"] == day and m2t[i["계기번호"]] == "중구")
        TJ += jr; TZ += jg
        print(f"D{day:>4} {fmt(jr):>8} {fmt(jg):>8} {fmt(jr+jg):>8}")
    print(f"{'합계':>5} {fmt(TJ):>8} {fmt(TZ):>8} {fmt(TJ+TZ):>8}")

    # D16
    jr = items_of(lambda i,a,g: i["검침일"]==16 and m2t[i["계기번호"]]=="종로")
    jg = items_of(lambda i,a,g: i["검침일"]==16 and m2t[i["계기번호"]]=="중구")
    t = len(jr)+len(jg)
    print(f"\n=== D16 (목표 38.8:61.2, 종로=남) ===")
    print(f"종로 {fmt(len(jr))} ({len(jr)/t*100:.1f}%) / 중구 {fmt(len(jg))} ({len(jg)/t*100:.1f}%)")
    print(f"종로 lat평균 {latavg(jr):.5f} < 중구 {latavg(jg):.5f} (종로 남)? {latavg(jr)<latavg(jg)}")

    # D22
    jr = items_of(lambda i,a,g: i["검침일"]==22 and m2t[i["계기번호"]]=="종로")
    jg = items_of(lambda i,a,g: i["검침일"]==22 and m2t[i["계기번호"]]=="중구")
    t = len(jr)+len(jg)
    print(f"\n=== D22 (목표 38.8:61.2) ===")
    print(f"종로 {fmt(len(jr))} ({len(jr)/t*100:.1f}%) / 중구 {fmt(len(jg))} ({len(jg)/t*100:.1f}%)")
    jr3 = items_of(lambda i,a,g: i["검침일"]==22 and i["법정동"]=="명륜3가" and m2t[i["계기번호"]]=="종로")
    jg3 = items_of(lambda i,a,g: i["검침일"]==22 and i["법정동"]=="명륜3가" and m2t[i["계기번호"]]=="중구")
    print(f"  [3가] 종로 {fmt(len(jr3))} 중구 {fmt(len(jg3))} | 종로 lat {latavg(jr3):.5f} > 중구 {latavg(jg3):.5f} (종로 북)? {latavg(jr3)>latavg(jg3)}")
    jrn = items_of(lambda i,a,g: i["검침일"]==22 and i["법정동"]!="명륜3가" and m2t[i["계기번호"]]=="종로")
    jgn = items_of(lambda i,a,g: i["검침일"]==22 and i["법정동"]!="명륜3가" and m2t[i["계기번호"]]=="중구")
    sjr = sum(1 for i in jrn if i["_phase"]=="삼상"); sjg = sum(1 for i in jgn if i["_phase"]=="삼상")
    print(f"  [비3가] 종로 {fmt(len(jrn))} 중구 {fmt(len(jgn))} | 삼상 종로 {sjr} 중구 {sjg} (균등목표)")

    # D10
    jr = items_of(lambda i,a,g: i["검침일"]==10 and m2t[i["계기번호"]]=="종로")
    jg = items_of(lambda i,a,g: i["검침일"]==10 and m2t[i["계기번호"]]=="중구")
    print(f"\n=== D10 (종로=서, lng 작은) ===")
    print(f"종로 {fmt(len(jr))} / 중구 {fmt(len(jg))}")
    print(f"종로 lng평균 {lngavg(jr):.5f} < 중구 {lngavg(jg):.5f} (종로 서)? {lngavg(jr)<lngavg(jg)}")

    # 전체 단상/삼상/매출
    print(f"\n=== 전체 종로/중구 (단상/삼상/매출) ===")
    tot_sales = 0
    for team in ("종로", "중구"):
        its = [i for i in all_items if m2t[i["계기번호"]] == team]
        n = len(its); sam = sum(1 for i in its if i["_phase"]=="삼상"); dan = n-sam
        sales = dan*PRICE["단상"] + sam*PRICE["삼상"]; tot_sales += sales
        print(f"{team}: 총 {fmt(n)} | 단상 {fmt(dan)} 삼상 {fmt(sam)} (삼상 {sam/n*100:.1f}%) | 매출 {fmt(sales)}원")
    jr_sales = sum(PRICE[i["_phase"]] for i in all_items if m2t[i["계기번호"]]=="종로")
    print(f"전체 매출 {fmt(tot_sales)}원 | 종로 매출비중 {jr_sales/tot_sales*100:.1f}%")

    # awms / 분할 / 가별
    print(f"\nawms163 전부 중구? {set(m2t[w] for w in awms_whm)=={'중구'}} ({dict(Counter(m2t[w] for w in awms_whm))})")
    split = sum(1 for a, g in G.items() if len(set(m2t[i["계기번호"]] for i in g["items"]))>1)
    print(f"같은주소 분할 그룹: {split} (0이어야)")
    print("가(법정동)별:")
    for dong in ["명륜1가","명륜2가","명륜3가","명륜4가"]:
        jr = sum(1 for i in all_items if i["법정동"]==dong and m2t[i["계기번호"]]=="종로")
        jg = sum(1 for i in all_items if i["법정동"]==dong and m2t[i["계기번호"]]=="중구")
        print(f"  {dong}: 종로 {fmt(jr)} / 중구 {fmt(jg)}")
    print(f"\n종로 총량 {fmt(TJ)} (목표 ~1,000)")


if __name__ == "__main__":
    main()
