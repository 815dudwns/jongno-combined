// photo-uploader.js — 사진 압축(Canvas) + Firebase Storage 업로드

const PhotoUploader = (() => {

  // 사진 압축: 800px/q40 = awms통과+OCR검증 하한(2026-07-02). 원본이 800px 이하면 업스케일 금지.
  // awms는 저해상도/저용량(과압축) 사진을 "파일 업로드 실패"로 거부 → 800px·q40까지 확인 완료.
  // opts.square=true → 촬영 사진 1:1 센터크롭 (계기교체 촬영본 강제, 업로드본은 원본 비율)
  async function compress(fileOrBlob, opts = {}) {
    const { maxW = 800, quality = 0.40, square = false } = opts;
    const img = await createImageBitmap(fileOrBlob);

    // 소스 사각형: square면 짧은 변 기준 센터크롭, 아니면 원본 전체
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (square) {
      const side = Math.min(img.width, img.height);
      sx = Math.round((img.width - side) / 2);
      sy = Math.round((img.height - side) / 2);
      sw = sh = side;
    }
    const ratio = Math.min(maxW / Math.max(sw, sh), 1);
    const w = Math.round(sw * ratio);
    const h = Math.round(sh * ratio);

    // OffscreenCanvas 우선 (성능), 폴백 = 일반 canvas
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(w, h);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
    }
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

    let blob;
    if (canvas.convertToBlob) {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    } else {
      blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    }
    // canvas가 자동 삽입한 ICC 프로파일 제거 — awms saveRow가 ICC 포함 사진 거부(성공사진은 전부 ICC 없음)
    return await stripICC(blob);
  }

  // JPEG에서 APP2 ICC_PROFILE 세그먼트 제거 (픽셀 무손실)
  async function stripICC(blob) {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) return blob; // JPEG 아니면 그대로
    const out = [0xFF, 0xD8];
    let i = 2;
    while (i < u8.length) {
      if (u8[i] !== 0xFF) { for (; i < u8.length; i++) out.push(u8[i]); break; }
      const marker = u8[i + 1];
      if (marker === 0xDA) { for (; i < u8.length; i++) out.push(u8[i]); break; } // SOS=이미지 데이터
      const len = (u8[i + 2] << 8) | u8[i + 3];
      let isICC = false;
      if (marker === 0xE2) { // APP2
        let sig = '';
        for (let k = i + 4; k < i + 15 && k < u8.length; k++) sig += String.fromCharCode(u8[k]);
        isICC = sig.startsWith('ICC_PROFILE');
      }
      if (!isICC) for (let j = i; j < i + 2 + len; j++) out.push(u8[j]);
      i += 2 + len;
    }
    return new Blob([new Uint8Array(out)], { type: 'image/jpeg' });
  }

  // Firebase Storage 업로드 — path: replacements/{address}/{filename}
  async function upload(blob, path) {
    if (typeof firebase === 'undefined' || !firebase.storage) {
      throw new Error('Firebase Storage SDK 미로드');
    }
    const ref = firebase.storage().ref(path);
    const snap = await ref.put(blob, { contentType: 'image/jpeg' });
    const url = await snap.ref.getDownloadURL();
    return url;
  }

  // 압축 후 업로드 한 번에
  async function compressAndUpload(fileOrBlob, path, opts = {}) {
    const compressed = await compress(fileOrBlob, opts);
    const url = await upload(compressed, path);
    return { url, size: compressed.size };
  }

  // 썸네일 경로 규칙: foo/bar.jpg → foo/bar_thumb.jpg (Storage URL은 토큰이 달라 치환 불가 → URL은 RTDB에 별도 저장)
  function thumbPathOf(path) {
    return /\.jpg$/i.test(path) ? path.replace(/\.jpg$/i, '_thumb.jpg') : path + '_thumb.jpg';
  }

  // 목록(stats) 표시용 썸네일 생성+업로드 (~200px·q0.5 → 장당 10~15KB 목표).
  // 원본과 별개의 추가분 — 실패해도 호출부에서 best-effort로 무시(stats가 원본 폴백).
  async function uploadThumb(fileOrBlob, origPath) {
    const thumb = await compress(fileOrBlob, { maxW: 200, quality: 0.5, square: false });
    return await upload(thumb, thumbPathOf(origPath));
  }

  return { compress, upload, compressAndUpload, thumbPathOf, uploadThumb };
})();
