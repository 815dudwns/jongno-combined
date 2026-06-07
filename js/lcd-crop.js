// lcd-crop.js — 철거계기 사진에서 검침값 LCD 영역 크롭 (검증/학습용)
//
// 목적: firebase 업로드 시 사진이 압축(maxW 4096 + q0.85)되어 화질이 떨어진다.
//       그래서 업로드 직전 "원본(풀해상도)"에서 검침값 LCD만 크롭해 별도 저장한다.
//       나중 검증 단계의 7세그먼트 OCR 입력 + 학습 데이터로 쓴다.
//
// 설계 (영준님 지시 2026-06-07):
//   검침 디스플레이가 중요한 걸 작업자가 아니까 "항상 중앙 살짝 위"에 찍는다.
//   → 복잡한 자동검출 불필요. **고정 영역 크롭**으로 충분.
//   → 그 영역에 LCD(흰 바탕 위 어두운 사각형)가 없는 사진 = "문제 사진" 플래그 → 사람이 확인.

const LcdCrop = (() => {

  // 고정 크롭 영역 (이미지 비율). seg7 실측 + test 8장 검증: LCD는 중앙 70%, 세로 35~55%(중앙 살짝 위).
  // LCD를 놓치는 것보다 약간 넓게 잡는 게 안전(OCR 단계에서 7세그먼트 탐색).
  const REGION = { x0: 0.15, x1: 0.85, y0: 0.35, y1: 0.55 };

  // fileOrBlob → 픽셀 + ImageBitmap
  async function _load(fileOrBlob) {
    const img = await createImageBitmap(fileOrBlob);
    const w = img.width, h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    return { img, w, h, data };
  }

  // 고정 영역 안에 "흰 바탕 위 어두운 LCD 사각형"이 있는지 sanity 체크.
  // 반환: { ok, darkRatio, reason }
  //   - 어두운 픽셀 비율이 적당(LCD 숫자/테두리 존재)하면 ok.
  //   - 너무 낮음(전부 흰 명판/하늘) 또는 너무 높음(전부 검정 단자대/그늘) = 문제.
  function _sanity(data, w, h) {
    const x0 = Math.floor(w * REGION.x0), x1 = Math.floor(w * REGION.x1);
    const y0 = Math.floor(h * REGION.y0), y1 = Math.floor(h * REGION.y1);
    let sum = 0, n = 0;
    const vals = [];
    for (let y = y0; y < y1; y += 2) {
      const base = y * w * 4;
      for (let x = x0; x < x1; x += 2) {
        const i = base + x * 4;
        const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += g; n++; vals.push(g);
      }
    }
    if (!n) return { ok: false, darkRatio: 0, reason: 'empty' };
    const mean = sum / n;
    // 영역 내 평균 대비 어두운 픽셀 비율 (LCD 숫자 획·테두리 = 어두움)
    let dark = 0;
    const darkTh = mean * 0.65;
    for (const v of vals) if (v < darkTh) dark++;
    const darkRatio = dark / n;
    // LCD가 있으면 어두운 획이 5~55% 정도. 너무 적으면 흰 명판/배경, 너무 많으면 그늘/단자대.
    if (darkRatio < 0.04) return { ok: false, darkRatio, reason: 'too_bright(LCD 없음 추정)' };
    if (darkRatio > 0.70) return { ok: false, darkRatio, reason: 'too_dark(그늘/단자대 추정)' };
    return { ok: true, darkRatio, reason: '' };
  }

  // 원본에서 고정 영역 LCD 크롭 → Blob (압축 최소: q0.95, 원본 해상도 유지)
  // 반환: { blob, ok, darkRatio, reason, roi }
  //   ok=false 여도 blob은 반환(원본 영역 크롭) — 호출측이 "문제 사진"으로 플래그 가능.
  async function cropLcd(fileOrBlob, quality = 0.95) {
    try {
      const { img, w, h, data } = await _load(fileOrBlob);
      const sanity = _sanity(data, w, h);

      const x = Math.floor(w * REGION.x0);
      const y = Math.floor(h * REGION.y0);
      const cw = Math.floor(w * (REGION.x1 - REGION.x0));
      const ch = Math.floor(h * (REGION.y1 - REGION.y0));

      const out = document.createElement('canvas');
      out.width = cw; out.height = ch;
      out.getContext('2d').drawImage(img, x, y, cw, ch, 0, 0, cw, ch);
      img.close && img.close();

      const blob = await new Promise(res => out.toBlob(res, 'image/jpeg', quality));
      return { blob, ok: sanity.ok, darkRatio: sanity.darkRatio, reason: sanity.reason, roi: [x, y, cw, ch] };
    } catch (e) {
      console.warn('[LcdCrop] 크롭 실패', e);
      return { blob: null, ok: false, darkRatio: 0, reason: 'error:' + e.message, roi: null };
    }
  }

  return { cropLcd, REGION };
})();
