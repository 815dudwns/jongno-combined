#!/usr/bin/env python3
"""data/jongno-site-data.json → data/jongno-site-data.version.json 생성.
캐시-우선 로더(js/idb.js + map.js loadSiteDataCached)가 이 버전으로 폰 IndexedDB 캐시 무효화 판단.
★ jongno-site-data.json 변경(데이터 수정/추가) 후 반드시 다시 실행할 것.
   (안 하면 작업자 폰이 옛 IndexedDB 캐시 계속 사용 → 데이터 수정이 안 보임)
버전 = 콘텐츠 sha256(앞 12자리) → 내용 바뀌면 자동으로 달라져 캐시 무효화.
"""
import json, hashlib
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "jongno-site-data.json"
OUT = ROOT / "data" / "jongno-site-data.version.json"

raw = SRC.read_bytes()
ver = hashlib.sha256(raw).hexdigest()[:12]
try:
    count = len(json.loads(raw))
except Exception:
    count = -1

OUT.write_text(json.dumps({
    "version": ver,
    "count": count,
    "generated": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
}, ensure_ascii=False), encoding="utf-8")
print(f"jongno-site-data.version.json 생성: version={ver} count={count}")
